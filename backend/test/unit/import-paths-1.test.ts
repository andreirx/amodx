import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { readFileSync } from "fs";
import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { normalizeSlug } from "@amodx/shared";
import { FIXTURE_WXR, GOLDEN_FILE, GOLDEN_TIME, ImportTable, T, runImport, snapshot, uuidCounter } from "./import-paths-1-harness";

/**
 * IMPORT-PATHS-1 (docs/slices/import-paths-1.md) — a WordPress import keeps the old addresses. The real handler
 * (import/wordpress.ts) and the real parser run on the invented export fixtures/wordpress/import-paths-1.wxr.xml against
 * an in-memory table. Mocked: `db.js`, the media map (holds the fixture's attachment), the image upload, the CDN wrapper
 * (records whether a call went through it) and the purge. The reserved addresses are the real rule (slug-guard.ts) on
 * the English defaults (no tenant record). Credential-free.
 *
 * Row ids: IP1-TAX-* = the specification's Evidence taxonomy; IP1-R2/R5/R7-* = rulings 2, 5, 7 of the packet.
 */

const h = vi.hoisted(() => {
    // An upload target, so an image that is not in the media map goes to the (mocked, failing) copy — review-1 3b.
    process.env.UPLOADS_BUCKET = "test-uploads";
    process.env.UPLOADS_CDN_URL = "https://cdn.example.test";
    return { table: null as any, wrapped: 0, mediaMap: null as null | Map<string, string> };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => h.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/media-map.js", async () => {
    const { MEDIA_MAP } = await import("./import-paths-1-harness");
    return { loadMediaMap: vi.fn(async () => h.mediaMap ?? new Map(MEDIA_MAP)) };
});
vi.mock("../../src/lib/image-upload.js", () => ({ downloadAndUploadImage: vi.fn(async () => { throw new Error("no upload in tests"); }) }));
vi.mock("../../src/lib/invalidate-cdn.js", () => ({
    withInvalidation: (handler: any) => async (...args: any[]) => { h.wrapped++; return handler(...args); },
}));
vi.mock("../../src/lib/revalidate.js", () => ({ purgeStoredPagesOfRequestTenant: vi.fn(), revalidateTenantPaths: vi.fn() }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));

import { handler } from "../../src/import/wordpress.js";
import { parseWXR } from "../../src/import/wxr-parser.js";
import { oldAddressOf, servedBefore, planAddresses } from "../../src/import/wp-addresses.js";
import { redirectRouteItem, handler as updateHandler } from "../../src/content/update.js";
import { handler as wooHandler } from "../../src/import/woocommerce.js";
import { readReservedAddresses, reservedAddressRefusal, reservedAddressRefusalIn } from "../../src/lib/slug-guard.js";
import { urlPrefixesOf } from "@amodx/shared";

let db: ImportTable;
const dryEvent = async (body: Record<string, unknown>) => {
    const res = await handler({
        headers: { "x-tenant-id": "t1" }, queryStringParameters: { dryRun: "1" }, body: JSON.stringify(body),
        requestContext: { authorizer: { lambda: { sub: "u1", email: "editor@t1.example.test", role: "TENANT_ADMIN", tenantId: "t1" } } },
    } as any, {} as any, () => {}) as any;
    return { statusCode: res.statusCode as number, body: JSON.parse(res.body) };
};
const importAll = (extra: Record<string, unknown> = {}) => runImport(handler, { wxrContent: FIXTURE_WXR, ...extra });
const routeOf = (address: string) => db.get(T, `ROUTE#${address}`);
const pageAt = (address: string) => {
    const route = routeOf(address);
    return route?.TargetNode ? db.get(T, `CONTENT#${String(route.TargetNode).replace("NODE#", "")}#LATEST`) : undefined;
};
const writes = () => db.commands.filter((c) => c instanceof PutCommand);
const rowOf = (body: any, title: string) => body.rows.find((r: any) => r.title === title);

const CDN_IMAGE = "https://cdn.example.test/t1/ceara-hero.jpg";
const OLD_IMAGE = "https://atelier.example.test/wp-content/uploads/2024/03/ceara-hero.jpg";
const SHOP_REFUSAL = 'Slug "/shop/despre" uses the address "/shop" of the built-in shop page. Choose a different slug, or change that address in Settings.';
const PRODUCT_REFUSAL = 'Slug "/product/ghid" uses the address "/product" of the built-in product pages. Choose a different slug, or change that address in Settings.';
const QUERY_ONLY = "an address by query string only (?p=…): the renderer serves by path, so it answers the home page";
const CIORNA_LINK = "https://atelier.example.test/?page_id=60";
const DEFAULTS = { prefixes: urlPrefixesOf(undefined), catalog: false };
const SOURCE = (id: string) => `wordpress:atelier.example.test/${id}`;
const items = () => [...db.items.values()].map((i) => structuredClone(i));
/** A command that throws when it matches (LangTable `beforeCommand` runs once, before the command, then clears). */
const failNext = (match: (c: any) => boolean, message = "injected failure") => {
    db.beforeCommand = { match, run: async () => { throw new Error(message); } };
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(GOLDEN_TIME));
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(uuidCounter() as any);
    db = new ImportTable();
    h.table = db;
    h.wrapped = 0;
    h.mediaMap = null;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
// The handler read the upload target when it was imported; nothing after this file may see it.
afterAll(() => { delete process.env.UPLOADS_BUCKET; delete process.env.UPLOADS_CDN_URL; });

describe("IP1-GOLDEN-OPTION-OFF — option off is today's import (ruling 3)", () => {
    it("IP1-GOLDEN-OPTION-OFF / IP1-TAX-OPTION-OFF: the answer is byte-equal, and every command and every item equals the golden of 30421e3", async () => {
        const golden = JSON.parse(readFileSync(GOLDEN_FILE, "utf-8"));
        const res = await importAll({ keepOldAddresses: false });
        const now = snapshot(db, res.raw);
        expect(now.response).toBe(golden.response);
        expect(JSON.stringify(now.commands)).toBe(JSON.stringify(golden.commands));
        expect(JSON.stringify(now.items)).toBe(JSON.stringify(golden.items));
    });
});

describe("IP1-PARSER — the parser reads `<link>`, the parent id, the site host and the thumbnail (scope 1, 4)", () => {
    it("IP1-PARSER-LINK-PARENT: link, ids, parent and host per item; products kept for their address; attachments, menu items and trash left out", async () => {
        const items = await parseWXR(FIXTURE_WXR);
        expect(items.map((i) => `${i.postType}:${i.title}`)).toEqual([
            "page:Cursuri", "page:Ceara", "post:Titlu", "page:Despre magazin", "page:Ghid produse", "page:Coala", "page:Școala",
            "page:Program", "page:Galerie", "page:Ciorna", "product:Vas mare",
        ]);
        const ceara = items[1] as any;
        expect(ceara).toMatchObject({ link: "https://atelier.example.test/cursuri/ceara/", wpId: "11", parentId: "10", sourceHost: "atelier.example.test", featuredImageId: "101", featuredImageAttachmentUrl: OLD_IMAGE });
        expect(ceara.featuredImage).toBeUndefined();   // F-IP1-PRESERVATION: today's field stays unset
        expect((items[0] as any).parentId).toBeUndefined();
        expect(items[10]).toEqual({ postType: "product", title: "Vas mare", slug: "vas-mare", link: "https://atelier.example.test/produs/vas-mare/", wpId: "70", sourceHost: "atelier.example.test" });
    });

    it("IP1-TAX-FEATURED (parser half): an id with its attachment → the attachment URL; an id without one → none, the id kept to list it", async () => {
        const items = await parseWXR(FIXTURE_WXR) as any[];
        expect(items.find((i) => i.title === "Ceara")).toMatchObject({ featuredImageAttachmentUrl: OLD_IMAGE, featuredImageId: "101" });
        const titlu = items.find((i) => i.title === "Titlu");
        expect(titlu.featuredImageAttachmentUrl).toBeUndefined();
        expect(titlu.featuredImageId).toBe("999");
    });
});

