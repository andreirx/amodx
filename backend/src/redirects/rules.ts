import { normalizeSlug } from "@amodx/shared";
import { reservedAddressRefusalIn, type ReservedAddresses } from "../lib/slug-guard.js";
import { rendererRoute } from "../import/wp-addresses.js";

/**
 * REDIRECT-1 (docs/slices/redirect-1.md) — the decision rules of `POST /redirects` and `DELETE /redirects`. Pure: no
 * I/O. The handlers (create.ts, delete.ts) read the table, then call these functions; every expected failure is one
 * variant of `RedirectRefusal`, mapped to its answer by `refusalAnswer` (the one place of the status codes).
 */

/** Which field of the request an address came from. */
export type AddressField = "from" | "to";

/**
 * Why a redirect request is refused. Each variant carries only what its answer text needs.
 *  - `missing`: the field is absent, not a string, or empty after trimming;
 *  - `not-root-relative`: an absolute address (`https:…`, `mailto:…`) or scheme-relative (`//host`);
 *  - `bad-character`: a control character (Unicode Cc, anywhere in the string AS SENT — checked before trimming) or a
 *    backslash;
 *  - `repeated-slash`: `//` inside the address (trailing slashes excepted: they are dropped). Next.js answers such a
 *    path with a 308 to the path with one `/` before any route is read (next/dist/server/base-server.js:577-581), so
 *    `/a//b` is not the address a visitor ends on: as `to` it hides the route at `/a/b` (a self-loop `/a/b → /a//b`, or a
 *    chain); as `from` it is never looked up. Review-1 F-R1-DESTINATION. With `bad-character` and `not-normal`, this
 *    closes the class "the serving stack rewrites the address before its route is read": after `normalizeSlug`'s
 *    character set, a trailing slash (dropped here) and repeated slashes are the rewrites left;
 *  - `not-normal`: `normalizeSlug` would store another address than the one typed (ignoring surrounding whitespace,
 *    the leading slash and trailing slashes) — for example `/Room` or `/camere.html`. Refused, never changed silently:
 *    visitors ask for the typed address, and a stored `/room` does not answer `/Room` (REDIRECT1-NORMAL-FORM = A);
 *  - `system-route`: `/` or `/contact` — system routes are immutable (docs/database-patterns.md, Hard Rules item 4):
 *    a redirect is neither added there nor deleted there;
 *  - `reserved`: `from` is at a built-in page's address (slug-guard.ts `reservedAddressRefusalIn`; its text);
 *  - `not-served`: the renderer never looks up a route at `from` (import/wp-addresses.ts `rendererRoute`), so a
 *    redirect there would never answer;
 *  - `same-address`: `to` equals `from`;
 *  - `home-loop`: `to` is `/`, and `/` shows the home page whose address is `from` (renderer SitePage.tsx: `/` reads
 *    `ROUTE#<homePageSlug>` when it is set) — the redirect would answer itself;
 *  - `target-is-redirect`: the route at `to` is itself a redirect (no chains);
 *  - `home-is-redirect`: `to` is `/`, and the route of the home page (`homePageSlug`) is a redirect (no chains);
 *  - `page-at-from`: a route that is not a redirect holds `from` (a page) — never overwritten;
 *  - `unclassified-route`: the route at `address` (`from`, the target, or the delete address) holds an `IsRedirect` that
 *    is neither absent, `false` nor `true` (`RouteAt` `unclassified`) — never used as a target, overwritten or deleted;
 *  - `redirect-at-from`: a redirect already holds `from` — replace is delete, then add;
 *  - `changed-meanwhile`: a conditional write found another state at `address` than the read (a concurrent change);
 *  - `no-redirect-at`: delete of an address that holds nothing;
 *  - `page-not-redirect`: delete of an address that holds a page route — nothing is deleted.
 */
export type RedirectRefusal =
    | { kind: "missing"; field: AddressField }
    | { kind: "not-root-relative"; field: AddressField; value: string }
    | { kind: "bad-character"; field: AddressField; value: string }
    | { kind: "repeated-slash"; field: AddressField; value: string }
    | { kind: "not-normal"; field: AddressField; value: string; normal: string }
    | { kind: "system-route"; address: string }
    | { kind: "reserved"; from: string; message: string }
    | { kind: "not-served"; from: string; by: string }
    | { kind: "same-address"; address: string }
    | { kind: "home-loop"; from: string }
    | { kind: "target-is-redirect"; to: string; next: string }
    | { kind: "home-is-redirect"; home: string; next: string }
    | { kind: "page-at-from"; from: string }
    | { kind: "unclassified-route"; address: string; flagType: string }
    | { kind: "redirect-at-from"; from: string; to: string }
    | { kind: "changed-meanwhile"; address: string }
    | { kind: "no-redirect-at"; from: string }
    | { kind: "page-not-redirect"; from: string };

