import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * CDL-2 — the backend rows of the packet's evidence taxonomy (record docs/slices/cdl-2.md § 5):
 *   - the content-slug check (`lib/slug-guard.ts`): reserved built-in addresses per site kind, the per-key path rule
 *     on a partial stored object, the refusal message that names the page (design § 14 item 1);
 *   - `POST /tenant` stores the English defaults, `interest: "/my-list"` and `checkoutConfirmation: "/confirmation"`.
 * Only `db.js` (`send`), `events.js` and the cache helpers are mocked; the real handlers and command classes run.
 * Credential-free.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => ({ ddbSend: vi.fn(), mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/revalidate.js", () => ({
    revalidateTenantPaths: async () => {}, purgeStoredPagesOfRequestTenant: async () => {}, purgeStoredPagesOfDomains: async () => {},
}));

import { checkSlugCommerceConflict } from "../../src/lib/slug-guard.js";
import { handler as createTenant } from "../../src/tenant/create.js";

/** The tenant record the Get returns (undefined = no record). */
function tenantRecord(item: Record<string, unknown> | undefined) {
    ddbSend.mockImplementation(async (cmd: any) => (cmd instanceof GetCommand ? { Item: item ? structuredClone(item) : undefined } : {}));
}
const check = (slug: string) => checkSlugCommerceConflict("t1", slug);
const message = (slug: string, prefix: string, page: string) =>
    `Slug "${slug}" uses the address "${prefix}" of the built-in ${page}. Choose a different slug, or change that address in Settings.`;

const CATALOG = { catalogMode: true };
const COMMERCE = { commerceEnabled: true };
const CONTENT = {};
const KINDS = [["catalog", CATALOG], ["commerce", COMMERCE], ["content", CONTENT]] as const;

beforeEach(() => {
    ddbSend.mockReset();
    mockAudit.mockReset().mockResolvedValue(undefined);
});

describe("CDL-2 slug check — reserved built-in addresses", () => {
    it("ONE tenant read: a GetCommand on the request tenant's own record, projecting urlPrefixes and catalogMode", async () => {
        tenantRecord(CONTENT);
        await check("/about");
        expect(ddbSend).toHaveBeenCalledTimes(1);
        const get = ddbSend.mock.calls[0][0] as GetCommand;
        expect(get).toBeInstanceOf(GetCommand);
        expect(get.input.Key).toEqual({ PK: "SYSTEM", SK: "TENANT#t1" });
        expect(get.input.ProjectionExpression).toBe("urlPrefixes, catalogMode");
    });

    it("slug at product / category / cart / checkout / shop → refused, as today, with the new message form (every site kind)", async () => {
        const rows = [
            ["/product", "/product", "product pages"], ["/product/oak", "/product", "product pages"],
            ["/category", "/category", "category pages"], ["/category/floors/x", "/category", "category pages"],
            ["/cart", "/cart", "cart page"], ["/checkout", "/checkout", "checkout page"],
            ["/checkout/confirmation", "/checkout/confirmation", "order confirmation page"],
            ["/checkout/o1", "/checkout", "order tracking page"], ["/shop", "/shop", "shop page"],
        ] as const;
        for (const [kind, record] of KINDS) {
            tenantRecord(record);
            for (const [slug, prefix, page] of rows) expect(await check(slug), `${kind} ${slug}`).toBe(message(slug, prefix, page));
        }
    });

    it("slug at account or search, any site kind → refused; the message names the page", async () => {
        for (const [kind, record] of KINDS) {
            tenantRecord(record);
            expect(await check("/account"), kind).toBe(message("/account", "/account", "account page"));
            expect(await check("/account/orders"), kind).toBe(message("/account/orders", "/account", "account page"));
            expect(await check("/search"), kind).toBe(message("/search", "/search", "search page"));
        }
    });

    it("slug at the interest address, catalog site → refused (default /my-list, and a stored address)", async () => {
        tenantRecord(CATALOG);
        expect(await check("/my-list")).toBe(message("/my-list", "/my-list", "interest list page"));
        expect(await check("my-list")).toBe(message("/my-list", "/my-list", "interest list page"));   // leading "/" added
        tenantRecord({ ...CATALOG, urlPrefixes: { interest: "/lista-mea" } });
        expect(await check("/lista-mea")).toBe(message("/lista-mea", "/lista-mea", "interest list page"));
        expect(await check("/my-list")).toBeNull();   // the stored address replaces the default
    });

    it("slug at the interest address, commerce or content site → accepted", async () => {
        for (const record of [COMMERCE, CONTENT, { catalogMode: "true" }]) {   // only the literal true is catalog
            tenantRecord(record);
            expect(await check("/my-list"), JSON.stringify(record)).toBeNull();
        }
        tenantRecord({ ...COMMERCE, urlPrefixes: { interest: "/lista-mea" } });
        expect(await check("/lista-mea")).toBeNull();
    });

    it("tenant with a partial stored object → the defaults of the missing keys are reserved", async () => {
        tenantRecord({ ...CATALOG, urlPrefixes: { interest: "/lista-mea", product: "", shop: "   " } });
        expect(await check("/product/x")).toBe(message("/product/x", "/product", "product pages"));
        expect(await check("/shop")).toBe(message("/shop", "/shop", "shop page"));
        expect(await check("/checkout")).toBe(message("/checkout", "/checkout", "checkout page"));
        expect(await check("/search")).toBe(message("/search", "/search", "search page"));
        tenantRecord(undefined);   // no tenant record: every default
        expect(await check("/cart")).toBe(message("/cart", "/cart", "cart page"));
    });

    it("stored custom addresses replace the defaults (the default address is free then)", async () => {
        tenantRecord({ ...COMMERCE, urlPrefixes: { shop: "/magazin", account: "/cont" } });
        expect(await check("/magazin")).toBe(message("/magazin", "/magazin", "shop page"));
        expect(await check("/cont")).toBe(message("/cont", "/cont", "account page"));
        expect(await check("/shop")).toBeNull();
        expect(await check("/account")).toBeNull();
    });

    it("an unrelated slug → accepted (incl. a slug that only starts with the same letters)", async () => {
        for (const [kind, record] of KINDS) {
            tenantRecord(record);
            for (const slug of ["/about", "/", "/shopping", "/products", "/searching", "/my-listing", "/accounts"]) {
                expect(await check(slug), `${kind} ${slug}`).toBeNull();
            }
        }
    });
});

