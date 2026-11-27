import { normalizeSlug } from "@amodx/shared";
import type { WordPressItem, WordPressPost, WordPressProduct } from "./wxr-parser.js";
import { builtInPageAt, reservedAddressRefusalIn, type ReservedAddresses } from "../lib/slug-guard.js";

/**
 * IMPORT-PATHS-1 (docs/slices/import-paths-1.md) — where each item of a WordPress export goes when the import keeps the
 * old addresses. Pure: no I/O. The handler (wordpress.ts) adds what only the table can tell (a page or a redirect that
 * already holds an address, the product that exists) and writes.
 *
 * Rules, applied to the export's items in export order (the first item keeps an address, ruling 5):
 *  1. The old address (`oldAddressOf`) is the path of `<link>`, host removed, end slash removed, each segment as the
 *     renderer's page body receives it. A link to `/` is the home page; a link whose path is `/` or `/index.php` and that
 *     carries a query (`/?page_id=12`, plain permalinks) is an address by query only; any other query is dropped (the
 *     renderer serves by path) and the fragment is not part of the address (a browser never sends it).
 *  2. A page goes to `normalizeSlug(old address)`. With no address by path, a page goes under its parent's old address
 *     (`<parent path>/<post name>`) when a parent has one, else to the flat address `normalizeSlug(/<post name>)`.
 *  3. An address the page cannot have (`blockedAt`: reserved by `reservedAddressRefusalIn`, or answered by the
 *     renderer before its content lookup, `servedBefore`) is not used: the page goes to its flat address instead.
 *  4. An address an earlier item holds is refused: the page is not imported (nothing is overwritten).
 *  5. When the page's address is not its old address, the old address gets a redirect to the page — unless the renderer
 *     answers the old address before its content and redirect lookup (`servedBefore`: such an address cannot be kept
 *     or redirected, operator ruling IP1-BUILTIN-REDIRECTS = A) or an earlier item holds it.
 *  6. A product's old address gets a redirect to the site's product page `<product prefix>/<slug>` when the two differ
 *     (the product is looked up by the handler; the redirect source is claimed here, in export order).
 */

/** The old public address of an item, read from its `<link>`. Every kind keeps what the link said. */
export type OldAddress =
    | { kind: "none" }                                            // no `<link>`
    | { kind: "invalid"; link: string }                           // a `<link>` that is not a URL
    | { kind: "home"; link: string }                              // the site's home page `/`
    | { kind: "query-only"; link: string }                        // `/?p=12`, `/index.php?page_id=3`: no address by path
    | { kind: "undecodable"; link: string; raw: string }          // a malformed %-escape: Next.js answers 400 (review-2)
    | { kind: "path"; path: string; raw: string; query?: string; slashesFrom?: string };
// `path`: the page body's form (the ROUTE# key); `raw`: the request path the renderer routes; `query`: dropped;
// `slashesFrom`: the link's path when it holds `//` or `\` — Next.js answers it with a 308 to `raw` before it renders
// (next/dist/server/base-server.js:577-581, `normalizeRepeatedSlashes`, next/dist/shared/lib/utils.js:129-135).

/** One path segment percent-decoded once, or as it is when it holds a malformed escape. */
export function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/**
 * One path segment as the renderer's PAGE BODY receives it: every escape decoded once, except an encoded slash, which
 * stays `%2F` (upper case) — the renderer's measured contract, renderer/src/lib/site-segment.ts:96-110
 * (`firstPageSegmentOf`), pinned by renderer/test/serving-contract/contract.test.mjs:4436-4443 (`/ro%2Fdespre` →
 * the page stored at `/ro%2Fdespre`). A copy, because the backend does not import renderer code.
 */
function bodySegment(segment: string): string {
    return segment.split(/%2F/i).map(decodeSegment).join("%2F");
}

/** Rule 1. */
export function oldAddressOf(link: string | undefined): OldAddress {
    if (!link) return { kind: "none" };
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return { kind: "invalid", link };
    }
    const linked = url.pathname.replace(/\/+$/, "");
    const raw = collapseSlashes(linked).replace(/\/+$/, "");
    if (url.search !== "" && (raw === "" || raw === "/index.php")) return { kind: "query-only", link };
    if (raw === "") return { kind: "home", link };
    if (requestPathProblem(raw) !== null) return { kind: "undecodable", link, raw };
    const path = raw.split("/").map(bodySegment).join("/");
    return {
        kind: "path", path, raw,
        ...(url.search !== "" ? { query: url.search } : {}),
        ...(linked !== raw ? { slashesFrom: linked } : {}),
    };
}

