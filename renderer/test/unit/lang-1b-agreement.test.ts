import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * LANG-1B (docs/slices/lang-1.md § 5.1, § 7.1; row L1B-LANG-AGREEMENT) — the two readers of the stored language list
 * decide the same language for every stored value, malformed ones included:
 *  - the middleware: its host gate reads the tenant item with the LOW-LEVEL client (AttributeValues), converts the
 *    projected `languages` to the plain form and parses it; the production branch puts the language into the segment;
 *  - the renderer: `getTenantConfig` reads with the DocumentClient (plain values), `mapTenant` parses `languages`, and a
 *    page's language is `pageLanguageOf(<its address>, config.languages)`.
 * The REAL middleware and the REAL `getTenantConfig` run; only the two DynamoDB clients are replaced, each answering the
 * same stored item in its own wire form (the AttributeValue form is made by the SDK's own `marshall`).
 */

const store = vi.hoisted(() => ({ items: new Map<string, Record<string, unknown>>(), failGate: new Set<string>() }));

vi.mock("@aws-sdk/client-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    const { marshall } = await import("@aws-sdk/util-dynamodb");
    return {
        ...real,
        // The middleware gate's low-level client: answers the stored item for the queried host, in AttributeValues.
        DynamoDBClient: class {
            async send(cmd: any) {
                const host = cmd.input?.ExpressionAttributeValues?.[":d"]?.S;
                if (store.failGate.has(host)) throw new Error("injected gate failure"); // → verdict `unknown`
                const item = store.items.get(host);
                return item ? { Items: [marshall(item, { removeUndefinedValues: true })], Count: 1 } : { Items: [], Count: 0 };
            }
        },
    };
});
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    return {
        ...real,
        // The renderer's DocumentClient: the same stored item, plain.
        DynamoDBDocumentClient: {
            from: () => ({
                send: async (cmd: any) => {
                    if (cmd.constructor.name !== "QueryCommand") return {};
                    const item = store.items.get(cmd.input?.ExpressionAttributeValues?.[":d"]);
                    return { Items: item ? [structuredClone(item)] : [] };
                },
            }),
        },
    };
});

import { NextRequest } from "next/server";
import { pageLanguageOf, type PageLanguage } from "@amodx/shared";
import { middleware } from "../../middleware";
import { getTenantConfig } from "@/lib/dynamo";
import { parseSiteSegment } from "@/lib/site-segment";

beforeEach(() => {
    process.env.TABLE_NAME = "lang-1b-agreement";
    process.env.AWS_ACCESS_KEY_ID = "unit";
    process.env.AWS_SECRET_ACCESS_KEY = "unit";
    store.items.clear();
    store.failGate.clear();
});

/** The stored `languages` values of the table (the plain, stored form); `undefined` = the attribute is absent. */
const STORED: [string, unknown][] = [
    ["a list", ["ro"]],
    ["two languages", ["de", "ro"]],
    ["a string", "ro"],
    ["null, upper case, a repeat and a number", [null, "RO", "ro", "ro", 5]],
    ["a nested list and a map entry", [["ro"], { ro: "ro" }, "fr"]],
    ["a map", { ro: "ro" }],
    ["a string set", new Set(["ro", "de"])],
    ["a boolean", true],
    ["an empty list", []],
    ["absent", undefined],
];
const PATHS = [
    "/ro/x", "/ro", "/de/y", "/fr", "/en/z", "/about", "/", "/RO/x", "/r%6F/x",
    // Revision 1 (R-LANG1B-01): an encoded slash (the page body keeps it encoded: not a language), a double-encoded one.
    "/ro%2Fdespre", "/ro%2fdespre", "/ro%252Fdespre",
    // Revision 1 (R-LANG1B-02): the four route handlers at the root, and content paths that end with their names.
    "/sitemap.xml", "/robots.txt", "/llms.txt", "/openai-feed",
    "/ro/sitemap.xml", "/ro/robots.txt", "/ro/llms.txt", "/ro/openai-feed", "/de/openai-feed",
];

/**
 * The address as the page BODY receives it — the oracle of this test, stated from the OBSERVED behaviour of Next 16.4.6
 * (revision 1 probe, `next start` and the OpenNext bundle; docs/slices/lang-1.md Appendix F), independent of the code under
 * test: each path segment decoded once, except that an encoded slash stays `%2F` (upper case) inside its segment.
 */
const pageAddress = (path: string) => path.split("/").map((seg) => seg.split(/%2F/i).map((piece) => decodeURIComponent(piece)).join("%2F")).join("/");

