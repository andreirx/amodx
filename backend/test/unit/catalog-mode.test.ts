import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

/**
 * CATALOG-MODE-1 / CAT-MODE-1 — the unit rows of docs/slices/cat-mode-1.md § 5 (and the builder packet § 1).
 *
 * Same style as `settings-keys*.test.ts`: the real handlers, the real `requireRole`, `withInvalidation`,
 * `catprod.ts` and `lib/catalog-product.ts` run, with real command classes; only `db.js` (`send`), `events.js`
 * (`publishAudit`), the cache-invalidation call of `products/update.ts` and the order handler's origin and
 * reCAPTCHA helpers are mocked. Credential-free. Each row inspects exactly what would reach DynamoDB.
 */

const { ddbSend, mockAudit, mockRevalidate, mockVerifyOrigin, mockResolveRecaptcha, mockVerifyRecaptcha } = vi.hoisted(() => ({
    ddbSend: vi.fn(),
    mockAudit: vi.fn(),
    mockRevalidate: vi.fn(),
    mockVerifyOrigin: vi.fn(),
    mockResolveRecaptcha: vi.fn(),
    mockVerifyRecaptcha: vi.fn(),
}));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/revalidate.js", () => ({ revalidateTenantPaths: mockRevalidate }));
vi.mock("../../src/lib/tenant-verify.js", () => ({ verifyTenantFromOrigin: mockVerifyOrigin }));
vi.mock("../../src/lib/recaptcha.js", () => ({ resolveRecaptchaConfig: mockResolveRecaptcha, verifyRecaptcha: mockVerifyRecaptcha }));

import { handler as createTenant } from "../../src/tenant/create.js";
import { updateHandler as putSettings } from "../../src/tenant/settings.js";
import { handler as createProduct } from "../../src/products/create.js";
import { handler as updateProduct } from "../../src/products/update.js";
import { handler as wooImport } from "../../src/import/woocommerce.js";
import { handler as createOrder } from "../../src/orders/create.js";
import { checkProductWrite } from "../../src/lib/catalog-product.js";

const GLOBAL_ADMIN = { sub: "g1", email: "global@amodx.test", role: "GLOBAL_ADMIN", tenantId: "GLOBAL" };
const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };

const TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", Domain: "t1.test" };
const CATALOG_TENANT = { ...TENANT, catalogMode: true };
const COMMERCE_TENANT = { ...TENANT, commerceEnabled: true };

const IMG = "https://img.test/a.jpg";
/** A stored catalog product: no monetary field, as the write boundary leaves it. */
const CATALOG_PRODUCT = {
    PK: "TENANT#t1", SK: "PRODUCT#p1", id: "p1", tenantId: "t1", Type: "Product", TenantSlug: "t1#rug",
    title: "Rug", slug: "rug", description: "d", status: "active", imageLink: IMG, categoryIds: ["c1"],
    currency: "USD", availability: "in_stock", volumePricing: [], personalizations: [], variants: [],
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
/** A stored product written by the catalog importer: one variant group, images derived from its options. */
const IMPORTED_PRODUCT = {
    ...CATALOG_PRODUCT,
    importSource: "glam:boen/pl",
    imageLink: "https://img.test/1.jpg",
    additionalImageLinks: ["https://img.test/2.jpg"],
    variants: [{ id: "g", name: "Format", options: [
        { value: "120x20", imageLink: "https://img.test/1.jpg" },
        { value: "140x20", imageLink: "https://img.test/2.jpg" },
    ] }],
};

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const writes = () => commands().filter((c) =>
    c instanceof PutCommand || c instanceof UpdateCommand || c instanceof DeleteCommand ||
    c instanceof BatchWriteCommand || c instanceof TransactWriteCommand);
/** Writes other than the CDN_LAST_CHANGE marker of `withInvalidation` (it fires only on 2xx). */
const dataWrites = () => writes().filter((c) => !(c instanceof PutCommand && c.input.Item?.SK === "CDN_LAST_CHANGE")
    && !(c instanceof UpdateCommand && String(c.input.Key?.SK ?? "").startsWith("CDN_")));
const tenantGets = () => commands().filter((c) => c instanceof GetCommand && c.input.Key?.SK === "TENANT#t1");
const productPuts = () => commands().filter((c) => c instanceof PutCommand && String(c.input.Item?.SK).startsWith("PRODUCT#"));

/** Get of the tenant record → `tenant` (undefined = missing); Get of a product → `product`; other calls → empty. */
function mockDb({ tenant, product }: { tenant?: Record<string, any>; product?: Record<string, any> }) {
    ddbSend.mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) {
            const sk = String(cmd.input.Key?.SK);
            if (sk.startsWith("TENANT#")) return { Item: tenant ? structuredClone(tenant) : undefined };
            if (sk.startsWith("PRODUCT#")) return { Item: product ? structuredClone(product) : undefined };
            return {};
        }
        if (cmd instanceof QueryCommand) return { Items: [] };
        return {};
    });
}