/** Next.js's own normalisation before it renders: `\` → `/`, repeated `/` → one (utils.js:129-135). */
function collapseSlashes(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/\/+/g, "/");
}

/** The flat address of a post: today's `/<post name>`, decoded and through `normalizeSlug`. */
export function flatAddressOf(post: { slug: string }): string {
    return normalizeSlug("/" + decodeSegment(String(post.slug)));
}

/**
 * Where a request for `raw` (the request path) on a site's own domain ends up, before or at the renderer's
 * `ROUTE#<body>` lookup — the COMPLETE serving path (review-1 F-IP1-REACHABILITY: CDN, Next.js, middleware, route
 * handlers, pages), each rule with its source. A copy (pinned by IP1-F4-SERVED-BEFORE in
 * backend/test/unit/import-paths-1.test.ts; drift is F-IP1-BUILTIN-ADDRESS-LOST's risk, docs/TECH-DEBT.md):
 *  - infra/lib/renderer-hosting.ts:631-652 — CloudFront sends `/api/*` to the server function unrewritten and
 *    `/_next/static/*`, `/assets/*`, `/favicon.ico` to file storage (S3);
 *  - next/dist/server/base-server.js:577-581 — a path with `//` or `\` answers 308 to its normalised form;
 *  - renderer/middleware.ts:510-515 — the matcher does not run the middleware for `/api…`, `/_next/static…`,
 *    `/_next/image…`, `/favicon.ico…`, so the path is never bound to the site;
 *  - :265-268 — `/_next…`, `/api…`, `/static…` pass to Next.js unrewritten;
 *  - :279 — `/_dyn`, `/_dyn/…` answer 404; :301 — a second segment `_dyn` answers 308 to a preview address;
 *  - :313 with renderer/src/lib/booking-path.ts:59-66 — a first segment that decodes to `_book` answers 404;
 *    `/_booking`, `/_booking/…` are the booking pages;
 *  - :362, :384 — `/tenant/…`, `/_site/…` answer 403 on a site domain;
 *  - renderer/src/app/[siteId]/{robots.txt,sitemap.xml,llms.txt,openai-feed}/route.ts — those four addresses;
 *  - renderer/src/app/[siteId]/products/[productId]/page.tsx — `/products/<one segment>` is the product page by id;
 *  - renderer/src/components/SitePage.tsx:576 — `/` is the site's home page (Settings → home page);
 *  - slug-guard.ts `builtInPageAt` — the interest list (catalog), cart, checkout, shop, product and category pages,
 *    account and search (SitePage.tsx `matchCommercePrefix`, :215-235): `builtin`, with the address that owns it.
 * `content`: the renderer looks up `ROUTE#<body>` (a page or a redirect answers).
 */
export type RendererRoute =
    | { kind: "content" }
    | { kind: "builtin"; page: string; address: string }
    | { kind: "other"; by: string };