/**
 * CDL2-R2 (review-0): the page the message names is the page the renderer shows at the slug, for EQUAL and NESTED
 * overlaps of the reserved addresses; where the renderer shows content, the first reserved address the slug falls on,
 * in the renderer's precedence. The SAME rows (stored, kind, slug → renderer branch) run through the real renderer in
 * `renderer/test/unit/cdl-2-site-page.test.ts` › "CDL2-R2 overlaps"; keep the two tables equal.
 */
const OVERLAPS: { stored: Record<string, string>; catalog: boolean; slug: string; page: string; address: string }[] = [
    { stored: { interest: "/shop" }, catalog: true, slug: "/shop", page: "interest list page", address: "/shop" },
    { stored: { product: "/shop" }, catalog: false, slug: "/shop", page: "shop page", address: "/shop" },
    { stored: { product: "/checkout" }, catalog: false, slug: "/checkout", page: "checkout page", address: "/checkout" },
    { stored: { product: "/x", interest: "/x/a" }, catalog: true, slug: "/x/a", page: "interest list page", address: "/x/a" },
    { stored: { product: "/x", interest: "/x/a" }, catalog: false, slug: "/x/a", page: "product pages", address: "/x" },
    { stored: { shop: "/a", product: "/a/b" }, catalog: false, slug: "/a/b/c", page: "product pages", address: "/a/b" },
    { stored: { shop: "/a", product: "/a/b" }, catalog: false, slug: "/a/b", page: "shop page", address: "/a" },
    { stored: { search: "/checkout/x" }, catalog: false, slug: "/checkout/x", page: "order tracking page", address: "/checkout" },
    { stored: { account: "/cart" }, catalog: false, slug: "/cart", page: "cart page", address: "/cart" },
    { stored: { category: "/product" }, catalog: false, slug: "/product/x", page: "product pages", address: "/product" },
    { stored: { checkoutConfirmation: "/multumim" }, catalog: false, slug: "/checkout/multumim", page: "order confirmation page", address: "/checkout/multumim" },
    { stored: { cart: "/shop/cart" }, catalog: false, slug: "/shop/cart", page: "cart page", address: "/shop/cart" },
    { stored: { interest: "/search" }, catalog: true, slug: "/search", page: "interest list page", address: "/search" },
    { stored: { interest: "/search" }, catalog: false, slug: "/search", page: "search page", address: "/search" },
    { stored: { account: "/category/x" }, catalog: false, slug: "/category/x", page: "category pages", address: "/category" },
];

describe("CDL2-R2 — overlapping addresses: the message names the page the renderer shows", () => {
    for (const row of OVERLAPS) {
        it(`${JSON.stringify(row.stored)} ${row.catalog ? "catalog" : "non-catalog"} ${row.slug} → ${row.page} (${row.address})`, async () => {
            tenantRecord({ ...(row.catalog ? CATALOG : COMMERCE), urlPrefixes: row.stored });
            expect(await check(row.slug)).toBe(message(row.slug, row.address, row.page));
        });
    }
});

describe("CDL-2 POST /tenant — the creation default follows URL_PREFIX_DEFAULTS", () => {
    it("the created tenant record stores interest \"/my-list\" and checkoutConfirmation \"/confirmation\"", async () => {
        ddbSend.mockImplementation(async () => ({}));
        const event = {
            headers: {},
            requestContext: { authorizer: { lambda: { sub: "g1", email: "global@amodx.test", role: "GLOBAL_ADMIN", tenantId: "GLOBAL" } }, http: { sourceIp: "127.0.0.1" } },
            body: JSON.stringify({ name: "Glam", catalogMode: true }),
        } as any;
        const res = (await createTenant(event, {} as any, () => {})) as any;
        expect(res.statusCode).toBe(201);
        const tx = ddbSend.mock.calls.map((c) => c[0]).find((c) => c instanceof TransactWriteCommand) as TransactWriteCommand;
        const stored = tx.input.TransactItems![0].Put!.Item!;
        expect(stored.urlPrefixes.interest).toBe("/my-list");
        expect(stored.urlPrefixes.checkoutConfirmation).toBe("/confirmation");
        expect(stored.urlPrefixes).toEqual({
            product: "/product", category: "/category", cart: "/cart", checkout: "/checkout", shop: "/shop",
            account: "/account", search: "/search", interest: "/my-list", checkoutConfirmation: "/confirmation",
        });
    });
});
