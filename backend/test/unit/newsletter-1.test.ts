import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { inspect } from "node:util";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md) — the backend of the newsletter signup, run through the real handlers:
 * `POST /leads` (leads/create.ts → leads/newsletter.ts → lib/mailerlite.ts), `POST /leads/{email}/push` (leads/push.ts),
 * `GET /leads`, `DELETE /leads/{email}`, `GET /public/popups`, `GET /settings`, `GET /settings/secrets`, `PUT /settings`.
 *
 * Mocked: `db.js` — an in-memory table that runs a transaction all-or-nothing, evaluates exactly the condition and update
 * expressions these handlers write (and throws on any other), pages its Query answers (`pageSize`), honours the SDK's
 * `abortSignal`, and can hold one kind of write until it is released or aborted; `events.js` (audit events are collected);
 * the global `fetch` — the local stand-in for MailerLite: it plays each answer the MailerLite documentation names (201
 * created, 200 already in the list, 422 invalid data, 401 bad token, 429 rate limited), a 500, a hang (aborted by the
 * caller's signal) and a connection failure; it also answers Google's reCAPTCHA check. Credential-free; nothing leaves the
 * process. Every console line is collected for the sentinel checks. "Ruling N" = the packet's ruling; "NL1-Rn" = a
 * review-0 finding.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => {
    delete process.env.RECAPTCHA_SECRET_KEY;
    return { ddbSend: vi.fn(), mockAudit: vi.fn() };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { handler as createLead } from "../../src/leads/create.js";
import { handler as pushLead } from "../../src/leads/push.js";
import { handler as listLeads } from "../../src/leads/list.js";
import { handler as deleteLead } from "../../src/leads/delete.js";
import { handler as publicPopups } from "../../src/popups/public-list.js";
import { getHandler as getSettings, updateHandler as putSettings } from "../../src/tenant/settings.js";
import { handler as getSecrets } from "../../src/tenant/settings-secrets.js";
import { MAILERLITE_SUBSCRIBERS_URL, MAILERLITE_API_VERSION, PUSH_TIMEOUT_MS } from "../../src/lib/mailerlite.js";
import { POST_STORE_DEADLINE_MS } from "../../src/leads/newsletter.js";
import { LANGUAGE_PACKS, newsletterCanSendAgain, NewsletterPushSchema, NewsletterSubscriptionSchema, type NewsletterPush } from "@amodx/shared";

const T = "t1";
const SENTINEL_TOKEN = "SENTINEL-ML-TOKEN-7f3c9d";
const GROUP = "112233445566";
const EMAIL = "reader.sentinel@example.test";
const EN_CONSENT = LANGUAGE_PACKS.en.site.newsletterConsent!;

// ── the in-memory table ──────────────────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
let table: Map<string, Row>;
const k = (pk: string, sk: string) => `${pk}|${sk}`;
const item = (pk: string, sk: string) => table.get(k(pk, sk));
const failure = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name, ...extra });
let pageSize = Infinity;
/** A command kind to hold until released (`release()`) or aborted by its `abortSignal`. */
let hold: ((cmd: any) => boolean) | null = null;
let releaseHeld: (() => void)[] = [];
/** Called before a matching command runs (to interleave two requests). */
let beforeSend: ((cmd: any) => Promise<void>) | null = null;
/** Makes a matching command fail with a non-condition error. */
let failWhen: ((cmd: any) => boolean) | null = null;
/** NL1-WRITE-ACK-UNCERTAINTY: the write COMMITS, then its acknowledgement never comes (the client sees only its abort). */
let ackLost: ((cmd: any) => boolean) | null = null;
/** NL1-WRITE-ACK-UNCERTAINTY: the write commits only when released — the client's abort does not roll it back. */
let delayedCommit: ((cmd: any) => boolean) | null = null;
let releaseCommits: (() => void)[] = [];

const pathOf = (path: string, names: Record<string, string> = {}) => path.split(".").map((p) => names[p] ?? p);
const get = (row: Row | undefined, path: string[]) => path.reduce<any>((v, p) => (v === undefined || v === null ? undefined : v[p]), row);

function conditionHolds(expr: string | undefined, row: Row | undefined, names: Record<string, string> = {}, values: Record<string, any> = {}): boolean {
    if (expr === undefined) return true;
    return expr.split(" AND ").every((term) => {
        let m = /^attribute_not_exists\(([^)]+)\)$/.exec(term);
        if (m) return row === undefined || get(row, pathOf(m[1], names)) === undefined;
        m = /^attribute_exists\(([^)]+)\)$/.exec(term);
        if (m) return row !== undefined && get(row, pathOf(m[1], names)) !== undefined;
        m = /^([#\w.]+) = (:\w+)$/.exec(term);
        if (m) return row !== undefined && get(row, pathOf(m[1], names)) !== undefined && get(row, pathOf(m[1], names)) === values[m[2]];
        throw new Error(`unmocked condition: ${term}`);
    });
}

