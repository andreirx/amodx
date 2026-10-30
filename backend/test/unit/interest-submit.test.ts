import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, BatchGetCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { InterestSubmissionSchema, InterestResolveRequestSchema } from "@amodx/shared";
import { createHash } from "node:crypto";

/**
 * CAT-INTEREST-1 — `POST /public/interest` and `POST /public/interest/resolve` unit rows (slice docs/slices/cat-interest-1.md § 5 "Unit"; contract
 * docs/slices/catalog-mode-1.md § 3.5). The real handler over a MOCKED DynamoDB document client and SES client
 * (aws-sdk-client-mock); the origin check (`tenant-verify.js`, the forms helper reused unchanged) is replaced by a
 * pass. No reCAPTCHA env and no tenant keys → `resolveRecaptchaConfig` returns null (local-dev branch), so reCAPTCHA
 * is not exercised here. Credential-free.
 */

process.env.TABLE_NAME = "amodx-table";
process.env.SES_FROM_EMAIL = "noreply@platform.test";
delete process.env.RECAPTCHA_SECRET_KEY;

vi.mock("../../src/lib/tenant-verify.js", () => ({ verifyTenantFromOrigin: vi.fn(async () => true) }));

const ddb = mockClient(DynamoDBDocumentClient);
const sesMock = mockClient(SESClient);

const { handler, UNPROCESSED_RETRIES } = await import("../../src/interest/public.js");

const TOKEN = "3f1c2a4e-8b7d-4c1e-9a2b-1d2e3f4a5b6c";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");
const VALID = {
    name: "Ana Pop", email: "ana@example.com", phone: "0700000000", message: "Bună ziua",
    items: [{ productId: "p1", optionValue: "120x20" }], submissionToken: TOKEN, recaptchaToken: null,
};
const PRODUCT = {
    id: "p1", title: "Oak Plank", slug: "oak-plank", status: "active", imageLink: "https://img.test/oak.jpg",
    variants: [{ id: "format", name: "Format", options: [
        { value: "120x20", imageLink: "https://img.test/oak-120.jpg" }, { value: "140x20" },
    ] }],
};

const call = async (body: unknown, routeKey = "POST /public/interest") => {
    const res = (await handler({
        routeKey,
        headers: { "x-tenant-id": "t1", origin: "https://glam.test" },
        requestContext: { http: { sourceIp: "127.0.0.1" } },
        body: JSON.stringify(body),
    } as any, {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};
const batchGets = () => ddb.commandCalls(BatchGetCommand);
const puts = () => ddb.commandCalls(PutCommand);

/** The tenant item: the reCAPTCHA/notification read and the consistent mode read (`readTenantMode`). */
function tenant(item: Record<string, any> | undefined) {
    ddb.on(GetCommand, { Key: { PK: "SYSTEM", SK: "TENANT#t1" } }).resolves({ Item: item });
}

beforeEach(() => {
    ddb.reset();
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({ MessageId: "m1" });
    tenant({ SK: "TENANT#t1", id: "t1", name: "Glam", domain: "glam.test", catalogMode: true, integrations: { contactEmail: "office@glam.test" } });
    ddb.on(BatchGetCommand).resolves({ Responses: { "amodx-table": [PRODUCT] }, UnprocessedKeys: {} });
    ddb.on(PutCommand).resolves({});
    // The replay lookup: no stored record for the token unless a row says so.
    ddb.on(GetCommand, { Key: { PK: "TENANT#t1", SK: `FORMSUB#interest-list#${TOKEN_HASH}` } }).resolves({ Item: undefined });
});

describe("InterestSubmissionSchema (packages/shared) — the § 3.5 payload limits", () => {
    const ok = (over: Record<string, unknown>) => InterestSubmissionSchema.safeParse({ ...VALID, ...over }).success;
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ productId: `p${i}` }));

    it("accepts the valid payload; the email is normalized before it is validated", () => {
        const r = InterestSubmissionSchema.safeParse({ ...VALID, email: " Ana@Example.COM " });
        expect(r.success && r.data.email).toBe("ana@example.com");
        expect(ok({ phone: undefined, message: undefined })).toBe(true);
    });

    it("each limit at its bound is accepted and +1 is refused", () => {
        const at = (s: number) => "a".repeat(s);
        const email = (len: number) => `${"a".repeat(len - "@example.com".length)}@example.com`;
        for (const [field, bound, make] of [
            ["name", 200, at], ["phone", 40, at], ["message", 2000, at], ["email", 254, email],
        ] as const) {
            expect({ field, at: ok({ [field]: make(bound) }) }).toEqual({ field, at: true });
            expect({ field, over: ok({ [field]: make(bound + 1) }) }).toEqual({ field, over: false });
        }
        expect(ok({ items: items(50) })).toBe(true);
        expect(ok({ items: items(51) })).toBe(false);
        expect(ok({ items: [] })).toBe(false);
        expect(ok({ items: [{ productId: "x".repeat(64) }] })).toBe(true);
        expect(ok({ items: [{ productId: "x".repeat(65) }] })).toBe(false);
        expect(ok({ items: [{ productId: "p", optionValue: "o".repeat(200) }] })).toBe(true);
        expect(ok({ items: [{ productId: "p", optionValue: "o".repeat(201) }] })).toBe(false);
        expect(ok({ name: "   " })).toBe(false);
        expect(ok({ submissionToken: "not-a-uuid" })).toBe(false);
    });

    it("an unknown key is refused — at the top level and on an item (client titles, slugs, images are not accepted)", () => {
        expect(ok({ extra: 1 })).toBe(false);
        expect(ok({ items: [{ productId: "p1", title: "Forged" }] })).toBe(false);
        expect(ok({ items: [{ productId: "p1", imageLink: "https://evil.test/x.jpg" }] })).toBe(false);
    });
});