describe("L1B-LANG-AGREEMENT — the middleware's segment language equals pageLanguageOf over mapTenant output", () => {
    STORED.forEach(([name, languages], i) => {
        it(`L1B-LANG-AGREEMENT: stored languages = ${name}`, async () => {
            const host = `t${i}.agreement.test`;
            store.items.set(host, {
                PK: "SYSTEM", SK: `TENANT#t${i}`, id: `t${i}`, Domain: host, domain: host, locale: "en-US",
                ...(languages === undefined ? {} : { languages }),
            });
            const config = await getTenantConfig(host);
            expect(config).not.toBeNull();
            for (const path of PATHS) {
                const res = await middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
                const rewrite = res.headers.get("x-middleware-rewrite");
                expect(rewrite, `${name} ${path}: a rewrite`).not.toBeNull();
                const segment = parseSiteSegment(new URL(rewrite!).pathname.split("/")[1]);
                expect(segment.host, `${name} ${path}: the host`).toBe(host);
                // The renderer's rule on every path (a handler address at the root never has a language-shaped first segment).
                const language: PageLanguage = pageLanguageOf(pageAddress(path), config!.languages ?? []);
                const expected = language.kind === "extra" ? language.subtag : undefined;
                expect(segment.language, `${name} ${path}`).toBe(expected);
            }
        });
    });

    it("L1B-LANG-AGREEMENT control: the comparison sees a language — a listed prefix gets ~ro, an unlisted one none", async () => {
        const host = "control.agreement.test";
        store.items.set(host, { PK: "SYSTEM", SK: "TENANT#c", id: "c", Domain: host, domain: host, locale: "en-US", languages: ["ro"] });
        const at = async (p: string) => new URL((await middleware(new NextRequest(`https://${host}${p}`, { headers: { host } }))).headers.get("x-middleware-rewrite")!).pathname;
        expect(await at("/ro/x")).toBe(`/${host}~ro/ro/x`);
        expect(await at("/de/x")).toBe(`/${host}/de/x`);
        expect(await at("/ro/x?q=1")).toBe(`/${host}~ro/_dyn/ro/x`);
    });
});

/** The middleware's rewrite target path for `path` on `host` (`x-middleware-rewrite`), or the status when it answers. */
async function target(host: string, path: string): Promise<string> {
    const res = await middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
    const rewrite = res.headers.get("x-middleware-rewrite");
    return rewrite === null ? `status ${res.status}` : new URL(rewrite).pathname;
}

describe("L1B-LANG-AGREEMENT (revision 1) — one page-address rule in every branch: wired, unknown verdict, by-id", () => {
    const tenant = (host: string, id: string) => ({ PK: "SYSTEM", SK: `TENANT#${id}`, id, Domain: host, domain: host, locale: "en-US", languages: ["ro"] });

    it("L1B-LANG-AGREEMENT wired: the handler-name suffixes get ~ro; an encoded or double-encoded slash, and the real handlers, do not", async () => {
        const host = "wired.agreement.test";
        store.items.set(host, tenant(host, "w"));
        expect(await target(host, "/ro%2Fdespre")).toBe(`/${host}/ro%2Fdespre`);
        expect(await target(host, "/r%6F%2Fdespre")).toBe(`/${host}/r%6F%2Fdespre`);
        expect(await target(host, "/r%6F/despre")).toBe(`/${host}~ro/r%6F/despre`);
        expect(await target(host, "/ro%252Fdespre")).toBe(`/${host}/ro%252Fdespre`);
        for (const name of ["sitemap.xml", "robots.txt", "llms.txt", "openai-feed"]) {
            expect(await target(host, `/ro/${name}`), name).toBe(`/${host}~ro/ro/${name}`);
            expect(await target(host, `/${name}`), name).toBe(`/${host}/${name}`); // the handler, as before
        }
    });

    it("L1B-LANG-AGREEMENT unknown verdict: the handler-name suffixes go to the twin with ~ro; real handlers, an encoded or double-encoded slash and /about keep today's fail-open rewrite", async () => {
        const host = "unknown.agreement.test";
        store.failGate.add(host);
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await target(host, "/ro%2Fdespre")).toBe(`/${host}/ro%2Fdespre`);
        expect(await target(host, "/r%6F/despre")).toBe(`/${host}~ro/_dyn/r%6F/despre`);
        expect(await target(host, "/ro/despre")).toBe(`/${host}~ro/_dyn/ro/despre`);
        for (const name of ["sitemap.xml", "robots.txt", "llms.txt", "openai-feed"]) {
            expect(await target(host, `/ro/${name}`), name).toBe(`/${host}~ro/_dyn/ro/${name}`);
            expect(await target(host, `/${name}`), name).toBe(`/${host}/${name}`);
        }
        expect(await target(host, "/ro%252Fdespre")).toBe(`/${host}/ro%252Fdespre`);
        expect(await target(host, "/about")).toBe(`/${host}/about`);
        expect(errors).toHaveBeenCalled(); // the gate read did fail (fail-open log)
        errors.mockRestore();
    });

    it("L1B-LANG-AGREEMENT by-id (/tenant/ and /_site/): the handler-name suffixes get the twin with ~ro; an encoded slash, real handlers and one-language suffix paths keep today's target", async () => {
        for (const mode of ["tenant", "_site"]) {
            const at = (rest: string) => target("localhost", `/${mode}/t1${rest}`);
            expect(await at("/ro%2Fdespre"), mode).toBe("/t1/_dyn/ro%2Fdespre");
            expect(await at("/r%6F/despre"), mode).toBe("/t1~ro/_dyn/r%6F/despre");
            expect(await at("/ro%252Fdespre"), mode).toBe("/t1/_dyn/ro%252Fdespre");
            expect(await at("/about"), mode).toBe("/t1/_dyn/about");
            for (const name of ["sitemap.xml", "robots.txt", "llms.txt", "openai-feed"]) {
                expect(await at(`/ro/${name}`), `${mode} ${name}`).toBe(`/t1~ro/_dyn/ro/${name}`);
                expect(await at(`/${name}`), `${mode} ${name}`).toBe(`/t1/${name}`); // the handler, as before
                expect(await at(`/blog/${name}`), `${mode} ${name}`).toBe(`/t1/blog/${name}`); // suffix content path, as before
            }
        }
    });
});
