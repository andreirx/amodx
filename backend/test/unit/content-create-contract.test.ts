import { describe, it, expect, beforeEach, vi } from "vitest";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * BACKEND-CONTRACT-1 — POST /content contract (backend/src/content/create.ts).
 *
 *  D1  a schema mismatch is a 400 with zod issues, and nothing is written.
 *  D2  seoTitle: null is accepted and written as null.
 *  D3  the slug goes through normalizeSlug.
 *
 * Credential-free: `db.js` is mocked (db-mock seam of revalidate-order.test.ts); audit, the
 * commerce-prefix guard and the ISR purge are mocked. `requireRole` is the real function.
 * "Writes" = the value in the TransactWrite the handler SENDS to the mocked client.
 */

const { ddbSend } = vi.hoisted(() => ({ ddbSend: vi.fn() }));

vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));
vi.mock("../../src/lib/slug-guard.js", () => ({ checkSlugCommerceConflict: vi.fn(async () => null) }));
vi.mock("../../src/lib/revalidate.js", () => ({ revalidateTenantPaths: vi.fn() }));

import { handler } from "../../src/content/create.js";

async function post(body: unknown) {
    const ev = {
        headers: { "x-tenant-id": "t1" },
        body: JSON.stringify(body),
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "ed@t1.test", role: "TENANT_ADMIN", tenantId: "t1" } },
            http: { sourceIp: "127.0.0.1" },
        },
    } as any;
    return (await handler(ev, {} as any, () => {})) as { statusCode: number; body: string };
}

function transactWrites() {
    return ddbSend.mock.calls.map((c) => c[0]).filter((c) => c instanceof TransactWriteCommand);
}

beforeEach(() => {
    ddbSend.mockReset();
    ddbSend.mockResolvedValue({});
});

describe("BACKEND-CONTRACT-1 create — slug normalised, null SEO accepted", () => {
    it("slug 'My Page' + seoTitle null → 201, writes slug /my-page, ROUTE#/my-page and seoTitle null", async () => {
        const res = await post({ title: "Some title", slug: "My Page", seoTitle: null });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).slug).toBe("/my-page");

        const [tx] = transactWrites();
        const [contentPut, routePut] = tx.input.TransactItems;
        expect(contentPut.Put.Item.slug).toBe("/my-page");
        expect(contentPut.Put.Item.seoTitle).toBeNull();
        expect(routePut.Put.Item.SK).toBe("ROUTE#/my-page");
    });
});

describe("BACKEND-CONTRACT-1 D1 create — client errors are 400", () => {
    it("blocks: 'x' → 400 'Validation failed' with issues; no TransactWrite", async () => {
        const res = await post({ title: "T", blocks: "x" });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toBe("Validation failed");
        expect(body.issues[0].path).toEqual(["blocks"]);
        expect(transactWrites()).toHaveLength(0);
    });
});