export function rendererRoute(raw: string, body: string, reserved: ReservedAddresses): RendererRoute {
    const other = (by: string): RendererRoute => ({ kind: "other", by });
    const request = requestPathProblem(raw);
    if (request !== null) return other(request);
    if (raw.startsWith("/assets/") || raw.startsWith("/_next/static/") || raw === "/favicon.ico") return other("the site's CDN serves this address from file storage (/assets/…, /_next/static/…, /favicon.ico)");
    if (/(\\|\/\/)/.test(raw)) return other("Next.js answers it with a 308 to the address without repeated slashes");
    if (/^\/(api|_next\/static|_next\/image|favicon.ico)/.test(raw)) return other("the renderer does not route this address to the site (its middleware skips /api…, /_next/…, /favicon.ico)");
    if (raw.startsWith("/_next") || raw.startsWith("/api") || raw.startsWith("/static")) return other("the renderer passes this address to its own files (/_next…, /api…, /static…)");
    const segs = raw.split("/");
    if (raw === "/_dyn" || raw.startsWith("/_dyn/")) return other("an internal address of the renderer (it answers 404)");
    if (segs.length >= 3 && segs[2] === "_dyn") return other("a preview address of the renderer (it answers 308 to /_site/…)");
    const first = segs.find((s) => s !== "");
    if (first !== undefined && decodeFully(first).toLowerCase() === "_book") return other("an internal booking address of the renderer (it answers 404)");
    if (raw === "/_booking" || raw.startsWith("/_booking/")) return other("the site's booking pages");
    if (raw.startsWith("/tenant/") || raw.startsWith("/_site/")) return other("a preview address of the renderer (it answers 403 on the site's domain)");
    if (body === "/robots.txt" || body === "/sitemap.xml" || body === "/llms.txt" || body === "/openai-feed") return other(`the site's ${body.slice(1)}`);
    if (/^\/products\/[^/]+$/.test(body)) return other("the product page by id (/products/<id>)");
    if (body === "/") return other("the site's home page");
    const page = builtInPageAt(body, reserved.prefixes, reserved.catalog);
    if (page) return { kind: "builtin", page: page.page, address: page.address };
    return { kind: "content" };
}

/**
 * Review-2 F-IP1-PRODUCT-TARGET / F-IP1-REACHABILITY — whether `address` is, as written, the path of the request a
 * browser sends for it, or the reason it is not. An address is read as a URL first (a `?` or `#` ends the path; `.` and
 * `..` segments and `\` are rewritten by the URL), then every segment must decode as Next.js decodes it (its route
 * matcher: `decodeURIComponent` per segment, a failure answers 400 — next/dist/shared/lib/router/utils/
 * route-matcher.js:17-23), and an end slash is answered by Next.js with a 308 to the address without it (default
 * `trailingSlash: false`). Null: the address is its own request path.
 */
export function requestPathProblem(address: string): string | null {
    if (!address.startsWith("/")) return "not a path (it does not start with /)";
    let url: URL;
    try {
        url = new URL(address, "https://site.invalid");
    } catch {
        return "not a URL path";
    }
    if (url.search !== "" || url.hash !== "" || address.includes("?") || address.includes("#")) return "a ? or # ends the path of a request, so the rest is not part of the address";
    const decodedEach = (path: string): string[] | null => {
        try {
            return path.split("/").map((segment) => decodeURIComponent(segment));
        } catch {
            return null;
        }
    };
    const asWritten = decodedEach(address);
    if (asWritten === null) return "Next.js cannot decode this address (a malformed %-escape) and answers 400";
    const asRequested = decodedEach(url.pathname);
    if (asRequested === null || asRequested.join("/") !== asWritten.join("/")) return `the URL rewrites this address to ${url.pathname} (. or .. segments, or \\)`;
    if (address.length > 1 && address.endsWith("/")) return "Next.js answers 308 to the address without its end slash";
    return null;
}

/** The reason `rendererRoute` does not reach the content lookup, or null when it does (rules 3 and 5). */
export function servedBefore(raw: string, body: string, reserved: ReservedAddresses): string | null {
    const route = rendererRoute(raw, body, reserved);
    switch (route.kind) {
        case "content": return null;
        case "builtin": return `the site's ${route.page}`;
        case "other": return route.by;
    }
}

/** The page-body form of a request path (each segment as the page body receives it). */
export function bodyPathOf(raw: string): string {
    return raw.split("/").map(bodySegment).join("/");
}

/**
 * Review-1 F-IP1-PRODUCT-TARGET: whether a request for `address` shows the product whose stored slug is `slug` — it
 * must route to the product pages (not a page that precedes them, e.g. a product prefix under `/checkout`), and the
 * slug the renderer reads there (the page-body form, SitePage.tsx `matchCommercePrefix` → `getProductBySlug`) must be
 * the stored one (a slug `v%61s-mare` is read as `vas-mare`). Null when it does, else the reason.
 */
export function productPageProblem(address: string, slug: string, reserved: ReservedAddresses): string | null {
    const request = requestPathProblem(address);
    if (request !== null) return `${address} is not the path a browser requests: ${request}`;
    const body = bodyPathOf(address);
    const route = rendererRoute(address, body, reserved);
    if (route.kind !== "builtin" || route.page !== "product pages") {
        return `the site answers ${address} with ${servedBefore(address, body, reserved) ?? "its content pages"}, not with the product page`;
    }
    const read = body.slice(route.address.length + 1);
    return read === slug ? null : `the product page at ${address} reads the slug "${read}", and the product's slug is "${slug}"`;
}

