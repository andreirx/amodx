import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * LEAD-NORMALIZE-1 (docs/slices/lead-normalize-1.md) — every lead writer stores the lead under the normalized address,
 * and a later write never changes a stored lead value. Run through the real handlers: the lead magnet and the newsletter
 * (`POST /leads`, leads/create.ts → leads/newsletter.ts), the contact form (`POST /contact`, contact/send.ts), comments
 * (`POST /comments`, comments/create.ts), and the readers `GET /leads`, `DELETE /leads/{email}`, `POST /leads/{email}/push`.
 *
 * Mocked: `db.js` — an in-memory table that evaluates exactly the expression forms these handlers send (conditions
 * `attribute_exists` / `attribute_not_exists` / `path = :v` joined by AND; updates `SET #a = :v` and
 * `SET #a = if_not_exists(#a, :v)`) and THROWS on any other form, runs a transaction all-or-nothing and records every
 * command; `events.js` (audit); `@aws-sdk/client-ses` (the contact form's email; it can be made to refuse). No network:
 * the tenant has no MailerLite settings and no reCAPTCHA keys. Credential-free.
 */

const { ddbSend, mockAudit, sesSend } = vi.hoisted(() => {
    delete process.env.RECAPTCHA_SECRET_KEY;
    return { ddbSend: vi.fn(), mockAudit: vi.fn(), sesSend: vi.fn() };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: class { send = sesSend; },
    SendEmailCommand: class { constructor(public input: unknown) {} },
}));

import { handler as createLead } from "../../src/leads/create.js";
import { handler as contactSend } from "../../src/contact/send.js";
import { handler as createComment } from "../../src/comments/create.js";
import { handler as listLeads } from "../../src/leads/list.js";
import { handler as deleteLead } from "../../src/leads/delete.js";
import { handler as pushLead } from "../../src/leads/push.js";
import { createOrFillLead } from "../../src/lib/lead-write.js";
import { LANGUAGE_PACKS } from "@amodx/shared";

const T = "t1";
const PK = `TENANT#${T}`;
const TYPED = "Ana@Example.com ";
const N = "ana@example.com";
const EN_CONSENT = LANGUAGE_PACKS.en.site.newsletterConsent!;

// ── the in-memory table ──────────────────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
let table: Map<string, Row>;
let sent: any[];
const k = (pk: string, sk: string) => `${pk}|${sk}`;
const item = (sk: string, pk = PK) => table.get(k(pk, sk));
const rowsOf = (prefix: string) => [...table.values()].filter((r) => String(r.SK).startsWith(prefix));
const failure = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name, ...extra });
const resolve = (path: string, names: Record<string, string> = {}) => path.split(".").map((p) => names[p] ?? p);
const at = (row: Row | undefined, path: string[]) => path.reduce<any>((v, p) => (v == null ? undefined : v[p]), row);

function holds(expr: string | undefined, row: Row | undefined, names: Record<string, string> = {}, values: Record<string, any> = {}) {
    if (expr === undefined) return true;
    return expr.split(" AND ").every((term) => {
        let m = /^attribute_not_exists\(([^)]+)\)$/.exec(term);
        if (m) return at(row, resolve(m[1], names)) === undefined;
        m = /^attribute_exists\(([^)]+)\)$/.exec(term);
        if (m) return at(row, resolve(m[1], names)) !== undefined;
        m = /^([#\w.]+) = (:\w+)$/.exec(term);
        if (m) return at(row, resolve(m[1], names)) !== undefined && at(row, resolve(m[1], names)) === values[m[2]];
        throw new Error(`unmocked condition: ${term}`);
    });
}

