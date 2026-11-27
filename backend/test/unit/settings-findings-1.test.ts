import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * SETTINGS-FINDINGS-1 item 7 (docs/slices/settings-findings-1.md § Item 7) — what the FIRST Save through the admin
 * Settings screen writes into a record that was never saved through the screen. Observed by the operator on staging
 * (refactor-settings-1 closeout): the first Save changed the stored `integrations` and `recaptcha`; a second Save
 * changed nothing.
 *
 * The chain, without a real system:
 *  1. the real tenant-create handler (`tenant/create.ts`) writes the record into an in-memory table;
 *  2. the real `GET /settings` and `GET /settings/secrets` answer EXACTLY what the admin test served to the real page
 *     (`admin/src/pages/__markup__/settings-findings-1/first-save.answers.json`) — this pins that the admin test's
 *     restated record is the record the create handler writes;
 *  3. the real `PUT /settings` takes the Save body the real page sent for those answers with no edit (the admin
 *     capture `first-save.save.json`, written by `Settings.markup.test.ts` § SETTINGS-FINDINGS-1 "item 7");
 *  4. every path that differs between the record before and after is listed with the KIND of its value (never a
 *     value: these paths hold secrets on a real site).
 * Mocked: `db.js` (a Map; the commands these handlers send), `events.js`, and `revalidate.js` (the stored-page purge
 * of tenant/create and tenant/settings; it is tested in bulk-purge.test.ts; here its calls are recorded, as in
 * catalog-mode.test.ts). The handlers, `requireRole` and `withInvalidation` are real. Credential-free.
 *
 * Isolation (review-0 R1, review-1 R3). Rule: every module of the handler chain that can reach a service outside the
 * process is a test double, and the test proves that nothing leaves, with a detector whose coverage each claim names
 * and a positive control proves. A synthetic revalidation and fast-lane configuration is set before any module loads
 * (the configuration under which `lib/revalidate.ts` would read Secrets Manager and call the renderer, and
 * `lib/invalidate-cdn.ts` would invoke a Lambda). The guard records — and refuses — calls of exactly these three:
 *  - `LambdaClient.prototype.send`: the only AWS SDK client the unmocked chain loads (import walk from the three
 *    handlers and `lib/recaptcha.ts`, mocked modules skipped: `@aws-sdk/client-lambda` in `lib/invalidate-cdn.ts`);
 *  - `SecretsManagerClient.prototype.send`: the client of `lib/revalidate.ts`, the module behind the purge double (it
 *    catches a removed double; iteration 1 proved that path);
 *  - `globalThis.fetch` (the renderer call of `lib/revalidate.ts`).
 * It covers no other client class; the walk found none. `db.js` and `events.js` are test doubles, never SDK clients.
 * Each test ends with zero recorded calls; one positive control per detector shows it records a call.
 * The test reads two JSON files of the admin workspace (data only; no code import). Direction: backend test → admin
 * capture, the direction of the request at run time (the page sends the body to this handler).
 */

