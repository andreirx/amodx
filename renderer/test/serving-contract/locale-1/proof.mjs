// LOCALE-1 proof helpers (docs/slices/locale-1.md § 8.5, ruling LOCALE1-PROOF = A, § 16.2 item 5).
//
// Two instruments, used by the `loc1-*` rows of contract.test.mjs and by every locale-1 slice:
//
//  1. `extractVisibleText(body)` — the visible-text extraction of § 8.5: from the server HTML, outside <script> and
//     <style>, (a) every text node, HTML comments (the `<!-- -->` text separators included) removed, whitespace
//     collapsed; (b) the attributes alt, title, placeholder, aria-label, and `value` on <button> and on
//     <input type="submit|button">; (c) <title> and the content of <meta name="description">, og:title and
//     og:description. Each item keeps its kind and document order. Before extraction the footer year is replaced
//     by the regex of the ratified CM1-A1 canonicalisation 4 (`© <!-- -->dddd<!-- -->` → `{year}`), because the year comes from
//     the clock and the start-commit capture is immutable; nothing else is changed.
//
//  2. `byteDifferences(beforeSet, beforeBody, afterSet, afterBody)` + `checkExpected(...)` — the byte gate of § 8.5
//     rules 2-3: both bodies go through the UNCHANGED CM1-A1 canonicalisation (`maskBody` of cm1-byte-identity.mjs);
//     what still differs must be exactly the listed differences of `expected-diff.json`, each with its category:
//       1  text-node consolidation — `{ category: 1, before: "<html substring>", after: "<html substring>",
//                                    flightBefore?, flightAfter? }` — the same consolidation in the RSC row, when the
//                                    element is server-rendered (its children travel in the payload too);
//       2  added string props      — `{ category: 2, element: "<module path>#<export>", prop: "<name>", value: <JSON> }`:
//                                    the element of that client component carries one more prop with that value;
//                                    LOCALE-1B: with `beforeValue: <JSON>` the element HAD the prop, with exactly that
//                                    value, and now has exactly `value` — the texts it receives (the SearchBar's labels
//                                    "$undefined" → the resolved texts; the commerce views' `strings` gain the 1b keys);
//                                    both values must occur, each on its side;
//       3  approved ledger change  — `{ category: 3, row: "<ledger row>", before, after }` (an html substring change).
//       4  LOCALE-1E root-layout move — `{ category: 4, row: "LOC1E-ROOT-LAYOUT", lang }` (operator ruling
//                                    LOC1E-STRUCTURE-CATEGORY = A): `<html>`/`<body>` moved from the deleted `app/layout.tsx`
//                                    into `app/[siteId]/layout.tsx`, and the root 404 boundary writes its own document.
//                                    Applied as a FORWARD transform of the BEFORE tree (`moveRootLayout`, below) that
//                                    validates every input against the d9999d2 shape; the AFTER tree must then be equal.
//     The check removes each listed difference from the AFTER side and then demands byte equality with BEFORE; a
//     listed difference that does not occur on that URL also fails. No canonicalisation is added or widened.
import { fileURLToPath } from "node:url";
import { fillTemplate, selectPluralText } from "@amodx/shared";
import { CM1_REQUESTS, maskBody, splitFlight } from "../cm1-byte-identity.mjs";
import { CM1, FIXTURE_HOST, ITEMS, LOC1, LOC1E, MISSING_SLUG, UNKNOWN_HOST } from "../fixtures.mjs";

export const LOC1_DIR = fileURLToPath(new URL("./", import.meta.url));

