import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import inventory from "../serving-contract/landing-1-capture-lines.json";
import { deriveLanding1Expected, readLanding1ExpectedCaptures } from "../serving-contract/landing-1-expected.mjs";
import { readHydration1ExpectedCaptures } from "../serving-contract/hydration-1-expected.mjs";
import { maskBody, splitFlight } from "../serving-contract/cm1-byte-identity.mjs";
import { checkExpected } from "../serving-contract/locale-1/proof.mjs";

const root = fileURLToPath(new URL("../serving-contract/", import.meta.url));
const sets = ["cm1-byte-identity/baseline", "cm1-byte-identity/control-de4ad52", ...["cdl-2", "variant-gallery-1", "theme-1", "quote-1", "1e"].map((s) => `locale-1/${s}/before`), "locale-1/1e/before-404"];
const classes = {
    "site-navbar": "border-b bg-background/80 backdrop-blur",
    "site-footer": "border-t py-12 bg-muted",
    "site-top-bar": "bg-primary text-primary-foreground text-xs py-2 px-4",
    "site-commerce-bar": "hidden md:block bg-background/80 backdrop-blur border-b text-sm",
};

describe("LANDING-1 — expected-only serving data (operator-run, no recapture)", () => {
    it("A1: enumerates every affected historical capture line and class addition; unchanged captures stay byte-identical", async () => {
        const actual = [];
        for (const set of sets) {
            const before = await readHydration1ExpectedCaptures(root + set);
            const after = await readLanding1ExpectedCaptures(root + set);
            const index = JSON.parse(readFileSync(root + set + "/index.json", "utf8"));
            for (let i = 0; i < before.captures.length; i++) {
                const b = before.captures[i];
                const a = after.captures[i];
                const { body, additions } = deriveLanding1Expected(b.body);
                expect(a).toEqual({ ...b, body }); // no status, Content-Type, address or metadata change
                if (Object.keys(additions).length === 0) expect(a.body).toBe(b.body);
                else {
                    // Reverse ONLY these literal additions: nothing else changes in HTML or decoded flight rows.
                    const undo = (s: string) => s.replace(/ site-(?:top-bar|commerce-bar|navbar|footer)(?="|\\")/g, "");
                    expect(undo(splitFlight(a.body).html)).toBe(splitFlight(b.body).html);
                    expect(undo(splitFlight(a.body).flight)).toBe(splitFlight(b.body).flight);
                }
                const file = index.captures[i].body;
                const raw = readFileSync(root + set + "/" + file, "utf8");
                const sourceAttributeLines: Record<string, number[]> = {};
                for (const [marker, oldClass] of Object.entries(classes)) {
                    if (Object.keys(additions).some((k) => k.startsWith(marker + ":"))) {
                        sourceAttributeLines[marker] = raw.split("\n").flatMap((line, j) => line.includes(oldClass) ? [j + 1] : []);
                        expect(sourceAttributeLines[marker].length).toBeGreaterThan(0);
                    }
                }
                actual.push({ file: set + "/" + file, tenant: b.tenant, path: b.path, sourceAttributeLines, additions });
            }
        }
        expect(actual).toEqual(inventory);
        expect(actual.filter((c) => Object.keys(c.additions).length > 0)).toHaveLength(699);
        expect(actual.filter((c) => Object.keys(c.additions).length === 0)).toHaveLength(145);
    });
    it("A1: both comparison families still report a missing marker, a changed page byte and a changed footer payload class", async () => {
        const set = await readLanding1ExpectedCaptures(root + "locale-1/cdl-2/before");
        const capture = set.captures.find((c: any) => c.tenant === "content" && c.path === "/about")!;
        const body = capture.body;
        expect(checkExpected(set, body, set, body, [])).toEqual([]);
        for (const mutant of [
            body.replace('backdrop-blur site-navbar"', 'backdrop-blur"'),
            body.replace("cm1-content about", "WRONG TITLE"),
            body.replace(/\\"className\\":\\"border-t py-12 bg-muted\/30 site-footer\\"/, '\\"className\\":\\"border-t py-12 bg-muted/30 WRONG\\"'),
        ]) {
            expect(mutant).not.toBe(body);
            expect(maskBody(mutant, set).masked).not.toBe(maskBody(body, set).masked);
            expect(checkExpected(set, body, set, mutant, []).length).toBeGreaterThan(0);
        }
    });
    it("does not rewrite page nav/footer, similar class names or text; ambiguous chrome fails closed", () => {
        const body = '<main><nav class="block-nav">Nav</nav><footer class="block-footer">Footer</footer><p>border-t py-12 bg-muted</p></main>';
        expect(deriveLanding1Expected(body)).toEqual({ body, additions: {} });
        expect(() => deriveLanding1Expected('<footer class="border-t py-12 bg-muted"></footer>'.repeat(2))).toThrow(/ambiguous/);
    });
});
