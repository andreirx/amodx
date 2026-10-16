import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * BACKEND-CONTRACT-1 — PUT /content/{id} contract (backend/src/content/update.ts).
 *
 *  D1  a validation failure or a non-JSON body is a 400, a forbidden caller a 403, a cancelled
 *      transaction (the slug-clash case) a 409 — not a 500.
 *  D2  seoTitle (and the other four nullable fields): absent = keep, null = clear, string = set.
 *  D3  a slug that differs from the stored one goes through normalizeSlug; an absent slug, or the
 *      stored slug resent unchanged, keeps the stored one as it is.
 *
 * Credential-free (db-mock seam of revalidate-order.test.ts): `db.js` is mocked; audit, the
 * commerce-prefix guard and the ISR purge are mocked because they do their own I/O and are not
 * under test here. `requireRole` is the real (pure) function. "Writes" in a test name = the value in
 * the DynamoDB command the handler SENDS to the mocked client; nothing is persisted.
 */

const { ddbSend } = vi.hoisted(() => ({ ddbSend: vi.fn() }));

vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));
vi.mock("../../src/lib/slug-guard.js", () => ({ checkSlugCommerceConflict: vi.fn(async () => null) }));
vi.mock("../../src/lib/revalidate.js", () => ({ revalidateTenantPaths: vi.fn() }));

import { handler } from "../../src/content/update.js";

const CURRENT = {
    PK: "TENANT#t1",
    SK: "CONTENT#n1#LATEST",
    title: "Old",
    slug: "/old",
    status: "Draft",
    blocks: [],
    seoTitle: "Stored SEO title",
    version: 3,
};

function event(body: string, tokenTenant = "t1") {
    return {
        headers: { "x-tenant-id": "t1" },
        pathParameters: { id: "n1" },
        body,
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "ed@t1.test", role: "TENANT_ADMIN", tenantId: tokenTenant } },
            http: { sourceIp: "127.0.0.1" },
        },
    } as any;
}

async function put(body: unknown, tokenTenant?: string) {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return (await handler(event(raw, tokenTenant), {} as any, () => {})) as { statusCode: number; body: string };
}

/** Serve `stored` (merged over CURRENT) as the page the handler reads. */
function storedPage(stored: Record<string, unknown>) {
    ddbSend.mockImplementation(async (cmd: any) => (cmd instanceof GetCommand ? { Item: { ...CURRENT, ...stored } } : {}));
}

function sentTransaction() {
    return ddbSend.mock.calls.map((c) => c[0]).find((c) => c instanceof TransactWriteCommand);
}

/** The UpdateCommand on CONTENT#…#LATEST inside the one TransactWrite the handler sent. */
function contentUpdate() {
    const tx = ddbSend.mock.calls.map((c) => c[0]).find((c) => c instanceof TransactWriteCommand);
    expect(tx, "TransactWriteCommand was sent").toBeDefined();
    return tx.input.TransactItems.find((i: any) => i.Update)!.Update;
}

beforeEach(() => {
    ddbSend.mockReset();
    ddbSend.mockImplementation(async (cmd: any) => (cmd instanceof GetCommand ? { Item: { ...CURRENT } } : {}));
});

describe("BACKEND-CONTRACT-1 D2 — seoTitle: absent keeps, null clears, string sets", () => {
    it("seoTitle absent → 200, :st = the stored value (keep)", async () => {
        const res = await put({ title: "New" });
        expect(res.statusCode).toBe(200);
        expect(contentUpdate().ExpressionAttributeValues[":st"]).toBe("Stored SEO title");
    });

    it("seoTitle null → 200, :st = null (clear)", async () => {
        const res = await put({ seoTitle: null });
        expect(res.statusCode).toBe(200);
        expect(contentUpdate().ExpressionAttributeValues[":st"]).toBeNull();
    });

    it("seoTitle string → 200, :st = the string (set)", async () => {
        const res = await put({ seoTitle: "Fresh" });
        expect(res.statusCode).toBe(200);
        expect(contentUpdate().ExpressionAttributeValues[":st"]).toBe("Fresh");
    });
});