function applyUpdate(key: { PK: string; SK: string }, expr: string, names: Record<string, string> = {}, values: Record<string, any> = {}) {
    if (!expr.startsWith("SET ")) throw new Error(`unmocked update: ${expr}`);
    const row: Row = table.get(k(key.PK, key.SK)) ?? { PK: key.PK, SK: key.SK };
    const assignments = [...expr.slice(4).matchAll(/(#?\w+)\s*=\s*(?:if_not_exists\((#?\w+),\s*(:\w+)\)|(:\w+))/g)];
    if (assignments.length === 0) throw new Error(`unmocked update: ${expr}`);
    for (const a of assignments) {
        const attr = names[a[1]] ?? a[1];
        if (a[3] !== undefined) { if (row[attr] === undefined) row[attr] = structuredClone(values[a[3]]); }
        else row[attr] = structuredClone(values[a[4]]);
    }
    table.set(k(key.PK, key.SK), row);
}

function project(row: Row, projection: string | undefined, names: Record<string, string> = {}) {
    if (!projection) return structuredClone(row);
    const out: Row = {};
    for (const raw of projection.split(",").map((s) => s.trim())) {
        const name = names[raw] ?? raw;
        if (Object.hasOwn(row, name)) out[name] = structuredClone(row[name]);
    }
    return out;
}

/** One transact item → its key and a closure that applies it (after every condition held). */
function transactPart(t: any): { key: { PK: string; SK: string }; holds: () => boolean; apply: () => void } {
    if (t.Put) { const p = t.Put; return { key: p.Item, holds: () => conditionHolds(p.ConditionExpression, item(p.Item.PK, p.Item.SK), p.ExpressionAttributeNames, p.ExpressionAttributeValues), apply: () => table.set(k(p.Item.PK, p.Item.SK), structuredClone(p.Item)) }; }
    if (t.Update) { const u = t.Update; return { key: u.Key, holds: () => conditionHolds(u.ConditionExpression, item(u.Key.PK, u.Key.SK), u.ExpressionAttributeNames, u.ExpressionAttributeValues), apply: () => applyUpdate(u.Key, u.UpdateExpression, u.ExpressionAttributeNames, u.ExpressionAttributeValues) }; }
    if (t.ConditionCheck) { const c = t.ConditionCheck; return { key: c.Key, holds: () => conditionHolds(c.ConditionExpression, item(c.Key.PK, c.Key.SK), c.ExpressionAttributeNames, c.ExpressionAttributeValues), apply: () => {} }; }
    if (t.Delete) { const d = t.Delete; return { key: d.Key, holds: () => conditionHolds(d.ConditionExpression, item(d.Key.PK, d.Key.SK), d.ExpressionAttributeNames, d.ExpressionAttributeValues), apply: () => { table.delete(k(d.Key.PK, d.Key.SK)); } }; }
    throw new Error(`unmocked transact item: ${Object.keys(t)}`);
}

async function run(cmd: any): Promise<any> {
    const input = cmd.input;
    if (failWhen?.(cmd)) throw failure("ProvisionedThroughputExceededException", { message: `throttled for ${JSON.stringify(input)}` });
    if (cmd instanceof GetCommand) {
        const row = item(input.Key.PK, input.Key.SK);
        return row ? { Item: project(row, input.ProjectionExpression, input.ExpressionAttributeNames) } : {};
    }
    if (cmd instanceof PutCommand) {
        if (!conditionHolds(input.ConditionExpression, item(input.Item.PK, input.Item.SK), input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw failure("ConditionalCheckFailedException");
        table.set(k(input.Item.PK, input.Item.SK), structuredClone(input.Item));
        return {};
    }
    if (cmd instanceof UpdateCommand) {
        if (input.UpdateExpression?.startsWith("SET dueAt")) return {};
        if (!conditionHolds(input.ConditionExpression, item(input.Key.PK, input.Key.SK), input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw failure("ConditionalCheckFailedException");
        applyUpdate(input.Key, input.UpdateExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        return {};
    }
    if (cmd instanceof DeleteCommand) { table.delete(k(input.Key.PK, input.Key.SK)); return {}; }
    if (cmd instanceof TransactWriteCommand) {
        const parts = input.TransactItems.map(transactPart);
        const reasons = parts.map((p: ReturnType<typeof transactPart>) => ({ Code: p.holds() ? "None" : "ConditionalCheckFailed" }));
        if (reasons.some((r: { Code: string }) => r.Code !== "None")) throw failure("TransactionCanceledException", { CancellationReasons: reasons });
        for (const p of parts) p.apply();
        return {};
    }
    if (cmd instanceof QueryCommand) {
        if (input.IndexName) return { Items: [] };     // GSI_Domain: no tenant holds a foreign origin's host
        const v = input.ExpressionAttributeValues;
        const rows = [...table.values()].filter((r) => r.PK === v[":pk"] && String(r.SK).startsWith(v[":sk"])).sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        const from = input.ExclusiveStartKey ? rows.findIndex((r) => r.SK === input.ExclusiveStartKey.SK) + 1 : 0;
        const page = rows.slice(from, from + pageSize);
        const last = from + pageSize < rows.length ? { LastEvaluatedKey: { PK: v[":pk"], SK: page[page.length - 1].SK } } : {};
        return { Items: page.map((r) => project(r, input.ProjectionExpression, input.ExpressionAttributeNames)), ...last };
    }
    throw new Error(`unmocked command: ${cmd.constructor.name}`);
}

function mockTable() {
    ddbSend.mockImplementation(async (cmd: any, options?: { abortSignal?: AbortSignal }) => {
        if (beforeSend) await beforeSend(cmd);
        if (ackLost?.(cmd)) {
            await run(cmd);
            return new Promise((_, reject) => options?.abortSignal?.addEventListener("abort", () => reject(failure("AbortError"))));
        }
        if (delayedCommit?.(cmd)) {
            const committed = new Promise<void>((resolve) => releaseCommits.push(resolve)).then(() => run(cmd));
            return new Promise((resolve, reject) => {
                options?.abortSignal?.addEventListener("abort", () => reject(failure("AbortError")));
                committed.then(resolve, reject);
            });
        }
        if (hold?.(cmd)) {
            await new Promise<void>((resolve, reject) => {
                releaseHeld.push(resolve);
                options?.abortSignal?.addEventListener("abort", () => reject(failure("AbortError")));
            });
        }
        return run(cmd);
    });
}

const tenantRecord = (over: Record<string, any> = {}) => ({
    PK: "SYSTEM", SK: `TENANT#${T}`, id: T, name: "Tenant One", domain: "t1.test", Domain: "t1.test", locale: "en-US",
    integrations: { contactEmail: "office@t1.test", mailerlite: { apiToken: SENTINEL_TOKEN, groupId: GROUP } },
    ...over,
});
const putTenant = (over: Record<string, any> = {}) => table.set(k("SYSTEM", `TENANT#${T}`), tenantRecord(over));

// ── the MailerLite stand-in (global fetch) ──────────────────────────────────────────────────────────────────────────
type Answer = { status: number; body?: unknown } | "hang" | "network";
let answers: Answer[];
let mlCalls: { url: string; init: RequestInit }[];
let recaptchaSuccess = true;

async function standIn(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const href = String(url);
    if (href.startsWith("https://www.google.com/recaptcha/")) {
        return new Response(JSON.stringify({ success: recaptchaSuccess, score: recaptchaSuccess ? 0.9 : 0.1 }), { status: 200 });
    }
    if (href !== MAILERLITE_SUBSCRIBERS_URL) return new Response("", { status: 200 }); // best-effort side calls (page purge)
    mlCalls.push({ url: href, init });
    const answer = answers.shift() ?? { status: 201 };
    if (answer === "network") throw new TypeError("fetch failed");
    if (answer === "hang") {
        return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    }
    // Bodies as documented (developers.mailerlite.com/docs/): the 200/201 body echoes the subscriber with its address.
    const body = answer.body ?? (answer.status < 300 ? { data: { email: JSON.parse(String(init.body)).email, groups: [] } }
        : answer.status === 401 ? { message: "Unauthenticated." }
        : answer.status === 422 ? { message: "The given data was invalid.", errors: { email: ["The email must be a valid email address."] } }
        : answer.status === 429 ? { message: "Too Many Attempts." } : { message: "Server Error" });
    return new Response(JSON.stringify(body), { status: answer.status, headers: { "Content-Type": "application/json" } });
}

// ── events and calls ────────────────────────────────────────────────────────────────────────────────────────────────
let consoleLines: string[];
const ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: T };

type Res = { statusCode: number; body: string };
const call = async (h: any, event: Record<string, any>) => (await h(event, {} as any, () => {})) as Res;
const rawSignup = (rawBody: string, headers: Record<string, string> = {}, role: string | null = "RENDERER") => call(createLead, {
    headers: { "x-tenant-id": T, ...headers },
    requestContext: { authorizer: role ? { lambda: { role } } : undefined, http: { sourceIp: "127.0.0.1" } },
    body: rawBody,
});
const signup = (body: Record<string, unknown>, headers: Record<string, string> = {}, role: string | null = "RENDERER") => rawSignup(JSON.stringify(body), headers, role);
const newsletterBody = (over: Record<string, unknown> = {}) => ({
    email: EMAIL, source: "newsletter", consentText: EN_CONSENT, consentLocale: "en-US", data: { referral: null, userAgent: "vitest" }, ...over,
});
const admin = (h: any, over: Record<string, any> = {}) => call(h, {
    headers: { "x-tenant-id": T }, requestContext: { authorizer: { lambda: ADMIN }, http: { sourceIp: "127.0.0.1" } }, ...over,
});
const sendAgain = (email = EMAIL) => admin(pushLead, { pathParameters: { email: encodeURIComponent(email) } });
const subscription = (email = EMAIL) => item(`TENANT#${T}`, `NEWSLETTER#${email.toLowerCase()}`);
const lead = (email = EMAIL) => item(`TENANT#${T}`, `LEAD#${email}`);
const rowsOf = (prefix: string) => [...table.values()].filter((r) => String(r.SK).startsWith(prefix));
const pushOf = () => subscription()!.push as NewsletterPush;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
    table = new Map();
    pageSize = Infinity;
    hold = null;
    releaseHeld = [];
    beforeSend = null;
    failWhen = null;
    answers = [];
    mlCalls = [];
    recaptchaSuccess = true;
    consoleLines = [];
    ddbSend.mockReset();
    mockTable();
    mockAudit.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn(standIn));
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { consoleLines.push(args.map((a) => typeof a === "string" ? a : inspect(a, { depth: 8 })).join(" ")); });
    }
    putTenant();
});
/** NL1-R8 invariant, checked after EVERY test: a subscription `NEWSLETTER#<n>` never exists without its lead `LEAD#<n>`. */
function orphanSubscriptions(): string[] {
    return rowsOf("NEWSLETTER#").filter((sub) => !table.has(k(sub.PK, `LEAD#${String(sub.SK).slice("NEWSLETTER#".length)}`))).map((sub) => sub.SK);
}
afterEach(() => {
    releaseHeld.forEach((r) => r());
    expect(orphanSubscriptions(), "a subscription without its normalized lead").toEqual([]);
    ackLost = null; delayedCommit = null; releaseCommits = [];
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

// ── Evidence taxonomy of the specification ──────────────────────────────────────────────────────────────────────────
describe("Evidence taxonomy (newsletter-1.md)", () => {
    it("ET1 no settings → the address is stored, no call out (push NoSettings)", async () => {
        putTenant({ integrations: { contactEmail: "office@t1.test" } });
        const res = await signup(newsletterBody());
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body)).toEqual({ message: "Subscribed" });
        expect(lead()).toMatchObject({ email: EMAIL, source: "newsletter", status: "New", Type: "Lead" });
        expect(pushOf()).toEqual({ state: "NoSettings" });
        expect(mlCalls).toHaveLength(0);
    });

    it("ET2 valid settings → one subscriber in the group: one documented call (URL, Bearer token, JSON headers, version, { email, groups })", async () => {
        const res = await signup(newsletterBody());
        expect(res.statusCode).toBe(201);
        expect(mlCalls).toHaveLength(1);
        const { url, init } = mlCalls[0];
        expect(url).toBe("https://connect.mailerlite.com/api/subscribers");
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({ Authorization: `Bearer ${SENTINEL_TOKEN}`, "Content-Type": "application/json", Accept: "application/json", "X-Version": MAILERLITE_API_VERSION });
        expect(JSON.parse(String(init.body))).toEqual({ email: EMAIL, groups: [GROUP] });
        expect(pushOf()).toMatchObject({ state: "Sent" });
        expect(NewsletterSubscriptionSchema.safeParse(subscription()).success).toBe(true);
    });

    it("ET3 same address twice → one lead, one subscription, success both times; MailerLite's 200 (already in the list) is Sent", async () => {
        answers = [{ status: 201 }];
        expect((await signup(newsletterBody())).statusCode).toBe(201);
        expect((await signup(newsletterBody({ email: `  ${EMAIL.toUpperCase()} ` }))).statusCode).toBe(201);   // the same address, normalized
        expect(rowsOf("LEAD#")).toHaveLength(1);
        expect(rowsOf("NEWSLETTER#")).toHaveLength(1);
        expect(mlCalls).toHaveLength(1);                     // the same consent again sends nothing (ruling 12)
        subscription()!.push = { state: "Failed", at: "2026-11-27T00:00:00.000Z", reason: { kind: "timeout" }, attempt: "a-old" };
        answers = [{ status: 200 }];
        expect((await sendAgain()).statusCode).toBe(200);
        expect(pushOf().state).toBe("Sent");
    });

    for (const [label, answer, reason] of [
        ["422 invalid data", { status: 422 }, { kind: "http", status: 422 }],
        ["401 bad token", { status: 401 }, { kind: "http", status: 401 }],
        ["429 rate limited", { status: 429 }, { kind: "http", status: 429 }],
        ["500 server error", { status: 500 }, { kind: "http", status: 500 }],
        ["no connection", "network", { kind: "network" }],
    ] as const) {
        it(`ET4 MailerLite answers ${label} → the signup answers success; Failed(reason, at) is recorded`, async () => {
            answers = [answer as Answer];
            const res = await signup(newsletterBody());
            expect(res.statusCode).toBe(201);
            expect(JSON.parse(res.body)).toEqual({ message: "Subscribed" });
            const push = pushOf();
            expect(push).toMatchObject({ state: "Failed", reason });
            expect(NewsletterPushSchema.safeParse(push).success).toBe(true);
        });
    }

    it(`ET4 MailerLite does not answer → after ${PUSH_TIMEOUT_MS} ms the signup answers success; Failed(timeout) is recorded`, async () => {
        answers = ["hang"];
        const started = Date.now();
        const res = await signup(newsletterBody());
        const elapsed = Date.now() - started;
        expect(res.statusCode).toBe(201);
        expect(pushOf()).toMatchObject({ state: "Failed", reason: { kind: "timeout" } });
        expect(elapsed).toBeGreaterThanOrEqual(PUSH_TIMEOUT_MS - 50);
        expect(elapsed).toBeLessThan(PUSH_TIMEOUT_MS + 800);
    }, 10_000);

    it("ET5 consent absent in the request (no line, no locale, not a string) → 400, nothing stored, nothing sent", async () => {
        for (const body of [newsletterBody({ consentText: undefined }), newsletterBody({ consentText: "" }), newsletterBody({ consentText: true }), newsletterBody({ consentLocale: undefined })]) {
            const res = await signup(body);
            expect(res.statusCode).toBe(400);
            expect(table.size).toBe(1);                      // the tenant record only
            expect(mlCalls).toHaveLength(0);
        }
        expect((await signup(newsletterBody({ email: "not-an-address" }))).statusCode).toBe(400);
        expect(table.size).toBe(1);
    });

    it("ET6 foreign origin → 403; failed reCAPTCHA → 403; nothing stored, nothing sent", async () => {
        const foreign = await signup(newsletterBody(), { origin: "https://evil.example" }, null);
        expect(foreign.statusCode).toBe(403);
        putTenant({ recaptcha: { siteKey: "site", secretKey: "secret", threshold: 0.5 } });
        recaptchaSuccess = false;
        const bot = await signup(newsletterBody({ recaptchaToken: "tok" }));
        expect(bot.statusCode).toBe(403);
        const noToken = await signup(newsletterBody());
        expect(noToken.statusCode).toBe(400);
        expect(rowsOf("LEAD#")).toHaveLength(0);
        expect(rowsOf("NEWSLETTER#")).toHaveLength(0);
        expect(mlCalls).toHaveLength(0);
    });
});

// ── Storage ruling NL1-CONSENT-STORAGE = A ──────────────────────────────────────────────────────────────────────────
describe("Storage A — one transaction for the signup, one for the deletion (finding NL1-R5)", () => {
    const writesOf = () => ddbSend.mock.calls.map(([c]) => c).filter((c) => c instanceof TransactWriteCommand || c instanceof PutCommand || c instanceof UpdateCommand && c.input.UpdateExpression !== "SET #push = :push");

    it("no lead yet → ONE transaction: the lead (conditional on its absence) and the subscription with its consent", async () => {
        putTenant({ integrations: {} });
        await signup(newsletterBody());
        const writes = writesOf();
        expect(writes).toHaveLength(1);
        expect(writes[0].input.TransactItems.map((t: any) => Object.keys(t)[0])).toEqual(["Put", "Put"]);
        expect(writes[0].input.TransactItems[0].Put.ConditionExpression).toBe("attribute_not_exists(SK)");
        expect(lead()).toMatchObject({ email: EMAIL, source: "newsletter" });
        expect(subscription()!.consent).toMatchObject({ text: EN_CONSENT, locale: "en-US" });
    });

    it("an existing lead is NOT written: the transaction only checks it is there (ConditionCheck); every value and attribute stays", async () => {
        putTenant({ integrations: {} });
        table.set(k(`TENANT#${T}`, `LEAD#${EMAIL}`), { PK: `TENANT#${T}`, SK: `LEAD#${EMAIL}`, id: "lead-1", email: EMAIL, name: "Ana", source: "Comment", status: "Contacted", createdAt: "2026-01-01T00:00:00.000Z", Type: "Lead" });
        const before = structuredClone(lead());
        await signup(newsletterBody());
        const writes = writesOf();
        expect(writes).toHaveLength(1);
        expect(writes[0].input.TransactItems.map((t: any) => Object.keys(t)[0])).toEqual(["ConditionCheck", "Put"]);
        expect(lead()).toEqual(before);                     // no attribute added (no `data`, no `tenantId`), none changed
        expect(subscription()).toBeDefined();
    });

    it("the lead is deleted between the read and the transaction → the transaction is cancelled, read again, and both items end up stored", async () => {
        putTenant({ integrations: {} });
        table.set(k(`TENANT#${T}`, `LEAD#${EMAIL}`), { PK: `TENANT#${T}`, SK: `LEAD#${EMAIL}`, id: "lead-1", email: EMAIL, Type: "Lead" });
        let once = true;
        beforeSend = async (c) => { if (c instanceof TransactWriteCommand && once) { once = false; table.delete(k(`TENANT#${T}`, `LEAD#${EMAIL}`)); } };
        expect((await signup(newsletterBody())).statusCode).toBe(201);
        expect(writesOf()).toHaveLength(2);
        expect(lead()).toMatchObject({ source: "newsletter" });
        expect(subscription()).toBeDefined();
    });

    it("the transaction fails (throttled) → 500, NEITHER the lead nor the subscription is stored, nothing is sent; the log names the error only", async () => {
        failWhen = (c) => c instanceof TransactWriteCommand;
        const res = await signup(newsletterBody());
        expect(res.statusCode).toBe(500);
        expect(rowsOf("LEAD#")).toHaveLength(0);
        expect(rowsOf("NEWSLETTER#")).toHaveLength(0);
        expect(mlCalls).toHaveLength(0);
        expect(consoleLines.join("\n")).toContain("error=ProvisionedThroughputExceededException");
        expect(consoleLines.join("\n")).not.toContain(EMAIL);
    });

    it("deleting the normalized lead is ONE transaction that removes the lead and its subscription; a failed transaction removes neither", async () => {
        await signup(newsletterBody());
        failWhen = (c) => c instanceof TransactWriteCommand;
        expect((await admin(deleteLead, { pathParameters: { email: encodeURIComponent(EMAIL) } })).statusCode).toBe(500);
        expect(lead()).toBeDefined();
        expect(subscription()).toBeDefined();
        failWhen = null;
        ddbSend.mockClear();
        expect((await admin(deleteLead, { pathParameters: { email: encodeURIComponent(EMAIL) } })).statusCode).toBe(200);
        const sent = ddbSend.mock.calls.map(([c]) => c);
        expect(sent).toHaveLength(1);
        expect(sent[0].input.TransactItems.map((t: any) => t.Delete.Key.SK)).toEqual([`LEAD#${EMAIL}`, `NEWSLETTER#${EMAIL}`]);
        expect(lead()).toBeUndefined();
        expect(subscription()).toBeUndefined();
    });
});

// ── Rulings ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Ruling 3 / finding NL1-R3 — consent is a fact with its evidence (time, locale, exact line)", () => {
    it("the subscription holds an id, the time, the presentation locale and the exact line of its locale table (German pack for de-DE)", async () => {
        putTenant({ locale: "de-DE" });
        const text = LANGUAGE_PACKS.de.site.newsletterConsent!;
        const before = Date.now();
        expect((await signup(newsletterBody({ consentText: text, consentLocale: "de-DE" }))).statusCode).toBe(201);
        const consent = subscription()!.consent;
        expect(consent).toEqual({ id: expect.any(String), at: expect.any(String), locale: "de-DE", text });
        expect(Date.parse(consent.at)).toBeGreaterThanOrEqual(before - 1);
    });

    it("the SAME text in two locales: the locale is the one the browser sent with the line, never inferred from the text", async () => {
        const fr = LANGUAGE_PACKS.fr.site.newsletterConsent!;
        putTenant({ locale: "en-US", siteStrings: { newsletterConsent: fr }, languages: ["fr"] });   // English site whose own line equals the French pack's
        expect((await signup(newsletterBody({ consentText: fr, consentLocale: "fr" }))).statusCode).toBe(201);
        expect(subscription()!.consent).toMatchObject({ locale: "fr", text: fr });
        table.delete(k(`TENANT#${T}`, `NEWSLETTER#${EMAIL}`));
        expect((await signup(newsletterBody({ consentText: fr, consentLocale: "en-US" }))).statusCode).toBe(201);
        expect(subscription()!.consent).toMatchObject({ locale: "en-US", text: fr });
        table.delete(k(`TENANT#${T}`, `NEWSLETTER#${EMAIL}`));
        expect((await signup(newsletterBody({ consentText: fr, consentLocale: "de-DE" }))).statusCode).toBe(409);   // not a locale the site shows
        expect(rowsOf("NEWSLETTER#")).toHaveLength(0);
    });

    it("an extra language (LANG-1): its pack's line with its locale is accepted; another language's line, or a line with the wrong locale → 409", async () => {
        putTenant({ locale: "ro-RO", languages: ["fr"] });
        expect((await signup(newsletterBody({ consentText: LANGUAGE_PACKS.de.site.newsletterConsent, consentLocale: "de" }))).statusCode).toBe(409);
        expect((await signup(newsletterBody({ consentText: LANGUAGE_PACKS.fr.site.newsletterConsent, consentLocale: "ro-RO" }))).statusCode).toBe(409);
        expect((await signup(newsletterBody({ consentText: LANGUAGE_PACKS.fr.site.newsletterConsent, consentLocale: "fr" }))).statusCode).toBe(201);
        expect(subscription()!.consent).toMatchObject({ locale: "fr", text: LANGUAGE_PACKS.fr.site.newsletterConsent });
    });

    it("the tenant's own line (Labels) is the one checked and stored; a line the table does not give now → 409, nothing stored", async () => {
        const own = "Da, trimiteți-mi scrisoarea Atelierului.";
        putTenant({ locale: "ro-RO", siteStrings: { newsletterConsent: own } });
        expect((await signup(newsletterBody({ consentText: LANGUAGE_PACKS.ro.site.newsletterConsent, consentLocale: "ro-RO" }))).statusCode).toBe(409);
        expect((await signup(newsletterBody({ consentText: "I agree to anything", consentLocale: "ro-RO" }))).statusCode).toBe(409);
        expect(table.size).toBe(1);
        expect((await signup(newsletterBody({ consentText: own, consentLocale: "ro-RO" }))).statusCode).toBe(201);
        expect(subscription()!.consent).toMatchObject({ locale: "ro-RO", text: own });
    });
});

