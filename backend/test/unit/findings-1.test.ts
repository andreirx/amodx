import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * FINDINGS-1 (docs/slices/findings-1.md) — Part 1 and Part 2.
 *
 * Part 1: `GET /public/products/{slug}` answers only the named public fields (F-DFG1-PUBLIC-GET-DENYLIST).
 * Part 2: `GET /products` does not answer `resourceId` to a service key (F-DFG1-SERVICE-KEY); `GET /products/{id}`
 * never answers a service key at all.
 *
 * The real handlers run. Mocked: `db.js` (its `send` returns a fixed answer). Credential-free.
 */

const { ddbSend } = vi.hoisted(() => ({ ddbSend: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));

import { handler as productPublicGet } from "../../src/products/public-get.js";
import { handler as productsList } from "../../src/products/list.js";
import { handler as productGet } from "../../src/products/get.js";

const T = "t1";

beforeEach(() => {
    ddbSend.mockReset();
});

// ── Part 1 ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The public fields, written out here as the contract (the record's § Part 1 table). Every one has a value below. */
const PUBLIC_FIELDS: Record<string, unknown> = {
    id: "p1", status: "active", title: "Ring", slug: "ring", sku: "R-1", description: "Short", longDescription: "<p>Long</p>",
    price: "100", currency: "EUR", salePrice: "90", volumePricing: [{ minQuantity: 2, price: "85" }],
    availability: "in_stock", availableFrom: "2020-01-01", availableUntil: "2999-12-31",
    brand: "Brand", condition: "new", categoryIds: ["c1"], tags: ["gold"], attributes: [{ key: "Metal", value: "Gold" }],
    personalizations: [{ id: "x", label: "Engraving", type: "text", required: false }],
    variants: [{ id: "v", name: "Size", options: [{ value: "52" }] }],
    ingredients: "Gold", nutritionalValues: [{ label: "n", value: "v" }],
    imageLink: "https://cdn.test/a.jpg", additionalImageLinks: ["https://cdn.test/b.jpg"], paymentLinkId: "pri_1",
    seoTitle: "SEO title", seoDescription: "SEO description", sortOrder: 3,
};

/** Stored attributes that must never leave: the private file, storage keys, importer bookkeeping, fields no visitor
 *  sees, and one attribute that is not in ProductSchema at all. */
const PRIVATE_FIELDS: Record<string, unknown> = {
    resourceId: "r-secret-file",
    PK: `TENANT#${T}`, SK: "PRODUCT#p1", TenantSlug: `${T}#ring`, Type: "Product", tenantId: T,
    importSource: "glam:producer/internal-sheet", importLabels: { a: "b" }, importProfileRevision: 4,
    facetModes: { Metal: "single" },
    costPriceFromSupplier: "41.50",
    productType: "physical", inventoryQuantity: 7, weight: 12, link: "https://x.test", category: "legacy",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
};

const publicGet = async (stored: Record<string, unknown>) => {
    ddbSend.mockResolvedValue({ Items: [structuredClone(stored)] });
    return (await (productPublicGet as any)(
        { headers: { "x-tenant-id": T }, pathParameters: { slug: "ring" } }, {} as any, () => {},
    )) as { statusCode: number; body: string };
};

describe("FINDINGS-1 Part 1 — GET /public/products/{slug} answers only the named public fields", () => {
    it("a stored item with resourceId, storage keys, importer fields and an unknown attribute → none of them answered", async () => {
        const res = await publicGet({ ...PRIVATE_FIELDS, ...PUBLIC_FIELDS });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        for (const key of Object.keys(PRIVATE_FIELDS)) expect(key in body, key).toBe(false);
        expect(res.body).not.toContain("r-secret-file");
        expect(res.body).not.toContain("internal-sheet");
        expect(res.body).not.toContain("41.50");
    });

    it("every listed field that is present is answered unchanged, and nothing else", async () => {
        const res = await publicGet({ ...PRIVATE_FIELDS, ...PUBLIC_FIELDS });
        expect(JSON.parse(res.body)).toEqual(PUBLIC_FIELDS);
    });

    it("a listed field the item does not hold is not added (no undefined or null keys)", async () => {
        const res = await publicGet({ PK: `TENANT#${T}`, SK: "PRODUCT#p2", id: "p2", status: "active", slug: "ring", title: "Plain" });
        expect(JSON.parse(res.body)).toEqual({ id: "p2", status: "active", slug: "ring", title: "Plain" });
    });

    it("a draft product → 404 as before", async () => {
        const res = await publicGet({ ...PRIVATE_FIELDS, ...PUBLIC_FIELDS, status: "draft" });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: "Product not found" });
    });

    it("an unavailable product (availableUntil in the past) → 404 as before", async () => {
        const res = await publicGet({ ...PRIVATE_FIELDS, ...PUBLIC_FIELDS, availableUntil: "2000-01-01" });
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toEqual({ error: "Product not found" });
    });
});

