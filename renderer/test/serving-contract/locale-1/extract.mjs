// LOCALE-1 — the § 8.5 visible-text extraction (docs/slices/locale-1.md § 8.5), moved unchanged out of `proof.mjs` by
// locale-1d so a jsdom unit test can import it: this module imports nothing, while `proof.mjs` loads the fixtures and
// the capture module at import time, whose `new URL(…, import.meta.url)` does not resolve under vitest's jsdom
// environment. `proof.mjs` re-exports these three functions; every serving row uses them through it, as before.
// Users: `proof.mjs` (rows `loc1-*`, `cmrc-counties-1`), `renderer/test/unit/locale-1d-client.test.ts`.

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
