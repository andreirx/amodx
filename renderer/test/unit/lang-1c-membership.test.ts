import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

/**
 * LANG-1C (docs/slices/lang-1.md § 6.2, § 8.4, § 8.5) — the membership reads and the alternates rule, through the REAL
 * `lib/dynamo.ts`, the REAL `buildSitePageMetadata` (components/SitePage.tsx) and the REAL sitemap route, over a fake
 * DocumentClient that answers the shapes they send and records every command. So the tests also count the reads each
 * render adds: a one-language tenant must add none.
 *
 * The fake client: `QueryCommand` on `GSI_Domain` (`#d = :d`, the tenant read) and `PK = :pk AND begins_with(SK, :sk)`
 * (SK order, `pageSize` items per response with `LastEvaluatedKey`, `ExclusiveStartKey` honoured, `FilterExpression`
 * `#s = :pub` applied); `GetCommand` by key. Anything else throws (an unmodelled read is a red test, never an empty
 * result). Credential-free; no socket.
 */

type Item = Record<string, unknown>;
const store = vi.hoisted(() => ({ items: [] as Record<string, unknown>[], pageSize: 1000, commands: [] as { name: string; input: any }[] }));

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    const send = async (cmd: any) => {
        const name = cmd.constructor.name as string;
        const input = cmd.input;
        store.commands.push({ name, input });
        if (name === "GetCommand") {
            const item = store.items.find((i) => i.PK === input.Key.PK && i.SK === input.Key.SK);
            return { Item: item ? structuredClone(item) : undefined };
        }
        if (name === "QueryCommand" && input.IndexName === "GSI_Domain") {
            const host = input.ExpressionAttributeValues[":d"];
            return { Items: store.items.filter((i) => i.Domain === host && String(i.SK).startsWith("TENANT#")).map((i) => structuredClone(i)) };
        }
        if (name === "QueryCommand" && input.KeyConditionExpression === "PK = :pk AND begins_with(SK, :sk)") {
            const { ":pk": pk, ":sk": sk, ":pub": pub } = input.ExpressionAttributeValues;
            if (input.FilterExpression !== undefined && input.FilterExpression !== "#s = :pub") throw new Error(`fake: filter ${input.FilterExpression}`);
            const matching = store.items
                .filter((i) => i.PK === pk && typeof i.SK === "string" && (i.SK as string).startsWith(sk))
                .filter((i) => input.FilterExpression === undefined || i.status === pub)
                .sort((a, b) => ((a.SK as string) < (b.SK as string) ? -1 : 1));
            const start = input.ExclusiveStartKey ? matching.findIndex((i) => i.SK === input.ExclusiveStartKey.SK) + 1 : 0;
            const page = matching.slice(start, start + store.pageSize);
            const more = start + store.pageSize < matching.length;
            return { Items: page.map((i) => structuredClone(i)), ...(more ? { LastEvaluatedKey: { PK: pk, SK: page[page.length - 1].SK } } : {}) };
        }
        throw new Error(`fake: unmodelled ${name} ${JSON.stringify(input)}`);
    };
    return { ...real, DynamoDBDocumentClient: { from: () => ({ send }) } };
});
vi.mock("next/navigation", () => ({
    permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    usePathname: () => "/",
}));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn(async () => null) }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));

import {
    listedAlternates, parseTranslationSk, passesMembership, isTranslationKey, getTranslationSetMembers, getTranslationItems,
    sitemapAlternates, getPublishedContent, type TranslationMember,
} from "@/lib/dynamo";
import { buildSitePageMetadata } from "@/components/SitePage";
import { GET as sitemapGET } from "@/app/[siteId]/sitemap.xml/route";