// ── Part 2 ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Ctx = Record<string, string>;
const SERVICE: Ctx = { sub: "service:k1", role: "SERVICE", tenantId: T, scopes: "catalog:read", keyId: "k1" };
const TENANT_ADMIN: Ctx = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: T };
const ROBOT: Ctx = { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" };

const STORED_LIST = [
    { id: "p1", title: "Course", slug: "course", price: "49", status: "active", productType: "digital", paymentLinkId: "pri_1", resourceId: "r-paid", sortOrder: 0 },
    { id: "p2", title: "Ring", slug: "ring", price: "100", status: "active", productType: "physical", sortOrder: 1 },
];

const call = async (handler: any, ctx: Ctx, extra: Record<string, unknown> = {}) =>
    (await handler({
        headers: { "x-tenant-id": T },
        requestContext: { authorizer: { lambda: ctx }, http: { sourceIp: "127.0.0.1" } },
        ...extra,
    } as any, {} as any, () => {})) as { statusCode: number; body: string };

describe("FINDINGS-1 Part 2 — GET /products answers resourceId to admin sessions only", () => {
    it("TENANT_ADMIN → resourceId present, the list unchanged", async () => {
        ddbSend.mockResolvedValue({ Items: structuredClone(STORED_LIST) });
        const res = await call(productsList, TENANT_ADMIN);
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).items).toEqual(STORED_LIST);
    });

    it("GLOBAL_ADMIN (master key, the MCP server's credential) → resourceId present", async () => {
        ddbSend.mockResolvedValue({ Items: structuredClone(STORED_LIST) });
        const res = await call(productsList, ROBOT);
        expect(JSON.parse(res.body).items[0].resourceId).toBe("r-paid");
    });

    it("SERVICE key with catalog:read → resourceId absent, every other field unchanged", async () => {
        ddbSend.mockResolvedValue({ Items: structuredClone(STORED_LIST) });
        const res = await call(productsList, SERVICE);
        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain("r-paid");
        const { resourceId: _r, ...firstWithout } = STORED_LIST[0];
        expect(JSON.parse(res.body).items).toEqual([firstWithout, STORED_LIST[1]]);
    });
});

describe("FINDINGS-1 Part 2 — GET /products/{id} never answers a service key", () => {
    it("SERVICE key → not 200, no DynamoDB read, no resourceId", async () => {
        ddbSend.mockResolvedValue({ Item: structuredClone(STORED_LIST[0]) });
        const res = await call(productGet, SERVICE, { pathParameters: { id: "p1" } });
        expect(res.statusCode).not.toBe(200);
        expect(ddbSend).not.toHaveBeenCalled();
        expect(res.body).not.toContain("r-paid");
    });

    it("TENANT_ADMIN → the stored item, resourceId present (unchanged)", async () => {
        ddbSend.mockResolvedValue({ Item: structuredClone(STORED_LIST[0]) });
        const res = await call(productGet, TENANT_ADMIN, { pathParameters: { id: "p1" } });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).resourceId).toBe("r-paid");
    });
});