function update(key: { PK: string; SK: string }, expr: string, names: Record<string, string> = {}, values: Record<string, any> = {}) {
    if (!expr.startsWith("SET ")) throw new Error(`unmocked update: ${expr}`);
    const row: Row = structuredClone(table.get(k(key.PK, key.SK)) ?? { PK: key.PK, SK: key.SK });
    for (const part of expr.slice(4).split(/, (?=#)/)) {
        const m = /^(#\w+) = (?:if_not_exists\((#\w+), (:\w+)\)|(:\w+))$/.exec(part);
        if (!m || (m[2] !== undefined && m[2] !== m[1])) throw new Error(`unmocked update: ${part}`);
        const attr = names[m[1]];
        if (m[3] !== undefined) { if (row[attr] === undefined) row[attr] = structuredClone(values[m[3]]); }
        else row[attr] = structuredClone(values[m[4]]);
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

function part(t: any): { holds: () => boolean; apply: () => void } {
    if (t.Put) { const p = t.Put; return { holds: () => holds(p.ConditionExpression, table.get(k(p.Item.PK, p.Item.SK)), p.ExpressionAttributeNames, p.ExpressionAttributeValues), apply: () => table.set(k(p.Item.PK, p.Item.SK), structuredClone(p.Item)) }; }
    if (t.Update) { const u = t.Update; return { holds: () => holds(u.ConditionExpression, table.get(k(u.Key.PK, u.Key.SK)), u.ExpressionAttributeNames, u.ExpressionAttributeValues), apply: () => update(u.Key, u.UpdateExpression, u.ExpressionAttributeNames, u.ExpressionAttributeValues) }; }
    if (t.ConditionCheck) { const c = t.ConditionCheck; return { holds: () => holds(c.ConditionExpression, table.get(k(c.Key.PK, c.Key.SK)), c.ExpressionAttributeNames, c.ExpressionAttributeValues), apply: () => {} }; }
    if (t.Delete) { const d = t.Delete; return { holds: () => holds(d.ConditionExpression, table.get(k(d.Key.PK, d.Key.SK))), apply: () => { table.delete(k(d.Key.PK, d.Key.SK)); } }; }
    throw new Error(`unmocked transact item: ${Object.keys(t)}`);
}

async function run(cmd: any): Promise<any> {
    sent.push(cmd);
    const input = cmd.input;
    if (cmd instanceof GetCommand) {
        const row = table.get(k(input.Key.PK, input.Key.SK));
        return row ? { Item: project(row, input.ProjectionExpression, input.ExpressionAttributeNames) } : {};
    }
    if (cmd instanceof PutCommand) {
        if (!holds(input.ConditionExpression, table.get(k(input.Item.PK, input.Item.SK)), input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw failure("ConditionalCheckFailedException");
        table.set(k(input.Item.PK, input.Item.SK), structuredClone(input.Item));
        return {};
    }
    if (cmd instanceof UpdateCommand) {
        if (!holds(input.ConditionExpression, table.get(k(input.Key.PK, input.Key.SK)), input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw failure("ConditionalCheckFailedException");
        update(input.Key, input.UpdateExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        return {};
    }
    if (cmd instanceof DeleteCommand) { table.delete(k(input.Key.PK, input.Key.SK)); return {}; }
    if (cmd instanceof TransactWriteCommand) {
        const parts = input.TransactItems.map(part);
        const reasons = parts.map((p: ReturnType<typeof part>) => ({ Code: p.holds() ? "None" : "ConditionalCheckFailed" }));
        if (reasons.some((r: { Code: string }) => r.Code !== "None")) throw failure("TransactionCanceledException", { CancellationReasons: reasons });
        for (const p of parts) p.apply();
        return {};
    }
    if (cmd instanceof QueryCommand) {
        if (input.IndexName) throw new Error("unmocked index query");
        const v = input.ExpressionAttributeValues;
        const rows = [...table.values()].filter((r) => r.PK === v[":pk"] && String(r.SK).startsWith(v[":sk"])).sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        return { Items: rows.map((r) => project(r, input.ProjectionExpression, input.ExpressionAttributeNames)) };
    }
    throw new Error(`unmocked command: ${cmd.constructor.name}`);
}

// ── calls through the real handlers ──────────────────────────────────────────────────────────────────────────────────
type Res = { statusCode: number; body: string };
const call = async (h: any, event: Record<string, any>) => (await h(event, {} as any, () => {})) as Res;
const renderer = (body: Record<string, unknown>) => ({
    headers: { "x-tenant-id": T },
    requestContext: { authorizer: { lambda: { role: "RENDERER", tenantId: T, sub: "robot" } }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
});
const magnet = (email: unknown, over: Record<string, unknown> = {}) => call(createLead, renderer({ email, source: "Footer Form", ...over }));
const contact = (email: unknown, over: Record<string, unknown> = {}) => call(contactSend, renderer({ email, name: "Ana", message: "Hello", ...over }));
const comment = (authorEmail: unknown, over: Record<string, unknown> = {}) => call(createComment, renderer({ pageId: "p1", content: "Nice", authorName: "Ana G.", authorEmail, ...over }));
const newsletter = (email: string) => call(createLead, renderer({ email, source: "newsletter", consentText: EN_CONSENT, consentLocale: "en-US" }));
const ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: T };
const admin = (h: any, over: Record<string, any> = {}) => call(h, {
    headers: { "x-tenant-id": T }, requestContext: { authorizer: { lambda: ADMIN }, http: { sourceIp: "127.0.0.1" } }, ...over,
});
const listed = async () => JSON.parse((await admin(listLeads)).body).items as Row[];
/** The SKs every command of a handler call wrote or named. */
const keysNamed = (cmds: any[]) => cmds.flatMap((c) => {
    const i = c.input;
    const one = (x: any) => [x?.Key?.SK, x?.Item?.SK].filter(Boolean);
    return i.TransactItems ? i.TransactItems.flatMap((t: any) => one(Object.values(t)[0])) : one(i);
});

const OLD_CREATED = "2026-01-01T00:00:00.000Z";
/** A lead stored BEFORE this slice by a writer that did not normalize: its key and `email` are the typed spelling. */
const putOldRow = (spelling = "Ana@Example.com") => table.set(k(PK, `LEAD#${spelling}`), {
    PK, SK: `LEAD#${spelling}`, id: "old-id", tenantId: T, email: spelling, source: "Website", status: "New", createdAt: OLD_CREATED, Type: "Lead",
});

beforeEach(() => {
    table = new Map();
    sent = [];
    ddbSend.mockReset().mockImplementation(run);
    mockAudit.mockReset().mockResolvedValue(undefined);
    sesSend.mockReset().mockResolvedValue({ MessageId: "m1" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    table.set(k("SYSTEM", `TENANT#${T}`), { PK: "SYSTEM", SK: `TENANT#${T}`, id: T, name: "Tenant One", locale: "en-US", integrations: { contactEmail: "office@t1.test" } });
});

// ── evidence row 1 ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("`Ana@Example.com ` through each of the three writers → one item LEAD#ana@example.com", () => {
    const writers: [string, (e: string) => Promise<Res>, number][] = [["lead magnet", magnet, 201], ["contact form", contact, 200], ["comments", comment, 201]];
    for (const [name, write, status] of writers) {
        it(`${name}: the key and the stored email are the normalized address`, async () => {
            expect((await write(TYPED)).statusCode).toBe(status);
            expect(rowsOf("LEAD#").map((r) => r.SK)).toEqual([`LEAD#${N}`]);
            expect(item(`LEAD#${N}`)).toMatchObject({ email: N, tenantId: T, status: "New", Type: "Lead" });
        });

        it(`${name}: with a subscription stored, its commands name no NEWSLETTER# key and the subscription reads back unchanged`, async () => {
            expect((await newsletter(N)).statusCode).toBe(201);
            const subscription = structuredClone(item(`NEWSLETTER#${N}`)!);
            sent = [];
            expect((await write(TYPED)).statusCode).toBe(status);
            expect(keysNamed(sent).filter((sk) => sk.startsWith("NEWSLETTER#"))).toEqual([]);
            expect(item(`NEWSLETTER#${N}`)).toEqual(subscription);
        });
    }

    it("all three writers in turn, each in another spelling → still one lead row", async () => {
        await magnet(TYPED);
        await contact(" ANA@EXAMPLE.COM");
        await comment("ana@Example.COM");
        expect(rowsOf("LEAD#").map((r) => r.SK)).toEqual([`LEAD#${N}`]);
    });

    it("the comment item keeps authorEmail as sent; only its lead is normalized", async () => {
        await comment(TYPED);
        expect(rowsOf("COMMENT#")).toHaveLength(1);
        expect(rowsOf("COMMENT#")[0].authorEmail).toBe(TYPED);
    });

    it("the write is one Update whose every assignment is if_not_exists; undefined values are left out", () => {
        const u = createOrFillLead(T, TYPED, { source: "x", createdAt: "now" });
        expect(u.Key).toEqual({ PK, SK: `LEAD#${N}` });
        expect(u.UpdateExpression.slice(4).split(/, (?=#)/).every((a) => /^#(\w+) = if_not_exists\(#\1, :\1\)$/.test(a))).toBe(true);
        expect(Object.values(u.ExpressionAttributeNames).sort()).toEqual(["Type", "createdAt", "email", "id", "source", "status", "tenantId"]);
    });
});

// ── evidence rows 2 and 3 ────────────────────────────────────────────────────────────────────────────────────────────
describe("one key: a later writer never changes a stored lead value and never touches NEWSLETTER#", () => {
    it("contact form, then the newsletter, then a comment → one lead row; subscription intact; createdAt and first source kept", async () => {
        expect((await contact(TYPED)).statusCode).toBe(200);
        const first = structuredClone(item(`LEAD#${N}`)!);
        expect(first).toMatchObject({ source: "contact-form", name: "Ana", data: { message: "Hello" } });

        expect((await newsletter("ANA@example.com")).statusCode).toBe(201);
        const subscription = structuredClone(item(`NEWSLETTER#${N}`)!);
        expect(subscription.consent.text).toBe(EN_CONSENT);

        sent = [];
        expect((await comment(" Ana@Example.Com")).statusCode).toBe(201);
        expect(keysNamed(sent).some((sk) => sk.startsWith("NEWSLETTER#"))).toBe(false);

        expect(rowsOf("LEAD#")).toHaveLength(1);
        expect(item(`LEAD#${N}`)).toEqual(first);                  // nothing changed: createdAt, source, id, name, data
        expect(item(`NEWSLETTER#${N}`)).toEqual(subscription);
        const rows = await listed();
        expect(rows).toHaveLength(1);
        expect(rows[0].newsletter.consent.text).toBe(EN_CONSENT);
    });

    it("the newsletter first, then the lead magnet in another spelling → one lead row; NEWSLETTER# read back unchanged; the missing name is added", async () => {
        expect((await newsletter(N)).statusCode).toBe(201);
        const lead = structuredClone(item(`LEAD#${N}`)!);
        const subscription = structuredClone(item(`NEWSLETTER#${N}`)!);
        expect(lead.name).toBeUndefined();

        sent = [];
        expect((await magnet("  ANA@EXAMPLE.com", { name: "Ana", data: { from: "footer" } })).statusCode).toBe(201);
        expect(keysNamed(sent).some((sk) => sk.startsWith("NEWSLETTER#"))).toBe(false);

        expect(rowsOf("LEAD#")).toHaveLength(1);
        expect(item(`NEWSLETTER#${N}`)).toEqual(subscription);
        expect(item(`LEAD#${N}`)).toEqual({ ...lead, name: "Ana", ...(lead.data === undefined ? { data: { from: "footer" } } : {}) });
        expect(item(`LEAD#${N}`)).toMatchObject({ source: "newsletter", createdAt: lead.createdAt, id: lead.id });
    });

    it("the owner's status stays: a lead marked Contacted is not reset to New by a later message or comment", async () => {
        await magnet(N);
        table.get(k(PK, `LEAD#${N}`))!.status = "Contacted";
        await contact(N);
        await comment(N);
        expect(item(`LEAD#${N}`)!.status).toBe("Contacted");
    });

    it("a lead written by a writer meanwhile does not break a newsletter signup that read 'no lead' (its retry, NL1-R5)", async () => {
        let injected = false;
        ddbSend.mockImplementation(async (cmd: any) => {
            if (!injected && cmd instanceof TransactWriteCommand) {
                injected = true;
                await run(new UpdateCommand(createOrFillLead(T, N, { source: "contact-form", createdAt: OLD_CREATED })));
            }
            return run(cmd);
        });
        expect((await newsletter(N)).statusCode).toBe(201);
        expect(rowsOf("LEAD#")).toHaveLength(1);
        expect(item(`LEAD#${N}`)).toMatchObject({ source: "contact-form", createdAt: OLD_CREATED });
        expect(item(`NEWSLETTER#${N}`)).toBeDefined();
    });
});

// ── evidence row 4 ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("an old row LEAD#Ana@Example.com (stored before this slice): list / delete / push", () => {
    it("listed beside the normalized row; the subscription shows on the normalized row only", async () => {
        putOldRow();
        await contact(N);
        await newsletter(N);
        const rows = await listed();
        expect(rows.map((r) => r.email).sort()).toEqual(["Ana@Example.com", N]);
        expect(rows.find((r) => r.email === "Ana@Example.com")!.newsletter).toBeUndefined();
        expect(rows.find((r) => r.email === N)!.newsletter).toBeDefined();
    });

    it("as the Leads page does it (DELETE /leads/{encodeURIComponent(listed email)}): each listed row's key is LEAD#<its email>, and deleting the old row removes exactly that row", async () => {
        putOldRow();
        await newsletter(N);
        const rows = await listed();
        for (const r of rows) expect(table.has(k(PK, `LEAD#${r.email}`))).toBe(true);
        const before = structuredClone([...table.entries()]);
        sent = [];
        const old = rows.find((r) => r.email === "Ana@Example.com")!;
        expect((await admin(deleteLead, { pathParameters: { email: encodeURIComponent(old.email) } })).statusCode).toBe(200);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toBeInstanceOf(DeleteCommand);
        expect([...table.entries()]).toEqual(before.filter(([key]) => key !== k(PK, "LEAD#Ana@Example.com")));
    });

    it("deleting a row written after this slice (by its listed email) removes it and its subscription in one transaction", async () => {
        await magnet(TYPED);
        await newsletter(N);
        const row = (await listed())[0];
        expect((await admin(deleteLead, { pathParameters: { email: encodeURIComponent(row.email) } })).statusCode).toBe(200);
        expect(rowsOf("LEAD#")).toHaveLength(0);
        expect(rowsOf("NEWSLETTER#")).toHaveLength(0);
    });

    it("push (Send again) on the old row with no subscription: 404, as before; nothing written", async () => {
        putOldRow();
        const before = structuredClone([...table.entries()]);
        const res = await admin(pushLead, { pathParameters: { email: encodeURIComponent("Ana@Example.com") } });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: "This lead has no newsletter subscription." });
        expect([...table.entries()]).toEqual(before);
    });

    it("a later submission in the old spelling makes the normalized row and leaves the old row untouched (no merge: F-FND2-1)", async () => {
        putOldRow();
        const old = structuredClone(item("LEAD#Ana@Example.com"));
        await contact("Ana@Example.com");
        expect(item("LEAD#Ana@Example.com")).toEqual(old);
        expect(item(`LEAD#${N}`)).toMatchObject({ email: N, source: "contact-form" });
    });
});

// ── evidence row 5 ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("an invalid address (normalizeEmail refuses none; the handler's own check, on the normalized form)", () => {
    it("lead magnet: 500 with the fixed text, nothing written", async () => {
        for (const bad of ["not-an-address", "", 42]) {
            const res = await magnet(bad);
            expect(res.statusCode).toBe(500);
            expect(JSON.parse(res.body)).toEqual({ error: "Internal error" });
        }
        expect(rowsOf("LEAD#")).toHaveLength(0);
    });

    it("comments: 500, nothing written (neither the comment nor the lead)", async () => {
        for (const bad of ["not-an-address", undefined]) expect((await comment(bad)).statusCode).toBe(500);
        expect(rowsOf("LEAD#")).toHaveLength(0);
        expect(rowsOf("COMMENT#")).toHaveLength(0);
    });

    it("contact form: no address check of its own (unchanged); when SES refuses the Reply-To, 500 and nothing written", async () => {
        sesSend.mockRejectedValue(failure("InvalidParameterValue"));
        const res = await contact("not-an-address");
        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res.body)).toEqual({ error: "Internal error" });
        expect(rowsOf("LEAD#")).toHaveLength(0);
    });

    it("contact form: when SES accepts, the text is stored as a lead (unchanged: no address check); its key is now the normalized form (finding LN1-F2)", async () => {
        expect((await contact(" Not-An-Address")).statusCode).toBe(200);
        expect(rowsOf("LEAD#").map((r) => r.SK)).toEqual(["LEAD#not-an-address"]);
    });
});

// ── evidence row 6 ───────────────────────────────────────────────────────────────────────────────────────────────────
describe("tenant keys are built from x-tenant-id only", () => {
    it("a body naming another tenant changes no key and no tenantId (each writer)", async () => {
        const evil = { tenantId: "t-evil", PK: "TENANT#t-evil", SK: "LEAD#x" };
        await magnet(TYPED, evil);
        await contact(TYPED, evil);
        await comment(TYPED, evil);
        const written = [...table.values()].filter((r) => r.PK !== "SYSTEM");
        expect(written.length).toBeGreaterThan(0);
        for (const r of written) {
            expect(r.PK).toBe(PK);
            expect(r.tenantId).toBe(T);
        }
    });
});