const T = "TENANT#t1";
const HOST = "t1.test";
function tenantItem(extra: Item = {}): Item {
    return { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", Domain: HOST, domain: HOST, name: "T1", locale: "en-US", ...extra };
}
/** A page: its LATEST and its ROUTE#; `key` → the LATEST holds it; `item` (default true with a key) → its membership item. */
function page(nodeId: string, slug: string, { status = "Published", key, item = key !== undefined }: { status?: string; key?: unknown; item?: boolean } = {}): Item[] {
    return [
        { PK: T, SK: `CONTENT#${nodeId}#LATEST`, id: `c-${nodeId}`, nodeId, slug, title: `Page ${slug}`, status, createdAt: "2026-01-01T00:00:00.000Z", ...(key !== undefined ? { translationKey: key } : {}) },
        { PK: T, SK: `ROUTE#${slug}`, TargetNode: `NODE#${nodeId}` },
        ...(item && typeof key === "string" ? [{ PK: T, SK: `TRANSLATION#${key}#${nodeId}`, Type: "Translation" }] : []),
    ];
}
const member = (nodeId: string, slug: string): TranslationMember => ({ nodeId, slug });
const SITE = { languages: ["ro", "de"], locale: "en-US", homePageSlug: "/home" };
const commandShapes = () => store.commands.map(({ name, input }) => name === "GetCommand"
    ? `Get ${input.Key.SK}`
    : input.IndexName ? `Query ${input.IndexName}` : `Query ${input.ExpressionAttributeValues[":sk"]}`);

beforeEach(() => {
    process.env.TABLE_NAME = "lang-1c-unit";
    store.items = [];
    store.pageSize = 1000;
    store.commands = [];
});

describe("listedAlternates — the same-language rule, the threshold, the order, x-default and the home guard (§ 5.3, § 8.4)", () => {
    it("lang1c-hreflang (unit): every member listed, default language first then `languages` in order; x-default = the default member", () => {
        const got = listedAlternates([member("d", "/de/uber"), member("r", "/ro/despre"), member("e", "/about")], SITE);
        expect(got).toEqual({
            links: [{ hreflang: "en", nodeId: "e", path: "/about" }, { hreflang: "ro", nodeId: "r", path: "/ro/despre" }, { hreflang: "de", nodeId: "d", path: "/de/uber" }],
            xDefault: "/about",
        });
    });

    it("lang1c-same-language-pair (unit): two members with one hreflang value are both left out; the others listed", () => {
        const got = listedAlternates([member("e", "/pair"), member("r1", "/ro/a"), member("r2", "/ro/b"), member("d", "/de/paar")], SITE);
        expect(got).toEqual({ links: [{ hreflang: "en", nodeId: "e", path: "/pair" }, { hreflang: "de", nodeId: "d", path: "/de/paar" }], xDefault: "/pair" });
    });

    it("fewer than two listed members → null (today's output): one member; a pair that leaves one", () => {
        expect(listedAlternates([], SITE)).toBeNull();
        expect(listedAlternates([member("e", "/about")], SITE)).toBeNull();
        expect(listedAlternates([member("e", "/x"), member("r1", "/ro/a"), member("r2", "/ro/b")], SITE)).toBeNull();
    });

    it("lang1c-hreflang-home (unit): the default member whose slug is homePageSlug is at /; an extra member named by homePageSlug (table edit) keeps its slug", () => {
        expect(listedAlternates([member("h", "/home"), member("r", "/ro/acasa")], SITE)).toEqual({
            links: [{ hreflang: "en", nodeId: "h", path: "/" }, { hreflang: "ro", nodeId: "r", path: "/ro/acasa" }], xDefault: "/",
        });
        expect(listedAlternates([member("s", "/start"), member("r", "/ro/start")], { ...SITE, homePageSlug: "/ro/start" })).toEqual({
            links: [{ hreflang: "en", nodeId: "s", path: "/start" }, { hreflang: "ro", nodeId: "r", path: "/ro/start" }], xDefault: "/start",
        });
    });

    it("lang1c-language-removed (unit): ro no longer listed → /ro/about derives en, collides with /about: neither listed, no x-default", () => {
        const members = [member("e", "/about"), member("r", "/ro/about"), member("f", "/fr/about"), member("d", "/de/about")];
        expect(listedAlternates(members, { ...SITE, languages: ["fr", "de"] })).toEqual({
            links: [{ hreflang: "fr", nodeId: "f", path: "/fr/about" }, { hreflang: "de", nodeId: "d", path: "/de/about" }],
        });
        // lang1c-language-readded (unit): the same members, ro listed again → the earlier alternates (no input other than the list).
        expect(listedAlternates(members, { ...SITE, languages: ["ro", "fr", "de"] })?.links.map((l) => l.hreflang)).toEqual(["en", "ro", "fr", "de"]);
    });

    it("lang1c-default-subtag-listed (unit): a list naming the default subtag → /x and /en/x both hold en, both left out, no x-default", () => {
        const got = listedAlternates([member("x", "/x"), member("ex", "/en/x"), member("r", "/ro/x"), member("d", "/de/x")], { ...SITE, languages: ["en", "ro", "de"] });
        expect(got).toEqual({ links: [{ hreflang: "ro", nodeId: "r", path: "/ro/x" }, { hreflang: "de", nodeId: "d", path: "/de/x" }] });
    });

    it("the default language is localeLanguageSubtag(locale): ro-RO tenant with en extra; absent locale → en", () => {
        expect(listedAlternates([member("r", "/despre"), member("e", "/en/about")], { languages: ["en"], locale: "ro-RO" })?.links.map((l) => [l.hreflang, l.path]))
            .toEqual([["ro", "/despre"], ["en", "/en/about"]]);
        expect(listedAlternates([member("a", "/a"), member("r", "/ro/a")], { languages: ["ro"] })?.links[0].hreflang).toBe("en");
    });
});

describe("the membership conditions (§ 6.2)", () => {
    it("parseTranslationSk: the key and the node id; an SK without either is skipped", () => {
        expect(parseTranslationSk("TRANSLATION#k1#n1")).toEqual({ setKey: "k1", nodeId: "n1" });
        expect(parseTranslationSk("TRANSLATION#k1#")).toBeNull();
        expect(parseTranslationSk("TRANSLATION##n1")).toBeNull();
        expect(parseTranslationSk("TRANSLATION#k1")).toBeNull();
        expect(parseTranslationSk("CONTENT#n1#LATEST")).toBeNull();
        expect(parseTranslationSk(5)).toBeNull();
    });

    it("lang1c-hreflang-member-invalid (unit) / lang1c-member-not-owner (unit): conditions 2 and 3 — Published, a string slug, the key held now", () => {
        const ok = { status: "Published", slug: "/a", translationKey: "k" };
        expect(passesMembership("k", ok)).toBe(true);
        expect(passesMembership("k", undefined)).toBe(false);                       // the page item is missing
        expect(passesMembership("k", { ...ok, status: "Draft" })).toBe(false);
        expect(passesMembership("k", { ...ok, status: "Archived" })).toBe(false);
        expect(passesMembership("k", { ...ok, slug: 5 })).toBe(false);
        expect(passesMembership("k", { ...ok, translationKey: "other" })).toBe(false); // the page now holds another key
        expect(passesMembership("k", { status: "Published", slug: "/a" })).toBe(false); // the page holds no key
    });

    it("lang1c-key-malformed (unit): a stored key that is not a non-empty string is not a key", () => {
        expect(isTranslationKey("k")).toBe(true);
        for (const bad of ["", 5, null, undefined, {}, ["k"]]) expect(isTranslationKey(bad)).toBe(false);
    });
});

describe("the reads (no scan; § 6.2) and their cost per render", () => {
    function setA() {
        store.items = [
            tenantItem({ languages: ["ro", "de"], homePageSlug: "/home" }),
            ...page("e", "/about", { key: "K" }), ...page("r", "/ro/despre", { key: "K" }), ...page("d", "/de/uber", { key: "K" }),
            ...page("x", "/de/archived", { key: "K", status: "Archived" }),
            ...page("o", "/de/owner", { key: "OTHER" }), { PK: T, SK: "TRANSLATION#K#o", Type: "Translation" },
            { PK: T, SK: "TRANSLATION#K#ghost", Type: "Translation" }, { PK: T, SK: "TRANSLATION#K#", Type: "Translation" },
            ...page("p", "/plain"),
        ];
    }

    it("lang1c-pagination (unit): getTranslationSetMembers follows LastEvaluatedKey, one Get per item, skips the stale items", async () => {
        setA();
        store.pageSize = 1;
        const members = await getTranslationSetMembers("t1", "K");
        expect(members).toEqual([member("d", "/de/uber"), member("e", "/about"), member("r", "/ro/despre")]);
        const queries = store.commands.filter((c) => c.name === "QueryCommand");
        expect(queries.length).toBeGreaterThan(1);
        for (const q of queries) {
            expect(q.input.KeyConditionExpression).toBe("PK = :pk AND begins_with(SK, :sk)");
            expect(q.input.ExpressionAttributeValues).toMatchObject({ ":pk": T, ":sk": "TRANSLATION#K#" });
        }
        const gets = store.commands.filter((c) => c.name === "GetCommand");
        expect(gets.map((g) => g.input.Key.SK).sort()).toEqual(["CONTENT#d#LATEST", "CONTENT#e#LATEST", "CONTENT#ghost#LATEST", "CONTENT#o#LATEST", "CONTENT#r#LATEST", "CONTENT#x#LATEST"]);
        expect(gets[0].input.ProjectionExpression).toBe("slug, #s, translationKey");
        expect(store.commands.some((c) => c.name === "ScanCommand")).toBe(false);
    });

    it("lang1c-pagination (unit): getTranslationItems reads every page of the tenant's items; SKs without key or node id skipped", async () => {
        setA();
        store.pageSize = 2;
        const items = await getTranslationItems("t1");
        expect(items).toContainEqual({ setKey: "K", nodeId: "ghost" });
        expect(items).toHaveLength(7);   // e, r, d, x, o, ghost under K; "TRANSLATION#K#" skipped; OTHER has no item
        expect(store.commands.every((c) => c.name === "QueryCommand" && c.input.ExpressionAttributeValues[":sk"] === "TRANSLATION#")).toBe(true);
        expect(store.commands.length).toBe(4);
    });

    it("getPublishedContent: the node id from the SK and the raw key are added; every earlier field is unchanged", async () => {
        setA();
        const pages = await getPublishedContent("t1");
        const about = pages.find((p) => p.slug === "/about")!;
        expect(about).toEqual({ id: "c-e", title: "Page /about", slug: "/about", seoDescription: undefined, status: "Published", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: undefined, nodeId: "e", translationKey: "K" });
        expect(pages.find((p) => p.slug === "/plain")!.translationKey).toBeUndefined();
        expect(store.commands[0].input.ProjectionExpression).toBe("SK, id, title, slug, seoDescription, createdAt, updatedAt, #s, translationKey");
    });

    it("sitemapAlternates: the join applies conditions 1-3 and the listed rule; only listed members get an entry", async () => {
        setA();
        const pages = await getPublishedContent("t1");
        const items = await getTranslationItems("t1");
        const map = sitemapAlternates(pages, items, SITE);
        expect([...map.keys()].sort()).toEqual(["d", "e", "r"]);
        expect(map.get("e")!.links.map((l) => l.path)).toEqual(["/about", "/ro/despre", "/de/uber"]);
    });

    it("reads per page render — one-language tenant: ZERO added (tenant, route, page: as before), also for a page that holds a key", async () => {
        store.items = [tenantItem(), ...page("e", "/about", { key: "K" }), ...page("r", "/ro/x", { key: "K" })];
        const meta = await buildSitePageMetadata({ siteId: HOST, slug: ["about"], query: {} });
        expect(commandShapes()).toEqual(["Query GSI_Domain", "Get ROUTE#/about", "Get CONTENT#e#LATEST"]);
        expect(meta.alternates).toEqual({ canonical: `https://${HOST}/about` });
    });

    it("reads per page render — two-language tenant: a page in no set adds none; a page in a set of 3 adds 1 Query (per 1 MB page) + 3 Gets", async () => {
        setA();
        const plain = await buildSitePageMetadata({ siteId: HOST, slug: ["plain"], query: {} });
        expect(commandShapes()).toEqual(["Query GSI_Domain", "Get ROUTE#/plain", "Get CONTENT#p#LATEST"]);
        expect(plain.alternates).toEqual({ canonical: `https://${HOST}/plain` });
        store.items = [tenantItem({ languages: ["ro", "de"] }), ...page("e", "/about", { key: "K" }), ...page("r", "/ro/despre", { key: "K" }), ...page("d", "/de/uber", { key: "K" })];
        store.commands = [];
        const meta = await buildSitePageMetadata({ siteId: HOST, slug: ["ro", "despre"], query: {} });
        expect(commandShapes()).toEqual(["Query GSI_Domain", "Get ROUTE#/ro/despre", "Get CONTENT#r#LATEST", "Query TRANSLATION#K#", "Get CONTENT#d#LATEST", "Get CONTENT#e#LATEST", "Get CONTENT#r#LATEST"]);
        expect(meta.alternates).toEqual({
            canonical: `https://${HOST}/ro/despre`,
            languages: { en: `https://${HOST}/about`, ro: `https://${HOST}/ro/despre`, de: `https://${HOST}/de/uber`, "x-default": `https://${HOST}/about` },
        });
    });

    it("lang1c-hreflang-member-invalid (unit, read cost): every PARSEABLE item costs one GetItem, stale ones included — 2 listed members, 6 GetItem (review R-LANG1C-02)", async () => {
        store.items = [
            tenantItem({ languages: ["ro", "de", "fr"] }),
            ...page("e", "/team", { key: "K" }), ...page("r", "/ro/echipa", { key: "K" }),
            ...page("x", "/de/team", { key: "K", status: "Archived" }), ...page("f", "/fr/equipe", { key: "K", status: "Draft" }),
            ...page("o", "/de/other", { key: "OTHER" }), { PK: T, SK: "TRANSLATION#K#o", Type: "Translation" },
            { PK: T, SK: "TRANSLATION#K#ghost", Type: "Translation" }, { PK: T, SK: "TRANSLATION#K#", Type: "Translation" },
        ];
        const meta = await buildSitePageMetadata({ siteId: HOST, slug: ["team"], query: {} });
        const shapes = commandShapes();
        expect(shapes.slice(0, 4)).toEqual(["Query GSI_Domain", "Get ROUTE#/team", "Get CONTENT#e#LATEST", "Query TRANSLATION#K#"]);
        // e, r (members) + x (Archived), f (Draft), o (another key), ghost (no page): 6; the SK without a node id: none.
        expect(shapes.slice(4).sort()).toEqual(["Get CONTENT#e#LATEST", "Get CONTENT#f#LATEST", "Get CONTENT#ghost#LATEST", "Get CONTENT#o#LATEST", "Get CONTENT#r#LATEST", "Get CONTENT#x#LATEST"]);
        expect(meta.alternates).toEqual({
            canonical: `https://${HOST}/team`,
            languages: { en: `https://${HOST}/team`, ro: `https://${HOST}/ro/echipa`, "x-default": `https://${HOST}/team` },
        });
    });

    it("keyed singleton (unit, read cost): a page whose set has only itself — the reads run (1 Query + 1 GetItem), the object is today's (no alternates is not no reads)", async () => {
        store.items = [tenantItem({ languages: ["ro"] }), ...page("s", "/solo", { key: "SOLO" })];
        const meta = await buildSitePageMetadata({ siteId: HOST, slug: ["solo"], query: {} });
        expect(commandShapes()).toEqual(["Query GSI_Domain", "Get ROUTE#/solo", "Get CONTENT#s#LATEST", "Query TRANSLATION#SOLO#", "Get CONTENT#s#LATEST"]);
        expect(meta.alternates).toEqual({ canonical: `https://${HOST}/solo` });
    });

    it("lang1c-key-malformed (unit): a page whose stored key is \"\" or a number makes no membership read", async () => {
        store.items = [tenantItem({ languages: ["ro"] }), ...page("a", "/a", { key: "" }), ...page("b", "/ro/b", { key: 5 })];
        for (const slug of [["a"], ["ro", "b"]]) {
            store.commands = [];
            const meta = await buildSitePageMetadata({ siteId: HOST, slug, query: {} });
            expect(commandShapes().some((s) => s.startsWith("Query TRANSLATION"))).toBe(false);
            expect(meta.alternates).toEqual({ canonical: `https://${HOST}/${slug.join("/")}` });
        }
    });

    it("reads per sitemap request — one-language: 2 (tenant, pages; as before); two-language: + 1 paginated Query of the tenant's items, no Get", async () => {
        store.items = [tenantItem(), ...page("e", "/about")];
        const one = await sitemapGET(new Request(`https://${HOST}/sitemap.xml`), { params: Promise.resolve({ siteId: HOST }) });
        expect(commandShapes()).toEqual(["Query GSI_Domain", "Query CONTENT#"]);
        expect(await one.text()).not.toContain("xhtml");
        setA();
        store.commands = [];
        const two = await sitemapGET(new Request(`https://${HOST}/sitemap.xml`), { params: Promise.resolve({ siteId: HOST }) });
        expect(commandShapes()).toEqual(["Query GSI_Domain", "Query CONTENT#", "Query TRANSLATION#"]);
        // Stale items add to the query's VOLUME (they are returned: 8 items for 3 members), never a GetItem.
        const itemsQuery = store.commands.find((c) => c.input.ExpressionAttributeValues?.[":sk"] === "TRANSLATION#")!;
        expect(store.items.filter((i) => String(i.SK).startsWith("TRANSLATION#")).length).toBe(8);
        expect(itemsQuery.input.ProjectionExpression).toBe("SK");
        const xml = await two.text();
        expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">');
        expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="x-default" href="https://${HOST}/about"/>`);
    });

    it("sitemap: an href is XML-escaped in its attribute", async () => {
        store.items = [tenantItem({ languages: ["ro"] }), ...page("e", "/a&b", { key: "K" }), ...page("r", "/ro/a\"b", { key: "K" })];
        const xml = await (await sitemapGET(new Request(`https://${HOST}/sitemap.xml`), { params: Promise.resolve({ siteId: HOST }) })).text();
        expect(xml).toContain(`href="https://${HOST}/a&amp;b"`);
        expect(xml).toContain(`href="https://${HOST}/ro/a&quot;b"`);
    });
});
