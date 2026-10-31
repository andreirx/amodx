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
//       3  approved ledger change  — `{ category: 3, row: "<ledger row>", before, after }` (an html substring change).
//     The check removes each listed difference from the AFTER side and then demands byte equality with BEFORE; a
//     listed difference that does not occur on that URL also fails. No canonicalisation is added or widened.
import { fileURLToPath } from "node:url";
import { CM1_REQUESTS, maskBody } from "../cm1-byte-identity.mjs";
import { CM1, ITEMS, LOC1 } from "../fixtures.mjs";

export const LOC1_DIR = fileURLToPath(new URL("./", import.meta.url));

/** The RO copies answer the request list of their EN source tenant, on their own host (fixtures.mjs `LOC1`). */
export const LOC1_REQUESTS = Object.fromEntries(Object.entries(LOC1).map(([key, t]) => [
    key, CM1_REQUESTS[t.source].map((r) => ({ ...r, tenant: key, host: t.host })),
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
const fileOf = (p) => (p === "/" ? "root" : p.replace(/^\//, "").replace(/[^A-Za-z0-9.-]+/g, "_"));

function derivedRequests(t) {
    const own = ITEMS.filter((i) => i.PK === `TENANT#${t.id}`);
    const routes = own.filter((i) => i.SK.startsWith("ROUTE#")).map((i) => i.SK.slice("ROUTE#".length));
    const categories = own.filter((i) => i.SK.startsWith("CATEGORY#")).map((i) => `/category/${i.slug}`);
    const products = own.filter((i) => i.SK.startsWith("PRODUCT#") && i.status === "active").map((i) => `/product/${i.slug}`);
    const paths = [...routes, ...(categories.length || products.length ? ["/shop", ...categories, ...products] : [])];
    return paths.map((p) => ({ tenant: t.id, host: t.Domain, path: p, file: fileOf(p) }));
}

/** `{ <subject key>: <request list> }` for every en-US subject, in fixture order. */
export const EN_US_REQUESTS = Object.fromEntries(tenantItems
    .filter((t) => !Object.prototype.hasOwnProperty.call(t, "locale"))
    .map((t) => (cm1KeyOf[t.id] ? [cm1KeyOf[t.id], CM1_REQUESTS[cm1KeyOf[t.id]]] : [t.id, derivedRequests(t)])));

/** Per subject, the URLs whose visible text differs between two capture sets (status, structure or text). */
export function textMismatches(beforeSet, afterSet, key) {
    const out = [];
    for (const b of beforeSet.captures.filter((c) => c.tenant === key)) {
        const a = afterSet.captures.find((c) => c.tenant === key && c.path === b.path);
        if (!a) { out.push(`${b.path}: not captured`); continue; }
        if (a.status !== b.status) { out.push(`${b.path}: status ${b.status} → ${a.status}`); continue; }
        if (!b.contentType.startsWith("text/html")) continue;
        if (JSON.stringify(extractVisibleText(a.body)) !== JSON.stringify(extractVisibleText(b.body))) out.push(`${b.path}: visible text changed`);
    }
    return out;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
        if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
        return ENTITIES[e] ?? m;
    });
}
const collapse = (s) => s.replace(/\s+/g, " ").trim();

function attributesOf(raw) {
    const out = {};
    const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let m;
    while ((m = re.exec(raw))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
    return out;
}

/** CM1-A1 canonicalisation 4 (footer year): the same regex as `maskBody`; the digits become the text `{year}` (a
 *  token the extraction reads as text, where `maskBody`'s `<year>` would parse as a tag). HTML only. */
export function maskFooterYear(html) {
    return html.replace(/© <!-- -->\d{4}<!-- -->/g, "© <!-- -->{year}<!-- -->");
}

/** @returns {{ kind: string, text: string }[]} the § 8.5 extraction of one HTML body, in document order. */
export function extractVisibleText(body) {
    const html = maskFooterYear(body)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "");
    const items = [];
    let inTitle = false;
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
        if (m[4] !== undefined) {
            const text = collapse(decode(m[4]));
            if (text) items.push({ kind: inTitle ? "title" : "text", text });
            continue;
        }
        const closing = m[1] === "/";
        const tag = m[2].toLowerCase();
        if (tag === "title") { inTitle = !closing; continue; }
        if (closing) continue;
        const a = attributesOf(m[3]);
        if (tag === "meta") {
            const which = a.name === "description" ? "meta:description" : a.property === "og:title" ? "meta:og:title" : a.property === "og:description" ? "meta:og:description" : null;
            if (which && a.content !== undefined) items.push({ kind: which, text: collapse(a.content) });
            continue;
        }
        for (const name of ["alt", "title", "placeholder", "aria-label"]) {
            if (a[name] !== undefined && collapse(a[name])) items.push({ kind: `@${name}`, text: collapse(a[name]) });
        }
        const isButtonInput = tag === "input" && (a.type === "submit" || a.type === "button");
        if ((tag === "button" || isButtonInput) && a.value !== undefined && collapse(a.value)) items.push({ kind: "@value", text: collapse(a.value) });
    }
    return items;
}

/**
 * The item-by-item changes between two extractions of the SAME page structure: `[{ kind, from, to }]` in document
 * order. Throws when the two lists differ in length or in an item's kind (a structural change is never a text
 * change; it must fail loudly).
 */
export function textChanges(from, to) {
    if (from.length !== to.length) throw new Error(`extractions differ in length: ${from.length} → ${to.length}`);
    const out = [];
    from.forEach((item, i) => {
        if (item.kind !== to[i].kind) throw new Error(`item ${i}: kind ${item.kind} → ${to[i].kind}`);
        if (item.text !== to[i].text) out.push({ kind: item.kind, from: item.text, to: to[i].text });
    });
    return out;
}

const FLIGHT_MARK = "\n--- flight payload rows, sorted ---\n";

// ── Row renumbering (operator ruling LOCALE1A-ROW-IDS = A, 2026-10-31; packet § 6) ───────────────────────────────────
// A RULED WIDENING of the comparison, for the locale byte rows only (`loc1-diff-*`); the `cm1-identity-*` rows keep
// CM1-A1 exactly. Why: the RSC encoder numbers the outlined rows of some pages (catalog-mode category pages) in an order
// that varies between renders of one tree (build-1: 8 of 16 runs). What it ignores: row LABELS only — which number a
// row carries. Everything else is compared as written: every row's content, every object key, every non-model row,
// every reference and the row it points to, the set of rows (a dropped or added row differs), unreferenced rows.
//
// Method: start at the root row `0`; walk the row's references in textual order; each referenced row gets the next
// new id at its first encounter and is walked at once (depth first, textual order); every reference is rewritten; rows
// are emitted sorted by new id; rows never reached from the root follow, with the next ids, in input order.
//
// What a reference is — by its PLACE in the React Flight protocol, not by its spelling (review-2 R5):
//  - Only MODEL rows hold references: a labelled row whose body is JSON (`[`, `{`, `"`, a number, true/false/null).
//    Inside it, only string VALUES are references; an object KEY is data and is never rewritten.
//  - Non-model rows are kept exactly as written and are not scanned: text rows `<id>:T<len>,<text>`, error rows
//    `<id>:E{…}` (their digest/message is metadata), and the bare stream markers `<id>:X`, `x`, `R`, `r`, `C`.
//    Lines without a label (hint rows `:HL[…]`, text continuation lines) follow the labelled rows, in input order.
//  - A string value `"$" + <form> + <hex id> + (":" + <path>)*` is a row reference, for the React Flight forms that name
//    a row: "" (model row), "@" (promise), "L" (lazy), "F" (server reference), "Q" (Map), "W" (Set), "B" (Blob),
//    "K" (FormData), "i" (iterator). The path is kept as written. A reference to a missing row becomes
//    `"$<form>!<id><path>"`, so it can never equal a real row.
//  - Known non-references stay as written: the element marker `"$"`, escaped text `"$$…"`, symbols `"$S…"`,
//    `"$Infinity"`, `"$NaN"`, `"$-0"`/`"$-Infinity"`, `"$undefined"`, dates `"$D…"`, bigints `"$n…"`, and the CM1-A1
//    client identities `"$L[project]…"`.
//  - FAIL CLOSED: any other `$`-form, or a labelled row of any other kind, throws — the comparison cannot know what
//    its label means after relabelling, so it refuses rather than pass or fail by accident.
// All lines that carry one label are ONE row (a stream row is several lines: `<id>:X` start, chunks, `<id>:C` close);
// they are renumbered together and keep their order.
const VALUE_TOKEN = /"(?:[^"\\]|\\.)*"(\s*:)?/g;       // a JSON string token; group 1 set = it is an object key
const ROW_REFERENCE = /^\$([@LFQWBKi]?)([0-9a-f]+)((?::[^:]*)*)$/;
const NOT_A_REFERENCE = /^\$(?:$|\$|S|Infinity$|NaN$|-0$|-Infinity$|undefined$|D|n[0-9]|L\[project\])/;
const ROW_LABEL = /^([0-9a-f]+):/;