describe("Ruling 5 / NL1-R4 / NL1-WRITE-ACK-UNCERTAINTY = A — the answer within 4 s; the result write is `recorded` or `unconfirmed`; the STORED state is the truth", () => {
    it(`MailerLite answers at once but the result write is held → the answer comes at the deadline (${POST_STORE_DEADLINE_MS} ms); the write never committed, so the stored state is Pending; Send again recovers it`, async () => {
        hold = (c) => c instanceof UpdateCommand && c.input.UpdateExpression === "SET #push = :push";
        const started = Date.now();
        const res = await signup(newsletterBody());
        const elapsed = Date.now() - started;
        expect(res.statusCode).toBe(201);
        expect(elapsed).toBeGreaterThanOrEqual(POST_STORE_DEADLINE_MS - 50);
        expect(elapsed).toBeLessThan(POST_STORE_DEADLINE_MS + 800);
        expect(pushOf().state).toBe("Pending");
        expect(newsletterCanSendAgain(pushOf())).toBe(true);
        hold = null;
        const again = await sendAgain();
        expect(JSON.parse(again.body)).toMatchObject({ resultWrite: "recorded", push: { state: "Sent" } });
        expect(pushOf().state).toBe("Sent");
    }, 15_000);

    it("COMMITTED but the acknowledgement is lost → Send again answers `unconfirmed` at the deadline; the stored state is Sent (a later read is the truth)", async () => {
        putTenant({ integrations: {} });
        await signup(newsletterBody());
        putTenant();
        ackLost = (c) => c instanceof UpdateCommand && c.input.UpdateExpression === "SET #push = :push";
        const started = Date.now();
        const res = await sendAgain();
        expect(Date.now() - started).toBeLessThan(POST_STORE_DEADLINE_MS + 800);
        expect(JSON.parse(res.body)).toEqual({ push: { state: "Sent", at: expect.any(String), attempt: expect.any(String) }, resultWrite: "unconfirmed" });
        expect(pushOf().state).toBe("Sent");                 // committed: "unconfirmed" never claimed it was not
        expect(mockAudit.mock.calls[0][0].details).toEqual({ mailerliteAnswer: "Sent", resultWrite: "unconfirmed" });
    }, 15_000);

    it("a DELAYED commit (after the client gave up) → the answer is `unconfirmed` at the deadline with Pending stored; the write lands later and a later read shows Sent", async () => {
        putTenant({ integrations: {} });
        await signup(newsletterBody());
        putTenant();
        delayedCommit = (c) => c instanceof UpdateCommand && c.input.UpdateExpression === "SET #push = :push";
        const res = await sendAgain();
        expect(JSON.parse(res.body).resultWrite).toBe("unconfirmed");
        expect(pushOf().state).toBe("Pending");              // stored truth at answer time
        releaseCommits.forEach((r) => r());
        await tick(10);
        expect(pushOf().state).toBe("Sent");                 // stored truth later: also correct
        const listed = JSON.parse((await admin(listLeads)).body).items;
        expect(listed[0].newsletter.push.state).toBe("Sent");
    }, 15_000);

    it("MailerLite hangs AND the result write is held → still answered by the deadline; nothing was written, the stored state is Pending", async () => {
        answers = ["hang"];
        hold = (c) => c instanceof UpdateCommand && c.input.UpdateExpression === "SET #push = :push";
        const started = Date.now();
        expect((await signup(newsletterBody())).statusCode).toBe(201);
        expect(Date.now() - started).toBeLessThan(POST_STORE_DEADLINE_MS + 800);
        expect(pushOf().state).toBe("Pending");
    }, 15_000);

    it("the result write fails at once (throttled; not committed in this stand-in) → success; the stored state is Pending", async () => {
        failWhen = (c) => c instanceof UpdateCommand;
        expect((await signup(newsletterBody())).statusCode).toBe(201);
        expect(pushOf().state).toBe("Pending");
    });
});