export type Checked<T> = { ok: true; value: T } | { ok: false; refusal: RedirectRefusal };

const CONTROL_CHARACTER = /\p{Cc}/u;   // U+0000–U+001F, U+007F, U+0080–U+009F

/** The system routes (docs/database-patterns.md, Hard Rules item 4). */
const SYSTEM_ROUTES: readonly string[] = ["/", "/contact"];
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** `/` first, no trailing `/` (the root stays `/`). */
function withoutEndSlashes(path: string): string {
    const withRoot = path.startsWith("/") ? path : "/" + path;
    return withRoot.replace(/\/+$/, "") || "/";
}

/**
 * The address the owner typed, checked, in the form it is stored: `normalizeSlug`, then without trailing slashes (the
 * address Next.js asks for after its own 308 for a trailing slash). The same rule for `from` and `to`.
 */
export function addressOf(raw: unknown, field: AddressField): Checked<string> {
    if (typeof raw !== "string") return { ok: false, refusal: { kind: "missing", field } };
    // On the string as sent: `trim()` removes leading and trailing control characters (tab, CR, LF), which must refuse.
    if (CONTROL_CHARACTER.test(raw) || raw.includes("\\")) return { ok: false, refusal: { kind: "bad-character", field, value: raw } };
    const typed = raw.trim();
    if (typed === "") return { ok: false, refusal: { kind: "missing", field } };
    if (SCHEME.test(typed) || typed.startsWith("//")) return { ok: false, refusal: { kind: "not-root-relative", field, value: typed } };
    if (withoutEndSlashes(typed).includes("//")) return { ok: false, refusal: { kind: "repeated-slash", field, value: typed } };
    const normal = withoutEndSlashes(normalizeSlug(typed));
    if (normal !== withoutEndSlashes(typed)) return { ok: false, refusal: { kind: "not-normal", field, value: typed, normal } };
    return { ok: true, value: normal };
}

/**
 * The stored key of a redirect to delete: the address exactly as the list shows it (`SK` without `ROUTE#`), not
 * normalized — a rename writes the old slug as it was stored, which may not be in normal form.
 */
export function storedAddressOf(raw: unknown): Checked<string> {
    if (typeof raw !== "string" || raw === "") return { ok: false, refusal: { kind: "missing", field: "from" } };
    if (CONTROL_CHARACTER.test(raw) || raw.includes("\\")) return { ok: false, refusal: { kind: "bad-character", field: "from", value: raw } };
    if (!raw.startsWith("/") || raw.startsWith("//")) return { ok: false, refusal: { kind: "not-root-relative", field: "from", value: raw } };
    return { ok: true, value: raw };
}

/** The system-route refusal for `address`, or null. */
function systemRouteRefusal(address: string): RedirectRefusal | null {
    return SYSTEM_ROUTES.includes(address) ? { kind: "system-route", address } : null;
}

/** The body of `DELETE /redirects`, checked without the table: the stored key, not a system route. */
export function deleteRequestOf(body: { from?: unknown }): Checked<string> {
    const from = storedAddressOf(body.from);
    if (!from.ok) return from;
    const system = systemRouteRefusal(from.value);
    return system ? { ok: false, refusal: system } : from;
}

/** The body of `POST /redirects`, checked without the table: both addresses, `from` not a system route, `to` ≠ `from`. */
export function createRequestOf(body: { from?: unknown; to?: unknown }): Checked<{ from: string; to: string }> {
    const from = addressOf(body.from, "from");
    if (!from.ok) return from;
    const system = systemRouteRefusal(from.value);
    if (system) return { ok: false, refusal: system };
    const to = addressOf(body.to, "to");
    if (!to.ok) return to;
    if (from.value === to.value) return { ok: false, refusal: { kind: "same-address", address: from.value } };
    return { ok: true, value: { from: from.value, to: to.value } };
}

/** The checks of `from` against the tenant's site (one tenant read): a built-in page's address, or no route lookup. */
export function fromRefusal(from: string, reserved: ReservedAddresses): RedirectRefusal | null {
    const message = reservedAddressRefusalIn(from, reserved);
    if (message !== null) return { kind: "reserved", from, message };
    const route = rendererRoute(from, from, reserved);
    switch (route.kind) {
        case "content": return null;
        // Unreachable after `reservedAddressRefusalIn` (it refuses every address `builtInPageAt` names); kept as a refusal.
        case "builtin": return { kind: "reserved", from, message: `The address "${from}" is the built-in ${route.page}.` };
        case "other": return { kind: "not-served", from, by: route.by };
    }
}