const { ddbSend, mockAudit, savedEnv, SYNTHETIC_ENV } = vi.hoisted(() => {
    // Synthetic values only (no real name, URL or key); set before the modules that read them at load time.
    const SYNTHETIC_ENV: Record<string, string> = {
        REVALIDATION_SECRET_NAME: "settings-findings-1-synthetic-secret-name",
        RENDERER_URL: "https://renderer.settings-findings-1.invalid",
        DEBOUNCE_FLUSH_FUNCTION_NAME: "settings-findings-1-synthetic-function",
    };
    const savedEnv: Record<string, string | undefined> = {};
    for (const name of [...Object.keys(SYNTHETIC_ENV), "RECAPTCHA_SECRET_KEY"]) savedEnv[name] = process.env[name];
    Object.assign(process.env, SYNTHETIC_ENV);
    return { ddbSend: vi.fn(), mockAudit: vi.fn(), savedEnv, SYNTHETIC_ENV };
});
const { mockPurge } = vi.hoisted(() => ({ mockPurge: vi.fn(async (_domains: unknown[]) => {}) }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/revalidate.js", () => ({ purgeStoredPagesOfDomains: mockPurge }));

import { handler as createTenant } from "../../src/tenant/create.js";
import { getHandler as getSettings, updateHandler as putSettings } from "../../src/tenant/settings.js";
import { handler as getSecrets } from "../../src/tenant/settings-secrets.js";
import { resolveRecaptchaConfig } from "../../src/lib/recaptcha.js";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { enqueueEdgeInvalidation } from "../../src/lib/invalidate-cdn.js";

const CAPTURES = new URL("../../../admin/src/pages/__markup__/settings-findings-1/", import.meta.url);
const capture = (name: string) => JSON.parse(readFileSync(new URL(name, CAPTURES), "utf8"));

type Row = Record<string, any>;
let table: Map<string, Row>;
const KEY = "SYSTEM|TENANT#first-save";

const GLOBAL_ADMIN = { sub: "u1", email: "agency@amodx.test", role: "GLOBAL_ADMIN", tenantId: "ALL" };
const TENANT_ADMIN = { sub: "u2", email: "owner@first.test", role: "TENANT_ADMIN", tenantId: "first-save" };

const call = async (handler: unknown, auth: Record<string, unknown>, body?: unknown) => (await (handler as any)({
    headers: { "x-tenant-id": "first-save" },
    requestContext: { authorizer: { lambda: auth }, http: { sourceIp: "127.0.0.1" } },
    body: body === undefined ? undefined : JSON.stringify(body),
}, {} as any, () => {})) as { statusCode: number; body: string };

/** The isolation guard: Lambda and Secrets Manager client sends and fetches are recorded and refused (see the header). */
let lambdaSends: ReturnType<typeof vi.spyOn>;
let secretsSends: ReturnType<typeof vi.spyOn>;
let fetches: ReturnType<typeof vi.spyOn>;
const refuse = (what: string) => async () => { throw new Error(`settings-findings-1: a ${what} left the test double`); };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T00:00:00.000Z"));
    Object.assign(process.env, SYNTHETIC_ENV);
    delete process.env.RECAPTCHA_SECRET_KEY;
    lambdaSends = vi.spyOn(LambdaClient.prototype, "send").mockImplementation(refuse("Lambda client send"));
    secretsSends = vi.spyOn(SecretsManagerClient.prototype, "send").mockImplementation(refuse("Secrets Manager client send"));
    fetches = vi.spyOn(globalThis, "fetch").mockImplementation(refuse("fetch"));
    table = new Map();
    ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd instanceof TransactWriteCommand) {
            for (const t of cmd.input.TransactItems ?? []) if (t.Put) table.set(`${t.Put.Item!.PK}|${t.Put.Item!.SK}`, structuredClone(t.Put.Item!));
            return {};
        }
        if (cmd instanceof GetCommand) {
            const row = table.get(`${cmd.input.Key!.PK}|${cmd.input.Key!.SK}`);
            return { Item: row === undefined ? undefined : structuredClone(row) };
        }
        if (cmd instanceof PutCommand) { table.set(`${cmd.input.Item!.PK}|${cmd.input.Item!.SK}`, structuredClone(cmd.input.Item!)); return {}; }
        if (cmd instanceof QueryCommand) return { Items: [] };
        if (cmd instanceof UpdateCommand) return {};          // the CDN-pending marker of withInvalidation
        throw new Error(`unmocked command ${cmd?.constructor?.name}`);
    });
    mockAudit.mockReset().mockResolvedValue(undefined);
    mockPurge.mockClear();
});
afterEach(() => {
    const escaped = { lambda: lambdaSends.mock.calls.length, secretsManager: secretsSends.mock.calls.length, fetch: fetches.mock.calls.length };
    lambdaSends.mockRestore();
    secretsSends.mockRestore();
    fetches.mockRestore();
    vi.useRealTimers();
    for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    expect(escaped, "no Lambda send, no Secrets Manager send and no fetch left the test doubles").toEqual({ lambda: 0, secretsManager: 0, fetch: 0 });
});

/** The kind of a value, never the value: "empty string", "string (n chars)", "object {k: kind, …}", a number, … */
function kindOf(value: unknown): string {
    if (typeof value === "string") return value === "" ? "empty string" : `string (${value.length} chars)`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return `object {${Object.entries(value).map(([k, v]) => `${k}: ${kindOf(v)}`).join(", ")}}`;
    }
    return Array.isArray(value) ? `array (${value.length})` : typeof value;
}
/** Every path whose value differs between `before` and `after`: added, removed or changed, with the kinds. */
function differingPaths(before: Row, after: Row, prefix = ""): string[] {
    const out: string[] = [];
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
        const path = prefix + key, b = before[key], a = after[key];
        const objects = [b, a].every((v) => v !== null && typeof v === "object" && !Array.isArray(v));
        if (!(key in before)) out.push(`added ${path}: ${kindOf(a)}`);
        else if (!(key in after)) out.push(`removed ${path}: ${kindOf(b)}`);
        else if (objects) out.push(...differingPaths(b, a, `${path}.`));
        else if (JSON.stringify(b) !== JSON.stringify(a)) out.push(`changed ${path}: ${kindOf(b)} → ${kindOf(a)}`);
    }
    return out;
}
const withoutSaveMetadata = (row: Row) => { const { updatedAt: _a, updatedBy: _b, ...rest } = row; return rest; };

describe("SETTINGS-FINDINGS-1 item 7 — the isolation guard (review-0 R1, review-1 R3)", () => {
    it("control: each detector records and refuses a call (so a zero count means none of these calls left)", async () => {
        // Lambda: through the REAL module-level client of lib/invalidate-cdn.ts (the fast-lane invoke under the synthetic
        // DEBOUNCE_FLUSH_FUNCTION_NAME); the module swallows the refusal, the detector still counts it.
        await enqueueEdgeInvalidation(["/settings-findings-1-control"]);
        expect(lambdaSends.mock.calls.length, "the Lambda detector").toBe(1);
        await expect(new SecretsManagerClient({ region: "eu-west-1" }).send(new GetSecretValueCommand({ SecretId: SYNTHETIC_ENV.REVALIDATION_SECRET_NAME }))).rejects.toThrow(/left the test double/);
        expect(secretsSends.mock.calls.length, "the Secrets Manager detector").toBe(1);
        await expect(fetch(`${SYNTHETIC_ENV.RENDERER_URL}/api/revalidate`)).rejects.toThrow(/left the test double/);
        expect(fetches.mock.calls.length, "the fetch detector").toBe(1);
        lambdaSends.mockClear();
        secretsSends.mockClear();
        fetches.mockClear();
    });
});