describe("Finding NL1-R5 — a cancelled signup is re-read, retried once, then refused; never success with nothing stored", () => {
    it("both items are deleted (through DELETE /leads/{email}) just before a changed-consent transaction → re-read finds none → retried once → both stored, 201", async () => {
        putTenant({ integrations: {} });
        await signup(newsletterBody());
        const newer = "Yes, the newer Atelier letter.";
        putTenant({ integrations: {}, siteStrings: { newsletterConsent: newer } });
        let once = true;
        beforeSend = async (c) => {
            if (once && c instanceof TransactWriteCommand && c.input.TransactItems[1]?.Put) {
                once = false;
                expect((await admin(deleteLead, { pathParameters: { email: encodeURIComponent(EMAIL) } })).statusCode).toBe(200);
            }
        };
        const res = await signup(newsletterBody({ consentText: newer }));
        expect(res.statusCode).toBe(201);
        expect(lead()).toBeDefined();
        expect(subscription()!.consent.text).toBe(newer);
    });

    it("a conflicting subscription appears before EVERY try and is gone at every re-read → retried once, then 503 \"try again\", nothing stored — never 201", async () => {
        putTenant({ integrations: {} });
        let tries = 0;
        let armed = false;
        beforeSend = async (c) => {
            if (c instanceof TransactWriteCommand && c.input.TransactItems[1]?.Put) {
                tries++;
                armed = true;   // another signup's items land between this request's read and its transaction …
                table.set(k(`TENANT#${T}`, `LEAD#${EMAIL}`), { PK: `TENANT#${T}`, SK: `LEAD#${EMAIL}`, email: EMAIL, Type: "Lead" });
                table.set(k(`TENANT#${T}`, `NEWSLETTER#${EMAIL}`), { PK: `TENANT#${T}`, SK: `NEWSLETTER#${EMAIL}`, email: EMAIL, consent: { id: `c-${tries}`, at: "x", locale: "en-US", text: "other" }, push: { state: "NoSettings" } });
            } else if (armed && c instanceof GetCommand && String(c.input.Key.SK).startsWith("NEWSLETTER#")) {
                armed = false;  // … and are deleted (DELETE /leads/{email}) before the re-read
                expect((await admin(deleteLead, { pathParameters: { email: encodeURIComponent(EMAIL) } })).statusCode).toBe(200);
            }
        };
        const res = await signup(newsletterBody());
        expect(res.statusCode).toBe(503);
        expect(JSON.parse(res.body)).toEqual({ error: "The signup was not stored. Please try again." });
        expect(tries).toBe(2);
        expect(subscription()).toBeUndefined();
        expect(lead()).toBeUndefined();
    });

    it("the subscription changed meanwhile to the SAME text (another signup of this address) → success without a second write", async () => {
        putTenant({ integrations: {} });
        let once = true;
        beforeSend = async (c) => {
            if (once && c instanceof TransactWriteCommand) {
                once = false;
                table.set(k(`TENANT#${T}`, `LEAD#${EMAIL}`), { PK: `TENANT#${T}`, SK: `LEAD#${EMAIL}`, email: EMAIL, Type: "Lead" });
                table.set(k(`TENANT#${T}`, `NEWSLETTER#${EMAIL}`), { PK: `TENANT#${T}`, SK: `NEWSLETTER#${EMAIL}`, email: EMAIL, consent: { id: "c-other", at: "x", locale: "en-US", text: EN_CONSENT }, push: { state: "NoSettings" } });
            }
        };
        expect((await signup(newsletterBody())).statusCode).toBe(201);
        expect(subscription()!.consent.id).toBe("c-other");
    });
});