/** The kind of a labelled row body: "model" (JSON: scanned for references) or "literal" (kept as written). */
function rowKind(body) {
    if (/^T[0-9a-f]+,/.test(body) || /^E\{/.test(body) || /^[XxRrC]$/.test(body)) return "literal";
    if (/^[\[{"\-0-9]/.test(body) || /^(?:true|false|null)$/.test(body)) return "model";
    throw new Error(`renumberRows: unsupported RSC row kind ${JSON.stringify(body.slice(0, 40))} — refusing to compare`);
}

/** The row reference a string value names, or null when it is not one; throws on an unknown `$`-form. */
function referenceIn(value) {
    if (!value.startsWith("$")) return null;
    const ref = ROW_REFERENCE.exec(value);
    if (ref) return { form: ref[1], id: ref[2], path: ref[3] };
    if (NOT_A_REFERENCE.test(value)) return null;
    throw new Error(`renumberRows: unknown RSC string form ${JSON.stringify(value.slice(0, 40))} — refusing to compare`);
}

/** Calls `onValue(value, token)` for each string VALUE token of a model body, in textual order (keys are skipped). */
function eachValue(body, onValue) {
    for (const m of body.matchAll(VALUE_TOKEN)) if (m[1] === undefined) onValue(JSON.parse(m[0]));
}

export function renumberRows(rows) {
    const bodiesOf = new Map();      // label → the bodies of its lines, in input order
    const labelled = [];
    const unlabelled = [];
    for (const row of rows) {
        const m = ROW_LABEL.exec(row);
        if (!m) { unlabelled.push(row); continue; }
        if (!bodiesOf.has(m[1])) { bodiesOf.set(m[1], []); labelled.push(m[1]); }
        bodiesOf.get(m[1]).push(row.slice(m[1].length + 1));
    }
    const newId = new Map();
    let next = 0;
    const visit = (id) => {
        if (newId.has(id) || !bodiesOf.has(id)) return;
        newId.set(id, (next++).toString(16));
        for (const body of bodiesOf.get(id)) {
            if (rowKind(body) !== "model") continue;
            eachValue(body, (value) => { const ref = referenceIn(value); if (ref) visit(ref.id); });
        }
    };
    visit("0");
    for (const id of labelled) if (!newId.has(id)) newId.set(id, (next++).toString(16));
    const rewrite = (body) => (rowKind(body) !== "model" ? body : body.replace(VALUE_TOKEN, (token, key) => {
        if (key !== undefined) return token;
        const ref = referenceIn(JSON.parse(token));
        if (!ref) return token;
        return JSON.stringify(newId.has(ref.id) ? `$${ref.form}${newId.get(ref.id)}${ref.path}` : `$${ref.form}!${ref.id}${ref.path}`);
    }));
    return [
        ...labelled.map((id) => ({ id: parseInt(newId.get(id), 16), lines: bodiesOf.get(id).map((body) => `${newId.get(id)}:${rewrite(body)}`) }))
            .sort((a, b) => a.id - b.id).flatMap((x) => x.lines),
        ...unlabelled,
    ];
}

/** The two compared parts of one body: the HTML outside the payload (CM1-A1) and the payload rows (CM1-A1, then
 *  `renumberRows`). */
function canonicalParts(set, body) {
    const { masked } = maskBody(body, set);
    const at = masked.indexOf(FLIGHT_MARK);
    return at < 0 ? { html: masked, rows: [] } : { html: masked.slice(0, at), rows: renumberRows(masked.slice(at + FLIGHT_MARK.length).split("\n")) };
}
function parseRow(row) {
    const m = /^([0-9a-f]+):(.*)$/s.exec(row);
    if (!m) return null;
    try { return { id: m[1], value: JSON.parse(m[2]) }; } catch { return null; }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Removes `prop` (when it deep-equals `value`) from every element `["$", "$L<identity>", key, props]` in `node`. */
function stripProp(node, identity, prop, value, hits) {
    if (Array.isArray(node)) {
        if (node[0] === "$" && node[1] === `$L${identity}` && node[3] && typeof node[3] === "object" && Object.hasOwn(node[3], prop) && same(node[3][prop], value)) {
            const props = { ...node[3] };
            delete props[prop];
            hits.n += 1;
            return [node[0], node[1], node[2], stripProp(props, identity, prop, value, hits), ...node.slice(4)];
        }
        return node.map((child) => stripProp(child, identity, prop, value, hits));
    }
    if (node && typeof node === "object") {
        const out = {};
        for (const [k, v] of Object.entries(node)) out[k] = stripProp(v, identity, prop, value, hits);
        return out;
    }
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
    // Category 2: only the rows a listed difference touches are re-serialised (after the prop is removed) and compared
    // with the same-id BEFORE row, also re-serialised; every other row is compared as its exact canonical string.
    const props = expected.filter((x) => x.category === 2);
    const hitsPer = props.map(() => ({ n: 0 }));
    const touched = new Set();
    const rows = replacedRows.map((row) => {
        const parsed = parseRow(row);
        if (!parsed) return row;
        const before = hitsPer.reduce((n, h) => n + h.n, 0);
        let value = parsed.value;
        props.forEach((e, i) => { value = stripProp(value, e.element, e.prop, e.value, hitsPer[i]); });
        if (hitsPer.reduce((n, h) => n + h.n, 0) === before) return row;
        touched.add(parsed.id);
        return `${parsed.id}:${JSON.stringify(value)}`;
    });
    props.forEach((e, i) => { if (hitsPer[i].n === 0) problems.push(`listed category-2 difference does not occur: ${e.element} prop ${e.prop}`); });
    const beforeRows = b.rows.map((row) => {
        const p = parseRow(row);
        return p && touched.has(p.id) ? `${p.id}:${JSON.stringify(p.value)}` : row;
    }).sort();
    const afterRows = rows.sort();
    if (!same(beforeRows, afterRows)) {
        const onlyBefore = beforeRows.filter((r) => !afterRows.includes(r));
        const onlyAfter = afterRows.filter((r) => !beforeRows.includes(r));
        problems.push(`flight rows differ beyond the listed differences: ${onlyBefore.length} only before, ${onlyAfter.length} only after` +
            (onlyAfter[0] ? `; first only-after row: ${onlyAfter[0].slice(0, 300)}` : ""));
    }
    return problems;
}

/**
 * The listed differences of one URL from an `expected-diff.json` document, with each category-2 `valueRef` replaced by
 * its value from the document's `propValues`. A URL the file does not list → an error (every URL must be listed).
 */
export function expectedFor(doc, tenant, urlPath) {
    const list = doc.fixtures?.[tenant]?.[urlPath];
    if (!Array.isArray(list)) throw new Error(`expected-diff.json lists no entry for ${tenant} ${urlPath}`);
    return list.map((e) => {
        if (e.category !== 2 || e.valueRef === undefined) return e;
        if (!Object.hasOwn(doc.propValues ?? {}, e.valueRef)) throw new Error(`unknown valueRef ${e.valueRef}`);
        return { ...e, value: doc.propValues[e.valueRef] };
    });
}