const event = (auth: any, body: unknown, extra: Record<string, any> = {}) => ({
    headers: { "x-tenant-id": "t1", origin: "https://t1.test" },
    requestContext: { authorizer: { lambda: auth }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
    ...extra,
}) as any;
const call = async (h: any, e: any) => (await h(e, {} as any, () => {})) as any;

beforeEach(() => {
    ddbSend.mockReset();
    mockAudit.mockReset().mockResolvedValue(undefined);
    mockRevalidate.mockReset().mockResolvedValue(undefined);
    mockVerifyOrigin.mockReset().mockResolvedValue(true);
    mockResolveRecaptcha.mockReset().mockReturnValue(null);
    mockVerifyRecaptcha.mockReset();
});

// ── 1. The flag at creation (CM-D11) ────────────────────────────────────────────────────
describe("CM1 — POST /tenants binds the mode", () => {
    const createdTenant = () => {
        const tx = commands().find((c) => c instanceof TransactWriteCommand) as TransactWriteCommand;
        return tx.input.TransactItems![0].Put!.Item!;
    };

    it("catalogMode: true in the body → the tenant record stores catalogMode true and commerceEnabled false", async () => {
        mockDb({});
        const res = await call(createTenant, event(GLOBAL_ADMIN, { name: "Glam", catalogMode: true, commerceEnabled: true }));
        expect(res.statusCode).toBe(201);
        expect(createdTenant().catalogMode).toBe(true);
        expect(createdTenant().commerceEnabled).toBe(false);
    });

    it("no catalogMode in the body → catalogMode false (only the literal true sets it)", async () => {
        mockDb({});
        expect((await call(createTenant, event(GLOBAL_ADMIN, { name: "Plain" }))).statusCode).toBe(201);
        expect(createdTenant().catalogMode).toBe(false);
        ddbSend.mockClear();
        expect((await call(createTenant, event(GLOBAL_ADMIN, { name: "Plain2", catalogMode: "true" }))).statusCode).toBe(201);
        expect(createdTenant().catalogMode).toBe(false);
    });
});

// ── 2. PUT /settings — the narrow two-flag parse and the authoritative read ─────────────
describe("CM1 — PUT /settings keeps the mode fixed", () => {
    const settingsPut = () => commands().filter((c) => c instanceof PutCommand && c.input.Item!.SK === "TENANT#t1");

    it("mode change false → true → 400, nothing written", async () => {
        mockDb({ tenant: TENANT });
        const res = await call(putSettings, event(TENANT_ADMIN, { catalogMode: true }));
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/fixed when the site is created/);
        expect(writes()).toHaveLength(0);
    });

    it("mode change true → false → 400, nothing written", async () => {
        mockDb({ tenant: CATALOG_TENANT });
        expect((await call(putSettings, event(TENANT_ADMIN, { catalogMode: false }))).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it("both flags: commerceEnabled true on a catalog tenant → 400, nothing written", async () => {
        mockDb({ tenant: CATALOG_TENANT });
        const res = await call(putSettings, event(TENANT_ADMIN, { commerceEnabled: true }));
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/no cart or checkout/);
        expect(writes()).toHaveLength(0);
    });

    it("absent flag = false on both sides: a record without catalogMode saves with or without catalogMode:false", async () => {
        mockDb({ tenant: TENANT });
        expect((await call(putSettings, event(TENANT_ADMIN, { name: "Renamed" }))).statusCode).toBe(200);
        expect(settingsPut()).toHaveLength(1);
        expect(settingsPut()[0].input.Item).not.toHaveProperty("catalogMode");
        ddbSend.mockClear();
        expect((await call(putSettings, event(TENANT_ADMIN, { catalogMode: false, commerceEnabled: true }))).statusCode).toBe(200);
        expect(settingsPut()).toHaveLength(1);
    });

    it("a catalog tenant's ordinary save (full config round trip, unchanged mode) → 200, mode kept", async () => {
        mockDb({ tenant: CATALOG_TENANT });
        expect((await call(putSettings, event(TENANT_ADMIN, { ...CATALOG_TENANT, name: "New name" }))).statusCode).toBe(200);
        expect(settingsPut()[0].input.Item.catalogMode).toBe(true);
    });

    it("missing tenant record → 404, nothing written (no more { name: 'Unknown' } records); the read is ConsistentRead", async () => {
        mockDb({ tenant: undefined });
        expect((await call(putSettings, event(TENANT_ADMIN, { name: "x" }))).statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
        expect(tenantGets()[0].input.ConsistentRead).toBe(true);
    });
});

// ── 3. The product write boundary (CM-D1, CM-D7, CM-D8) ─────────────────────────────────
describe("CM1 — POST /products write boundary", () => {
    const base = { title: "Rug", description: "d" };

    it("missing tenant record → 404, nothing written; the mode read is ConsistentRead", async () => {
        mockDb({ tenant: undefined });
        expect((await call(createProduct, event(TENANT_ADMIN, { ...base, price: "1", imageLink: IMG }))).statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
        expect(tenantGets()[0].input.ConsistentRead).toBe(true);
    });

    const monetary: [string, Record<string, unknown>][] = [
        ["price", { price: "10" }],
        ["price (empty string is still a present key)", { price: "" }],
        ["salePrice", { salePrice: "5" }],
        ["volumePricing", { volumePricing: [{ minQuantity: 2, price: "9" }] }],
        ["variant option priceOverride", { variants: [{ id: "g", name: "Size", options: [{ value: "S", priceOverride: "" }] }] }],
        ["personalizations (addedCost defaults to \"0\")", { personalizations: [{ id: "x", label: "Text", type: "text" }] }],
    ];
    for (const [name, fields] of monetary) {
        it(`catalog tenant refuses ${name} → 400, nothing written`, async () => {
            mockDb({ tenant: CATALOG_TENANT });
            const res = await call(createProduct, event(TENANT_ADMIN, { ...base, ...fields }));
            expect(res.statusCode).toBe(400);
            expect(JSON.parse(res.body).error).toMatch(/catalog site stores no prices/);
            expect(writes()).toHaveLength(0);
        });
    }

    it("catalog tenant: no price and no image → 201; the stored item has neither key", async () => {
        mockDb({ tenant: CATALOG_TENANT });
        expect((await call(createProduct, event(TENANT_ADMIN, base))).statusCode).toBe(201);
        const item = productPuts()[0].input.Item!;
        expect(item).not.toHaveProperty("price");
        expect(item).not.toHaveProperty("imageLink");
        expect(item.personalizations).toEqual([]);
    });

    it("commerce tenant stays as strict as before: no price → 400, no image → 400, both → 201", async () => {
        mockDb({ tenant: COMMERCE_TENANT });
        expect((await call(createProduct, event(TENANT_ADMIN, { ...base, imageLink: IMG }))).statusCode).toBe(400);
        expect((await call(createProduct, event(TENANT_ADMIN, { ...base, price: "10" }))).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
        expect((await call(createProduct, event(TENANT_ADMIN, { ...base, price: "10", imageLink: IMG }))).statusCode).toBe(201);
        expect(productPuts()[0].input.Item!.price).toBe("10");
    });

    it("imageLink \"\" refused (400) and imageLink null refused on create (400); nothing written", async () => {
        mockDb({ tenant: CATALOG_TENANT });
        expect((await call(createProduct, event(TENANT_ADMIN, { ...base, imageLink: "" }))).statusCode).toBe(400);
        expect((await call(createProduct, event(TENANT_ADMIN, { ...base, imageLink: null }))).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it("importSource is omitted from authoring input: a body importSource is stripped, never stored", async () => {
        mockDb({ tenant: CATALOG_TENANT });
        expect((await call(createProduct, event(TENANT_ADMIN, { ...base, importSource: "glam:x/y" }))).statusCode).toBe(201);
        expect(productPuts()[0].input.Item).not.toHaveProperty("importSource");
    });

    it("CAT-IMPORT-PROFILE-1: facetModes and importProfileRevision are omitted from authoring input (stripped, never stored)", async () => {
        mockDb({ tenant: CATALOG_TENANT });
        const stamps = { facetModes: { attributes: [{ key: "colecție", mode: "always" }] }, importProfileRevision: 3 };
        expect((await call(createProduct, event(TENANT_ADMIN, { ...base, ...stamps }))).statusCode).toBe(201);
        expect(productPuts()[0].input.Item).not.toHaveProperty("facetModes");
        expect(productPuts()[0].input.Item).not.toHaveProperty("importProfileRevision");
    });
});

describe("CM1 — PUT /products/{id} write boundary and hardening", () => {
    const put = (body: unknown) => call(updateProduct, event(TENANT_ADMIN, body, { pathParameters: { id: "p1" } }));
    const projectionWrites = () => commands().filter((c) => c instanceof BatchWriteCommand);

    it("missing tenant record → 404, nothing written; the mode read is ConsistentRead", async () => {
        mockDb({ tenant: undefined, product: CATALOG_PRODUCT });
        expect((await put({ title: "x" })).statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
        expect(tenantGets()[0].input.ConsistentRead).toBe(true);
    });

    it("catalog tenant: a request adding price → 400, nothing written (rule runs on the merged item)", async () => {
        mockDb({ tenant: CATALOG_TENANT, product: CATALOG_PRODUCT });
        expect((await put({ ...CATALOG_PRODUCT, price: "10" })).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it("the product Put carries attribute_exists(PK); an ordinary catalog save → 200 and rebuilds projections", async () => {
        mockDb({ tenant: CATALOG_TENANT, product: CATALOG_PRODUCT });
        expect((await put({ ...CATALOG_PRODUCT, title: "Rug 2" })).statusCode).toBe(200);
        expect(productPuts()[0].input.ConditionExpression).toBe("attribute_exists(PK)");
        expect(projectionWrites().length).toBeGreaterThan(0);
    });

    it("update condition cancelled (product deleted meanwhile) → 404 and ZERO projection writes", async () => {
        mockDb({ tenant: CATALOG_TENANT, product: CATALOG_PRODUCT });
        const base = ddbSend.getMockImplementation()!;
        ddbSend.mockImplementation(async (cmd: any) => {
            if (cmd instanceof PutCommand && String(cmd.input.Item?.SK).startsWith("PRODUCT#")) {
                throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
            }
            return base(cmd);
        });
        expect((await put({ ...CATALOG_PRODUCT, title: "Rug 2" })).statusCode).toBe(404);
        expect(projectionWrites()).toHaveLength(0);
        expect(mockRevalidate).not.toHaveBeenCalled();
    });

    it("imageLink: null removes the stored image (key absent in the Put); imageLink \"\" is refused", async () => {
        mockDb({ tenant: CATALOG_TENANT, product: CATALOG_PRODUCT });
        expect((await put({ ...CATALOG_PRODUCT, imageLink: null })).statusCode).toBe(200);
        expect(productPuts()[0].input.Item).not.toHaveProperty("imageLink");
        ddbSend.mockClear();
        expect((await put({ ...CATALOG_PRODUCT, imageLink: "" })).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it("commerce tenant: imageLink: null leaves the product without the required image → 400", async () => {
        mockDb({ tenant: COMMERCE_TENANT, product: { ...CATALOG_PRODUCT, price: "10" } });
        expect((await put({ imageLink: null })).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });

    it("importSource: the body can neither set, change nor remove it", async () => {
        mockDb({ tenant: CATALOG_TENANT, product: IMPORTED_PRODUCT });
        expect((await put({ ...IMPORTED_PRODUCT, importSource: "glam:other/x" })).statusCode).toBe(200);
        expect(productPuts()[0].input.Item!.importSource).toBe("glam:boen/pl");
        ddbSend.mockClear();
        mockDb({ tenant: CATALOG_TENANT, product: CATALOG_PRODUCT });
        expect((await put({ ...CATALOG_PRODUCT, importSource: "glam:x/y" })).statusCode).toBe(200);
        expect(productPuts()[0].input.Item).not.toHaveProperty("importSource");
    });

    it("CAT-IMPORT-PROFILE-1: an admin edit keeps facetModes and importProfileRevision and cannot set or change them", async () => {
        const stamped = { ...IMPORTED_PRODUCT, facetModes: { variant: "never", attributes: [] }, importProfileRevision: 2 };
        mockDb({ tenant: CATALOG_TENANT, product: stamped });
        expect((await put({ ...stamped, title: "Rug 2", facetModes: { attributes: [] }, importProfileRevision: 9 })).statusCode).toBe(200);
        expect(productPuts()[0].input.Item).toMatchObject({ title: "Rug 2", facetModes: { variant: "never", attributes: [] }, importProfileRevision: 2 });
        ddbSend.mockClear();
        mockDb({ tenant: CATALOG_TENANT, product: CATALOG_PRODUCT });
        expect((await put({ ...CATALOG_PRODUCT, importProfileRevision: 9, facetModes: { attributes: [] } })).statusCode).toBe(200);
        expect(productPuts()[0].input.Item).not.toHaveProperty("importProfileRevision");
        expect(productPuts()[0].input.Item).not.toHaveProperty("facetModes");
    });

    it("importSource product: the derived gallery is recomputed from the options, overwriting a direct edit", async () => {
        mockDb({ tenant: CATALOG_TENANT, product: IMPORTED_PRODUCT });
        const variants = [{ id: "g", name: "Format", options: [
            { value: "90x20" },
            { value: "120x20", imageLink: "https://img.test/9.jpg" },
            { value: "140x20", imageLink: "https://img.test/2.jpg" },
            { value: "160x20", imageLink: "https://img.test/9.jpg" },
        ] }];
        const res = await put({ ...IMPORTED_PRODUCT, imageLink: "https://img.test/hand-edit.jpg", additionalImageLinks: [], variants });
        expect(res.statusCode).toBe(200);
        const item = productPuts()[0].input.Item!;
        expect(item.imageLink).toBe("https://img.test/9.jpg");
        expect(item.additionalImageLinks).toEqual(["https://img.test/2.jpg"]);
    });

    it("importSource product: two groups / a normalised label collision / an option image \"\" → 400, nothing written", async () => {
        mockDb({ tenant: CATALOG_TENANT, product: IMPORTED_PRODUCT });
        const group = IMPORTED_PRODUCT.variants[0];
        expect((await put({ ...IMPORTED_PRODUCT, variants: [group, { ...group, id: "h" }] })).statusCode).toBe(400);
        expect((await put({ ...IMPORTED_PRODUCT, variants: [{ ...group, options: [{ value: "A  b" }, { value: " a b" }] }] })).statusCode).toBe(400);
        expect((await put({ ...IMPORTED_PRODUCT, variants: [{ ...group, options: [{ value: "x", imageLink: "" }] }] })).statusCode).toBe(400);
        expect(writes()).toHaveLength(0);
    });
});

describe("CM1 — checkProductWrite (pure)", () => {
    it("an imported product whose options have no image has no imageLink and an empty gallery", () => {
        const check = checkProductWrite({ ...IMPORTED_PRODUCT, variants: [{ id: "g", name: "F", options: [{ value: "a" }] }] }, true);
        expect(check.kind).toBe("accepted");
        if (check.kind === "accepted") {
            expect(check.item).not.toHaveProperty("imageLink");
            expect(check.item.additionalImageLinks).toEqual([]);
        }
    });

    it("a non-catalog tenant ignores importSource rules and keeps the item as sent", () => {
        const item = { ...IMPORTED_PRODUCT, price: "1", variants: [] };
        expect(checkProductWrite(item, false)).toEqual({ kind: "accepted", item });
    });
});

// ── 4. The two commerce-freeze exceptions ───────────────────────────────────────────────
describe("CM1 — WooCommerce import refusal (CM-D8 guard 1)", () => {
    const csv = "Name,Regular price\nRug,10\n";

    it("catalog tenant → 403 with a business message, nothing written, no audit", async () => {
        mockDb({ tenant: CATALOG_TENANT });
        const res = await call(wooImport, event(TENANT_ADMIN, { csvContent: csv }));
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).error).toMatch(/catalog site/);
        expect(writes()).toHaveLength(0);
        expect(mockAudit).not.toHaveBeenCalled();
        expect(tenantGets()[0].input.ConsistentRead).toBe(true);
    });

    it("missing tenant record → 404, nothing written", async () => {
        mockDb({ tenant: undefined });
        expect((await call(wooImport, event(TENANT_ADMIN, { csvContent: csv }))).statusCode).toBe(404);
        expect(writes()).toHaveLength(0);
    });

    it("non-catalog tenant passes the guard (reaches the CSV checks unchanged)", async () => {
        mockDb({ tenant: COMMERCE_TENANT });
        const res = await call(wooImport, event(TENANT_ADMIN, { csvContent: "Name\n" }));
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toBe("No data rows found in CSV");
    });
});

describe("CM1 — order guard (CM-D6 = A)", () => {
    const order = {
        items: [{ productId: "3f0e4b3c-5a8e-4a43-9d2e-1c2b3a4d5e6f", quantity: 1 }],
        customerEmail: "buyer@example.com",
        customerName: "Buyer",
        paymentMethod: "cod",
    };
    const orderEvent = () => ({ headers: { "x-tenant-id": "t1", origin: "https://t1.test" }, requestContext: { http: { sourceIp: "127.0.0.1" } }, body: JSON.stringify(order) }) as any;

    for (const [name, tenant] of [["commerceEnabled false", { ...TENANT, commerceEnabled: false }], ["commerceEnabled absent", TENANT], ["catalog tenant", CATALOG_TENANT], ["missing tenant record", undefined]] as const) {
        it(`${name} → 403, zero calls after the tenant-config read (no reCAPTCHA, no product read, no write)`, async () => {
            mockDb({ tenant: tenant as any });
            const res = await call(createOrder, orderEvent());
            expect(res.statusCode).toBe(403);
            expect(JSON.parse(res.body).error).toBe("This site does not take online orders.");
            expect(commands()).toHaveLength(1);
            expect(tenantGets()).toHaveLength(1);
            expect(mockResolveRecaptcha).not.toHaveBeenCalled();
            expect(mockVerifyRecaptcha).not.toHaveBeenCalled();
        });
    }

    it("commerceEnabled true → unchanged path: reCAPTCHA resolution and the product read run", async () => {
        mockDb({ tenant: COMMERCE_TENANT, product: undefined });
        const res = await call(createOrder, orderEvent());
        expect(res.statusCode).not.toBe(403);
        expect(mockResolveRecaptcha).toHaveBeenCalled();
        expect(commands().some((c) => c instanceof GetCommand && String(c.input.Key?.SK).startsWith("PRODUCT#"))).toBe(true);
    });
});
