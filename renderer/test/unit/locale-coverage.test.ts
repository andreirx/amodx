import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SiteStringsSchema, CatalogStringsSchema, CommerceStringsSchema, PluralTextsSchema, LANGUAGE_PACKS, pluralCategoriesOf } from "@amodx/shared";

/**
 * LOCALE-1 coverage rule (docs/slices/locale-1.md § 16.2 item 5, ratified with LOCALE1-PROOF), for EVERY locale-1 slice
 * (named `locale-1a-coverage.test.ts` until locale-1b renamed it, operator ruling 2026-11-01): each slice commits
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
 *
 * LOCALE-1B (§ 16.2 item 6; packet rule 5): a COUNT key (a key whose schema type is the plural-texts object) needs, in
 * addition, a check for EACH plural category of EACH registered language — entry `<part>.<key>@<language>.<category>`,
 * the categories from `pluralCategoriesOf` (en: one, other; ro: one, few, other; a new pack adds its own). A capture
 * check for a category must name a listed item of that key whose `count` selects that category in the file's
 * language. Capture checks read the slice's `ro-expected.json` (language ro) and, from 1b on, `text-expected.json`
 * (the L-EN-CAT changes of the en-US catalog subjects, language en). An item without `part` (the 1a form) is a site item.
 */

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const LOC1 = path.join(REPO, "renderer/test/serving-contract/locale-1");

type Check = { test: string; case: string } | { capture: { row: string; fixture: string; path: string } };
type Part = "site" | "catalog" | "commerce";
type Coverage = { slice: string; allocatedKeys: Record<Part, string[]>; checks: Record<string, Check[]> };
type Expected = { fixtures: Record<string, { paths: Record<string, { key: string; part?: string; count?: number }[]> }> };
/** A slice's capture expectation files, each with the language of the texts it lists (`ro-expected.json`: ro). */
type ExpectationDocs = { language: string; doc: Expected }[];

const SHAPES = { site: SiteStringsSchema.shape, catalog: CatalogStringsSchema.shape, commerce: CommerceStringsSchema.shape } as Record<Part, Record<string, { unwrap: () => unknown }>>;
/** A count key: its schema type is the plural-texts object (§ 16.2 item 6). */
export const isCountKey = (part: Part, key: string) => SHAPES[part][key]?.unwrap() === PluralTextsSchema;

/** The problems of one slice's coverage document; empty = every allocated key (and every plural category of every
 *  count key, per registered language) has a valid check. */
export function coverageProblems(cov: Coverage, docs: ExpectationDocs, readFile: (p: string) => string | null): string[] {
    const problems: string[] = [];
    const checkOne = (entry: string, part: string, key: string, c: Check, category?: { language: string; name: string }) => {
        if ("test" in c) {
            const src = readFile(c.test);
            if (src === null) problems.push(`${entry}: test file ${c.test} does not exist`);
            else if (!src.includes(c.case)) problems.push(`${entry}: ${c.test} has no test "${c.case}"`);
            return;
        }
        const lists = docs.filter((d) => !category || d.language === category.language)
            .map((d) => ({ language: d.language, list: d.doc.fixtures?.[c.capture.fixture]?.paths?.[c.capture.path] }))
            .filter((x) => x.list);
        if (lists.length === 0) { problems.push(`${entry}: no expectation for ${c.capture.fixture} ${c.capture.path}`); return; }
        const items = lists.flatMap((x) => x.list!.filter((e) => e.key === key && (e.part ?? "site") === part).map((e) => ({ ...e, language: x.language })));
        if (items.length === 0) { problems.push(`${entry}: ${c.capture.fixture} ${c.capture.path} does not list the key`); return; }
        if (category && !items.some((e) => e.count !== undefined && new Intl.PluralRules(category.language).select(e.count) === category.name)) {
            problems.push(`${entry}: ${c.capture.fixture} ${c.capture.path} lists no count of category ${category.name}`);
        }
    };
    for (const [part, keys] of Object.entries(cov.allocatedKeys) as [Part, string[]][]) {
        for (const key of keys) {
            const entries: [string, { language: string; name: string } | undefined][] = [[`${part}.${key}`, undefined]];
            if (isCountKey(part, key)) {
                for (const language of Object.keys(LANGUAGE_PACKS)) {
                    for (const name of pluralCategoriesOf(language)) entries.push([`${part}.${key}@${language}.${name}`, { language, name }]);
                }
            }
            for (const [entry, category] of entries) {
                const checks = cov.checks[entry] ?? [];
                if (checks.length === 0) { problems.push(`${entry}: no check`); continue; }
                for (const c of checks) checkOne(entry, part, key, c, category);
            }
        }
    }
    return problems;
}