describe("POST /public/interest — the handler over a mocked DynamoDB", () => {
    it("server dedupe: (p, red), (p, blue), (p, red) → two recorded items, ONE fetch key", async () => {
        ddb.on(BatchGetCommand).resolves({ Responses: { "amodx-table": [{
            id: "p", title: "Rug", slug: "rug", status: "active",
            variants: [{ id: "c", name: "Color", options: [{ value: "red" }, { value: "blue" }] }],
        }] }, UnprocessedKeys: {} });
        const res = await call({ ...VALID, items: [
            { productId: "p", optionValue: "red" }, { productId: "p", optionValue: "blue" }, { productId: "p", optionValue: "red" },
        ] });
        expect(res.status).toBe(201);
        const keys = batchGets()[0].args[0].input.RequestItems!["amodx-table"].Keys;
        expect(keys).toEqual([{ PK: "TENANT#t1", SK: "PRODUCT#p" }]);
        const record = puts().map((c) => c.args[0].input.Item!).find((i) => String(i.SK).startsWith("FORMSUB#"))!;
        expect(record.data.items.map((i: any) => i.optionValue)).toEqual(["red", "blue"]);
    });

    it("the read: consistent, projection id, title, slug, status, imageLink, variants", async () => {
        await call(VALID);
        const req = batchGets()[0].args[0].input.RequestItems!["amodx-table"];
        expect(req.ConsistentRead).toBe(true);
        expect(req.ProjectionExpression).toBe("id, title, slug, #s, imageLink, variants");
        expect(req.ExpressionAttributeNames).toEqual({ "#s": "status" });
    });

    it("option-not-found: an option the product no longer has is DROPPED, never recorded as interest in the plain product", async () => {
        const res = await call({ ...VALID, items: [{ productId: "p1", optionValue: "999x99" }, { productId: "p1" }] });
        expect(res.status).toBe(201);
        expect(res.body.dropped).toEqual([{ productId: "p1", optionValue: "999x99", reason: "option-not-found" }]);
        const record = puts().map((c) => c.args[0].input.Item!).find((i) => String(i.SK).startsWith("FORMSUB#"))!;
        expect(record.data.items).toEqual([{ productId: "p1", title: "Oak Plank", slug: "oak-plank", imageLink: "https://img.test/oak.jpg" }]);
    });

    it("only an option-not-found item → 400 with the drop reported, nothing written, no mail", async () => {
        const res = await call({ ...VALID, items: [{ productId: "p1", optionValue: "999x99" }] });
        expect(res.status).toBe(400);
        expect(res.body.dropped).toEqual([{ productId: "p1", optionValue: "999x99", reason: "option-not-found" }]);
        expect(puts()).toHaveLength(0);
        expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    });

    it(`UnprocessedKeys: retried ${UNPROCESSED_RETRIES} times, then 503 { retryable: true } and NOTHING written (no record, no form, no mail)`, async () => {
        const key = { PK: "TENANT#t1", SK: "PRODUCT#p1" };
        ddb.on(BatchGetCommand).resolves({ Responses: { "amodx-table": [] }, UnprocessedKeys: { "amodx-table": { Keys: [key] } } });
        const res = await call(VALID);
        expect(res.status).toBe(503);
        expect(res.body.retryable).toBe(true);
        expect(batchGets()).toHaveLength(1 + UNPROCESSED_RETRIES);
        expect(batchGets()[1].args[0].input.RequestItems!["amodx-table"].Keys).toEqual([key]);
        expect(puts()).toHaveLength(0);
        expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    });

    it("UnprocessedKeys that clear on a retry: the read completes and the list is recorded", async () => {
        const key = { PK: "TENANT#t1", SK: "PRODUCT#p1" };
        ddb.on(BatchGetCommand)
            .resolvesOnce({ Responses: { "amodx-table": [] }, UnprocessedKeys: { "amodx-table": { Keys: [key] } } })
            .resolves({ Responses: { "amodx-table": [PRODUCT] }, UnprocessedKeys: {} });
        const res = await call(VALID);
        expect(res.status).toBe(201);
        expect(batchGets()).toHaveLength(2);
    });

    it("tenant mode: no tenant record → 404; a tenant that is not catalog → 403; both before any product read or write", async () => {
        tenant(undefined);
        expect((await call(VALID)).status).toBe(404);
        tenant({ SK: "TENANT#t1", id: "t1", commerceEnabled: true });
        expect((await call(VALID)).status).toBe(403);
        expect(batchGets()).toHaveLength(0);
        expect(puts()).toHaveLength(0);
        // The mode read is the strongly consistent one (readTenantMode).
        expect(ddb.commandCalls(GetCommand).some((c) => c.args[0].input.ConsistentRead === true)).toBe(true);
    });

    it("an invalid body → 400 before the tenant mode or any product is read", async () => {
        const res = await call({ ...VALID, items: [{ productId: "p1", title: "Forged" }] });
        expect(res.status).toBe(400);
        expect(batchGets()).toHaveLength(0);
        expect(ddb.commandCalls(GetCommand).some((c) => c.args[0].input.ConsistentRead === true)).toBe(false);
    });
});

