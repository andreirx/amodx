// HYDRATION-1: forward-derive EXPECTED data only, never transform the candidate or widen a mask.
// Users: CM1 identity and locale-1 historical comparisons in contract.test.mjs. The historical captures stay intact.
// Exact delta: fill the existing empty share wrapper, add its canonical `url` prop, and normalize only
// the root `url` of json-ld-schema to that same captured canonical. No other JSON-LD field moves.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCaptures, splitFlight } from "./cm1-byte-identity.mjs";

const template = readFileSync(new URL("./hydration-1-share.html", import.meta.url), "utf8").trimEnd();
const english = { shareLabel: "Share:", shareOnX: "Share on X", shareOnLinkedIn: "Share on LinkedIn", shareOnFacebook: "Share on Facebook", shareByEmail: "Share via Email", shareCopyLink: "Copy Link" };
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]);

/** Frozen HTML expectation, not a render of the implementation under test. */
export function expectedShareHtml({ title, url, strings = english }) {
    const values = { ...strings, title: encodeURIComponent(title), url: encodeURIComponent(url) };
    return template.replace(/__HYDRATION1_(\w+)__/g, (_m, key) => {
        assert.equal(typeof values[key], "string", `missing share expectation: ${key}`);
        return escape(values[key]);
    });
}

export function deriveHydration1ExpectedBody(body, clientModules) {
    const { html, flight } = splitFlight(body);
    const canonical = () => {
        const links = [...html.matchAll(/<link rel="canonical" href="([^"]+)"\s*\/>/g)];
        assert.equal(links.length, 1, "a sharing/JSON-LD page must have exactly one canonical");
        const url = links[0][1].replaceAll("&amp;", "&");
        assert.ok(url.startsWith("https://"), "expected a public canonical address");
        return url;
    };
    let schemaChanged = false;
    const refs = new Set([...flight.matchAll(/^([a-f0-9]+):I\[(\d+),/gm)]
        .filter((m) => clientModules[m[2]] === "[project]/renderer/src/components/SocialShare.tsx")
        .map((m) => `$L${m[1]}`));
    let share = null;
    let wrapperClass;
    const visit = (node, parent) => {
        if (node === null || typeof node !== "object") return;
        if (Array.isArray(node) && node[0] === "$" && node[3]?.id === "json-ld-schema" && node[3]?.type === "application/ld+json") {
            const raw = node[3].dangerouslySetInnerHTML.__html;
            const schema = JSON.parse(raw);
            const url = canonical();
            const parsed = new URL(schema.url);
            assert.equal(parsed.pathname === "/" && parsed.searchParams.size === 0 ? parsed.origin : parsed.href, url,
                "JSON-LD url must be an alternate spelling of the captured canonical");
            if (schema.url !== url) {
                assert.equal(schemaChanged, false, "expected at most one json-ld-schema change");
                assert.equal(JSON.stringify(schema), raw, "expected compact recorded JSON-LD");
                schema.url = url;
                schemaChanged = true;
                node[3].dangerouslySetInnerHTML.__html = JSON.stringify(schema);
            }
            return;
        }
        if (Array.isArray(node) && node[0] === "$" && refs.has(node[1])) {
            assert.equal(share, null, "expected at most one share block per captured page");
            const props = node[3];
            assert.deepEqual(Object.keys(props), Object.hasOwn(props, "strings") ? ["title", "strings"] : ["title"]);
            const url = canonical();
            share = { ...props, url };
            assert.equal(parent?.[1], "div", "share parent must be its existing wrapper");
            wrapperClass = parent[3].className;
            node[3] = { title: props.title, url, ...(Object.hasOwn(props, "strings") ? { strings: props.strings } : {}) };
            return;
        }
        if (Array.isArray(node)) node.forEach((value) => visit(value, node));
        else Object.values(node).forEach((value) => visit(value, parent));
    };
    const rows = flight.split("\n").map((row) => {
        const m = /^([a-f0-9]+:)([\[{].*)$/.exec(row);
        if (!m) return row; // imports, text rows, error rows and scalar rows stay byte-identical
        let node;
        try { node = JSON.parse(m[2]); } catch { return row; }
        const before = JSON.stringify(node);
        visit(node, null);
        return JSON.stringify(node) === before ? row : m[1] + JSON.stringify(node);
    });
    if (share === null && !schemaChanged) return body;
    let expectedHtml = html;
    if (share !== null) {
        const empty = `<div class="${escape(wrapperClass)}"></div>`;
        assert.equal(html.split(empty).length - 1, 1, "expected exactly one empty share wrapper");
        expectedHtml = expectedHtml.replace(empty, `<div class="${escape(wrapperClass)}">${expectedShareHtml(share)}</div>`);
    }
    // Only stream cuts change in this derived data; the existing CM1 canonicalisation already joins them.
    const payload = JSON.stringify(rows.join("\n")).replaceAll("<", "\\u003c");
    return `${expectedHtml}<script>self.__next_f.push([1,${payload}])</script>`;
}

export async function readHydration1ExpectedCaptures(dir) {
    const set = await readCaptures(dir);
    return { ...set, captures: set.captures.map((c) => ({ ...c, body: deriveHydration1ExpectedBody(c.body, set.clientModules) })) };
}