describe("IP1-R7 / IP1-F5 — what an old address is (ruling 7; review F-IP1-PATH-INTERPRETATION)", () => {
    const A = "https://atelier.example.test";
    it.each([
        // [what, <link>, the old address the importer reads]
        ["nested page", `${A}/cursuri/ceara/`, { kind: "path", path: "/cursuri/ceara", raw: "/cursuri/ceara" }],
        ["upper case: kept as sent (the renderer looks up the path as the browser sends it)", `${A}/Atelier/Program/`, { kind: "path", path: "/Atelier/Program", raw: "/Atelier/Program" }],
        ["non-ASCII, percent-encoded: decoded once (the page body's form)", `${A}/%c8%99coala/`, { kind: "path", path: "/școala", raw: "/%c8%99coala" }],
        ["an encoded slash stays encoded, upper case (renderer site-segment.ts:96-110)", `${A}/ro%2fdespre/`, { kind: "path", path: "/ro%2Fdespre", raw: "/ro%2fdespre" }],
        ["a double-encoded slash: decoded once", `${A}/ro%252Fdespre/`, { kind: "path", path: "/ro%2Fdespre", raw: "/ro%252Fdespre" }],
        ["a path with a query: the path is the address, the query is dropped", `${A}/nested/page/?campaign=1`, { kind: "path", path: "/nested/page", raw: "/nested/page", query: "?campaign=1" }],
        ["query only (plain permalink)", `${A}/?page_id=60`, { kind: "query-only", link: `${A}/?page_id=60` }],
        ["query only through index.php", `${A}/index.php?p=12`, { kind: "query-only", link: `${A}/index.php?p=12` }],
        ["fragment: not part of the address", `${A}/galerie/#top`, { kind: "path", path: "/galerie", raw: "/galerie" }],
        ["the home page", `${A}/`, { kind: "home", link: `${A}/` }],
        ["not a URL", "galerie", { kind: "invalid", link: "galerie" }],
        ["no link", undefined, { kind: "none" }],
        ["malformed escape: undecodable (Next.js answers 400), never a lookup key", `${A}/a%E0%A4%A/`, { kind: "undecodable", link: `${A}/a%E0%A4%A/`, raw: "/a%E0%A4%A" }],
    ])("IP1-R7-OLD-ADDRESS: %s", (_what, link, expected) => {
        expect(oldAddressOf(link as string | undefined)).toEqual(expected);
    });

    it.each([
        // [input, what normalizeSlug (packages/shared/src/slug.ts) makes of it]
        ["/Atelier/Program", "/atelier/program"],   // upper case → lower case: differs from the old path → a redirect is needed
        ["/școala", "/coala"],                      // a non-ASCII letter is DROPPED (not transliterated) → differs
        ["/%c8%99coala", "/c899coala"],             // raw percent-encoding: `%` dropped, hex kept — why the importer decodes first
        ["/?page_id=60", "/page-id60"],             // a raw query string: `?` and `=` dropped, `_` → `-` — why the importer parses the URL first
        ["/galerie/#top", "/galerie/top"],          // a raw fragment: `#` dropped — same reason
    ])("IP1-R7-NORMALIZE: normalizeSlug(%s) = %s", (input, output) => {
        expect(normalizeSlug(input)).toBe(output);
    });

    it("IP1-F5-PLAN: the home link → flat page, the old `/` listed as not redirectable; a query on a path → kept by path; an encoded slash → redirected from its body form", () => {
        const post = (title: string, slug: string, link: string, wpId: string) => ({ postType: "page" as const, title, slug, link, wpId, content: "", status: "publish" as const, comments: [] });
        const plans = planAddresses([
            post("Acasa", "acasa", `${A}/`, "1"),
            post("Pagina", "pagina", `${A}/nested/page/?campaign=1`, "2"),
            post("Despre", "despre", `${A}/ro%2Fdespre/`, "3"),
        ], DEFAULTS) as any[];
        expect(plans.map((p) => [p.placement, p.redirect])).toEqual([
            [{ kind: "flat", address: "/acasa" }, { kind: "cannot-redirect", from: "/", by: "the site's home page: to keep it, set this page as the home page in Settings" }],
            [{ kind: "kept", address: "/nested/page" }, { kind: "none" }],
            [{ kind: "kept", address: "/ro2fdespre" }, { kind: "planned", from: "/ro%2Fdespre", to: "/ro2fdespre" }],
        ]);
    });
});

describe("IP1-F4 — an address the renderer answers before its content lookup (review F-IP1-REACHABILITY; ruling IP1-BUILTIN-REDIRECTS = A)", () => {
    it.each([
        ["/api/guide", "the renderer does not route this address to the site (its middleware skips /api…, /_next/…, /favicon.ico)"],
        ["/apiary", "the renderer does not route this address to the site (its middleware skips /api…, /_next/…, /favicon.ico)"],
        ["/favicon.ico", "the site's CDN serves this address from file storage (/assets/…, /_next/static/…, /favicon.ico)"],
        ["/assets/guide", "the site's CDN serves this address from file storage (/assets/…, /_next/static/…, /favicon.ico)"],
        ["/a//b", "Next.js answers it with a 308 to the address without repeated slashes"],
        ["/_next/data/x", "the renderer passes this address to its own files (/_next…, /api…, /static…)"],
        ["/static/plan.pdf", "the renderer passes this address to its own files (/_next…, /api…, /static…)"],
        ["/_dyn/x", "an internal address of the renderer (it answers 404)"],
        ["/blog/_dyn/x", "a preview address of the renderer (it answers 308 to /_site/…)"],
        ["/_book/x", "an internal booking address of the renderer (it answers 404)"],
        ["/%5Fbook/x", "an internal booking address of the renderer (it answers 404)"],
        ["/_booking/manage", "the site's booking pages"],
        ["/tenant/x", "a preview address of the renderer (it answers 403 on the site's domain)"],
        ["/_site/x", "a preview address of the renderer (it answers 403 on the site's domain)"],
        ["/robots.txt", "the site's robots.txt"],
        ["/sitemap.xml", "the site's sitemap.xml"],
        ["/llms.txt", "the site's llms.txt"],
        ["/openai-feed", "the site's openai-feed"],
        ["/products/123", "the product page by id (/products/<id>)"],
        ["/", "the site's home page"],
        ["/product/ghid", "the site's product pages"],
        ["/cart", "the site's cart page"],
        // Reached by the content lookup:
        ["/products", null], ["/products/a/b", null], ["/tenant", null], ["/shop/despre", null], ["/blog/robots.txt", null], ["/cursuri/ceara", null],
    ])("IP1-F4-SERVED-BEFORE: %s", (path, by) => {
        expect(servedBefore(path, path, DEFAULTS)).toBe(by);
    });

    it("IP1-F4-PLAN: the review's addresses — page addresses and redirect sources checked against the whole order", () => {
        const post = (title: string, slug: string, path: string, wpId: string) => ({ postType: "page" as const, title, slug, link: `https://atelier.example.test${path}`, wpId, content: "", status: "publish" as const, comments: [] });
        const plans = planAddresses([
            post("Guide", "guide", "/api/guide/", "1"),
            post("Tenant", "x", "/tenant/x/", "2"),
            post("Manage", "manage", "/_booking/manage/", "3"),
            post("Dyn", "dyn-x", "/_dyn/x/", "4"),
            post("Robots", "robots", "/robots.txt", "5"),
        ], DEFAULTS) as any[];
        expect(plans.map((p) => [p.placement.kind, p.placement.address, p.redirect.kind, p.redirect.by])).toEqual([
            ["moved", "/guide", "cannot-redirect", "the renderer does not route this address to the site (its middleware skips /api…, /_next/…, /favicon.ico)"],
            ["moved", "/x", "cannot-redirect", "a preview address of the renderer (it answers 403 on the site's domain)"],
            ["kept", "/-booking/manage", "cannot-redirect", "the site's booking pages"],
            ["kept", "/-dyn/x", "cannot-redirect", "an internal address of the renderer (it answers 404)"],
            ["kept", "/robotstxt", "cannot-redirect", "the site's robots.txt"],
        ]);
        expect(plans[0].placement.blocked).toEqual({ kind: "served-before", by: "the renderer does not route this address to the site (its middleware skips /api…, /_next/…, /favicon.ico)" });
    });
});