describe("Finding NL1-R8 — one lead identity: the normalized address", () => {
    const LEGACY = "Reader.Sentinel@Example.test";   // another spelling of EMAIL, as a writer that did not normalize stored it
    const legacy = () => item(`TENANT#${T}`, `LEAD#${LEGACY}`);
    // LEAD-NORMALIZE-1: each of the four LEAD# writers now normalizes (enumeration: docs/slices/lead-normalize-1.md § "The
    // email rule"), so a legacy item exists only as a row stored BEFORE that slice (its key
    // and `email` the typed spelling, as the old lead magnet wrote them). It is seeded here in that stored shape.
    const putLegacy = (over: Record<string, unknown> = {}) => table.set(k(`TENANT#${T}`, `LEAD#${LEGACY}`), {
        PK: `TENANT#${T}`, SK: `LEAD#${LEGACY}`, id: "legacy-id", tenantId: T, email: LEGACY, source: "Website", status: "New",
        createdAt: "2026-01-01T00:00:00.000Z", Type: "Lead", ...over,
    });

    it("a legacy spelling present BEFORE the signup: the signup creates LEAD#<normalized> with the subscription; the legacy item is untouched; the list shows the subscription on the normalized row only", async () => {
        putTenant({ integrations: {} });
        putLegacy({ data: { referral: "p1" } });
        const before = structuredClone(legacy());
        expect(before).toBeDefined();
        await signup(newsletterBody({ email: LEGACY }));
        expect(legacy()).toEqual(before);
        expect(lead()).toMatchObject({ email: EMAIL, source: "newsletter" });
        expect(subscription()).toBeDefined();
        const listed = JSON.parse((await admin(listLeads)).body).items;
        expect(listed).toHaveLength(2);                                                   // two rows until F-FND2-1
        expect(listed.find((r: any) => r.email === EMAIL).newsletter).toBeDefined();
        expect(listed.find((r: any) => r.email === LEGACY).newsletter).toBeUndefined();
    });

    it("a legacy item, then a lead-magnet submission in the legacy spelling after the signup: the submission goes to the normalized lead (LEAD-NORMALIZE-1) and changes nothing there; the legacy item stays separate; the subscription stays on the normalized lead", async () => {
        putTenant({ integrations: {} });
        await signup(newsletterBody());
        putLegacy();
        const legacyBefore = structuredClone(legacy());
        await signup({ email: LEGACY, source: "Website" });
        expect(legacy()).toEqual(legacyBefore);
        expect(lead()).toMatchObject({ source: "newsletter" });
        expect(rowsOf("LEAD#")).toHaveLength(2);
        const listed = JSON.parse((await admin(listLeads)).body).items;
        expect(listed.find((r: any) => r.email === LEGACY).newsletter).toBeUndefined();
        expect(listed.find((r: any) => r.email === EMAIL).newsletter.consent.text).toBe(EN_CONSENT);
    });

    it("deleting the LEGACY item deletes that item only (one Delete, no transaction); the subscription and the normalized lead stay", async () => {
        putTenant({ integrations: {} });
        putLegacy();
        await signup(newsletterBody());
        expect(legacy()).toBeDefined();
        ddbSend.mockClear();
        expect((await admin(deleteLead, { pathParameters: { email: encodeURIComponent(LEGACY) } })).statusCode).toBe(200);
        const sent = ddbSend.mock.calls.map(([c]) => c);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toBeInstanceOf(DeleteCommand);
        expect(legacy()).toBeUndefined();
        expect(lead()).toBeDefined();
        expect(subscription()).toBeDefined();
    });

    it("deleting the NORMALIZED lead deletes it and the subscription in one transaction; the legacy item stays", async () => {
        putTenant({ integrations: {} });
        putLegacy();
        await signup(newsletterBody());
        expect((await admin(deleteLead, { pathParameters: { email: encodeURIComponent(EMAIL) } })).statusCode).toBe(200);
        expect(lead()).toBeUndefined();
        expect(subscription()).toBeUndefined();
        expect(legacy()).toBeDefined();
    });

    it("normalization equivalents (case, spaces, NFKC fullwidth @) are one identity: one normalized lead, one subscription", async () => {
        putTenant({ integrations: {} });
        for (const spelling of [EMAIL, ` ${EMAIL.toUpperCase()} `, EMAIL.replace("@", "\uFF20")]) expect((await signup(newsletterBody({ email: spelling }))).statusCode).toBe(201);
        expect(rowsOf("LEAD#").map((r) => r.SK)).toEqual([`LEAD#${EMAIL}`]);
        expect(rowsOf("NEWSLETTER#")).toHaveLength(1);
    });
});

