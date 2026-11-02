import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, BatchGetCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { createHash } from "node:crypto";

/**
 * CAT-QUOTE-1 (docs/slices/cat-quote-1.md § 3 item 4; packet rule 2) — the interest list's recipient:
 * `interestListEmail` → `integrations.contactEmail` → none (stored, logged, no mail; no platform fallback). The mail is
 * the same whichever address receives it. The real handler over a mocked DynamoDB document client and SES client, as
 * interest-submit.test.ts (origin check replaced by a pass; no reCAPTCHA keys). Credential-free.
 */

process.env.TABLE_NAME = "amodx-table";
process.env.SES_FROM_EMAIL = "noreply@platform.test";
delete process.env.RECAPTCHA_SECRET_KEY;

vi.mock("../../src/lib/tenant-verify.js", () => ({ verifyTenantFromOrigin: vi.fn(async () => true) }));

const ddb = mockClient(DynamoDBDocumentClient);
const sesMock = mockClient(SESClient);

const { handler } = await import("../../src/interest/public.js");

const TOKEN = "3f1c2a4e-8b7d-4c1e-9a2b-1d2e3f4a5b6c";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");
const VALID = { name: "Ana Pop", email: "ana@example.com", items: [{ productId: "p1" }], submissionToken: TOKEN, recaptchaToken: null };
const PRODUCT = { id: "p1", title: "Oak Plank", slug: "oak-plank", status: "active" };
const BASE = { SK: "TENANT#t1", id: "t1", name: "Glam", domain: "glam.test", catalogMode: true };

function tenant(item: Record<string, unknown>) {
    ddb.on(GetCommand, { Key: { PK: "SYSTEM", SK: "TENANT#t1" } }).resolves({ Item: item });
}
async function send() {
    const res = (await handler({
        routeKey: "POST /public/interest",
        headers: { "x-tenant-id": "t1", origin: "https://glam.test" },
        requestContext: { http: { sourceIp: "127.0.0.1" } },
        body: JSON.stringify(VALID),
    } as any, {} as any, () => {})) as any;
    expect(res.statusCode).toBe(201);
    return sesMock.commandCalls(SendEmailCommand).map((c) => c.args[0].input);
}
/** The mail minus its recipient and its send time (the clock), to compare two sends. */
const withoutRecipient = (mail: any) => ({ ...mail, Destination: undefined, Message: { ...mail.Message, Body: { Text: { Data: mail.Message.Body.Text.Data.replace(/Trimisă: .*$/, "Trimisă: {now}") } } } });

beforeEach(() => {
    ddb.reset();
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({ MessageId: "m1" });
    ddb.on(BatchGetCommand).resolves({ Responses: { "amodx-table": [PRODUCT] }, UnprocessedKeys: {} });
    ddb.on(PutCommand).resolves({});
    ddb.on(GetCommand, { Key: { PK: "TENANT#t1", SK: `FORMSUB#interest-list#${TOKEN_HASH}` } }).resolves({ Item: undefined });
});

describe("CAT-QUOTE-1 — the interest list's recipient", () => {
    it("interestListEmail set → the mail goes there, not to integrations.contactEmail; the mail is otherwise the same", async () => {
        tenant({ ...BASE, integrations: { contactEmail: "office@glam.test" } });
        const [before] = await send();
        expect(before.Destination).toEqual({ ToAddresses: ["office@glam.test"] });
        sesMock.resetHistory();
        tenant({ ...BASE, integrations: { contactEmail: "office@glam.test" }, interestListEmail: "lists@glam.test" });
        const mails = await send();
        expect(mails).toHaveLength(1);
        expect(mails[0].Destination).toEqual({ ToAddresses: ["lists@glam.test"] });
        expect(withoutRecipient(mails[0])).toEqual(withoutRecipient(before));
    });

    it("interestListEmail absent → integrations.contactEmail, as before the slice", async () => {
        tenant({ ...BASE, integrations: { contactEmail: "office@glam.test" } });
        const mails = await send();
        expect(mails.map((m) => m.Destination)).toEqual([{ ToAddresses: ["office@glam.test"] }]);
    });

    it("interestListEmail set and no integrations.contactEmail → interestListEmail", async () => {
        tenant({ ...BASE, interestListEmail: "lists@glam.test" });
        const mails = await send();
        expect(mails.map((m) => m.Destination)).toEqual([{ ToAddresses: ["lists@glam.test"] }]);
    });

    it("neither → the list is stored, no mail, no platform fallback", async () => {
        tenant({ ...BASE, integrations: { contactEmail: "" } });
        const mails = await send();
        expect(mails).toEqual([]);
        expect(ddb.commandCalls(PutCommand).some((c) => String(c.args[0].input.Item?.SK).startsWith("FORMSUB#"))).toBe(true);
    });
});