describe("IP1-DRY-RUN — the dry run lists every old address with the address it gets, and writes nothing", () => {
    it("IP1-DRY-RUN-LIST: the whole list for the fixture (nested pages, dated post, reserved prefixes, a collision, featured images, a product)", async () => {
        const res = await dryEvent({ wxrContent: FIXTURE_WXR });
        expect(res.statusCode).toBe(200);
        const none = { kind: "none" };
        const at = (path: string, raw = path) => ({ kind: "path", path, raw });
        expect(res.body).toEqual({
            processedCount: 11, createdCount: 9, updatedCount: 0, totalCount: 11, complete: true,
            keepOldAddresses: true, dryRun: true,
            productAddresses: { site: "/product", old: ["/produs"] },
            rows: [
                { item: "page", title: "Cursuri", oldAddress: at("/cursuri"), page: { kind: "kept", address: "/cursuri", write: "create" }, redirect: none, featuredImage: none },
                { item: "page", title: "Ceara", oldAddress: at("/cursuri/ceara"), page: { kind: "kept", address: "/cursuri/ceara", write: "create" }, redirect: none, featuredImage: { kind: "from-export", url: OLD_IMAGE } },
                { item: "post", title: "Titlu", oldAddress: at("/2024/03/titlu"), page: { kind: "kept", address: "/2024/03/titlu", write: "create" }, redirect: none, featuredImage: { kind: "missing", id: "999" } },
                { item: "page", title: "Despre magazin", oldAddress: at("/shop/despre"), page: { kind: "moved", address: "/despre", wanted: "/shop/despre", blocked: { kind: "reserved", refusal: SHOP_REFUSAL }, write: "create" }, redirect: { kind: "write", from: "/shop/despre", to: "/despre" }, featuredImage: none },
                { item: "page", title: "Ghid produse", oldAddress: at("/product/ghid"), page: { kind: "moved", address: "/ghid", wanted: "/product/ghid", blocked: { kind: "reserved", refusal: PRODUCT_REFUSAL }, write: "create" }, redirect: { kind: "cannot-redirect", from: "/product/ghid", by: "the site's product pages" }, featuredImage: none },
                { item: "page", title: "Coala", oldAddress: at("/coala"), page: { kind: "kept", address: "/coala", write: "create" }, redirect: none, featuredImage: none },
                { item: "page", title: "Școala", oldAddress: at("/școala", "/%c8%99coala"), page: { kind: "refused-taken", address: "/coala", heldBy: "Coala" }, redirect: { kind: "no-target", from: "/școala" }, featuredImage: none },
                { item: "page", title: "Program", oldAddress: at("/Atelier/Program"), page: { kind: "kept", address: "/atelier/program", write: "create" }, redirect: { kind: "write", from: "/Atelier/Program", to: "/atelier/program" }, featuredImage: none },
                { item: "page", title: "Galerie", oldAddress: at("/galerie"), page: { kind: "kept", address: "/galerie", write: "create" }, redirect: none, featuredImage: none },
                { item: "page", title: "Ciorna", oldAddress: { kind: "query-only", link: CIORNA_LINK }, page: { kind: "parent", address: "/cursuri/ciorna", write: "create" }, redirect: { kind: "cannot-redirect", from: CIORNA_LINK, by: QUERY_ONLY }, featuredImage: none },
                { item: "product", title: "Vas mare", oldAddress: at("/produs/vas-mare"), product: { kind: "not-found", tried: ["vas-mare"] }, redirect: { kind: "no-target", from: "/produs/vas-mare" } },
            ],
        });
    });

    it("IP1-DRY-RUN-NO-WRITE: no Put, no transaction, and the call does not go through the CDN wrapper (no purge, no marker)", async () => {
        await dryEvent({ wxrContent: FIXTURE_WXR });
        expect(db.commands.filter((c) => c instanceof PutCommand || c instanceof TransactWriteCommand)).toEqual([]);
        expect(h.wrapped).toBe(0);
        await importAll({ keepOldAddresses: true });
        expect(h.wrapped).toBe(1);
    });

    it("IP1-DRY-RUN-OFF: with the option off the dry run lists today's flat addresses, no products and no featured image (today's import sets none)", async () => {
        const res = await dryEvent({ wxrContent: FIXTURE_WXR, keepOldAddresses: false });
        expect(res.body.keepOldAddresses).toBe(false);
        expect(res.body.totalCount).toBe(10);
        expect(res.body.productAddresses).toBeUndefined();
        expect(res.body.rows.map((r: any) => r.page.address)).toEqual(["/cursuri", "/ceara", "/titlu", "/despre", "/ghid", "/coala", "/%c8%99coala", "/program", "/galerie", "/ciorna"]);
        expect(res.body.rows.every((r: any) => r.page.kind === "today" && r.redirect.kind === "none" && r.featuredImage.kind === "none")).toBe(true);
        expect(writes()).toEqual([]);
    });

    it("IP1-DRY-RUN-BATCHES: batches of 4 give the same rows as one batch (the plan is made over the whole export)", async () => {
        const whole = (await dryEvent({ wxrContent: FIXTURE_WXR })).body.rows;
        const rows: any[] = [];
        for (let start = 0; start !== undefined;) {
            const res = (await dryEvent({ wxrContent: FIXTURE_WXR, keepOldAddresses: true, batchStart: start, batchSize: 4 })).body;
            rows.push(...res.rows);
            start = res.nextBatchStart;
            if (res.complete) break;
        }
        expect(rows).toEqual(whole);
    });
});