describe("POST /public/interest — replay by token hash (review-0 F2)", () => {
    it("a stored record for the token → 200 already-recorded from THAT record, before any product read, no write, no mail", async () => {
        ddb.on(GetCommand, { Key: { PK: "TENANT#t1", SK: `FORMSUB#interest-list#${TOKEN_HASH}` } })
            .resolves({ Item: { data: { items: [{ productId: "p1", title: "Oak Plank", slug: "oak-plank", optionValue: "120x20" }] } } });
        // Even a read that could never complete is not reached.
        ddb.on(BatchGetCommand).resolves({ Responses: { "amodx-table": [] }, UnprocessedKeys: { "amodx-table": { Keys: [{ PK: "TENANT#t1", SK: "PRODUCT#p1" }] } } });
        const res = await call(VALID);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ outcome: "already-recorded", submissionId: TOKEN_HASH, recorded: [{ productId: "p1", optionValue: "120x20" }] });
        expect(batchGets()).toHaveLength(0);
        expect(puts()).toHaveLength(0);
        expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
        const lookup = ddb.commandCalls(GetCommand).find((c) => String(c.args[0].input.Key?.SK).startsWith("FORMSUB#"))!;
        expect(lookup.args[0].input.ConsistentRead).toBe(true);
    });

    it("a new token: 201 recorded, with the recorded pairs and the drops", async () => {
        const res = await call({ ...VALID, items: [{ productId: "p1", optionValue: "120x20" }, { productId: "p1", optionValue: "999" }] });
        expect(res.status).toBe(201);
        expect(res.body).toEqual({
            outcome: "recorded", submissionId: TOKEN_HASH,
            recorded: [{ productId: "p1", optionValue: "120x20" }],
            dropped: [{ productId: "p1", optionValue: "999", reason: "option-not-found" }],
        });
    });
});