const slices = readdirSync(LOC1, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(path.join(LOC1, d.name, "coverage.json"))).map((d) => d.name);
const load = (slice: string) => {
    const cov: Coverage = JSON.parse(readFileSync(path.join(LOC1, slice, "coverage.json"), "utf8"));
    const docs: ExpectationDocs = [];
    for (const [file, language] of [["ro-expected.json", "ro"], ["text-expected.json", "en"]] as const) {
        const full = path.join(LOC1, slice, file);
        if (existsSync(full)) docs.push({ language, doc: JSON.parse(readFileSync(full, "utf8")) });
    }
    return { cov, docs };
};
const readRepoFile = (p: string) => (existsSync(path.join(REPO, p)) ? readFileSync(path.join(REPO, p), "utf8") : null);

describe("locale-1 coverage rule (§ 16.2 item 5)", () => {
    it("locale-1a and locale-1b have a coverage file", () => {
        expect(slices).toContain("1a");
        expect(slices).toContain("1b");
    });

    for (const slice of slices) {
        it(`slice ${slice}: every allocated key (and every plural category of every count key, per language) maps to at least one existing check`, () => {
            const { cov, docs } = load(slice);
            expect(coverageProblems(cov, docs, readRepoFile)).toEqual([]);
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
        // The commerce part is allocated only partly so far (its 77 existing keys go with locale-1d); an allocated
        // commerce key must still exist.
        const commerce = Object.keys(CommerceStringsSchema.shape);
        for (const slice of slices) expect(load(slice).cov.allocatedKeys.commerce.filter((k) => !commerce.includes(k))).toEqual([]);
    });

    it("the check goes red: a key without an entry, a missing test title, a capture path that does not list the key", () => {
        const { cov, docs } = load("1a");
        const noEntry = { ...cov, checks: { ...cov.checks, "site.navContact": [] } };
        expect(coverageProblems(noEntry, docs, readRepoFile)).toEqual(["site.navContact: no check"]);
        const badCase = { ...cov, checks: { ...cov.checks, "site.formErrorShort": [{ test: "renderer/test/unit/locale-1a-client.test.ts", case: "no such test title" }] } };
        expect(coverageProblems(badCase, docs, readRepoFile)).toHaveLength(1);
        const badCapture = { ...cov, checks: { ...cov.checks, "site.formErrorShort": [{ capture: { row: "loc1-ro-content", fixture: "roContent", path: "/" } }] } };
        expect(coverageProblems(badCapture, docs, readRepoFile)).toEqual(["site.formErrorShort: roContent / does not list the key"]);
    });

    it("LOCALE-1B: the check goes red for a count key: a plural category without an entry, and a capture whose count is of another category", () => {
        const { cov, docs } = load("1b");
        const { "catalog.facetsCount@ro.few": _few, ...rest } = cov.checks;
        expect(coverageProblems({ ...cov, checks: rest }, docs, readRepoFile)).toEqual(["catalog.facetsCount@ro.few: no check"]);
        // roCatalog /shop lists facetsCount with count 42 (ro: "other"), so it cannot cover ro.few.
        const wrong = { ...cov, checks: { ...cov.checks, "catalog.facetsCount@ro.few": [{ capture: { row: "loc1-ro-catalog", fixture: "roCatalog", path: "/shop" } }] } };
        expect(coverageProblems(wrong, docs, readRepoFile)).toEqual(["catalog.facetsCount@ro.few: roCatalog /shop lists no count of category few"]);
        // A registered third language adds its categories to the rule without a code change.
        LANGUAGE_PACKS.pl = { language: "pl", name: "Polish (test only)", defaultLocale: "pl-PL", commerce: {}, catalog: {}, site: {} };
        try {
            expect(coverageProblems(cov, docs, readRepoFile)).toContain("catalog.facetsCount@pl.many: no check");
        } finally {
            delete LANGUAGE_PACKS.pl;
        }
    });
});
