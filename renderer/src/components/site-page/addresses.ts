import { URL_PREFIX_DEFAULTS } from "@amodx/shared";

// Commerce prefix matching helper
type CommerceMatch = { type: 'product' | 'category' | 'shop' | 'cart' | 'checkout' | 'checkout-confirm' | 'checkout-track' | 'account' | 'search'; itemSlug?: string };

export function matchCommercePrefix(slugPath: string, urlPrefixes: any): CommerceMatch | null {
    const prefixes = urlPrefixes || URL_PREFIX_DEFAULTS;

    if (slugPath === prefixes.cart) return { type: 'cart' };
    if (slugPath === prefixes.checkout) return { type: 'checkout' };
    if (slugPath === prefixes.checkout + (prefixes.checkoutConfirmation || URL_PREFIX_DEFAULTS.checkoutConfirmation)) return { type: 'checkout-confirm' };
    if (slugPath.startsWith(prefixes.checkout + "/")) {
        const segment = slugPath.slice(prefixes.checkout.length + 1);
        if (segment && "/" + segment !== (prefixes.checkoutConfirmation || URL_PREFIX_DEFAULTS.checkoutConfirmation)) return { type: 'checkout-track', itemSlug: segment };
    }
    if (slugPath === prefixes.shop) return { type: 'shop' };
    if (slugPath.startsWith(prefixes.product + "/")) {
        return { type: 'product', itemSlug: slugPath.slice(prefixes.product.length + 1) };
    }
    if (slugPath.startsWith(prefixes.category + "/")) {
        return { type: 'category', itemSlug: slugPath.slice(prefixes.category.length + 1) };
    }
    if (slugPath === (prefixes.account || "/account")) return { type: 'account' };
    if (slugPath === (prefixes.search || "/search")) return { type: 'search' };
    return null;
}

/** CAT-INTEREST-1: the interest-list path of a tenant (`urlPrefixes.interest`, default `URL_PREFIX_DEFAULTS.interest`, "/my-list" since CDL-2). Catalog sites only. */
export function interestPrefix(config: any): string {
    return config.urlPrefixes?.interest || URL_PREFIX_DEFAULTS.interest;
}

/** Next-equivalent public address for parseable inputs; keep the existing raw value if parsing fails.
 * Never invent a replacement origin or throw in the page render. This is not tenant-domain validation.
 * Next omits the root slash when there is no query, and otherwise emits the WHATWG URL's href. */
export function normalizePageAddressOrKeepRaw(domain: string, slugPath: string): string {
    const raw = `https://${domain}${slugPath === '/' ? '' : slugPath}`;
    try {
        const url = new URL(raw);
        return url.pathname === '/' && url.searchParams.size === 0 ? url.origin : url.href;
    } catch {
        return raw;
    }
}