describe("POST /public/interest/resolve — the list page's identity read (§ 8 F3, F7)", () => {
    const RESOLVE = "POST /public/interest/resolve";
    const resolve = (productIds: unknown) => call({ productIds }, RESOLVE);

    it("active (display fields, collection from attributes[colecție], option values) | not-available (no fields) | absent", async () => {
        ddb.on(BatchGetCommand).resolves({ Responses: { "amodx-table": [
            { ...PRODUCT, attributes: [{ key: "unitate", value: "mp" }, { key: "colecție", value: "Herringbone" }] },
            { id: "d1", title: "Draft secret", slug: "draft", status: "draft", imageLink: "https://img.test/d.jpg" },
        ] }, UnprocessedKeys: {} });
        const res = await resolve(["p1", "d1", "gone", "p1"]);
        expect(res.status).toBe(200);
        expect(res.body.products).toEqual([
            { productId: "p1", status: "active", title: "Oak Plank", slug: "oak-plank", imageLink: "https://img.test/oak.jpg", collection: "Herringbone", optionValues: ["120x20", "140x20"] },
            { productId: "d1", status: "not-available" },
            { productId: "gone", status: "absent" },
        ]);
        expect(JSON.stringify(res.body)).not.toContain("Draft secret");
        const req = batchGets()[0].args[0].input.RequestItems!["amodx-table"];
        expect(req.Keys).toEqual([
            { PK: "TENANT#t1", SK: "PRODUCT#p1" }, { PK: "TENANT#t1", SK: "PRODUCT#d1" }, { PK: "TENANT#t1", SK: "PRODUCT#gone" },
        ]);
        expect(req.ConsistentRead).toBe(true);
        expect(req.ProjectionExpression).toBe("id, title, slug, #s, imageLink, variants, attributes");
    });

    it("no colecție attribute → no collection key", async () => {
        const res = await resolve(["p1"]);
        expect(res.body.products[0]).not.toHaveProperty("collection");
    });

    it(`keys still unprocessed after ${UNPROCESSED_RETRIES} retries → 503 retryable; absence is never stated from a partial read`, async () => {
        ddb.on(BatchGetCommand).resolves({ Responses: { "amodx-table": [] }, UnprocessedKeys: { "amodx-table": { Keys: [{ PK: "TENANT#t1", SK: "PRODUCT#p1" }] } } });
        const res = await resolve(["p1"]);
        expect(res.status).toBe(503);
        expect(res.body).toMatchObject({ retryable: true });
        expect(res.body).not.toHaveProperty("products");
        expect(batchGets()).toHaveLength(1 + UNPROCESSED_RETRIES);
    });

    it("the body is strict (1..50 ids, ≤ 64 chars, no other key); a non-catalog tenant → 403; no tenant → 404; nothing written", async () => {
        const ok = (b: unknown) => InterestResolveRequestSchema.safeParse(b).success;
        expect(ok({ productIds: Array.from({ length: 50 }, (_, i) => `p${i}`) })).toBe(true);
        expect(ok({ productIds: Array.from({ length: 51 }, (_, i) => `p${i}`) })).toBe(false);
        expect(ok({ productIds: [] })).toBe(false);
        expect(ok({ productIds: ["x".repeat(65)] })).toBe(false);
        expect(ok({ productIds: ["p1"], extra: 1 })).toBe(false);
        expect((await resolve([])).status).toBe(400);
        tenant({ SK: "TENANT#t1", id: "t1", commerceEnabled: true });
        expect((await resolve(["p1"])).status).toBe(403);
        tenant(undefined);
        expect((await resolve(["p1"])).status).toBe(404);
        expect(batchGets()).toHaveLength(0);
        expect(puts()).toHaveLength(0);
    });

    it("an unknown route key → 404, nothing read or written", async () => {
        const res = await call(VALID, "POST /public/interest/other");
        expect(res.status).toBe(404);
        expect(batchGets()).toHaveLength(0);
        expect(puts()).toHaveLength(0);
    });
});
