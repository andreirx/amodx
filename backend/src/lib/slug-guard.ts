import { db, TABLE_NAME } from "./db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { isCatalogMode, urlPrefixesOf } from "@amodx/shared";

/**
 * The reserved addresses, in the renderer's order of precedence, with the page name the refusal shows (admin text,
 * English). CDL-2 (docs/slices/catalog-data-labels-1.md § 14 item 1; record docs/slices/cdl-2.md § 2): on a catalog
 * site the renderer matches the interest list FIRST (SitePage.tsx `:347`); then `matchCommercePrefix`
 * (`:213-233`) runs on every site, in this order — cart, checkout (the order confirmation and order tracking lie
 * under it), shop, product, category, account, search — and a match never falls through to content. `interest` is
 * reserved on a catalog site only.
 */
const PRECEDENCE = [
    ["interest", "interest list page"],
    ["cart", "cart page"],
    ["checkout", "checkout page"],
    ["shop", "shop page"],
    ["product", "product pages"],
    ["category", "category pages"],
    ["account", "account page"],
    ["search", "search page"],
] as const;

/**
 * The built-in page the renderer shows at `slug`, with the address that owns it, or null when the renderer shows
 * content there. A copy of the renderer's precedence (SitePage.tsx `:347`, `matchCommercePrefix` `:213-233`):
 * equality for interest, cart, checkout, shop, account and search; `checkout` + `checkoutConfirmation` = the order
 * confirmation; any other non-empty segment under `checkout` = order tracking; a non-empty path under `product` or
 * `category` = those pages. Pinned against the renderer by the same overlap table in
 * `backend/test/unit/cdl-2-paths.test.ts` and `renderer/test/unit/cdl-2-site-page.test.ts`.
 */
function builtInPageAt(slug: string, p: ReturnType<typeof urlPrefixesOf>, catalog: boolean): { page: string; address: string } | null {
    const under = (address: string) => slug.startsWith(address + "/") && slug.length > address.length + 1;
    for (const [key, page] of PRECEDENCE) {
        if (key === "interest" && !catalog) continue;
        const address = p[key];
        if (key === "product" || key === "category") {
            if (under(address)) return { page, address };
            continue;
        }
        if (slug === address) return { page, address };
        if (key === "checkout") {
            const confirmation = address + p.checkoutConfirmation;
            if (slug === confirmation) return { page: "order confirmation page", address: confirmation };
            if (under(address)) return { page: "order tracking page", address };
        }
    }
    return null;
}

/**
 * Refuses a content slug that equals, or lies under, a reserved address of this tenant's kind of site: cart,
 * checkout, shop, product, category, account and search on every site, and the interest list on a catalog site only.
 * Addresses come from the tenant's `urlPrefixes` under the per-key rule (`urlPrefixesOf`: the saved path, else the
 * English default). One tenant read (`GetCommand`, own record). Returns the refusal message, or null if the slug is
 * free. The message names the page the renderer shows at the slug (`builtInPageAt`); where the renderer would show
 * content (for example the bare `/product`, or `/shop/x`), the first reserved address the slug falls on, in the
 * renderer's precedence.
 *
 * NAME (SMALL-FIXES-1 B, closes F-CDL2-GUARD-NAME of docs/slices/cdl-2.md): the function returns the REFUSAL for a
 * slug at a RESERVED ADDRESS (a built-in page of any kind of site, not only commerce), or null. Its old name said
 * "commerce conflict".
 */
export async function reservedAddressRefusal(tenantId: string, slug: string): Promise<string | null> {
    // Ensure slug starts with /
    const normalizedSlug = slug.startsWith("/") ? slug : `/${slug}`;

    const tenantRes = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
        ProjectionExpression: "urlPrefixes, catalogMode",
    }));

    const prefixes = urlPrefixesOf(tenantRes.Item?.urlPrefixes);
    const catalog = isCatalogMode(tenantRes.Item);
    const hit = PRECEDENCE.find(([key]) => (key !== "interest" || catalog)
        && (normalizedSlug === prefixes[key] || normalizedSlug.startsWith(prefixes[key] + "/")));
    if (!hit) return null;

    const owner = builtInPageAt(normalizedSlug, prefixes, catalog) ?? { page: hit[1], address: prefixes[hit[0]] };
    return `Slug "${normalizedSlug}" uses the address "${owner.address}" of the built-in ${owner.page}. Choose a different slug, or change that address in Settings.`;
}