describe("Ruling 4 — the push state sum: Send again decides by an exhaustive match", () => {
    it("NoSettings, Pending and Failed may be sent again; Sent may not", () => {
        expect(newsletterCanSendAgain({ state: "NoSettings" })).toBe(true);
        expect(newsletterCanSendAgain({ state: "Pending", attempt: "a" })).toBe(true);
        expect(newsletterCanSendAgain({ state: "Failed", at: "x", reason: { kind: "network" }, attempt: "a" })).toBe(true);
        expect(newsletterCanSendAgain({ state: "Sent", at: "x", attempt: "a" })).toBe(false);
    });
});

describe("Ruling 12 / finding NL1-R2 — newness and push results are fenced by ids that are never reused", () => {
    it("reversed completion order: two first signups read 'no subscription'; the one that commits second loses and changes nothing", async () => {
        putTenant({ integrations: {} });
        const newer = "Yes, the newer Atelier letter.";
        let releaseFirst!: () => void;
        let firstHeld = false;
        beforeSend = async (c) => {
            if (c instanceof TransactWriteCommand && !firstHeld) { firstHeld = true; await new Promise<void>((r) => { releaseFirst = r; }); }
        };
        const first = signup(newsletterBody());          // reads, then its transaction waits
        await tick(10);
        putTenant({ integrations: {}, siteStrings: { newsletterConsent: newer } });
        const second = await signup(newsletterBody({ consentText: newer }));   // reads, commits first
        expect(second.statusCode).toBe(201);
        releaseFirst();
        expect((await first).statusCode).toBe(201);
        expect(subscription()!.consent.text).toBe(newer);   // the consent committed first is the record; the delayed one did not replace it
    });

    it("equal timestamps: an older consent's late push result never lands on the newer consent (Sent stays Sent)", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-27T10:00:00.000Z"));
        const newer = "Yes, the newer Atelier letter.";
        answers = ["hang", { status: 201 }];                 // the first push hangs until its own deadline
        const first = signup(newsletterBody());
        await tick(20);
        putTenant({ siteStrings: { newsletterConsent: newer } });
        expect((await signup(newsletterBody({ consentText: newer }))).statusCode).toBe(201);
        expect(pushOf().state).toBe("Sent");
        expect((await first).statusCode).toBe(201);           // its Failed(timeout) is superseded, not written
        expect(subscription()!.consent.text).toBe(newer);
        expect(subscription()!.consent.at).toBe("2026-11-27T10:00:00.000Z");
        expect(pushOf().state).toBe("Sent");
    }, 15_000);

    it("concurrent Send again: both read the same Failed state; one claims the attempt and sends, the other gets 409 and sends nothing", async () => {
        await signup(newsletterBody());
        subscription()!.push = { state: "Failed", at: "x", reason: { kind: "http", status: 401 }, attempt: "a-old" };
        mlCalls = [];
        let releaseClaims!: () => void;
        const gate = new Promise<void>((r) => { releaseClaims = r; });
        let reads = 0;
        beforeSend = async (c) => {
            if (c instanceof UpdateCommand && c.input.UpdateExpression === "SET #push = :pending") { reads++; await gate; }
        };
        const a = sendAgain();
        const b = sendAgain();
        await tick(20);
        expect(reads).toBe(2);                              // both read before either claimed
        releaseClaims();
        const codes = [(await a).statusCode, (await b).statusCode].sort();
        expect(codes).toEqual([200, 409]);
        expect(mlCalls).toHaveLength(1);
        expect(pushOf().state).toBe("Sent");
    });

    it("order A: the same line twice keeps the FIRST consent (id and time); a different line later replaces it and is sent", async () => {
        await signup(newsletterBody());
        const first = structuredClone(subscription()!.consent);
        await tick(5);
        await signup(newsletterBody());
        expect(subscription()!.consent).toEqual(first);
        const newer = "Yes, send me the new Atelier letter.";
        putTenant({ siteStrings: { newsletterConsent: newer } });
        await signup(newsletterBody({ consentText: newer }));
        expect(subscription()!.consent.text).toBe(newer);
        expect(subscription()!.consent.id).not.toBe(first.id);
        expect(mlCalls).toHaveLength(2);
        expect(rowsOf("LEAD#")).toHaveLength(1);
    });

    it("order B: a lead from the lead-magnet block gains the subscription and keeps every field (id, source, status, data, createdAt)", async () => {
        await signup({ email: EMAIL, source: "Website", data: { referral: "partner-1" } });
        const before = structuredClone(lead());
        await signup(newsletterBody());
        expect(lead()).toEqual(before);
        const listed = JSON.parse((await admin(listLeads)).body).items;
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ id: before!.id, source: "Website", data: { referral: "partner-1" }, newsletter: { consent: { text: EN_CONSENT }, push: { state: "Sent" } } });
    });

    it("order C: a lead-magnet download after the signup changes no stored lead value (LEAD-NORMALIZE-1), and the subscription stays", async () => {
        await signup(newsletterBody());
        const before = structuredClone(lead());
        await signup({ email: EMAIL, source: "Website" });
        expect(lead()).toEqual(before);
        expect(lead()!.source).toBe("newsletter");
        const listed = JSON.parse((await admin(listLeads)).body).items;
        expect(listed[0].newsletter.consent.text).toBe(EN_CONSENT);
    });
});