const fileOf = (p) => (p === "/" ? "root" : p.replace(/^\//, "").replace(/[^A-Za-z0-9.-]+/g, "_"));

/**
 * LOCALE-1D (§ 16.2 item 5, coverage rule item 2): the commerce-only pages a CM1 request list does not hold, derived by
 * RULE from the fixture items of a `commerceEnabled` tenant (default URL prefixes; no fixture sets `urlPrefixes`):
 * `/account`, the order confirmation without an order ("Thank you for your order!"), and per `ORDER#` item its
 * confirmation and its tracking page with the order's e-mail, plus one tracking request of the first order with a wrong
 * e-mail ("Order Not Found"). A tenant without commerce or without orders adds nothing. Used for the en-US subjects and,
 * through their source, for the RO copies.
 */
export function orderRequests(tenantId) {
    const t = ITEMS.find((i) => i.PK === "SYSTEM" && i.SK === `TENANT#${tenantId}`);
    if (!t || t.commerceEnabled !== true) return [];
    const orders = ITEMS.filter((i) => i.PK === `TENANT#${tenantId}` && String(i.SK).startsWith("ORDER#"));
    if (orders.length === 0) return [];
    const email = (o) => encodeURIComponent(o.customerEmail);
    const paths = [
        "/account", "/checkout/confirmare",
        ...orders.flatMap((o) => [`/checkout/confirmare?id=${o.id}&email=${email(o)}`, `/checkout/${o.id}?email=${email(o)}`]),
        `/checkout/${orders[0].id}?email=${encodeURIComponent("not-the-buyer@serving-contract.test")}`,
    ];
    return paths.map((p) => ({ tenant: tenantId, host: t.Domain, path: p, file: fileOf(p) }));
}

/** The full request list of a CM1 tenant key: its reviewed CM1 list plus, since locale-1d, its order pages. */
const cm1Requests = (key) => [...CM1_REQUESTS[key], ...orderRequests(CM1[key].id).map((r) => ({ ...r, tenant: key }))];

/** The RO copies answer the request list of their EN source tenant, on their own host (fixtures.mjs `LOC1`). */
export const LOC1_REQUESTS = Object.fromEntries(Object.entries(LOC1).map(([key, t]) => [
    key, cm1Requests(t.source).map((r) => ({ ...r, tenant: key, host: t.host })),
]));

/** GETs every request in `requests`, sequentially; each capture keeps the request fields (shape of `captureCm1`). */
export async function captureRequests(request, port, requests) {
    const out = [];
    for (const r of requests) {
        const res = await request({ port, path: r.path, host: r.host });
        out.push({ ...r, status: res.status, contentType: res.header("content-type") ?? "", body: res.body });
    }
    return out;
}

// ── Text expectations (locale-1b `text-expected.json`, `ro-expected.json`) ──────────────────────────────────────────
// An item names the key a changed text comes from: `{ part, key, kind, values | count, frame?, row, from, to }`. A text
// key renders `fillTemplate(<table value>, values)`; a count key (§ 16.2 item 6) renders the plural form of `count`;
// `frame` places the key's text inside a longer extracted text (`"{text} | <site name>"` — Next's title template —, or
// `"{text} — 80.00 USD"` on the add-to-cart button). The rows compare `from` / `to` with these renders.

/** The text an expectation item names, rendered from a RESOLVED table (`resolveLocaleStrings(...).strings`).
 *  LOCALE-1D: `segment: <i>` names the i-th text segment of a template whose placeholder renders as its OWN element
 *  (SitePage `interpolateNodes`: "Order <span>{number}</span>", "You will pay <strong>{amount}</strong> …"), which the
 *  extraction sees as separate items — the segment between placeholders, whitespace collapsed and trimmed. */
export function renderItem(table, item) {
    const value = table[item.part][item.key];
    const text = typeof value === "string"
        ? (item.segment !== undefined ? segmentOf(value, item.segment) : fillTemplate(value, item.values ?? {}))
        : fillTemplate(selectPluralText(value, item.count), { n: item.count });
    return (item.frame ?? "{text}").replace("{text}", text);
}

function segmentOf(template, i) {
    const segments = template.split(/\{[A-Za-z0-9_]+\}/);
    if (i < 0 || i >= segments.length) throw new Error(`template "${template}" has no segment ${i}`);
    return segments[i].replace(/\s+/g, " ").trim();
}

/** The catalog count texts BEFORE locale-1b, per count key — the `from` side of an L-EN-CAT or L-RO-PLURAL count
 *  item, which no pack holds any more: the facet count (`SitePage.tsx` FacetPanel, `n === 1 ? "1 produs" : `${n}
 *  produse``) and the header widget's aria-label (`InterestShortlist.tsx`, `Lista mea: ${count} produse`, one form). */
export const PRE_1B_COUNT_TEXT = {
    facetsCount: (n) => (n === 1 ? "1 produs" : `${n} produse`),
    interestWidgetLabel: (n) => `Lista mea: ${n} produse`,
};

/** GETs every request of the given LOC1 tenants. */
export function captureLoc1(request, port, tenantKeys = Object.keys(LOC1)) {
    return captureRequests(request, port, tenantKeys.flatMap((key) => LOC1_REQUESTS[key]));
}

// ── The en-US subjects (packet hard rule 1; review-0 R1) ─────────────────────────────────────────────────────────────
// RULE: every tenant item of fixtures.mjs WITHOUT a `locale` attribute is an en-US subject; rows `loc1-subjects`,
// `loc1-text-*` and `loc1-diff-1a` cover exactly this set, and `before/` must hold exactly its captures. A fixture
// tenant added later without `locale` therefore joins the gate (and fails it until it is captured and listed) instead
// of being silently outside it. Request lists: the three CM1 tenants keep their reviewed lists (`CM1_REQUESTS`, key =
// the CM1 key); every other subject (key = its tenant id) gets a list derived by rule from its own items — each ROUTE#
// page, and, when it has categories or products, `/shop`, each category and each active product (default URL prefixes;
// no fixture tenant sets `urlPrefixes`).
const tenantItems = ITEMS.filter((i) => i.PK === "SYSTEM" && String(i.SK).startsWith("TENANT#"));
const cm1KeyOf = Object.fromEntries(Object.entries(CM1).map(([key, t]) => [t.id, key]));

function derivedRequests(t) {
    const own = ITEMS.filter((i) => i.PK === `TENANT#${t.id}`);
    const routes = own.filter((i) => i.SK.startsWith("ROUTE#")).map((i) => i.SK.slice("ROUTE#".length));
    const categories = own.filter((i) => i.SK.startsWith("CATEGORY#")).map((i) => `/category/${i.slug}`);
    const products = own.filter((i) => i.SK.startsWith("PRODUCT#") && i.status === "active").map((i) => `/product/${i.slug}`);
    const paths = [...routes, ...(categories.length || products.length ? ["/shop", ...categories, ...products] : [])];
    return [...paths.map((p) => ({ tenant: t.id, host: t.Domain, path: p, file: fileOf(p) })), ...orderRequests(t.id)];
}

/** `{ <subject key>: <request list> }` for every en-US subject, in fixture order. */
export const EN_US_REQUESTS = Object.fromEntries(tenantItems
    .filter((t) => !Object.prototype.hasOwnProperty.call(t, "locale"))
    .map((t) => (cm1KeyOf[t.id] ? [cm1KeyOf[t.id], cm1Requests(cm1KeyOf[t.id])] : [t.id, derivedRequests(t)])));

/**
 * LOCALE-1E: the requests that are not in the en-US or RO capture lists but whose answer the layout move could change:
 * the home page of each `<html lang>` fixture (`LOC1E`), and the not-found probes — a missing page on a known tenant
 * (the cacheable `307` handoff and its `?nf=1` `404`); three paths that SKIP the middleware (its matcher excludes `api`,
 * `_next/static` and `favicon.ico`) and therefore match `[siteId]` with `siteId` = their first segment (`"api"`,
 * `"favicon.ico"`, `"_next"`): no tenant record, so they take the layout's missing-tenant branch on the cacheable route
 * (OBSERVED at d9999d2 and after: `307`), plus the `?nf=1` follow-up of one; a missing tenant addressed by id on a preview
 * host (the same branch on the twin, `/_site/` and `/tenant/`); the unknown-host gate. None of these reaches Next's
 * prerendered `/_not-found` (OBSERVED for these probes; that no request reaches it is NOT claimed). Used with
 * `[...EN_US_REQUESTS, ...LOC1_REQUESTS]` by row `loc1e-cache-headers`; `tenant` is a label only.
 */
const LOC1E_PREVIEW_HOST = "preview.cloudfront.net";   // = PREVIEW_HOST of contract.test.mjs (any `cloudfront.net` host is a preview host)
export const LOC1E_PROBE_REQUESTS = [
    ...Object.entries(LOC1E).map(([key, t]) => ({ tenant: key, host: t.host, path: "/" })),
    { tenant: "not-found", host: FIXTURE_HOST, path: MISSING_SLUG },
    { tenant: "not-found", host: FIXTURE_HOST, path: `${MISSING_SLUG}?nf=1` },
    { tenant: "not-found", host: FIXTURE_HOST, path: "/api/loc1e-no-such-route" },
    { tenant: "not-found", host: FIXTURE_HOST, path: "/api/loc1e-no-such-route?nf=1" },
    { tenant: "not-found", host: FIXTURE_HOST, path: "/favicon.ico" },
    { tenant: "not-found", host: LOC1E_PREVIEW_HOST, path: "/_site/loc1e-no-such-tenant" },
    { tenant: "not-found", host: LOC1E_PREVIEW_HOST, path: "/tenant/loc1e-no-such-tenant" },
    { tenant: "not-found", host: FIXTURE_HOST, path: "/_next/static/loc1e-missing.js" },
    { tenant: "not-found", host: UNKNOWN_HOST, path: "/" },
].map((r) => ({ ...r, file: fileOf(r.path) }));

/**
 * LOCALE-1E (operator ruling LOC1E-404-DOCUMENT = B): the 404 documents whose payload must be exactly the d9999d2 one
 * moved by the `1e` category — a known en-US tenant's `?nf=1` landing, the RO copy's (its tenant layout says `ro`, the
 * root 404 boundary `en`), and a missing tenant on a preview host. Captured from d9999d2 into `1e/before-404/`.
 */
export const LOC1E_404_REQUESTS = [
    { tenant: "fixture-tenant", host: FIXTURE_HOST, path: `${MISSING_SLUG}?nf=1`, lang: "en" },
    { tenant: "roContent", host: LOC1.roContent.host, path: `${MISSING_SLUG}?nf=1`, lang: "ro" },
    { tenant: "missing-tenant", host: LOC1E_PREVIEW_HOST, path: "/_site/loc1e-no-such-tenant", lang: "en" },
].map((r) => ({ ...r, file: fileOf(r.path) }));

/** The four response fields of row `loc1e-cache-headers` (packet § 1 item 4); an absent header is `null`. */
export function cacheFields(res) {
    const one = (name) => { const v = res.header(name); return v === undefined ? null : String(v); };
    return { status: res.status, cacheControl: one("cache-control"), contentType: one("content-type"), vary: one("vary") };
}

/**
 * Per subject, the URLs whose visible text differs between two capture sets (status, structure or text) beyond the
 * listed changes. `listed(path)` → the exact `[{ kind, from, to }]` (`textChanges` form, document order) the URL must
 * show — LOCALE-REVIEWS-DATE-1: the `text` of its category-3 (ledger) entries; default none, i.e. the extractions must
 * be equal. A listed change that does not occur is a mismatch too.
 */
export function textMismatches(beforeSet, afterSet, key, listed = () => []) {
    const out = [];
    for (const b of beforeSet.captures.filter((c) => c.tenant === key)) {
        const a = afterSet.captures.find((c) => c.tenant === key && c.path === b.path);
        if (!a) { out.push(`${b.path}: not captured`); continue; }
        if (a.status !== b.status) { out.push(`${b.path}: status ${b.status} → ${a.status}`); continue; }
        if (!b.contentType.startsWith("text/html")) continue;
        const from = extractVisibleText(b.body), to = extractVisibleText(a.body);
        const want = listed(b.path);
        let same;
        if (want.length === 0) same = JSON.stringify(to) === JSON.stringify(from);
        else { try { same = JSON.stringify(textChanges(from, to)) === JSON.stringify(want); } catch { same = false; } }
        if (!same) out.push(`${b.path}: visible text changed`);
    }
    return out;
}

// LOCALE-1D: the extraction (`maskFooterYear`, `extractVisibleText`, `textChanges`) lives in `./extract.mjs` — moved
// there unchanged so a jsdom unit test can import it without this module's fixture graph; re-exported here.
import { extractVisibleText, textChanges } from "./extract.mjs";
export { maskFooterYear, extractVisibleText, textChanges } from "./extract.mjs";

const FLIGHT_MARK = "\n--- flight payload rows, sorted ---\n";

// ── Resolved-tree payload comparison (operator ruling LOCALE1B-ROW-CUT = A, 2026-11-01) ─────────────────────────────
// For the locale byte rows only (`loc1-diff-*`); the `cm1-identity-*` rows keep CM1-A1 exactly. It REPLACES the 1a row
// renumbering (LOCALE1A-ROW-IDS = A, which ignored row labels only): the React Flight encoder outlines elements into
// rows of their own by a SIZE threshold, so a longer prop or text moves where the payload is cut, and the order and
// labels of outlined rows vary between renders (F-LOCALE-ROW-IDS). Both are encoder choices, not page content.
//
// Method (`resolveFlight`): every row is parsed by its kind; every PLAIN row reference — a string value "$<hex id>",
// optionally with a ":path" — is replaced by the resolved content of the row it names (a path walks into it); the
// result is row 0's tree plus, as a sorted list, the tree of every row whose full content no reference places (an
// unreferenced row, or one reached only through a path into it) — so every parsed row is compared once (review-0 R4).
// An absent row 0 is not a `null` row 0. What it ignores: row labels and where rows are cut.
// What it still compares: every value, every object key, every element and its props, the type and the target content
// of every typed reference, every non-model row, every unreferenced row, the hint lines.
//
// The protocol positions it respects (the 1a review-2 R5 rule, kept):
//  - Only MODEL rows (JSON bodies) hold references, and only their string VALUES; an object KEY is data.
//  - Text rows `<id>:T<len>,<text>` resolve to their text (an inline string and an outlined text row compare equal).
//    A text row is length-prefixed (`<len>` = hex UTF-8 bytes) and has no line end, so the row that follows it is on
//    the same line; `splitTextRows` cuts the line at that length and parses the rest as rows. A text row shorter than
//    its length (its text held a line break) fails closed.
//  - Error rows `<id>:E{…}` and stream rows (`X`/`x`/`R`/`r`/`C`, one row = every line of its label) are kept literal,
//    as a generated `#row(…)` node.
//  - Nodes the comparison makes (typed references, literal rows, missing targets, an absent row 0) are instances of a
//    private class, printed by `canon` as `#<tag>(…)` — a form no raw JSON value takes — so raw data cannot impersonate
//    them; raw objects are copied with every own key, `__proto__` included (review-0 R5).
//  - A LAZY reference `"$L<id>"` whose target row is a React ELEMENT tuple `["$", …]` is the encoder's element outline
//    and resolves like `"$<id>"` (operator clarification 2026-11-01, packet § 7 item 2). Evidence
//    (React Flight server in next 16.4.3, `next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-
//    server.node.production.js`): when a row exceeds 3 200 serialised characters at an element position, `deferTask`
//    (l. 1259) moves the element into a task of its own and returns `serializeLazyID(id)` = `"$L" + id` (l. 1510); a
//    suspended or repeated element is referenced the same way (l. 1422-1466, 1530); the encoder picks `$L` instead of
//    `$` by POSITION only (element position vs any other, `serializeByValueID`). A lazy reference to ANY other target (a
//    non-element model row, an error, text, stream or missing row, or with a path) stays a typed lazy reference, so
//    `$L1` ≠ `$1`. Client-module references (lazy references to import rows) are the CM1-A1 identities
//    `"$L[project]…"`, kept as leaves.
//  - Every other TYPED reference — promise `$@`, server reference `$F`, Map `$Q`, Set `$W`, Blob `$B`, FormData `$K`,
//    iterator `$i` — stays a typed generated node `#ref:<form>(<resolved target>)`: the type is kept, the target is
//    compared, only the label is dropped.
//  - Known non-references stay as written: `"$"`, `"$$…"`, `"$S…"`, `$Infinity`, `$NaN`, `$-0`, `$-Infinity`,
//    `$undefined`, `$D…`, `$n…`.
//  - FAIL CLOSED: any other `$`-form, a row of any other kind, a model row with two lines, a reference cycle anywhere in
//    the payload (every row is resolved, so a disconnected cycle too) or a path that does not exist THROWS — the
//    comparison refuses rather than guess. A reference to a row that is not in the payload resolves to a generated
//    `#missing:…` node, which no real content equals.
//  - Not visible after resolution (stated limit): whether a row was SHARED (one row referenced twice) or duplicated —
//    both resolve to the same tree.
const ROW_REFERENCE = /^\$([@LFQWBKi]?)([0-9a-f]+)((?::[^:]*)*)$/;
const NOT_A_REFERENCE = /^\$(?:$|\$|S|Infinity$|NaN$|-0$|-Infinity$|undefined$|D|n[0-9]|L\[project\])/;
const ROW_LABEL = /^([0-9a-f]+):/;

/** The kind of a labelled row body: "model" (JSON), "text" (`T<len>,`) or "literal" (error, stream marker). */
function rowKind(body) {
    if (/^T[0-9a-f]+,/.test(body)) return "text";
    if (/^E\{/.test(body) || /^[XxRrC]$/.test(body)) return "literal";
    if (/^[\[{"\-0-9]/.test(body) || /^(?:true|false|null)$/.test(body)) return "model";
    throw new Error(`resolveFlight: unsupported RSC row kind ${JSON.stringify(body.slice(0, 40))} — refusing to compare`);
}

/** The row reference a string value names, or null when it is not one; throws on an unknown `$`-form. */
function referenceIn(value) {
    if (!value.startsWith("$")) return null;
    const ref = ROW_REFERENCE.exec(value);
    if (ref) return { form: ref[1], id: ref[2], path: ref[3] };
    if (NOT_A_REFERENCE.test(value)) return null;
    throw new Error(`resolveFlight: unknown RSC string form ${JSON.stringify(value.slice(0, 40))} — refusing to compare`);
}

/** One step of a ":path" inside a resolved value; an element tuple `["$", type, key, props]` is addressed by name. */
function step(value, segment) {
    const ELEMENT = { type: 1, key: 2, props: 3 };
    const at = Array.isArray(value) && value[0] === "$" && Object.hasOwn(ELEMENT, segment) ? ELEMENT[segment] : segment;
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, at)) {
        throw new Error(`resolveFlight: path segment ${JSON.stringify(segment)} does not exist — refusing to compare`);
    }
    return value[at];
}

/**
 * The canonical form of one payload (its CM1-A1 rows): `{ root, others, hints }` — `root` = row 0 resolved, `others` =
 * every other unreferenced row resolved (sorted JSON strings), `hints` = the unlabelled lines (sorted).
 */
/** The rows of the CM1-A1 lines, with every row that follows a text row on the same line split off (see above). */
function splitTextRows(lines) {
    const out = [];
    for (let line of lines) {
        for (;;) {
            const m = /^([0-9a-f]+):T([0-9a-f]+),/.exec(line);
            if (!m) { out.push(line); break; }
            const bytes = Buffer.from(line.slice(m[0].length), "utf8");
            const length = parseInt(m[2], 16);
            if (bytes.length < length) throw new Error(`resolveFlight: text row ${m[1]} is shorter than its length — refusing to compare`);
            out.push(m[0] + bytes.subarray(0, length).toString("utf8"));
            line = bytes.subarray(length).toString("utf8");
            if (line === "") break;
            if (!/^[0-9a-f]+:/.test(line)) throw new Error(`resolveFlight: text after text row ${m[1]} is not a row — refusing to compare`);
        }
    }
    return out;
}

/**
 * A node the comparison MAKES (never one read from the payload; review-0 R5): a typed reference, a literal row, a
 * reference to a missing row, an absent row 0. `canon` prints it as `#<tag>(…)`, a form no raw JSON value can take
 * (a raw value prints as JSON: a string starts with `"`), so raw data can never impersonate it.
 */
class Generated {
    constructor(tag, value) { this.tag = tag; this.value = value; }
}

/** A copy of a raw JSON object that keeps EVERY own key, `__proto__` included (review-0 R5). */
function rawObject(entries) {
    const out = Object.create(null);
    for (const [k, v] of entries) Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
    return out;
}

/** The canonical string of a resolved value: raw values as JSON (object keys in their order), generated nodes `#…`. */
export function canon(node) {
    if (node instanceof Generated) return `#${node.tag}(${canon(node.value)})`;
    if (Array.isArray(node)) return `[${node.map(canon).join(",")}]`;
    if (node !== null && typeof node === "object") return `{${Object.keys(node).map((k) => `${JSON.stringify(k)}:${canon(node[k])}`).join(",")}}`;
    return JSON.stringify(node) ?? "undefined";
}

export function resolveFlight(lines) {
    const rows = splitTextRows(lines);
    const byLabel = new Map();
    const hints = [];
    for (const row of rows) {
        const m = ROW_LABEL.exec(row);
        if (!m) { if (row !== "") hints.push(row); continue; }
        if (!byLabel.has(m[1])) byLabel.set(m[1], []);
        byLabel.get(m[1]).push(row.slice(m[1].length + 1));
    }
    const parsed = new Map();
    for (const [id, bodies] of byLabel) {
        const kinds = bodies.map(rowKind);
        if (kinds.includes("model")) {
            if (bodies.length !== 1) throw new Error(`resolveFlight: model row ${id} has ${bodies.length} lines — refusing to compare`);
            parsed.set(id, { kind: "model", value: JSON.parse(bodies[0]) });
        } else if (kinds.length === 1 && kinds[0] === "text") {
            parsed.set(id, { kind: "text", value: bodies[0].slice(bodies[0].indexOf(",") + 1) });
        } else if (kinds.every((k) => k === "literal")) {
            parsed.set(id, { kind: "literal", value: new Generated("row", bodies) });
        } else {
            throw new Error(`resolveFlight: row ${id} mixes kinds ${kinds.join(",")} — refusing to compare`);
        }
    }
    // Every parsed row is accounted for (review-0 R4), independently of label order: a row whose FULL content some
    // reference places (a reference without a path) is "consumed" there; every other row — unreferenced, or reached
    // only through a path into it — is compared as an entry of its own. Without a cycle, every consumed row's content
    // therefore lies inside row 0 or such an entry. Every row is resolved once, so a cycle anywhere in the payload
    // (also a disconnected one) fails closed.
    const consumed = new Set();
    const collect = (node) => {
        if (typeof node === "string") { const ref = referenceIn(node); if (ref && ref.path === "") consumed.add(ref.id); return; }
        if (Array.isArray(node)) { node.forEach(collect); return; }
        if (node !== null && typeof node === "object") Object.keys(node).forEach((k) => collect(node[k]));
    };
    for (const row of parsed.values()) if (row.kind === "model") collect(row.value);
    const resolveRow = (id, stack) => {
        const row = parsed.get(id);
        if (row.kind !== "model") return row.value;
        if (stack.includes(id)) throw new Error(`resolveFlight: reference cycle through row ${id} — refusing to compare`);
        return resolveValue(row.value, [...stack, id]);
    };
    const resolveValue = (node, stack) => {
        if (typeof node === "string") {
            const ref = referenceIn(node);
            if (!ref) return node;
            if (!parsed.has(ref.id)) return new Generated(`missing:${ref.form}${ref.path}`, null);
            let target = resolveRow(ref.id, stack);
            for (const segment of ref.path.split(":").slice(1)) target = step(target, segment);
            // Outlined content compares equal to inline content: a plain reference, and a LAZY reference to a row that
            // is a React element tuple `["$", …]` — the encoder's size-triggered element outline (`deferTask` →
            // `serializeLazyID`, operator clarification 2026-11-01). Any other lazy target stays a typed reference.
            const row = parsed.get(ref.id);
            const outlined = ref.form === "" || (ref.form === "L" && ref.path === "" && row.kind === "model" && Array.isArray(row.value) && row.value[0] === "$");
            return outlined ? target : new Generated(`ref:${ref.form}`, target);
        }
        if (Array.isArray(node)) return node.map((child) => resolveValue(child, stack));
        if (node !== null && typeof node === "object") return rawObject(Object.keys(node).map((k) => [k, resolveValue(node[k], stack)]));
        return node;
    };
    const resolved = new Map([...parsed.keys()].map((id) => [id, resolveRow(id, [])]));
    return {
        // An absent row 0 is not a present `null` row 0 (review-0 R4).
        root: resolved.has("0") ? resolved.get("0") : new Generated("absent-root", null),
        others: [...resolved].filter(([id]) => id !== "0" && !consumed.has(id)).map(([, value]) => canon(value)).sort(),
        hints: hints.sort(),
    };
}

/** The first place two resolved values differ, as a path and the two canonical values (a readable diagnostic). */
function firstDifference(a, b, path = "") {
    if (canon(a) === canon(b)) return null;
    if (a instanceof Generated && b instanceof Generated && a.tag === b.tag) return firstDifference(a.value, b.value, `${path}/#${a.tag}`);
    const plain = (x) => x !== null && typeof x === "object" && !(x instanceof Generated);
    if (plain(a) && plain(b) && Array.isArray(a) === Array.isArray(b)) {
        const keys = Array.isArray(a) ? [...Array(Math.max(a.length, b.length)).keys()] : [...new Set([...Object.keys(a), ...Object.keys(b)])];
        for (const k of keys) {
            const d = firstDifference(a[k], b[k], `${path}/${k}`);
            if (d) return d;
        }
    }
    return { path: path || "/", before: canon(a).slice(0, 160), after: canon(b).slice(0, 160) };
}

/** The two compared parts of one body: the HTML outside the payload (CM1-A1) and the payload rows (CM1-A1). */
function canonicalParts(set, body) {
    const { masked } = maskBody(body, set);
    const at = masked.indexOf(FLIGHT_MARK);
    return at < 0 ? { html: masked, rows: [] } : { html: masked.slice(0, at), rows: masked.slice(at + FLIGHT_MARK.length).split("\n") };
}

const same = (a, b) => canon(a) === canon(b);

/** Removes `prop` (when it equals `value`) from every element `["$", "$L<identity>", key, props]` in `node`; every
 *  other own key and every generated node is kept (review-0 R5). */
function stripProp(node, identity, prop, value, hits) {
    if (node instanceof Generated) return new Generated(node.tag, stripProp(node.value, identity, prop, value, hits));
    if (Array.isArray(node)) {
        if (node[0] === "$" && node[1] === `$L${identity}` && node[3] && typeof node[3] === "object" && Object.hasOwn(node[3], prop) && same(node[3][prop], value)) {
            hits.n += 1;
            const props = rawObject(Object.keys(node[3]).filter((k) => k !== prop).map((k) => [k, node[3][k]]));
            return [node[0], node[1], node[2], stripProp(props, identity, prop, value, hits), ...node.slice(4)];
        }
        return node.map((child) => stripProp(child, identity, prop, value, hits));
    }
    if (node !== null && typeof node === "object") return rawObject(Object.keys(node).map((k) => [k, stripProp(node[k], identity, prop, value, hits)]));
    return node;
}

// ── Category 4: the LOCALE-1E root-layout move (docs/slices/locale-1e.md § 4; ruling LOC1E-STRUCTURE-CATEGORY = A) ─────
// EXACTLY the enumerated rows, each value taken from the BEFORE side and its shape validated (never reset):
//  - root segment `""`: before `fragment[[LINK, SCRIPT], html{lang:"en"} > body{className} > LR]` → after
//    `fragment[null, LR']`, LR' = LR whose `notFound` `[NF0, []]` became `[html{lang:"en"} > body{className} > NF0, [LINK]]`
//    (the root 404 boundary `app/not-found.tsx` writes the document and links the same stylesheet); SCRIPT (the deleted
//    root layout's chunk) leaves the payload; the root `d.v` `null` → the stream-row reference `#row(["C","X"])`;
//  - `[siteId]` segment: `fragment[SCRIPTS, X]` → `fragment[[LINK, ...SCRIPTS], html{lang} > body{className} > X]`; its
//    hint `h` 1024 → 1040 (ISR) or absent → 16 (twin) — bit 16 is the root-layout hint, moved; any other `h` refuses;
//  - `G[1]` (the global-error stylesheets) `[LINK]` → `[]`;
//  - RAW values (CM1-A1 masks every `/_next/static` path, so the masked equality cannot see a changed URL; review 0 of
//    iteration 1, R1): on trees resolved with the asset paths UNMASKED (`rawParts`), the after `[siteId]` resources are
//    SELF-CONSISTENT with the live (after) document — CAT-IMPORT-GALLERY-1 correction, docs/slices/locale-1e.md § 18:
//    their shape is the before shape (exactly one stylesheet LINK, then as many scripts as the before SCRIPTS), the
//    stylesheet's `href` is a stylesheet of the live head and every script's `src` is a script the live head loads, and
//    the after 404 boundary's resources are `[that same live LINK]`. On a `__next_error__` shell (whose head loads no
//    stylesheet and none of the [siteId] scripts) the resources must instead equal those of the live 200 pages of the same
//    build (`liveSiteIdReference`: all such pages pass the live-head rule and agree; fail closed — no reference, a failing
//    reference or a disagreement is a problem). (Before § 18 they had to equal the before names;
//    Next names client files by a hash of their content, so that pinned every later client-bundle byte.) Unchanged: the
//    before `G[1]` equals the before root LINK; the removed SCRIPT's `src` is in the document head on both sides; the
//    head's `/_next/static` stylesheet hrefs are equal before/after, the before ones each equal the before LINK's href
//    and the after ones each equal the live LINK's href;
//  - the error-shell preload (ruling LOC1E-404-SHELL-PRELOAD = A): on a page whose RAW response starts with the
//    `__next_error__` shell — the predicate, never a URL list — exactly ONE `<link rel="preload" href="<LINK's href>"
//    as="style"/>` may be absent after; any other preload difference, and any preload difference on a page that is not
//    such a shell, refuses (the HTML comparison stays exact there).
// Anything else stays a difference. `body{className}` and `LINK` are the before side's own values (equality proves them).
const ERROR_SHELL = '<!DOCTYPE html><html id="__next_error__">';
const STYLE_PRELOAD = (href) => `<link rel="preload" href="${href}" as="style"/>`;
const isElement = (n, type) => Array.isArray(n) && n[0] === "$" && n[1] === type && n[3] !== null && typeof n[3] === "object";
const hasExactKeys = (o, keys) => canon(Object.keys(o)) === canon(keys);
const element = (type, props) => ["$", type, null, rawObject(Object.entries(props))];
const withProps = (el, props) => [el[0], el[1], el[2], rawObject(Object.entries({ ...el[3], ...props }))];
const withKeys = (o, entries) => rawObject([...Object.keys(o).map((k) => [k, Object.hasOwn(entries, k) ? entries[k] : o[k]]), ...Object.keys(entries).filter((k) => !Object.hasOwn(o, k)).map((k) => [k, entries[k]])]);
const fragmentChildren = (r) => (isElement(r, "$Sreact.fragment") && hasExactKeys(r[3], ["children"]) && Array.isArray(r[3].children) && r[3].children.length === 2 ? r[3].children : null);

/** The expected AFTER tree of the root-layout move, built from the BEFORE tree; `null` (with a problem) when the before
 *  tree is not the d9999d2 shape. `lang` = the tenant layout's expected `<html lang>`. */
function moveRootLayout(tree, lang, problems) {
    const fail = (why) => { problems.push(`category 4: ${why}`); return null; };
    const R = tree.root;
    if (R === null || typeof R !== "object" || R instanceof Generated || !R.t || !R.t.t) return fail("no root segment");
    const G = R.G, rootSeg = R.t.t;
    if (!Array.isArray(G) || G.length !== 2 || !Array.isArray(G[1]) || G[1].length !== 1 || !isElement(G[1][0], "link")) return fail("G[1] is not one stylesheet link");
    const LINK = G[1][0];
    const rootChildren = fragmentChildren(rootSeg.d?.r);
    if (!rootChildren) return fail("the root segment is not a two-child fragment");
    const [rootRes, html] = rootChildren;
    if (!Array.isArray(rootRes) || rootRes.length !== 2 || canon(rootRes[0]) !== canon(LINK) || !isElement(rootRes[1], "script")) return fail("the root resources are not [the G[1] stylesheet, one script]");
    if (!isElement(html, "html") || !hasExactKeys(html[3], ["lang", "children"]) || html[3].lang !== "en") return fail('the root layout is not <html lang="en">');
    const body = html[3].children;
    if (!isElement(body, "body") || !hasExactKeys(body[3], ["className", "children"]) || typeof body[3].className !== "string") return fail("the root layout's <html> holds no <body className>");
    const LR = body[3].children, className = body[3].className;
    if (!Array.isArray(LR) || LR[0] !== "$" || !LR[3] || !Array.isArray(LR[3].notFound) || LR[3].notFound.length !== 2 || canon(LR[3].notFound[1]) !== "[]") return fail("the root layout-router has no [404 UI, []] notFound");
    if (rootSeg.d.v !== null) return fail("the root segment's v is not null");
    if (!(rootSeg.c instanceof Generated) || !Array.isArray(rootSeg.c.value) || rootSeg.c.value.length !== 1 || rootSeg.c.value[0][0] !== "children") return fail("the root segment has not exactly one child segment");
    const seg = rootSeg.c.value[0][1];
    const segChildren = fragmentChildren(seg?.d?.r);
    if (!segChildren || !Array.isArray(segChildren[0]) || !segChildren[0].every((x) => isElement(x, "script"))) return fail("the [siteId] segment is not fragment[[scripts], content]");
    const h = !Object.hasOwn(seg, "h") ? 16 : seg.h === 1024 ? 1040 : undefined;
    if (h === undefined) return fail(`the [siteId] hint h=${seg.h} is not an enumerated value`);
    const wrap = (inner, l) => element("html", { lang: l, children: element("body", { className, children: inner }) });
    const lrAfter = withProps(LR, { notFound: [wrap(LR[3].notFound[0], "en"), [LINK]] });
    if (Object.keys(seg)[0] !== "s") return fail("the [siteId] segment does not start with its key s");
    const dAfter = withKeys(seg.d, { r: [seg.d.r[0], seg.d.r[1], seg.d.r[2], rawObject([["children", [[LINK, ...segChildren[0]], wrap(segChildren[1], lang)]]])] });
    // The before key order, with `h` right after `s` (where a twin segment gains it).
    const segAfter = rawObject(["s", "h", ...Object.keys(seg).filter((k) => k !== "s" && k !== "h")].map((k) => [k, k === "h" ? h : k === "d" ? dAfter : seg[k]]));
    const rootAfter = withKeys(rootSeg, {
        d: withKeys(rootSeg.d, { r: [rootSeg.d.r[0], rootSeg.d.r[1], rootSeg.d.r[2], rawObject([["children", [null, lrAfter]]])], v: new Generated("row", ["C", "X"]) }),
        c: new Generated(rootSeg.c.tag, [["children", segAfter]]),
    });
    return { ...tree, root: withKeys(R, { G: [G[0], []], t: withKeys(R.t, { t: rootAfter }) }) };
}

const RAW_STATIC = "/_next/RAW-static/";
/** The two parts of `canonicalParts`, through the UNCHANGED CM1-A1 pipeline, with the asset paths kept: the body's
 *  `/_next/static/` prefix is renamed first so the asset mask does not match it (`unraw` maps it back). */
const rawParts = (set, body) => canonicalParts(set, body.split("/_next/static/").join(RAW_STATIC));
const unraw = (v) => (typeof v === "string" ? v.split(RAW_STATIC).join("/_next/static/") : v);

/** The resources category 4 moves, read from a tree by position; `null` when the tree does not have the shape. */
function movedResources(tree, side) {
    try {
        const R = tree.root, rootSeg = R.t.t, seg = rootSeg.c.value[0][1];
        const [rootFirst, rootSecond] = rootSeg.d.r[3].children;
        const segRes = seg.d.r[3].children[0];
        if (side === "before") return { link: rootFirst[0], script: rootFirst[1], g1: R.G[1], scripts: segRes };
        const lr = rootSecond, notFound = lr[3].notFound;
        return { segRes, notFoundRes: notFound[1], g1: R.G[1] };
    } catch {
        return null;
    }
}

const headStylesheets = (html) => [...html.matchAll(/<link rel="stylesheet" href="(\/_next\/static\/[^"]+)"[^>]*>/g)].map((m) => m[1]);
const headScripts = (html) => [...html.matchAll(/<script src="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]);
const stylePreloads = (html) => [...html.matchAll(/<link rel="preload" href="(\/_next\/static\/[^"]+)" as="style"\/>/g)].map((m) => m[1]);

/** § 18: why live `[siteId]` resources (raw) are not self-consistent with their live document's head; `null` = they are:
 *  one stylesheet link, then scripts; the link's `href` is a head stylesheet; every script's `src` is a head script. */
function liveHeadProblem(res, html) {
    if (!Array.isArray(res) || res.length < 1 || !isElement(res[0], "link") || !res.slice(1).every((x) => isElement(x, "script"))) {
        return "the [siteId] resources are not one stylesheet then scripts";
    }
    const liveHref = unraw(res[0][3].href);
    if (typeof liveHref !== "string" || !headStylesheets(html).includes(liveHref)) return `the [siteId] stylesheet ${liveHref} is not a stylesheet of the live head`;
    for (const s of res.slice(1)) {
        const src = unraw(s[3].src);
        if (typeof src !== "string" || !headScripts(html).includes(src)) return `the [siteId] script ${src} is not a script the live head loads`;
    }
    return null;
}

/**
 * § 18 (shell rule, operator ruling CIG-SERVING-SHELL = A, fail closed) — the live reference a `__next_error__` shell's
 * `[siteId]` resources are compared with: the `[siteId]` resources of the live 200 HTML pages of `set` (non-shell, with the
 * category-4 payload shape), each of which must itself pass the live-head rule, and which must all be EQUAL (the
 * page-independence of the layout's resources is asserted on every run, never assumed). Returns `{ kind: "resources",
 * resources, pages }`, or `{ kind: "problem", problem }` when the set has no such page, a page fails the live-head rule,
 * or two pages disagree.
 */
export function liveSiteIdReference(set) {
    const refs = [];
    for (const c of set.captures) {
        if (c.status !== 200 || !String(c.contentType ?? "").startsWith("text/html") || c.body.startsWith(ERROR_SHELL)) continue;
        const after = movedResources(resolveFlight(rawParts(set, c.body).rows), "after");
        if (!after || !Array.isArray(after.segRes)) continue;
        const why = liveHeadProblem(after.segRes, splitFlight(c.body).html);
        if (why) return { kind: "problem", problem: `the 200 reference page ${c.tenant} ${c.path}: ${why}` };
        refs.push({ where: `${c.tenant} ${c.path}`, resources: after.segRes });
    }
    if (refs.length === 0) return { kind: "problem", problem: "no live 200 HTML page in the capture set anchors a shell's [siteId] resources" };
    const other = refs.find((r) => canon(r.resources) !== canon(refs[0].resources));
    if (other) return { kind: "problem", problem: `two live 200 pages disagree on the [siteId] resources (${refs[0].where}, ${other.where})` };
    return { kind: "resources", resources: refs[0].resources, pages: refs.length };
}

/**
 * Category 4, raw half (see above). Pushes a problem for every raw difference outside the enumerated move and returns
 * the BEFORE html (masked) the after html must equal: on an error shell, without the one allowed preload.
 */
function moveRootLayoutRaw(beforeSet, beforeBody, afterSet, afterBody, beforeHtml, problems, liveReference) {
    const fail = (why) => { problems.push(`category 4 (raw): ${why}`); return beforeHtml; };
    const rb = rawParts(beforeSet, beforeBody), ra = rawParts(afterSet, afterBody);
    const before = movedResources(resolveFlight(rb.rows), "before"), after = movedResources(resolveFlight(ra.rows), "after");
    if (!before || !after) return fail("the payload does not have the enumerated shape");
    const href = unraw(before.link?.[3]?.href);
    if (typeof href !== "string" || !href.startsWith("/_next/static/")) return fail("the before root stylesheet has no /_next/static href");
    if (canon(before.g1) !== canon([before.link])) return fail("the before G[1] is not the root stylesheet");
    const htmlB = splitFlight(beforeBody).html, htmlA = splitFlight(afterBody).html;
    // § 18: the [siteId] resources against the LIVE document (shape from the before side, names from the after side).
    const res = after.segRes;
    if (!Array.isArray(res) || !Array.isArray(before.scripts) || res.length !== 1 + before.scripts.length
        || !isElement(res[0], "link") || !res.slice(1).every((x) => isElement(x, "script"))) {
        return fail(`the [siteId] resources are not one stylesheet and ${before.scripts?.length} script(s), the before shape`);
    }
    const liveHref = unraw(res[0][3].href);
    if (htmlA.startsWith(ERROR_SHELL)) {
        // A shell's head loads no stylesheet and none of the [siteId] scripts: its resources must equal, element for
        // element, those of the live 200 pages of the same build (`liveSiteIdReference`), fail closed.
        if (!liveReference) return fail("a __next_error__ shell is checked without a live 200 reference");
        if (liveReference.kind !== "resources") return fail(liveReference.problem);
        if (canon(res) !== canon(liveReference.resources)) return fail("the shell's [siteId] resources are not the live 200 pages' [siteId] resources");
    } else {
        const why = liveHeadProblem(res, htmlA);
        if (why) return fail(why);
    }
    if (canon(after.notFoundRes) !== canon([res[0]])) return fail("the root 404 boundary does not link the live [siteId] stylesheet");
    const rootScript = unraw(before.script?.[3]?.src);
    if (!headScripts(htmlB).includes(rootScript) || !headScripts(htmlA).includes(rootScript)) return fail(`the removed root-layout script ${rootScript} is not in the document head on both sides`);
    const sheetsB = headStylesheets(htmlB), sheetsA = headStylesheets(htmlA);
    if (canon(sheetsB) !== canon(sheetsA) || sheetsB.some((h) => h !== href) || sheetsA.some((h) => h !== liveHref)) return fail(`the head stylesheets differ or are not the payload stylesheet (before ${JSON.stringify(sheetsB)} vs ${href}, after ${JSON.stringify(sheetsA)} vs ${liveHref})`);
    // The error-shell preload: identified by the raw response, never by a URL.
    const pb = stylePreloads(htmlB), pa = stylePreloads(htmlA);
    const missing = [...pb];
    for (const h of pa) { const i = missing.indexOf(h); if (i < 0) return fail(`a style preload appeared: ${h}`); missing.splice(i, 1); }
    if (missing.length === 0) return beforeHtml;
    const shell = htmlB.startsWith(ERROR_SHELL) && htmlA.startsWith(ERROR_SHELL);
    if (!shell) return fail("a style preload is missing on a page that is not a __next_error__ shell");
    if (missing.length !== 1 || missing[0] !== href) return fail(`the shell misses ${JSON.stringify(missing)}, not exactly one preload of ${href}`);
    // Remove that preload from the masked before html: the k-th masked style preload, k = its position in the raw list.
    const k = pb.indexOf(href);
    const masked = STYLE_PRELOAD("/_next/static/<asset>");
    const pieces = beforeHtml.split(masked);
    if (pieces.length !== pb.length + 1) return fail("the masked shell's preloads do not match the raw ones");
    return [...pieces.slice(0, k + 1).join(masked), pieces.slice(k + 1).join(masked)].join("");
}

/**
 * Checks one URL: after removing every listed difference from the AFTER side, its canonical body must equal BEFORE's.
 * @returns {string[]} problems; empty = the differences are exactly the listed ones.
 */
export function checkExpected(beforeSet, beforeBody, afterSet, afterBody, expected = [], liveReference = undefined) {
    const problems = [];
    const b = canonicalParts(beforeSet, beforeBody);
    const a = canonicalParts(afterSet, afterBody);
    const moves = expected.filter((x) => x.category === 4);
    if (moves.length > 1) problems.push("category 4 listed more than once");
    if (moves.some((m) => !hasExactKeys(m, ["category", "row", "lang"]))) problems.push("a category-4 entry holds a field other than category, row, lang");
    const beforeHtml = moves.length ? moveRootLayoutRaw(beforeSet, beforeBody, afterSet, afterBody, b.html, problems, liveReference) : b.html;
    let html = a.html;
    const textual = expected.filter((x) => x.category === 1 || x.category === 3);
    for (const e of textual) {
        if (e.after === undefined) continue;
        if (!html.includes(e.after)) problems.push(`listed category-${e.category} difference does not occur: ${JSON.stringify(e.after).slice(0, 120)}`);
        html = html.split(e.after).join(e.before);
    }
    // The payload form of a listed text change: replaced back in the after rows (as strings) before any comparison.
    let replacedRows = a.rows;
    for (const e of textual) {
        if (e.flightAfter === undefined) continue;
        if (!replacedRows.some((row) => row.includes(e.flightAfter))) problems.push(`listed category-${e.category} payload difference does not occur: ${JSON.stringify(e.flightAfter).slice(0, 120)}`);
        replacedRows = replacedRows.map((row) => row.split(e.flightAfter).join(e.flightBefore));
    }
    if (html !== beforeHtml) problems.push("the HTML outside the flight payload differs beyond the listed differences");
    // The payload: both sides resolved (`resolveFlight`), then each listed category-2 prop removed from the AFTER tree
    // where it has exactly `value`, and a changed prop (`beforeValue`, LOCALE-1B) from the BEFORE tree where it has
    // exactly that value; then the two trees must be equal.
    const props = expected.filter((x) => x.category === 2);
    const changed = props.filter((x) => Object.hasOwn(x, "beforeValue"));
    let treeB = resolveFlight(b.rows);
    let treeA = resolveFlight(replacedRows);
    if (moves.length) treeB = moveRootLayout(treeB, moves[0].lang, problems) ?? treeB;
    const hitsPer = props.map(() => ({ n: 0 }));
    const beforeHits = changed.map(() => ({ n: 0 }));
    props.forEach((e, i) => { treeA = stripProp(treeA, e.element, e.prop, e.value, hitsPer[i]); });
    changed.forEach((e, i) => { treeB = stripProp(treeB, e.element, e.prop, e.beforeValue, beforeHits[i]); });
    props.forEach((e, i) => { if (hitsPer[i].n === 0) problems.push(`listed category-2 difference does not occur: ${e.element} prop ${e.prop}`); });
    changed.forEach((e, i) => { if (beforeHits[i].n === 0) problems.push(`listed category-2 before value does not occur: ${e.element} prop ${e.prop}`); });
    const d = firstDifference(treeB, treeA);
    if (d) problems.push(`flight payload differs beyond the listed differences at ${d.path}: before ${d.before} after ${d.after}`);
    return problems;
}

/**
 * The listed differences of one URL from an `expected-diff.json` document, with each category-2 `valueRef` replaced by
 * its value from the document's `propValues`. A URL the file does not list → an error (every URL must be listed).
 */
export function expectedFor(doc, tenant, urlPath) {
    const list = doc.fixtures?.[tenant]?.[urlPath];
    if (!Array.isArray(list)) throw new Error(`expected-diff.json lists no entry for ${tenant} ${urlPath}`);
    const ref = (name) => {
        if (!Object.hasOwn(doc.propValues ?? {}, name)) throw new Error(`unknown valueRef ${name}`);
        return doc.propValues[name];
    };
    return list.map((e) => {
        if (e.category !== 2) return e;
        const out = { ...e };
        if (e.valueRef !== undefined) out.value = ref(e.valueRef);
        if (e.beforeValueRef !== undefined) out.beforeValue = ref(e.beforeValueRef);   // LOCALE-1B: a changed prop
        return out;
    });
}
