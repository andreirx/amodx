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
//     The check removes each listed difference from the AFTER side and then demands byte equality with BEFORE; a
//     listed difference that does not occur on that URL also fails. No canonicalisation is added or widened.
import { fileURLToPath } from "node:url";
import { fillTemplate, selectPluralText } from "@amodx/shared";
import { CM1_REQUESTS, maskBody } from "../cm1-byte-identity.mjs";
import { CM1, ITEMS, LOC1 } from "../fixtures.mjs";

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

/**
 * Checks one URL: after removing every listed difference from the AFTER side, its canonical body must equal BEFORE's.
 * @returns {string[]} problems; empty = the differences are exactly the listed ones.
 */
export function checkExpected(beforeSet, beforeBody, afterSet, afterBody, expected = []) {
    const problems = [];
    const b = canonicalParts(beforeSet, beforeBody);
    const a = canonicalParts(afterSet, afterBody);
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
    if (html !== b.html) problems.push("the HTML outside the flight payload differs beyond the listed differences");
    // The payload: both sides resolved (`resolveFlight`), then each listed category-2 prop removed from the AFTER tree
    // where it has exactly `value`, and a changed prop (`beforeValue`, LOCALE-1B) from the BEFORE tree where it has
    // exactly that value; then the two trees must be equal.
    const props = expected.filter((x) => x.category === 2);
    const changed = props.filter((x) => Object.hasOwn(x, "beforeValue"));
    let treeB = resolveFlight(b.rows);
    let treeA = resolveFlight(replacedRows);
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