describe("IP1-TAX — the Evidence taxonomy, on the written table", () => {
    it("IP1-TAX-NESTED-PAGE: page /cursuri/ceara/ → page at /cursuri/ceara", async () => {
        await importAll({ keepOldAddresses: true });
        expect(pageAt("/cursuri/ceara")).toMatchObject({ title: "Ceara", slug: "/cursuri/ceara", status: "Published", author: "wordpress-importer" });
        expect(routeOf("/ceara")).toBeUndefined();
    });

    it("IP1-TAX-DATED-POST: post /2024/03/titlu/ → page at /2024/03/titlu (with its comment)", async () => {
        await importAll({ keepOldAddresses: true });
        const page = pageAt("/2024/03/titlu");
        expect(page).toMatchObject({ title: "Titlu", slug: "/2024/03/titlu" });
        expect(db.keysWithPrefix(T, `COMMENT#${page!.nodeId}#`)).toHaveLength(1);
    });

    it("IP1-TAX-RESERVED (as amended by IP1-BUILTIN-REDIRECTS = A): a reserved address the renderer looks up → flat + one redirect; one it answers first → flat, no redirect, listed", async () => {
        const res = await importAll({ keepOldAddresses: true });
        expect(pageAt("/despre")).toMatchObject({ title: "Despre magazin", slug: "/despre" });
        expect(routeOf("/shop/despre")).toEqual(redirectRouteItem("t1", "/shop/despre", "/despre", GOLDEN_TIME, "u1"));
        expect(rowOf(res.body, "Despre magazin").redirect).toEqual({ kind: "write", from: "/shop/despre", to: "/despre" });
        expect(pageAt("/ghid")).toMatchObject({ title: "Ghid produse" });
        expect(routeOf("/product/ghid")).toBeUndefined();
        expect(rowOf(res.body, "Ghid produse").redirect).toEqual({ kind: "cannot-redirect", from: "/product/ghid", by: "the site's product pages" });
    });

    it("IP1-TAX-COLLISION / IP1-R5-FIRST-KEEPS: two items with one address — the first keeps it, the second is refused, nothing overwritten", async () => {
        const res = await importAll({ keepOldAddresses: true });
        expect(pageAt("/coala")).toMatchObject({ title: "Coala" });
        const contents = [...db.items.values()].filter((i) => String(i.SK).endsWith("#LATEST"));
        expect(contents.filter((i) => i.title === "Școala")).toEqual([]);
        expect(contents.filter((i) => i.slug === "/coala")).toHaveLength(1);
        expect(rowOf(res.body, "Școala").page).toEqual({ kind: "refused-taken", address: "/coala", heldBy: "Coala" });
        expect(res.body.createdCount).toBe(9);
    });

    it("IP1-TAX-FEATURED: an id with an attachment → image set (option on); without → none, listed", async () => {
        const res = await importAll({ keepOldAddresses: true });
        expect(pageAt("/cursuri/ceara")!.featuredImage).toBe(CDN_IMAGE);
        expect(pageAt("/2024/03/titlu")!.featuredImage).toBeUndefined();
        expect(rowOf(res.body, "Titlu").featuredImage).toEqual({ kind: "missing", id: "999" });
    });
});

describe("IP1-F2 — the same imported item = the same source identity (operator ruling IP1-ITEM-IDENTITY = A)", () => {
    const sitePage = (nodeId: string, slug: string, extra: Record<string, unknown> = {}) => {
        db.put({ PK: T, SK: `CONTENT#${nodeId}#LATEST`, id: `c-${nodeId}`, nodeId, slug, title: "Site page", status: "Published", version: 3, author: "u-human", createdAt: "2025-01-01T00:00:00.000Z", ...extra });
        db.put({ PK: T, SK: `ROUTE#${slug}`, TargetNode: `NODE#${nodeId}`, Type: "Route" });
    };

    it("IP1-F2-SOURCE-WRITTEN: an option-on page holds `wordpressSourceItem` = wordpress:<export host>/<post id>", async () => {
        await importAll({ keepOldAddresses: true });
        expect(pageAt("/cursuri/ceara")!.wordpressSourceItem).toBe(SOURCE("11"));
        expect(pageAt("/2024/03/titlu")!.wordpressSourceItem).toBe(SOURCE("20"));
    });

    it("IP1-F2-OTHER-EXPORT: another export (another host) with the same addresses replaces nothing; each page is refused with the source that holds it", async () => {
        await importAll({ keepOldAddresses: true });
        const before = items();
        const other = FIXTURE_WXR.replaceAll("atelier.example.test", "other.example.test");
        const res = await runImport(handler, { wxrContent: other, keepOldAddresses: true });
        expect(rowOf(res.body, "Ceara").page).toEqual({ kind: "refused-site", address: "/cursuri/ceara", holder: "page", source: SOURCE("11") });
        expect(res.body).toMatchObject({ createdCount: 0, updatedCount: 0 });
        expect(items()).toEqual(before);
    });

    it("IP1-F2-NO-SOURCE: a page without a source identity — made in the admin, or imported flat before — is never replaced", async () => {
        await importAll({ keepOldAddresses: false });   // flat: /cursuri, /coala, /galerie are also kept addresses
        const before = items();
        const res = await importAll({ keepOldAddresses: true });
        for (const [title, address] of [["Cursuri", "/cursuri"], ["Coala", "/coala"], ["Galerie", "/galerie"]]) {
            expect(rowOf(res.body, title).page).toEqual({ kind: "refused-site", address, holder: "page", source: null });
        }
        for (const item of before.filter((i) => ["/cursuri", "/coala", "/galerie"].includes(i.slug))) expect(db.get(T, item.SK)).toEqual(item);
    });

    it("IP1-R5-SITE-REDIRECT: an address held by a redirect of the site is not taken", async () => {
        db.put(redirectRouteItem("t1", "/galerie", "/foto", "2025-01-01T00:00:00.000Z", "u-human"));
        const res = await importAll({ keepOldAddresses: true });
        expect(routeOf("/galerie")).toMatchObject({ IsRedirect: true, RedirectTo: "/foto" });
        expect(rowOf(res.body, "Galerie").page).toEqual({ kind: "refused-site", address: "/galerie", holder: "redirect" });
    });

    it("IP1-IDENTITY-KEEPS-KEY: the same source → updated in place, its translation key copied; the write is conditioned on key, source and route", async () => {
        sitePage("imp1", "/cursuri", { author: "wordpress-importer", translationKey: "K1", wordpressSourceItem: SOURCE("10") });
        const res = await importAll({ keepOldAddresses: true });
        expect(pageAt("/cursuri")).toMatchObject({ nodeId: "imp1", id: "c-imp1", title: "Cursuri", translationKey: "K1", createdAt: "2025-01-01T00:00:00.000Z", wordpressSourceItem: SOURCE("10") });
        const tx = db.commands.find((c) => c instanceof TransactWriteCommand && c.input.TransactItems[0].Put.Item.SK === "CONTENT#imp1#LATEST")!;
        expect(tx.input.TransactItems.map((a: any) => [a.Put.ConditionExpression, a.Put.ExpressionAttributeValues])).toEqual([
            ["translationKey = :readKey AND wordpressSourceItem = :readSource", { ":readKey": "K1", ":readSource": SOURCE("10") }],
            ["TargetNode = :node AND attribute_not_exists(IsRedirect)", { ":node": "NODE#imp1" }],
        ]);
        expect(rowOf(res.body, "Cursuri").page).toEqual({ kind: "kept", address: "/cursuri", write: "update" });
    });

    it("IP1-R5-SECOND-RUN: a second import of the same export updates its own pages and finds its redirects in place", async () => {
        await importAll({ keepOldAddresses: true });
        const before = db.items.size;
        const res = await importAll({ keepOldAddresses: true });
        expect(res.body).toMatchObject({ createdCount: 0, updatedCount: 9 });
        expect(res.body.errors).toBeUndefined();
        expect(rowOf(res.body, "Despre magazin").redirect).toEqual({ kind: "present", from: "/shop/despre", to: "/despre" });
        expect(db.items.size).toBe(before);
    });

    it("IP1-F2-ADMIN-EDIT: an admin edit (PUT /content/<id>, the whole item it read sent back) KEEPS the attribute — on the page and in its history — so the next import still updates the page", async () => {
        await importAll({ keepOldAddresses: true });
        const page = pageAt("/cursuri/ceara")!;
        const res = await updateHandler({
            headers: { "x-tenant-id": "t1" }, pathParameters: { id: page.nodeId },
            body: JSON.stringify({ ...page, title: "Ceara (edited)" }),
            requestContext: { authorizer: { lambda: { sub: "u2", email: "editor@t1.example.test", role: "EDITOR", tenantId: "t1" } }, http: { sourceIp: "127.0.0.1" } },
        } as any, {} as any, () => {}) as any;
        expect(res.statusCode).toBe(200);
        expect(pageAt("/cursuri/ceara")).toMatchObject({ title: "Ceara (edited)", wordpressSourceItem: SOURCE("11") });
        expect(db.get(T, `CONTENT#${page.nodeId}#v1`)).toMatchObject({ wordpressSourceItem: SOURCE("11") });
        const again = await importAll({ keepOldAddresses: true });
        expect(rowOf(again.body, "Ceara").page).toEqual({ kind: "kept", address: "/cursuri/ceara", write: "update" });
    });
});