/** The booking rule's decoding (renderer/src/lib/booking-path.ts:36-49): until stable, at most 4 rounds. */
function decodeFully(segment: string): string {
    let current = segment;
    for (let i = 0; i < 4; i++) {
        let next: string;
        try {
            next = decodeURIComponent(current);
        } catch {
            return current;
        }
        if (next === current) return current;
        current = next;
    }
    return current;
}

/** Why a page cannot have an address. */
export type Blocked =
    | { kind: "reserved"; refusal: string }   // the content rule refuses it (reservedAddressRefusalIn)
    | { kind: "served-before"; by: string };  // the renderer answers it before the content lookup (servedBefore)

function blockedAt(address: string, reserved: ReservedAddresses): Blocked | null {
    const refusal = reservedAddressRefusalIn(address, reserved);
    if (refusal) return { kind: "reserved", refusal };
    const by = servedBefore(address, address, reserved);
    return by ? { kind: "served-before", by } : null;
}

/** Where a page goes. `refused-*`: not imported. */
export type Placement =
    | { kind: "kept"; address: string }                                     // its old address (normalized)
    | { kind: "parent"; address: string }                                   // no address by path: under its parent's
    | { kind: "flat"; address: string }                                     // no address by path, no parent with one
    | { kind: "moved"; address: string; wanted: string; blocked: Blocked }  // `wanted` blocked: flat instead
    | { kind: "refused-taken"; address: string; heldBy: string }            // an earlier item holds the address
    | { kind: "refused-blocked"; address: string; blocked: Blocked };       // the flat address is blocked too

/** What happens at an old address that is not the new one. `planned`: free in the export; the handler checks the site. */
export type RedirectPlan =
    | { kind: "none" }                                          // the old address is the new one, or there is none
    | { kind: "planned"; from: string; to: string }
    | { kind: "cannot-redirect"; from: string; by: string }     // cannot be kept or redirected: `by` answers it first
    | { kind: "taken-in-export"; from: string; heldBy: string }
    | { kind: "no-target"; from: string };                     // the page got no address: nothing to point to

export type ItemPlan =
    | { item: WordPressPost; old: OldAddress; placement: Placement; redirect: RedirectPlan }
    | { item: WordPressProduct; old: OldAddress; claimed: ClaimResult };

/** The claim of an old address as a redirect source, in export order (rule 5). */
type OldClaim =
    | { kind: "claimed"; from: string }
    | { kind: "cannot-redirect"; from: string; by: string }
    | { kind: "taken-in-export"; from: string; heldBy: string };

/** A product's old address, as claimed in export order: the redirect target is known only after the product lookup. */
export type ClaimResult = OldClaim | { kind: "none" };

/** The address a placement writes the page at, or null when the page is refused. */
export function pageAddressOf(p: Placement): string | null {
    switch (p.kind) {
        case "kept": return p.address;
        case "parent": return p.address;
        case "flat": return p.address;
        case "moved": return p.address;
        case "refused-taken": return null;
        case "refused-blocked": return null;
    }
}

/** An old address that is not an address by path cannot be redirected: the reason, or null for `path` and `none`. */
function unredirectable(old: OldAddress): { from: string; by: string } | null {
    switch (old.kind) {
        case "none": return null;
        case "path": return null;
        case "invalid": return { from: old.link, by: "the link is not a URL" };
        case "home": return { from: "/", by: "the site's home page: to keep it, set this page as the home page in Settings" };
        case "query-only": return { from: old.link, by: "an address by query string only (?p=…): the renderer serves by path, so it answers the home page" };
        case "undecodable": return { from: old.raw, by: "Next.js cannot decode this address (a malformed %-escape) and answers 400" };
    }
}