describe("BACKEND-CONTRACT-1 D1 — client errors are 400, not 500", () => {
    it("seoTitle number → 400 with issues[0].path == ['seoTitle']; no db call at all", async () => {
        const res = await put({ seoTitle: 42 });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("Validation failed");
        expect(body.issues[0].path).toEqual(["seoTitle"]);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("token for another tenant (auth.tenantId t9 ≠ header t1) → 403, no db call", async () => {
        const res = await put({ title: "New" }, "t9");
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/Access Denied/);
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("rename whose TransactWrite is cancelled (mocked TransactionCanceledException, ConditionalCheckFailed) → 409; the ROUTE#/taken Put sent is conditional", async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
            if (cmd instanceof GetCommand) return { Item: { ...CURRENT } };
            if (cmd instanceof TransactWriteCommand) {
                throw Object.assign(new Error("Transaction cancelled"), {
                    name: "TransactionCanceledException",
                    CancellationReasons: [{ Code: "None" }, { Code: "None" }, { Code: "ConditionalCheckFailed" }, { Code: "None" }],
                });
            }
            return {};
        });
        const res = await put({ slug: "/taken" });
        expect(res.statusCode).toBe(409);
        // the conflicting write really was the conditional route claim
        const routePut = sentTransaction().input.TransactItems.find((i: any) => i.Put?.Item?.SK === "ROUTE#/taken");
        expect(routePut.Put.ConditionExpression).toBe("attribute_not_exists(SK)");
    });

    it("body not JSON → 400 'Invalid JSON'", async () => {
        const res = await put("{not json");
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe("Invalid JSON");
        expect(ddbSend).not.toHaveBeenCalled();
    });
});

describe("BACKEND-CONTRACT-1 D3 — update uses the create normaliser", () => {
    it("slug '/Foo Bar' → 200, writes slug /foo-bar and a redirect Put from /old", async () => {
        const res = await put({ slug: "/Foo Bar" });
        expect(res.statusCode).toBe(200);
        const update = contentUpdate();
        expect(update.ExpressionAttributeValues[":sl"]).toBe("/foo-bar");
        // slugChanged → the redirect route for the old slug is part of the transaction
        const tx = ddbSend.mock.calls.map((c) => c[0]).find((c) => c instanceof TransactWriteCommand);
        const redirect = tx.input.TransactItems.find((i: any) => i.Put?.Item?.SK === "ROUTE#/old");
        expect(redirect.Put.Item.RedirectTo).toBe("/foo-bar");
        expect(JSON.parse(res.body).slug).toBe("/foo-bar");
    });

    it("legacy slug resent unchanged ('/Legacy%20Slug') → 200, writes no slug and no ROUTE# Put; response slug unchanged", async () => {
        storedPage({ slug: "/Legacy%20Slug" });
        const res = await put({ slug: "/Legacy%20Slug", title: "Edited" });
        expect(res.statusCode).toBe(200);
        const update = contentUpdate();
        expect(update.UpdateExpression).not.toContain("slug = :sl");
        expect(sentTransaction().input.TransactItems.some((i: any) => i.Put?.Item?.SK?.startsWith("ROUTE#"))).toBe(false);
        expect(JSON.parse(res.body).slug).toBe("/Legacy%20Slug");
    });

    it("legacy slug changed to '/New Slug' → writes slug /new-slug and a redirect Put from '/Legacy%20Slug'", async () => {
        storedPage({ slug: "/Legacy%20Slug" });
        const res = await put({ slug: "/New Slug" });
        expect(res.statusCode).toBe(200);
        expect(contentUpdate().ExpressionAttributeValues[":sl"]).toBe("/new-slug");
        const redirect = sentTransaction().input.TransactItems.find((i: any) => i.Put?.Item?.SK === "ROUTE#/Legacy%20Slug");
        expect(redirect.Put.Item.RedirectTo).toBe("/new-slug");
    });

    it("slug absent → 200, writes no slug; response slug is the stored /old", async () => {
        const res = await put({ title: "New" });
        expect(res.statusCode).toBe(200);
        const update = contentUpdate();
        expect(update.ExpressionAttributeValues[":sl"]).toBeUndefined();
        expect(update.UpdateExpression).not.toContain("slug = :sl");
        expect(JSON.parse(res.body).slug).toBe("/old");
    });
});