describe("IP1-F3 — the option-on write is atomic and conditioned on what authorised it (review F-IP1-ATOMICITY)", () => {
    const isTx = (address: string) => (c: any) => c instanceof TransactWriteCommand && c.input.TransactItems[1].Put.Item.SK === `ROUTE#${address}`;

    it("IP1-F3-ROUTE-INSERTED: a route written between the check and the write cancels both writes; the route stays; the row says failed", async () => {
        db.beforeCommand = { match: isTx("/cursuri/ceara"), run: async () => { db.put({ PK: T, SK: "ROUTE#/cursuri/ceara", TargetNode: "NODE#human", Type: "Route" }); } };
        const res = await importAll({ keepOldAddresses: true });
        expect(routeOf("/cursuri/ceara")).toEqual({ PK: T, SK: "ROUTE#/cursuri/ceara", TargetNode: "NODE#human", Type: "Route" });
        expect([...db.items.values()].filter((i) => i.title === "Ceara")).toEqual([]);   // rollback: no content item either
        expect(rowOf(res.body, "Ceara").page).toEqual({ kind: "failed", address: "/cursuri/ceara", error: "the address or the page changed between the check and the write; the database applied nothing" });
        expect(res.body.rows).toHaveLength(11);
    });

    it("IP1-F3-ROUTE-REPLACED: the own page's route turned into a redirect after the check → cancelled; the redirect stays, the page is unchanged", async () => {
        await importAll({ keepOldAddresses: true });
        const page = pageAt("/cursuri")!;
        db.beforeCommand = { match: isTx("/cursuri"), run: async () => { db.put(redirectRouteItem("t1", "/cursuri", "/elsewhere", "2026-01-01T00:00:00.000Z", "u-human")); } };
        const res = await importAll({ keepOldAddresses: true });
        expect(routeOf("/cursuri")).toMatchObject({ IsRedirect: true, RedirectTo: "/elsewhere" });
        expect(db.get(T, `CONTENT#${page.nodeId}#LATEST`)).toEqual(page);
        expect(rowOf(res.body, "Cursuri").page.kind).toBe("failed");
    });

    it("IP1-F3-OWNER-CHANGED: the page's source identity changed after the check → cancelled; the page keeps the new value", async () => {
        await importAll({ keepOldAddresses: true });
        const page = pageAt("/cursuri")!;
        db.beforeCommand = { match: isTx("/cursuri"), run: async () => { db.put({ ...page, wordpressSourceItem: "wordpress:other.example.test/10" }); } };
        const res = await importAll({ keepOldAddresses: true });
        expect(db.get(T, `CONTENT#${page.nodeId}#LATEST`)).toMatchObject({ wordpressSourceItem: "wordpress:other.example.test/10" });
        expect(rowOf(res.body, "Cursuri").page.kind).toBe("failed");
    });

    it("IP1-F3-NEW-PAGE: a new page's transaction is conditioned on both items being absent", async () => {
        await importAll({ keepOldAddresses: true });
        const tx = db.commands.find(isTx("/cursuri/ceara"))!;
        expect(tx.input.TransactItems.map((a: any) => a.Put.ConditionExpression)).toEqual(["attribute_not_exists(SK)", "attribute_not_exists(SK)"]);
    });
});

describe("IP1-F8 — every item keeps its row, and a partial outcome says what was written (review F-IP1-FAILURE-REPORT)", () => {
    it("IP1-F8-READ-FAILS: a failed site read → that row is `failed`, every other row is there, `errors` names it", async () => {
        failNext((c) => c instanceof GetCommand && c.input.Key.SK === "ROUTE#/cursuri");
        const res = await dryEvent({ wxrContent: FIXTURE_WXR });
        expect(res.body.rows).toHaveLength(11);
        expect(rowOf(res.body, "Cursuri").page).toEqual({ kind: "failed", address: "/cursuri", error: "the site could not be read at /cursuri: injected failure" });
        expect(res.body.errors).toEqual(['Failed to process "Cursuri": the site could not be read at /cursuri: injected failure']);
    });

    it("IP1-F8-REDIRECT-FAILS: the page is written and the redirect Put throws → the row says written + redirect NOT CONFIRMED (the Put was sent)", async () => {
        failNext((c) => c instanceof PutCommand && c.input.Item.SK === "ROUTE#/shop/despre");
        const res = await importAll({ keepOldAddresses: true });
        const row = rowOf(res.body, "Despre magazin");
        expect(row.page).toMatchObject({ kind: "moved", address: "/despre", write: "create" });
        expect(row.redirect).toEqual({ kind: "unconfirmed", from: "/shop/despre", to: "/despre", error: "injected failure" });
        expect(pageAt("/despre")).toMatchObject({ title: "Despre magazin" });
        expect(res.body.errors).toEqual(["Redirect /shop/despre → /despre not confirmed: injected failure"]);
    });

    it("IP1-R1-REDIRECT-READ-FAILS: the redirect's site read fails before any Put → `failed` (confirmed: nothing written)", async () => {
        failNext((c) => c instanceof GetCommand && c.input.Key.SK === "ROUTE#/shop/despre");
        const res = await importAll({ keepOldAddresses: true });
        expect(rowOf(res.body, "Despre magazin").redirect).toEqual({ kind: "failed", from: "/shop/despre", to: "/despre", error: "injected failure" });
        expect(routeOf("/shop/despre")).toBeUndefined();
    });

    it("IP1-R1-WRITE-UNCONFIRMED: the transaction commits and its answer is lost → the page is `unconfirmed`, never `failed`; its planned redirect is not attempted", async () => {
        const send = db.send.bind(db);
        db.send = async (cmd: any) => {
            const out = await send(cmd);
            if (cmd instanceof TransactWriteCommand && cmd.input.TransactItems[1].Put.Item.SK === "ROUTE#/atelier/program") throw new Error("response lost after commit");
            return out;
        };
        const res = await importAll({ keepOldAddresses: true });
        const row = rowOf(res.body, "Program");
        expect(row.page).toEqual({ kind: "unconfirmed", address: "/atelier/program", error: "response lost after commit" });
        expect(row.redirect).toEqual({ kind: "not-attempted", from: "/Atelier/Program", to: "/atelier/program" });
        expect(pageAt("/atelier/program")).toMatchObject({ title: "Program" });   // it WAS written
        expect(res.body.errors).toContain('The page "Program" at /atelier/program is not confirmed: response lost after commit');
    });

    it("IP1-R1-IMAGE-NOT-COPIED: the attachment is not in the media map and its copy fails → the page is written, its featured image `not-copied`, listed", async () => {
        h.mediaMap = new Map();
        const res = await importAll({ keepOldAddresses: true });
        const row = rowOf(res.body, "Ceara");
        expect(row.page).toMatchObject({ kind: "kept", write: "create" });
        expect(row.featuredImage).toEqual({ kind: "not-copied", url: OLD_IMAGE, error: "no upload in tests" });
        expect(pageAt("/cursuri/ceara")).toMatchObject({ title: "Ceara" });
        expect(pageAt("/cursuri/ceara")!.featuredImage).toBeUndefined();
        expect(res.body.errors).toContain('The featured image of "Ceara" was not copied: no upload in tests');
    });

    it("IP1-R1-IMAGE-COPIED: an attachment in the media map → `copied`, with the site's URL", async () => {
        const res = await importAll({ keepOldAddresses: true });
        expect(rowOf(res.body, "Ceara").featuredImage).toEqual({ kind: "copied", url: CDN_IMAGE });
    });

    it("IP1-F8-COMMENTS-FAIL: the page is written and a comment write fails → the row says written + commentsError", async () => {
        failNext((c) => c instanceof PutCommand && String(c.input.Item.SK).startsWith("COMMENT#"));
        const res = await importAll({ keepOldAddresses: true });
        const row = rowOf(res.body, "Titlu");
        expect(row.page).toMatchObject({ kind: "kept", write: "create" });
        expect(row.commentsError).toBe("1 of 1 comment writes not confirmed: injected failure");
        expect(pageAt("/2024/03/titlu")).toBeDefined();
    });

    it("IP1-F8-PRODUCT-FAILS: a failed product lookup → the product row is `failed`, with no redirect", async () => {
        failNext((c) => c.input?.IndexName === "GSI_Slug");
        const res = await dryEvent({ wxrContent: FIXTURE_WXR });
        expect(rowOf(res.body, "Vas mare")).toMatchObject({ product: { kind: "failed", error: "injected failure" }, redirect: { kind: "no-target", from: "/produs/vas-mare" } });
    });
});

