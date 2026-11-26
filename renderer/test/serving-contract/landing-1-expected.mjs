// LANDING-1 — forward-derived EXPECTED capture data, not a recapture or a candidate mask.
// Historical files remain intact. Only exact, recorded chrome-root class attributes change.
import assert from "node:assert/strict";
import { splitFlight } from "./cm1-byte-identity.mjs";
import { readHydration1ExpectedCaptures } from "./hydration-1-expected.mjs";

// Frozen expectations, deliberately NOT imported from production code.
const ROOTS = [
    ["div", "bg-primary text-primary-foreground text-xs py-2 px-4", "site-top-bar"],
    ["div", "hidden md:block bg-background/80 backdrop-blur border-b text-sm", "site-commerce-bar"],
    ["nav", "border-b bg-background/80 backdrop-blur", "site-navbar"],
    ["footer", "border-t py-12 bg-muted/30", "site-footer"],
    ["footer", "border-t py-12 bg-muted", "site-footer"],
];

export function deriveLanding1Expected(body) {
    const { html, flight } = splitFlight(body);
    const additions = {};
    const count = (marker, kind) => { const key = `${marker}:${kind}`; additions[key] = (additions[key] ?? 0) + 1; };
    let expectedHtml = html;
    for (const [tag, classes, marker] of ROOTS) {
        expectedHtml = expectedHtml.replaceAll(`<${tag} class="${classes}"`, () => {
            count(marker, "html");
            return `<${tag} class="${classes} ${marker}"`;
        });
    }
    function visit(node) {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node) && node[0] === "$") {
            for (const [tag, classes, marker] of ROOTS) {
                if (node[1] === tag && node[3]?.className === classes) {
                    node[3].className += ` ${marker}`;
                    count(marker, "flight");
                }
            }
        }
        for (const value of Object.values(node)) visit(value);
    }
    const rows = flight.split("\n").map((row) => {
        const m = /^([a-f0-9]+:)([\[{].*)$/.exec(row);
        if (!m) return row;
        let node;
        try { node = JSON.parse(m[2]); } catch { return row; }
        const before = JSON.stringify(node);
        visit(node);
        return before === JSON.stringify(node) ? row : m[1] + JSON.stringify(node);
    });
    // A recorded chrome part is unique per document. Do not silently rewrite duplicated lookalikes.
    for (const [where, n] of Object.entries(additions)) assert.equal(n, 1, `ambiguous recorded chrome root: ${where}`);
    if (Object.keys(additions).length === 0) return { body, additions };
    const payload = JSON.stringify(rows.join("\n")).replaceAll("<", "\\u003c");
    return { body: `${expectedHtml}${flight ? `<script>self.__next_f.push([1,${payload}])</script>` : ""}`, additions };
}

export async function readLanding1ExpectedCaptures(dir) {
    const set = await readHydration1ExpectedCaptures(dir);
    return { ...set, captures: set.captures.map((c) => ({ ...c, body: deriveLanding1Expected(c.body).body })) };
}