describe("Finding NL1-R6 — GET /leads: a projection, and every returned lead with its subscription", () => {
    it("the leads query has a projection; a subscription on a LATER query page is still joined (pages of one item)", async () => {
        putTenant({ integrations: {} });
        for (const e of ["a.first@example.test", "m.middle@example.test", "z.last@example.test"]) await signup(newsletterBody({ email: e }));
        pageSize = 1;
        ddbSend.mockClear();
        const listed = JSON.parse((await admin(listLeads)).body).items;
        const queries = ddbSend.mock.calls.map(([c]) => c).filter((c) => c instanceof QueryCommand);
        expect(queries[0].input.ProjectionExpression).toBeDefined();
        expect(queries.filter((q) => q.input.ExpressionAttributeValues[":sk"] === "NEWSLETTER#")).toHaveLength(3);
        // the leads query is one page (the older whole-list limit): its single lead gets its subscription from page 1 of 3 or later
        for (const row of listed) expect(row.newsletter?.consent?.text, row.email).toBe(EN_CONSENT);
        pageSize = Infinity;
        const all = JSON.parse((await admin(listLeads)).body).items;
        expect(all.map((r: any) => r.newsletter.push.state)).toEqual(["NoSettings", "NoSettings", "NoSettings"]);
        const last = all.find((r: any) => r.email === "z.last@example.test");
        expect(last.newsletter).toBeDefined();
        for (const r of all) expect(Object.keys(r).sort()).not.toContain("PK");
    });

    it("a subscription on the last page is joined even when the leads query returns every lead", async () => {
        putTenant({ integrations: {} });
        for (const e of ["a.first@example.test", "z.last@example.test"]) await signup(newsletterBody({ email: e }));
        // only the subscriptions query is paged: make every lead come back in one answer
        const realRun = ddbSend.getMockImplementation()!;
        ddbSend.mockImplementation(async (c: any, o?: any) => {
            pageSize = c instanceof QueryCommand && c.input.ExpressionAttributeValues?.[":sk"] === "NEWSLETTER#" ? 1 : Infinity;
            return realRun(c, o);
        });
        const listed = JSON.parse((await admin(listLeads)).body).items;
        expect(listed).toHaveLength(2);
        expect(listed.find((r: any) => r.email === "z.last@example.test").newsletter.consent.text).toBe(EN_CONSENT);
    });
});

describe("Ruling 10 — Send again (POST /leads/{email}/push)", () => {
    it("Failed → claims a new attempt, sends once and records Sent; the answer holds the attempt's state and `resultWrite: recorded`; one audit event", async () => {
        answers = [{ status: 401 }, { status: 201 }];
        await signup(newsletterBody());
        expect(pushOf()).toMatchObject({ state: "Failed", reason: { kind: "http", status: 401 } });
        const oldAttempt = (pushOf() as any).attempt;
        const res = await sendAgain();
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ push: { state: "Sent", at: expect.any(String), attempt: expect.any(String) }, resultWrite: "recorded" });
        expect((pushOf() as any).attempt).not.toBe(oldAttempt);
        expect(mlCalls).toHaveLength(2);
        expect(mockAudit).toHaveBeenCalledTimes(1);
        expect(mockAudit.mock.calls[0][0]).toMatchObject({ action: "NEWSLETTER_SEND_AGAIN", actor: { email: ADMIN.email }, details: { mailerliteAnswer: "Sent", resultWrite: "recorded" } });
    });

    it("NoSettings at signup, settings added later → Send again sends it", async () => {
        putTenant({ integrations: {} });
        await signup(newsletterBody());
        putTenant();
        expect((await sendAgain()).statusCode).toBe(200);
        expect(pushOf().state).toBe("Sent");
    });

    it("refused: already Sent (409), no settings now (409), no subscription (404), an EDITOR of another site (403); nothing sent", async () => {
        await signup(newsletterBody());
        const sent = mlCalls.length;
        expect((await sendAgain()).statusCode).toBe(409);
        subscription()!.push = { state: "Failed", at: "x", reason: { kind: "timeout" }, attempt: "a-old" };
        putTenant({ integrations: { mailerlite: true } });   // a legacy boolean is no connection (ruling 8)
        expect((await sendAgain()).statusCode).toBe(409);
        expect((await sendAgain("nobody@example.test")).statusCode).toBe(404);
        const other = await call(pushLead, { headers: { "x-tenant-id": T }, requestContext: { authorizer: { lambda: { ...ADMIN, role: "EDITOR", tenantId: "t2" } }, http: { sourceIp: "1" } }, pathParameters: { email: EMAIL } });
        expect(other.statusCode).toBe(403);
        expect(mlCalls).toHaveLength(sent);
    });
});

describe("Ruling 8 — a stored legacy boolean is no connection", () => {
    for (const legacy of [true, false]) {
        it(`integrations.mailerlite: ${legacy} → the signup is stored with NoSettings, nothing is sent`, async () => {
            putTenant({ integrations: { mailerlite: legacy } });
            expect((await signup(newsletterBody())).statusCode).toBe(201);
            expect(pushOf()).toEqual({ state: "NoSettings" });
            expect(mlCalls).toHaveLength(0);
        });
    }
});

describe("Ruling 9 — the newsletter path never yields a download link; a request without source \"newsletter\" takes the lead-magnet path", () => {
    it("a newsletter request naming a stored free resource → 201 without a link; no resource read, no product read", async () => {
        table.set(k(`TENANT#${T}`, "RESOURCE#r-free"), { PK: `TENANT#${T}`, SK: "RESOURCE#r-free", id: "r-free", s3Key: "t1/r-free.pdf" });
        process.env.PRIVATE_BUCKET = "test-private-bucket";
        const res = await signup(newsletterBody({ resourceId: "r-free" }));
        delete process.env.PRIVATE_BUCKET;
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body)).toEqual({ message: "Subscribed" });
        const reads = ddbSend.mock.calls.map((c) => c[0]);
        expect(reads.some((c) => c instanceof GetCommand && String(c.input.Key.SK).startsWith("RESOURCE#"))).toBe(false);
        expect(reads.some((c) => c instanceof QueryCommand && c.input.ExpressionAttributeValues?.[":sk"] === "PRODUCT#")).toBe(false);
    });

    it("a request without source \"newsletter\" takes the lead-magnet path: the lead is stored, no subscription, no push", async () => {
        const res = await signup({ email: EMAIL, source: "Website", consentText: EN_CONSENT });
        expect(res.statusCode).toBe(201);
        expect(rowsOf("NEWSLETTER#")).toHaveLength(0);
        expect(mlCalls).toHaveLength(0);
        expect(lead()).toMatchObject({ source: "Website", status: "New" });
    });
});