describe("IP1-REDIRECT — the written redirect is the one the renderer's redirect read finds", () => {
    /**
     * The renderer's read, by its key shape (renderer/src/lib/dynamo.ts:216-228 `getContentBySlug`): Get
     * `{ PK: TENANT#<t>, SK: ROUTE#<slug> }`; a truthy `IsRedirect` → `{ redirect: RedirectTo }` (SitePage.tsx:580-583:
     * `permanentRedirect`, 308); else `TargetNode` → Get `CONTENT#<node>#LATEST`.
     */
    const rendererRead = async (slug: string) => {
        const route = (await db.send(new GetCommand({ TableName: "test-table", Key: { PK: T, SK: `ROUTE#${slug}` } }))).Item;
        if (!route) return null;
        if (route.IsRedirect) return { redirect: route.RedirectTo };
        return (await db.send(new GetCommand({ TableName: "test-table", Key: { PK: T, SK: `CONTENT#${String(route.TargetNode).replace("NODE#", "")}#LATEST` } }))).Item ?? null;
    };
    const legacyPage = (nodeId: string, slug: string) => {
        db.put({ PK: T, SK: `CONTENT#${nodeId}#LATEST`, nodeId, slug, title: "Legacy", status: "Published", author: "u-human" });
        db.put({ PK: T, SK: `ROUTE#${slug}`, TargetNode: `NODE#${nodeId}`, Type: "Route" });
    };

    it("IP1-REDIRECT-RENDERER-READ: every redirect of the import resolves to a published page in one hop, and has the rename's item shape", async () => {
        const res = await importAll({ keepOldAddresses: true });
        const written = res.body.rows.filter((r: any) => r.redirect.kind === "write").map((r: any) => r.redirect);
        expect(written).toEqual([{ kind: "write", from: "/shop/despre", to: "/despre" }, { kind: "write", from: "/Atelier/Program", to: "/atelier/program" }]);
        for (const { from, to } of written) {
            expect(servedBefore(from, from, DEFAULTS)).toBeNull();   // the renderer reaches the lookup at `from`
            expect(await rendererRead(from)).toEqual({ redirect: to });
            expect(await rendererRead(to)).toMatchObject({ slug: to, status: "Published" });
            expect(routeOf(from)).toEqual(redirectRouteItem("t1", from, to, GOLDEN_TIME, "u1"));
        }
    });

    it("IP1-REDIRECT-CREATE-ONLY: a redirect never replaces a route the site holds at the old address", async () => {
        legacyPage("other", "/shop/despre");
        const res = await importAll({ keepOldAddresses: true });
        expect(routeOf("/shop/despre")).toMatchObject({ TargetNode: "NODE#other" });
        expect(rowOf(res.body, "Despre magazin").redirect).toEqual({ kind: "taken-on-site", from: "/shop/despre" });
    });
});

describe("IP1-PRODUCT — the old product address and the site's product page (scope 5; reviews F-IP1-TENANT-LOOKUP, F-IP1-PRODUCT-TARGET)", () => {
    const viaWooCommerce = async (extraColumns = "", extraCells = "") => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1" });
        const csv = [`ID,Type,Name,Published,Regular price${extraColumns}`, `70,simple,Vas mare,1,40${extraCells}`].join("\n");
        const res = await (wooHandler as any)({
            headers: { "x-tenant-id": "t1" }, body: JSON.stringify({ csvContent: csv }),
            requestContext: { authorizer: { lambda: { sub: "u1", email: "admin@t1.example.test", role: "TENANT_ADMIN", tenantId: "t1" } }, http: { sourceIp: "127.0.0.1" } },
        }, {}, () => {});
        expect(JSON.parse(res.body)).toMatchObject({ imported: 1 });
        return [...db.items.values()].find((i) => String(i.SK).startsWith("PRODUCT#"))!;
    };

    it("IP1-PRODUCT-REDIRECT: a product made by the WooCommerce import, active → a redirect old → `<product prefix>/<slug>`", async () => {
        await viaWooCommerce();
        const res = await importAll({ keepOldAddresses: true });
        expect(rowOf(res.body, "Vas mare")).toEqual({
            item: "product", title: "Vas mare", oldAddress: { kind: "path", path: "/produs/vas-mare", raw: "/produs/vas-mare" },
            product: { kind: "found", address: "/product/vas-mare" }, redirect: { kind: "write", from: "/produs/vas-mare", to: "/product/vas-mare" },
        });
        expect(routeOf("/produs/vas-mare")).toEqual(redirectRouteItem("t1", "/produs/vas-mare", "/product/vas-mare", GOLDEN_TIME, "u1"));
    });

    it("IP1-PRODUCT-DRAFT: a draft product → `unavailable` (its page answers 404), no redirect", async () => {
        const product = await viaWooCommerce();
        db.put({ ...product, status: "draft" });
        const res = await importAll({ keepOldAddresses: true });
        expect(rowOf(res.body, "Vas mare")).toMatchObject({ product: { kind: "unavailable", address: "/product/vas-mare", reason: "the product is not active (status: draft), so its page answers 404" }, redirect: { kind: "no-target", from: "/produs/vas-mare" } });
        expect(routeOf("/produs/vas-mare")).toBeUndefined();
    });

    it("IP1-PRODUCT-OUT-OF-DATES: a product past its availability dates → `unavailable`, no redirect", async () => {
        const product = await viaWooCommerce();
        db.put({ ...product, availableUntil: "2026-01-31" });
        const res = await importAll({ keepOldAddresses: true });
        expect(rowOf(res.body, "Vas mare").product).toEqual({ kind: "unavailable", address: "/product/vas-mare", reason: "the product is outside its availability dates (… – 2026-01-31), so its page answers 404" });
        expect(routeOf("/produs/vas-mare")).toBeUndefined();
    });

    it("IP1-PRODUCT-FOREIGN: a matching row of another tenant is not this site's product → not found, no redirect", async () => {
        db.put({ PK: "TENANT#t2", SK: "PRODUCT#p9", TenantSlug: "t1#vas-mare", Type: "Product", id: "p9", slug: "vas-mare", status: "active" });
        const res = await dryEvent({ wxrContent: FIXTURE_WXR });
        expect(rowOf(res.body, "Vas mare")).toMatchObject({ product: { kind: "not-found", tried: ["vas-mare"] }, redirect: { kind: "no-target" } });
    });

    it("IP1-PRODUCT-SAME-ADDRESS: the site's product prefix equals the old one → nothing to redirect", async () => {
        await viaWooCommerce();
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", urlPrefixes: { product: "/produs" } });
        const res = await dryEvent({ wxrContent: FIXTURE_WXR });
        expect(res.body.productAddresses).toEqual({ site: "/produs", old: ["/produs"] });
        expect(rowOf(res.body, "Vas mare")).toMatchObject({ product: { kind: "found", address: "/produs/vas-mare" }, redirect: { kind: "none" } });
    });
});