/**
 * What holds `ROUTE#<address>`: nothing; a redirect; a page route (not a redirect); or a route whose `IsRedirect` this
 * code cannot classify (`flag` = the stored value).
 */
export type RouteAt =
    | { kind: "none" }
    | { kind: "redirect"; to: string }
    | { kind: "page" }
    | { kind: "unclassified"; flag: unknown };

/**
 * The stored item (or none) as a `RouteAt` — THE reading of `IsRedirect` for every check of this module and for the
 * ConditionCheck of create.ts (review-2 F-R1-TARGET-PREDICATE):
 *  - `true` → redirect (also the list's rule, content/list.ts, so only a listed redirect can be deleted);
 *  - absent or `false` → page route (content/create.ts and the rename write no `IsRedirect` on a page route);
 *  - any other value (`"true"`, `1`, `null`, `0`, …; no writer makes one) → unclassified. The renderer
 *    (renderer/src/lib/dynamo.ts `getContentBySlug`) serves a TRUTHY `IsRedirect` as a redirect, so such an item may
 *    redirect or not; it is never treated as a safe target, never overwritten and never deleted here.
 */
export function routeAtOf(item: Record<string, unknown> | undefined): RouteAt {
    if (!item) return { kind: "none" };
    if (item.IsRedirect === true) return { kind: "redirect", to: String(item.RedirectTo) };
    if (item.IsRedirect === undefined || item.IsRedirect === false) return { kind: "page" };
    return { kind: "unclassified", flag: item.IsRedirect };
}

/**
 * The TYPE of an unclassified flag, for the refusal text — never the value (review-3 F-R1-REFUSAL-FORMATTING: the SDK
 * returns a DynamoDB number beyond 2^53 as a `bigint`, which `JSON.stringify` cannot serialize, also inside a map or a
 * list). Reads only `typeof` and the shape: `null`, a list (Array), a set (the document client's Set for SS/NS/BS),
 * binary (a typed array), a map (any other object), else the `typeof` name. Cannot throw for any value DynamoDB returns.
 */
function flagTypeOf(flag: unknown): string {
    if (flag === null) return "null";
    if (Array.isArray(flag)) return "list";
    if (flag instanceof Set) return "set";
    if (ArrayBuffer.isView(flag)) return "binary";
    return typeof flag === "object" ? "map" : typeof flag;
}

/**
 * The route a visitor of `to` reaches: `to` itself, except `/` with a home page set, which the renderer reads at
 * `ROUTE#<homePageSlug>` (SitePage.tsx:576; an empty `homePageSlug` counts as not set, renderer dynamo.ts `|| undefined`).
 */
export function effectiveTarget(to: string, homePageSlug: string | undefined): string {
    return to === "/" && homePageSlug ? homePageSlug : to;
}

/**
 * The checks of a create that need the routes as read: the route at `from`, and the route at `effectiveTarget(to)`.
 * The write itself stays conditional (create.ts: one transaction — `from` free, and the effective target not a redirect).
 */
export function createRefusal(from: string, to: string, homePageSlug: string | undefined, atFrom: RouteAt, atTarget: RouteAt): RedirectRefusal | null {
    const onFrom = sourceRefusal(from, atFrom);
    if (onFrom) return onFrom;
    const target = effectiveTarget(to, homePageSlug);
    if (target === from) return { kind: "home-loop", from };
    switch (atTarget.kind) {
        case "redirect": return target === to ? { kind: "target-is-redirect", to, next: atTarget.to } : { kind: "home-is-redirect", home: target, next: atTarget.to };
        case "unclassified": return { kind: "unclassified-route", address: target, flagType: flagTypeOf(atTarget.flag) };
        case "page": return null;
        case "none": return null;   // ruling 4: a target need not exist yet; the list marks it
    }
}

/** The route at `from` as read: only a free address can take a redirect. Every arm returns (exhaustive). */
function sourceRefusal(from: string, atFrom: RouteAt): RedirectRefusal | null {
    switch (atFrom.kind) {
        case "page": return { kind: "page-at-from", from };
        case "redirect": return { kind: "redirect-at-from", from, to: atFrom.to };
        case "unclassified": return { kind: "unclassified-route", address: from, flagType: flagTypeOf(atFrom.flag) };
        case "none": return null;
    }
}