describe("Scope item 5 — GET /public/popups: the newsletter texts only when a newsletter popup collects addresses", () => {
    const popup = (over: Record<string, any>) => table.set(k(`TENANT#${T}`, `POPUP#${over.id}`), { PK: `TENANT#${T}`, SK: `POPUP#${over.id}`, status: "active", trigger: "page_load", triggerValue: "0", showOnPages: [], showOncePerSession: true, ...over });
    const getPopups = async () => JSON.parse((await call(publicPopups, { headers: { "x-tenant-id": T } })).body);

    it("existing newsletter popups (no opt-in) and other types: the answer holds the items only, as before", async () => {
        popup({ id: "p1", type: "newsletter", headline: "News" });
        popup({ id: "p2", type: "announcement", collectEmail: true });
        const body = await getPopups();
        expect(Object.keys(body)).toEqual(["items"]);
        expect(body.items.find((p: any) => p.id === "p1")).not.toHaveProperty("collectEmail");
    });

    it("an active newsletter popup with collectEmail: true → `newsletter` texts of the tenant's locale (French pack), with that locale", async () => {
        putTenant({ locale: "fr-FR" });
        popup({ id: "p1", type: "newsletter", collectEmail: true });
        const body = await getPopups();
        expect(body.items[0].collectEmail).toBe(true);
        expect(body.newsletter).toMatchObject({ locale: "fr-FR", consent: LANGUAGE_PACKS.fr.site.newsletterConsent, subscribe: LANGUAGE_PACKS.fr.site.newsletterSubscribe });
    });
});

describe("Ruling 7 / finding NL1-R1 — the token is a secret; the address is personal data (sentinel checks)", () => {
    it("PUT /settings stores the token; GET /settings, GET /settings/secrets and the PUT answer never hold it; a save without a token keeps it; null disconnects", async () => {
        putTenant({ integrations: { contactEmail: "office@t1.test" } });
        const save = await admin(putSettings, { body: JSON.stringify({ integrations: { contactEmail: "office@t1.test", mailerlite: { groupId: GROUP, apiToken: SENTINEL_TOKEN } } }) });
        expect(save.statusCode).toBe(200);
        expect(item("SYSTEM", `TENANT#${T}`)!.integrations.mailerlite).toEqual({ apiToken: SENTINEL_TOKEN, groupId: GROUP });
        const read = await admin(getSettings);
        expect(JSON.parse(read.body).integrations.mailerlite).toEqual({ groupId: GROUP });
        const secrets = await admin(getSecrets);
        for (const answer of [save, read, secrets]) expect(answer.body).not.toContain(SENTINEL_TOKEN);
        for (const sent of [{ groupId: "998877" }, { groupId: "998877", apiToken: "  " }]) {
            expect((await admin(putSettings, { body: JSON.stringify({ integrations: { mailerlite: sent } }) })).statusCode).toBe(200);
            expect(item("SYSTEM", `TENANT#${T}`)!.integrations.mailerlite).toEqual({ apiToken: SENTINEL_TOKEN, groupId: "998877" });
        }
        const refused = await admin(putSettings, { body: JSON.stringify({ integrations: { mailerlite: { groupId: " ", apiToken: SENTINEL_TOKEN } } }) });
        expect(refused.statusCode).toBe(400);
        expect(refused.body).not.toContain(SENTINEL_TOKEN);
        expect((await admin(putSettings, { body: JSON.stringify({ integrations: { mailerlite: false } }) })).statusCode).toBe(200);
        expect(item("SYSTEM", `TENANT#${T}`)!.integrations.mailerlite.apiToken).toBe(SENTINEL_TOKEN);
        expect((await admin(putSettings, { body: JSON.stringify({ integrations: { mailerlite: null } }) })).statusCode).toBe(200);
        expect(Object.hasOwn(item("SYSTEM", `TENANT#${T}`)!.integrations, "mailerlite")).toBe(false);
        for (const [event] of mockAudit.mock.calls) expect(inspect(event, { depth: 8 })).not.toContain(SENTINEL_TOKEN);
    });

    it("NL1-R1: malformed bodies and errors BEFORE the newsletter dispatch: fixed answers, error names only — no address, no token anywhere", async () => {
        const answersSeen: Res[] = [];
        // a malformed signup body that holds the address (a JSON SyntaxError would quote it)
        answersSeen.push(await rawSignup(`{"email":"${EMAIL}","source":"newsletter",`));
        answersSeen.push(await rawSignup(`["${EMAIL}"]`));
        answersSeen.push(await rawSignup("null"));
        // a malformed settings body that holds the token
        answersSeen.push(await admin(putSettings, { body: `{"integrations":{"mailerlite":{"apiToken":"${SENTINEL_TOKEN}",` }));
        for (const a of answersSeen) expect(a.statusCode).toBe(400);
        // the tenant read (before the dispatch) fails with a message that quotes the request
        failWhen = (c) => c instanceof GetCommand && c.input.Key.PK === "SYSTEM";
        answersSeen.push(await signup(newsletterBody()));
        answersSeen.push(await admin(getSettings));
        answersSeen.push(await admin(getSecrets));
        answersSeen.push(await admin(putSettings, { body: JSON.stringify({ integrations: { mailerlite: { groupId: GROUP, apiToken: SENTINEL_TOKEN } } }) }));
        failWhen = (c) => c instanceof QueryCommand;
        answersSeen.push(await admin(listLeads));
        for (const a of answersSeen.slice(4)) expect(a.statusCode).toBe(500);
        expect(consoleLines.length).toBeGreaterThan(0);
        for (const line of consoleLines) {
            expect(line).not.toContain(SENTINEL_TOKEN);
            expect(line).not.toContain(EMAIL);
        }
        for (const a of answersSeen) {
            expect(a.body).not.toContain(SENTINEL_TOKEN);
            expect(a.body).not.toContain(EMAIL);
        }
        expect(rowsOf("LEAD#")).toHaveLength(0);
    });

    it("no log line, error answer, audit event or admin answer holds the token; no log line holds the address — across every push outcome", async () => {
        const answersSeen: string[] = [];
        for (const answer of [{ status: 201 }, { status: 401 }, { status: 422 }, { status: 429 }, "network"] as Answer[]) {
            table.delete(k(`TENANT#${T}`, `NEWSLETTER#${EMAIL}`));
            answers = [answer];
            answersSeen.push((await signup(newsletterBody())).body);
        }
        answers = [{ status: 500 }];
        subscription()!.push = { state: "Failed", at: "x", reason: { kind: "network" }, attempt: "a-old" };
        answersSeen.push((await sendAgain()).body);
        answersSeen.push((await signup(newsletterBody({ consentText: "" }))).body);
        answersSeen.push((await signup(newsletterBody({ consentText: "wrong" }))).body);
        answersSeen.push((await admin(listLeads)).body.replace(new RegExp(EMAIL, "g"), "<the listed address>"));
        failWhen = (c) => c instanceof UpdateCommand;
        answersSeen.push((await signup(newsletterBody({ email: "second.sentinel@example.test" }))).body);
        failWhen = (c) => c instanceof TransactWriteCommand;
        const broken = await signup(newsletterBody({ email: "third.sentinel@example.test" }));
        expect(broken.statusCode).toBe(500);
        answersSeen.push(broken.body);

        expect(consoleLines.length).toBeGreaterThan(0);
        for (const line of consoleLines) {
            expect(line).not.toContain(SENTINEL_TOKEN);
            expect(line).not.toContain(EMAIL);
            expect(line).not.toContain("second.sentinel");
            expect(line).not.toContain("third.sentinel");
        }
        for (const body of answersSeen) expect(body).not.toContain(SENTINEL_TOKEN);
        for (const [event] of mockAudit.mock.calls) {
            const text = inspect(event, { depth: 8 });
            expect(text).not.toContain(SENTINEL_TOKEN);
            expect(text).not.toContain(EMAIL);
        }
        expect(inspect([...table.values()].filter((r) => r.SK !== `TENANT#${T}`), { depth: 8 })).not.toContain(SENTINEL_TOKEN);
    });
});