describe("IP1-OPTION — the option and its default (scope 2, ruling 3)", () => {
    it("IP1-OPTION-DEFAULT-ON: absent, on a site with no imported page → on, and the answer says so", async () => {
        db.put({ PK: T, SK: "CONTENT#h1#LATEST", nodeId: "h1", slug: "/home", author: "u-human" });
        const res = await importAll();
        expect(res.body.keepOldAddresses).toBe(true);
        expect(pageAt("/cursuri/ceara")).toBeDefined();
    });

    it("IP1-OPTION-DEFAULT-OFF: absent, on a site that holds an imported page → off: today's import, the answer adds only `keepOldAddresses: false`", async () => {
        db.put({ PK: T, SK: "CONTENT#imp1#LATEST", nodeId: "imp1", slug: "/old", author: "wordpress-importer" });
        const res = await importAll();
        expect(res.body).toEqual({ processedCount: 10, createdCount: 10, updatedCount: 0, totalCount: 10, complete: true, keepOldAddresses: false });
        expect(pageAt("/ceara")).toMatchObject({ title: "Ceara" });
        expect(routeOf("/cursuri/ceara")).toBeUndefined();
    });

    it("IP1-OPTION-LATER-BATCH: absent on a later batch → 400 (a second decision would see the first batch's pages)", async () => {
        const res = await importAll({ batchStart: 4 });
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toMatch(/keepOldAddresses is required after the first batch/);
        expect(writes()).toEqual([]);
    });

    it("IP1-OPTION-TYPE: not a boolean → 400", async () => {
        const res = await importAll({ keepOldAddresses: "yes" });
        expect(res.statusCode).toBe(400);
        expect(writes()).toEqual([]);
    });
});

describe("IP1-F9 — the extracted reserved-address rule (operator ruling IP1-SHARED-PATH-SCOPE = A)", () => {
    const cases = ["/cart", "/cart/x", "/checkout", "/checkout/confirmation", "/checkout/ORD-1", "/shop", "/shop/x", "/product", "/product/x",
        "/category/x", "/account", "/search", "/my-list", "/my-list/x", "/cursuri", "cart", "/produs/x", "/"];
    it.each([
        ["English defaults, not a catalog", undefined],
        ["custom prefixes, a catalog", { urlPrefixes: { product: "/produs", shop: "/magazin", interest: "/lista" }, catalogMode: true }],
    ])("IP1-F9-PIN: reservedAddressRefusalIn(slug, readReservedAddresses(t)) = reservedAddressRefusal(t, slug) for every case (%s)", async (_what, tenant) => {
        if (tenant) db.put({ PK: "SYSTEM", SK: "TENANT#t1", ...tenant });
        const read = await readReservedAddresses("t1");
        for (const slug of [...cases, "/magazin", "/produs", "/lista", "/lista/x"]) {
            expect(reservedAddressRefusalIn(slug, read)).toBe(await reservedAddressRefusal("t1", slug));
        }
        expect(reservedAddressRefusalIn("/cursuri", read)).toBeNull();
        expect(reservedAddressRefusalIn("cart", DEFAULTS)).toBe('Slug "/cart" uses the address "/cart" of the built-in cart page. Choose a different slug, or change that address in Settings.');
    });

    it("IP1-F9-ONE-READ: readReservedAddresses is one GetItem of the tenant's own record, projected", async () => {
        await readReservedAddresses("t1");
        expect(db.commands.map((c) => [c.constructor.name, c.input])).toEqual([
            ["GetCommand", { TableName: "test-table", Key: { PK: "SYSTEM", SK: "TENANT#t1" }, ProjectionExpression: "urlPrefixes, catalogMode" }],
        ]);
    });
});

describe("IP1-R1-REACH — every old address has one outcome; every destination is reachable (review-1 F-IP1-REACHABILITY)", () => {
    const post = (title: string, slug: string, path: string, wpId: string) => ({ postType: "page" as const, title, slug, link: `https://atelier.example.test${path}`, wpId, sourceHost: "atelier.example.test", content: "<p>x</p>", status: "publish" as const, comments: [] });
    const wxrOf = (rows: [string, string, string, string][]) => `<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/"><channel><link>https://atelier.example.test</link>${
        rows.map(([title, slug, path, id]) => `<item><title>${title}</title><link>https://atelier.example.test${path}</link><content:encoded><![CDATA[<p>x</p>]]></content:encoded><wp:post_id>${id}</wp:post_id><wp:post_name>${slug}</wp:post_name><wp:status>publish</wp:status><wp:post_type>page</wp:post_type></item>`).join("")
    }</channel></rss>`;

    it("IP1-R1-REACH-PLAN: /assets/… is the CDN's (moved, cannot be redirected); /a//b/ is the renderer's own 308 to /a/b (kept at /a/b); /cart/ with post name `cart` → refused AND its old address classified", () => {
        const plans = planAddresses([post("Guide", "guide", "/assets/guide/", "1"), post("AB", "b", "/a//b/", "2"), post("Cart", "cart", "/cart/", "3")], DEFAULTS) as any[];
        expect(plans.map((p) => [p.old, p.placement, p.redirect])).toEqual([
            [{ kind: "path", path: "/assets/guide", raw: "/assets/guide" },
                { kind: "moved", address: "/guide", wanted: "/assets/guide", blocked: { kind: "served-before", by: "the site's CDN serves this address from file storage (/assets/…, /_next/static/…, /favicon.ico)" } },
                { kind: "cannot-redirect", from: "/assets/guide", by: "the site's CDN serves this address from file storage (/assets/…, /_next/static/…, /favicon.ico)" }],
            [{ kind: "path", path: "/a/b", raw: "/a/b", slashesFrom: "/a//b" }, { kind: "kept", address: "/a/b" }, { kind: "none" }],
            [{ kind: "path", path: "/cart", raw: "/cart" },
                { kind: "refused-blocked", address: "/cart", blocked: { kind: "reserved", refusal: 'Slug "/cart" uses the address "/cart" of the built-in cart page. Choose a different slug, or change that address in Settings.' } },
                { kind: "cannot-redirect", from: "/cart", by: "the site's cart page" }],
        ]);
    });

    it("IP1-R1-REACH-REPORT: the whole dry-run report of those three, through the handler", async () => {
        const res = await dryEvent({ wxrContent: wxrOf([["Guide", "guide", "/assets/guide/", "1"], ["AB", "b", "/a//b/", "2"], ["Cart", "cart", "/cart/", "3"]]) });
        expect(res.body.rows.map((r: any) => [r.title, r.page.kind, r.page.address, r.redirect.kind])).toEqual([
            ["Guide", "moved", "/guide", "cannot-redirect"],
            ["AB", "kept", "/a/b", "none"],
            ["Cart", "refused-blocked", "/cart", "cannot-redirect"],
        ]);
        expect(res.body.rows.filter((r: any) => r.redirect.kind === "cannot-redirect")).toHaveLength(2);   // the admin count
    });

    it("IP1-R1-REACH-SOURCE-ALWAYS: a refused page's old address that the renderer reaches is `no-target`, never silent", () => {
        const plans = planAddresses([post("A", "a", "/x/", "1"), post("B", "b", "/X/", "2")], DEFAULTS) as any[];
        expect(plans[1].placement).toEqual({ kind: "refused-taken", address: "/x", heldBy: "A" });
        expect(plans[1].redirect).toEqual({ kind: "no-target", from: "/X" });
    });
});

describe("IP1-R1-PRODUCT — the destination must show the same product (review-1 F-IP1-PRODUCT-TARGET)", () => {
    const viaWooCommerce = async (slugCell?: string) => {
        const header = `ID,Type,Name,Published,Regular price${slugCell !== undefined ? ",Slug" : ""}`;
        const row = `70,simple,Vas mare,1,40${slugCell !== undefined ? `,${slugCell}` : ""}`;
        const res = await (wooHandler as any)({
            headers: { "x-tenant-id": "t1" }, body: JSON.stringify({ csvContent: [header, row].join("\n") }),
            requestContext: { authorizer: { lambda: { sub: "u1", email: "admin@t1.example.test", role: "TENANT_ADMIN", tenantId: "t1" } }, http: { sourceIp: "127.0.0.1" } },
        }, {}, () => {});
        expect(JSON.parse(res.body)).toMatchObject({ imported: 1 });
    };

    it("IP1-R1-PRODUCT-OVERLAP: a product prefix under /checkout → the destination is the order tracking page → `unreachable`, no redirect", async () => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", urlPrefixes: { product: "/checkout" } });
        await viaWooCommerce();
        const res = await importAll({ keepOldAddresses: true });
        expect(rowOf(res.body, "Vas mare")).toMatchObject({
            product: { kind: "unreachable", address: "/checkout/vas-mare", reason: "the site answers /checkout/vas-mare with the site's order tracking page, not with the product page" },
            redirect: { kind: "no-target", from: "/produs/vas-mare" },
        });
        expect(routeOf("/produs/vas-mare")).toBeUndefined();
    });

    const P = "/product";
    it.each([
        ["v%61s-mare", `the product page at ${P}/v%61s-mare reads the slug "vas-mare", and the product's slug is "v%61s-mare"`],
        ["vas-mare?x=1", `${P}/vas-mare?x=1 is not the path a browser requests: a ? or # ends the path of a request, so the rest is not part of the address`],
        ["vas-mare#details", `${P}/vas-mare#details is not the path a browser requests: a ? or # ends the path of a request, so the rest is not part of the address`],
        ["../cart", `${P}/../cart is not the path a browser requests: the URL rewrites this address to /cart (. or .. segments, or \\)`],
        ["vas-mare/", `${P}/vas-mare/ is not the path a browser requests: Next.js answers 308 to the address without its end slash`],
        ["a%ZZ", `${P}/a%ZZ is not the path a browser requests: Next.js cannot decode this address (a malformed %-escape) and answers 400`],
    ])("IP1-R2-PRODUCT-REQUEST: stored slug %s (WooCommerce import, index unchanged) → `unreachable`, no redirect", async (slug, reason) => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1" });
        await viaWooCommerce(slug);
        const product = [...db.items.values()].find((i) => String(i.SK).startsWith("PRODUCT#"))!;
        expect(product).toMatchObject({ slug, TenantSlug: `t1#${slug}` });   // as the WooCommerce import stored it
        const wxr = FIXTURE_WXR.replace("<wp:post_name>vas-mare</wp:post_name>", `<wp:post_name>${slug}</wp:post_name>`);
        const res = await runImport(handler, { wxrContent: wxr, keepOldAddresses: true });
        expect(rowOf(res.body, "Vas mare")).toMatchObject({ product: { kind: "unreachable", address: `${P}/${slug}`, reason }, redirect: { kind: "no-target", from: "/produs/vas-mare" } });
        expect(routeOf("/produs/vas-mare")).toBeUndefined();
    });
});