/** Rules 1–6 over the whole export (export order). Deterministic: every batch of one export sees the same plan. */
export function planAddresses(items: WordPressItem[], reserved: ReservedAddresses): ItemPlan[] {
    const held = new Map<string, string>();   // address → title of the item that holds it (page or redirect source)
    const byId = new Map<string, WordPressItem>();
    for (const item of items) if (item.wpId) byId.set(item.wpId, item);

    // Every old address is classified on its own (review-1: also when its page is refused): the renderer answers it
    // first → cannot be kept or redirected; else it is claimed as a redirect source in export order.
    const claimOld = (old: Extract<OldAddress, { kind: "path" }>, title: string): OldClaim => {
        const by = servedBefore(old.raw, old.path, reserved);
        if (by) return { kind: "cannot-redirect", from: old.path, by };
        const holder = held.get(old.path);
        if (holder !== undefined) return { kind: "taken-in-export", from: old.path, heldBy: holder };
        held.set(old.path, title);
        return { kind: "claimed", from: old.path };
    };

    const plans: ItemPlan[] = [];
    for (const item of items) {
        const old = oldAddressOf(item.link);
        const lost = unredirectable(old);
        if (item.postType === "product") {
            const claimed: ClaimResult = old.kind === "path" ? claimOld(old, item.title)
                : lost ? { kind: "cannot-redirect", ...lost } : { kind: "none" };
            plans.push({ item, old, claimed });
            continue;
        }
        const placement = place(item, old, byId, reserved, held);
        const address = pageAddressOf(placement);
        if (address !== null) held.set(address, item.title);
        let redirect: RedirectPlan = { kind: "none" };
        if (lost) redirect = { kind: "cannot-redirect", ...lost };
        else if (old.kind === "path") {
            const by = servedBefore(old.raw, old.path, reserved);
            if (by) redirect = { kind: "cannot-redirect", from: old.path, by };
            else if (address === null) redirect = { kind: "no-target", from: old.path };
            else if (old.path !== address) {
                const claim = claimOld(old, item.title);
                redirect = claim.kind === "claimed" ? { kind: "planned", from: claim.from, to: address } : claim;
            }
        }
        plans.push({ item, old, placement, redirect });
    }
    return plans;
}

/** Rule 2's parent path: the nearest ancestor's old address + `/` + this post's decoded name. */
function parentPath(post: WordPressPost, byId: Map<string, WordPressItem>): string | null {
    const seen = new Set<string>();
    let names = [decodeSegment(String(post.slug))];
    let parentId = post.parentId;
    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (!parent || parent.postType === "product") return null;
        const old = oldAddressOf(parent.link);
        if (old.kind === "path") return [old.path, ...names].join("/");
        names = [decodeSegment(String(parent.slug)), ...names];
        parentId = parent.parentId;
    }
    return null;
}

function place(post: WordPressPost, old: OldAddress, byId: Map<string, WordPressItem>, reserved: ReservedAddresses, held: Map<string, string>): Placement {
    const atFlat = (): Placement => {
        const address = flatAddressOf(post);
        const blocked = blockedAt(address, reserved);
        if (blocked) return { kind: "refused-blocked", address, blocked };
        const holder = held.get(address);
        if (holder !== undefined) return { kind: "refused-taken", address, heldBy: holder };
        return { kind: "flat", address };
    };
    // The home page has no parent; `none`, `invalid` and `query-only` may go under a parent.
    const source = old.kind === "path" ? old.path : old.kind === "home" ? null : parentPath(post, byId);
    if (source === null) return atFlat();
    const address = normalizeSlug(source);
    const blocked = blockedAt(address, reserved);
    if (blocked) {
        const flat = atFlat();
        return flat.kind === "flat" ? { kind: "moved", address: flat.address, wanted: address, blocked } : flat;
    }
    const holder = held.get(address);
    if (holder !== undefined) return { kind: "refused-taken", address, heldBy: holder };
    return old.kind === "path" ? { kind: "kept", address } : { kind: "parent", address };
}

/** The old product prefixes of the export: the folder of each product's old address (`/produs/vas` → `/produs`). */
export function oldProductPrefixes(plans: ItemPlan[]): string[] {
    const prefixes = new Set<string>();
    for (const plan of plans) {
        if (plan.item.postType !== "product" || plan.old.kind !== "path") continue;
        const cut = plan.old.path.lastIndexOf("/");
        prefixes.add(cut > 0 ? plan.old.path.slice(0, cut) : "/");
    }
    return [...prefixes];
}