/** The check of a delete against the route as read: only a redirect is deleted; its target, for the audit title. */
export function deletableRedirect(from: string, at: RouteAt): Checked<{ to: string }> {
    switch (at.kind) {
        case "none": return { ok: false, refusal: { kind: "no-redirect-at", from } };
        case "page": return { ok: false, refusal: { kind: "page-not-redirect", from } };
        case "unclassified": return { ok: false, refusal: { kind: "unclassified-route", address: from, flagType: flagTypeOf(at.flag) } };
        case "redirect": return { ok: true, value: { to: at.to } };
    }
}

/** The answer of a refusal: status code (the spec's evidence table) and the English admin text. The one mapping. */
export function refusalAnswer(r: RedirectRefusal): { statusCode: 400 | 404 | 409; error: string } {
    switch (r.kind) {
        case "missing": return { statusCode: 400, error: `The "${r.field}" address is missing.` };
        case "not-root-relative": return { statusCode: 400, error: `The "${r.field}" address "${r.value}" must be an address of this site that starts with one "/" (for example /guest-house), not a full or scheme-relative URL.` };
        case "bad-character": return { statusCode: 400, error: `The "${r.field}" address holds a control character or a backslash.` };
        case "repeated-slash": return { statusCode: 400, error: `The "${r.field}" address "${r.value}" holds "//". The site's server turns "//" into "/" before it looks up a page, so this is not the address a visitor reaches. Use one "/" between the parts of the address.` };
        case "not-normal": return { statusCode: 400, error: `The "${r.field}" address "${r.value}" cannot be stored as typed: the site stores addresses with lowercase letters a-z, digits, "-" and "/" only, so it would become "${r.normal}". A redirect stored at another address than the one visitors ask for never answers. Use "${r.normal}" only if that is the real address.` };
        case "system-route": return { statusCode: 400, error: `"${r.address}" is a system route of the site. A redirect cannot be added or deleted there.` };
        case "reserved": return { statusCode: 400, error: r.message };
        case "not-served": return { statusCode: 400, error: `A redirect at "${r.from}" would never answer: ${r.by}.` };
        case "same-address": return { statusCode: 400, error: `The redirect goes from "${r.address}" to the same address.` };
        case "home-loop": return { statusCode: 400, error: `"/" shows the home page, whose address is "${r.from}". A redirect from "${r.from}" to "/" would send visitors back to the same address.` };
        case "target-is-redirect": return { statusCode: 400, error: `"${r.to}" is itself a redirect (to "${r.next}"). Point to the final address instead.` };
        case "home-is-redirect": return { statusCode: 400, error: `"/" shows the home page "${r.home}", which is itself a redirect (to "${r.next}"). Point to the final address instead.` };
        case "page-at-from": return { statusCode: 409, error: `A page uses the address "${r.from}". A redirect never replaces a page.` };
        case "unclassified-route": return { statusCode: 409, error: `The route at "${r.address}" holds an IsRedirect value of type ${r.flagType} that is neither true nor false, so the site may or may not serve it as a redirect. It is not used or changed here; correct the stored item first.` };
        case "redirect-at-from": return { statusCode: 409, error: `A redirect from "${r.from}" already exists (to "${r.to}"). To change it, delete it first, then add the new one.` };
        case "changed-meanwhile": return { statusCode: 409, error: `The address "${r.address}" changed while saving. Reload the list and try again.` };
        case "no-redirect-at": return { statusCode: 404, error: `No redirect from "${r.from}". Use the address exactly as the list shows it.` };
        case "page-not-redirect": return { statusCode: 409, error: `The address "${r.from}" belongs to a page, not to a redirect. Nothing was deleted.` };
    }
}

/** The HTTP answer of a refusal: `{error, refusal}` (the text and the variant's `kind`). */
export function refusalResponse(r: RedirectRefusal): { statusCode: number; body: string } {
    const { statusCode, error } = refusalAnswer(r);
    return { statusCode, body: JSON.stringify({ error, refusal: r.kind }) };
}

/**
 * The list's "target not found" mark (ruling 4, operator ruling after review-0): ROUTE PRESENCE ONLY. True when the
 * route at `effectiveTarget(to)` exists and is not a redirect — `to` itself, or for `/` the home page's route. A
 * built-in page's address (cart, shop, product, …) has no route, so it is marked: the list cannot know whether that
 * page answers (a product may not exist; commerce may be off). `routes` = every route of the tenant, keyed by address.
 */
export function targetFound(to: string, routes: ReadonlyMap<string, RouteAt>, homePageSlug: string | undefined): boolean {
    return routes.get(effectiveTarget(to, homePageSlug))?.kind === "page";
}