describe("SETTINGS-FINDINGS-1 item 7 — the first Save of a record never saved through the screen", () => {
    it("the record before → the page's unchanged-draft Save body → the record after: exactly three empty-string secret fields are added", async () => {
        // 1. The real create handler writes the record.
        const created = await call(createTenant, GLOBAL_ADMIN, { name: "First Save", domain: "first.test" });
        expect(created.statusCode).toBe(201);
        const before = structuredClone(table.get(KEY)!);

        // 2. The real GET answers are the answers the admin test served to the page.
        const answers = capture("first-save.answers.json");
        const settingsAnswer = await call(getSettings, TENANT_ADMIN);
        const secretsAnswer = await call(getSecrets, TENANT_ADMIN);
        expect(JSON.parse(settingsAnswer.body), "GET /settings = the admin test's settings answer").toEqual(answers.settings);
        expect(JSON.parse(secretsAnswer.body), "GET /settings/secrets = the admin test's secrets answer").toEqual(answers.secrets);

        // 3. The page's Save body, no edit.
        const saved = await call(putSettings, TENANT_ADMIN, capture("first-save.save.json"));
        expect(saved.statusCode).toBe(200);
        // The purge path is reached, and only the double ran (create: the new host; save: the host before and after).
        expect(mockPurge.mock.calls).toEqual([[["first.test"]], [["first.test", "first.test"]]]);
        const after = table.get(KEY)!;

        // 4. The differing paths, with kinds only. updatedAt / updatedBy: the handler writes them on every Save.
        expect(differingPaths(before, after)).toEqual([
            "added integrations.braveApiKey: empty string",
            "added integrations.google: object {clientSecret: empty string}",
            "added recaptcha.secretKey: empty string",
            "added updatedAt: string (24 chars)",
            "added updatedBy: string (2 chars)",
        ]);
    });

    it("judgement (a), a normal form: the redacted read gains only an empty object; the secrets read and the reCAPTCHA resolution are unchanged; a second Save changes nothing", async () => {
        await call(createTenant, GLOBAL_ADMIN, { name: "First Save", domain: "first.test" });
        const before = structuredClone(table.get(KEY)!);
        const readsBefore = [JSON.parse((await call(getSettings, TENANT_ADMIN)).body), JSON.parse((await call(getSecrets, TENANT_ADMIN)).body)];
        const body = capture("first-save.save.json");
        expect((await call(putSettings, TENANT_ADMIN, body)).statusCode).toBe(200);
        const after = structuredClone(table.get(KEY)!);
        const readsAfter = [JSON.parse((await call(getSettings, TENANT_ADMIN)).body), JSON.parse((await call(getSecrets, TENANT_ADMIN)).body)];

        // No value lost, no secret visible to the redacted read: GET /settings answers the same (save metadata aside), plus
        // one empty object — `redactSecrets` deletes `google.clientSecret` and keeps the object. Every reader of
        // `integrations.google` tests `clientId` / `clientSecret` for truth (admin Integrations.tsx, renderer
        // api/auth/[...nextauth]/route.ts and api/profile/route.ts), so `{}` reads as absent.
        expect(differingPaths(readsBefore[0], withoutSaveMetadata(readsAfter[0])), "GET /settings").toEqual(["added integrations.google: object {}"]);
        // The secrets read answers `""` for an absent field, so it answers the same.
        expect(readsAfter[1], "GET /settings/secrets").toEqual(readsBefore[1]);
        // No setting switched: the reCAPTCHA keys resolve the same (no deployment key, then a deployment key).
        expect(resolveRecaptchaConfig(after.recaptcha)).toEqual(resolveRecaptchaConfig(before.recaptcha));
        process.env.RECAPTCHA_SECRET_KEY = "deployment-test-key";
        expect(resolveRecaptchaConfig(after.recaptcha)).toEqual(resolveRecaptchaConfig(before.recaptcha));
        delete process.env.RECAPTCHA_SECRET_KEY;

        // A second Save: the page's input is the two answers, which are equal (GET adds only the save metadata, which the
        // page sends back as loaded), so the page sends the same body plus that metadata. The record stays equal.
        vi.setSystemTime(new Date("2026-11-27T00:05:00.000Z"));
        expect((await call(putSettings, TENANT_ADMIN, { ...body, updatedAt: after.updatedAt, updatedBy: after.updatedBy })).statusCode).toBe(200);
        expect(differingPaths(after, table.get(KEY)!)).toEqual(["changed updatedAt: string (24 chars) → string (24 chars)"]);
    });
});
