import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SiteStringsSchema, CatalogStringsSchema } from "@amodx/shared";

/**
 * LOCALE-1 coverage rule (docs/slices/locale-1.md § 16.2 item 5, ratified with LOCALE1-PROOF): each slice commits
 * `renderer/test/serving-contract/locale-1/<slice>/coverage.json` mapping every key it allocates to at least one check,
 * and THIS check fails when an allocated key has none. Runs in the renderer unit suite (a common gate).
 *
 * A check is either
 *   { test: "<repo-relative file>", case: "<substring of a test title in that file>" } — the file must exist and
 *     contain the substring; or
 *   { capture: { row, fixture, path } } — the slice's `ro-expected.json` must list that key at that fixture and path
 *     (the serving row then asserts the captured text).
 * Plus: every key of the site and catalog schemas is allocated to some slice, and no slice allocates a key the schema
 * does not have (a typo would otherwise count as covered).
 */

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const LOC1 = path.join(REPO, "renderer/test/serving-contract/locale-1");

type Check = { test: string; case: string } | { capture: { row: string; fixture: string; path: string } };
type Coverage = { slice: string; allocatedKeys: Record<"site" | "catalog" | "commerce", string[]>; checks: Record<string, Check[]> };
type RoExpected = { fixtures: Record<string, { paths: Record<string, { key: string }[]> }> };

/** The problems of one slice's coverage document; empty = every allocated key has a valid check. */
export function coverageProblems(cov: Coverage, roExpected: RoExpected | null, readFile: (p: string) => string | null): string[] {
    const problems: string[] = [];
    for (const [part, keys] of Object.entries(cov.allocatedKeys)) {
        for (const key of keys) {
            const checks = cov.checks[`${part}.${key}`] ?? [];
            if (checks.length === 0) { problems.push(`${part}.${key}: no check`); continue; }
            for (const c of checks) {
                if ("test" in c) {
                    const src = readFile(c.test);
                    if (src === null) problems.push(`${part}.${key}: test file ${c.test} does not exist`);
                    else if (!src.includes(c.case)) problems.push(`${part}.${key}: ${c.test} has no test "${c.case}"`);
                } else {
                    const list = roExpected?.fixtures?.[c.capture.fixture]?.paths?.[c.capture.path];
                    if (!list) problems.push(`${part}.${key}: no expectation for ${c.capture.fixture} ${c.capture.path}`);
                    else if (!list.some((e) => e.key === key)) problems.push(`${part}.${key}: ${c.capture.fixture} ${c.capture.path} does not list the key`);
                }
            }
        }
    }
    return problems;
}

const slices = readdirSync(LOC1, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(path.join(LOC1, d.name, "coverage.json"))).map((d) => d.name);
const load = (slice: string) => {
    const cov: Coverage = JSON.parse(readFileSync(path.join(LOC1, slice, "coverage.json"), "utf8"));
    const roFile = path.join(LOC1, slice, "ro-expected.json");
    const ro: RoExpected | null = existsSync(roFile) ? JSON.parse(readFileSync(roFile, "utf8")) : null;
    return { cov, ro };
};
const readRepoFile = (p: string) => (existsSync(path.join(REPO, p)) ? readFileSync(path.join(REPO, p), "utf8") : null);

describe("locale-1 coverage rule (§ 16.2 item 5)", () => {
    it("locale-1a has a coverage file", () => {
        expect(slices).toContain("1a");
    });

    for (const slice of slices) {
        it(`slice ${slice}: every allocated key maps to at least one existing check`, () => {
            const { cov, ro } = load(slice);
            expect(coverageProblems(cov, ro, readRepoFile)).toEqual([]);
        });
    }

    it("every site and catalog schema key is allocated to some slice, and every allocated key exists in its schema", () => {
        const allocated = { site: new Set<string>(), catalog: new Set<string>() };
        for (const slice of slices) {
            const { cov } = load(slice);
            for (const k of cov.allocatedKeys.site) allocated.site.add(k);
            for (const k of cov.allocatedKeys.catalog) allocated.catalog.add(k);
        }
        const site = Object.keys(SiteStringsSchema.shape), catalog = Object.keys(CatalogStringsSchema.shape);
        expect(site.filter((k) => !allocated.site.has(k))).toEqual([]);
        expect(catalog.filter((k) => !allocated.catalog.has(k))).toEqual([]);
        expect([...allocated.site].filter((k) => !site.includes(k))).toEqual([]);
        expect([...allocated.catalog].filter((k) => !catalog.includes(k))).toEqual([]);
    });

    it("the check goes red: a key without an entry, a missing test title, a capture path that does not list the key", () => {
        const { cov, ro } = load("1a");
        const noEntry = { ...cov, checks: { ...cov.checks, "site.navContact": [] } };
        expect(coverageProblems(noEntry, ro, readRepoFile)).toEqual(["site.navContact: no check"]);
        const badCase = { ...cov, checks: { ...cov.checks, "site.formErrorShort": [{ test: "renderer/test/unit/locale-1a-client.test.ts", case: "no such test title" }] } };
        expect(coverageProblems(badCase, ro, readRepoFile)).toHaveLength(1);
        const badCapture = { ...cov, checks: { ...cov.checks, "site.formErrorShort": [{ capture: { row: "loc1-ro-content", fixture: "roContent", path: "/" } }] } };
        expect(coverageProblems(badCapture, ro, readRepoFile)).toEqual(["site.formErrorShort: roContent / does not list the key"]);
    });
});