describe("IP1-R2-COMMENTS — a committed page stays written whatever its comments do (review-2 F-IP1-FAILURE-REPORT)", () => {
    const badDate = "0000-00-00 00:00:00";
    const second = `<wp:comment><wp:comment_author>Second Visitor</wp:comment_author><wp:comment_author_email>second@example.test</wp:comment_author_email><wp:comment_date>${badDate}</wp:comment_date><wp:comment_content>Al doilea.</wp:comment_content><wp:comment_approved>1</wp:comment_approved></wp:comment>`;
    const titluComments = () => [...db.items.values()].filter((i) => String(i.SK).startsWith("COMMENT#"));

    it("IP1-R2-COMMENT-BAD-DATE: the only comment has an unparseable date → page written (kept/create), the comment not written, the row says so", async () => {
        const wxr = FIXTURE_WXR.replace("<wp:comment_date>2024-03-07 08:00:00</wp:comment_date>", `<wp:comment_date>${badDate}</wp:comment_date>`);
        const res = await runImport(handler, { wxrContent: wxr, keepOldAddresses: true });
        const row = rowOf(res.body, "Titlu");
        expect(row.page).toEqual({ kind: "kept", address: "/2024/03/titlu", write: "create" });
        expect(row.commentsError).toBe("1 of 1 comments not written: Invalid time value");
        expect(pageAt("/2024/03/titlu")).toMatchObject({ title: "Titlu" });
        expect(titluComments()).toEqual([]);
    });

    it("IP1-R2-COMMENT-SECOND-BAD: a valid comment then an unparseable one → the first written, the second not, the page written", async () => {
        const wxr = FIXTURE_WXR.replace("</wp:comment>", `</wp:comment>${second}`);
        const res = await runImport(handler, { wxrContent: wxr, keepOldAddresses: true });
        const row = rowOf(res.body, "Titlu");
        expect(row.page).toMatchObject({ kind: "kept", write: "create" });
        expect(row.commentsError).toBe("1 of 2 comments not written: Invalid time value");
        expect(titluComments().map((c) => c.authorName)).toEqual(["Test Visitor"]);
    });

    it("IP1-R2-COMMENT-OPTION-OFF: with the option off the post fails as on 30421e3 (unchanged)", async () => {
        const wxr = FIXTURE_WXR.replace("<wp:comment_date>2024-03-07 08:00:00</wp:comment_date>", `<wp:comment_date>${badDate}</wp:comment_date>`);
        const res = await runImport(handler, { wxrContent: wxr, keepOldAddresses: false });
        expect(res.body.errors).toEqual(['Failed to process "Titlu": Invalid time value']);
    });
});

describe("IP1-R2-UNDECODABLE — an old address Next.js cannot decode (review-2 F-IP1-REACHABILITY)", () => {
    const wxr = `<?xml version="1.0"?><rss xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/"><channel><link>https://atelier.example.test</link><item><title>Pagina</title><link>https://atelier.example.test/a%E0%A4%A/</link><content:encoded><![CDATA[<p>x</p>]]></content:encoded><wp:post_id>1</wp:post_id><wp:post_name>pagina</wp:post_name><wp:status>publish</wp:status><wp:post_type>page</wp:post_type></item></channel></rss>`;

    it("IP1-R2-UNDECODABLE-REPORT: the page goes to its post name; the old address is `cannot be kept or redirected`, with the reason, and counted", async () => {
        const res = await dryEvent({ wxrContent: wxr });
        expect(res.body.rows).toEqual([{
            item: "page", title: "Pagina", oldAddress: { kind: "undecodable", link: "https://atelier.example.test/a%E0%A4%A/", raw: "/a%E0%A4%A" },
            page: { kind: "flat", address: "/pagina", write: "create" },
            redirect: { kind: "cannot-redirect", from: "/a%E0%A4%A", by: "Next.js cannot decode this address (a malformed %-escape) and answers 400" },
            featuredImage: { kind: "none" },
        }]);
        expect(res.body.rows.filter((r: any) => r.redirect.kind === "cannot-redirect")).toHaveLength(1);   // the admin count
    });

    it("IP1-R2-UNDECODABLE-ROUTE: the serving path refuses a malformed escape as an address too", () => {
        expect(servedBefore("/a%E0%A4%A", "/a%E0%A4%A", DEFAULTS)).toBe("Next.js cannot decode this address (a malformed %-escape) and answers 400");
    });
});
