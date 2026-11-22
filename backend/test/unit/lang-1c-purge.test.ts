import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { LangTable } from "./lang-1a-table";

/**
 * LANG-1C (docs/slices/lang-1.md § 9.3; row L1C-PURGE-SIBLINGS-SITEMAP) — what a content write purges. The REAL handlers
 * POST /content (create.ts) and PUT /content/{id} (update.ts) run against the lang-1a in-memory table (lang-1a-table.ts:
 * transactions applied atomically, conditions evaluated). The purge call itself (`revalidateTenantPaths`) is mocked and
 * its arguments are the subject: a write of a page whose LATEST holds a set key AS READ OR AS WRITTEN purges, besides
 * today's targets, the current address of every other page of each named set and `/sitemap.xml`; a page that holds no
 * key before or after purges exactly today's targets, with no extra read. The bulk writers (restore, WordPress import)
 * keep their whole-tenant wrapper. Credential-free.
 *
 * Fixture: tenant t1 (en-US; extra ro, de). Set S = {/about, /ro/despre, /de/uber}; set S2 = {/team, /ro/echipa};
 * /contact and /ro/contact in no set; /draft (Draft) in no set.
 */

const table = vi.hoisted(() => ({ current: null as any }));
const purge = vi.hoisted(() => ({ revalidate: vi.fn(), wrappers: [] as unknown[][] }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => table.current.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));
vi.mock("../../src/lib/slug-guard.js", () => ({ reservedAddressRefusal: vi.fn(async () => null) }));
vi.mock("../../src/lib/revalidate.js", () => ({ revalidateTenantPaths: purge.revalidate, purgeStoredPagesOfRequestTenant: vi.fn() }));
vi.mock("../../src/lib/invalidate-cdn.js", () => ({ withInvalidation: (h: any, ...rest: unknown[]) => { purge.wrappers.push(rest); return h; } }));

import { handler as createHandler } from "../../src/content/create.js";
import { handler as updateHandler } from "../../src/content/update.js";
import { purgeStoredPagesOfRequestTenant } from "../../src/lib/revalidate.js";

const T = "TENANT#t1";
let db: LangTable;

function event(body: unknown, nodeId?: string) {
    return {
        headers: { "x-tenant-id": "t1" },
        pathParameters: nodeId ? { id: nodeId } : undefined,
        body: JSON.stringify(body),
        requestContext: {
            authorizer: { lambda: { sub: "u1", email: "ed@t1.test", role: "TENANT_ADMIN", tenantId: "t1" } },
            http: { sourceIp: "127.0.0.1" },
            requestId: "r1",
        },
    } as any;
}
type Res = { statusCode: number; body: string };
const create = async (body: unknown) => (await (createHandler as any)(event(body), {}, () => {})) as Res;
const update = async (nodeId: string, body: unknown) => (await (updateHandler as any)(event(body, nodeId), {}, () => {})) as Res;

function page(nodeId: string, slug: string, extra: Record<string, unknown> = {}) {
    db.put({ PK: T, SK: `CONTENT#${nodeId}#LATEST`, id: `c-${nodeId}`, nodeId, slug, title: `Page ${nodeId}`, status: "Published", version: 2, blocks: [], ...extra });
    db.put({ PK: T, SK: `ROUTE#${slug}`, TargetNode: `NODE#${nodeId}`, Type: "Route" });
}
function inSet(key: string, ...nodeIds: string[]) {
    for (const n of nodeIds) {
        db.put({ ...db.get(T, `CONTENT#${n}#LATEST`)!, translationKey: key });
        db.put({ PK: T, SK: `TRANSLATION#${key}#${n}`, Type: "Translation" });
    }
}
/** The one purge call's slugs (the handler makes exactly one), with `undefined` kept as the handler passes it. */
function purged(): unknown[] {
    expect(purge.revalidate).toHaveBeenCalledTimes(1);
    const [tenantId, kind, slugs] = purge.revalidate.mock.calls[0];
    expect([tenantId, kind]).toEqual(["t1", "page"]);
    return slugs;
}
/** The reads this write made on translation-set items (Query) — the cost the rule adds. */
const setQueries = () => db.commands.filter((c) => c instanceof QueryCommand && String(c.input.ExpressionAttributeValues[":sk"]).startsWith("TRANSLATION#"));

beforeEach(() => {
    db = new LangTable();
    table.current = db;
    purge.revalidate.mockReset();
    db.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", domain: "t1.test", locale: "en-US", languages: ["ro", "de"] });
    page("en1", "/about"); page("ro1", "/ro/despre"); page("de1", "/de/uber");
    page("en2", "/team"); page("ro2", "/ro/echipa");
    page("en3", "/contact"); page("ro3", "/ro/contact");
    page("dr", "/draft", { status: "Draft" });
    inSet("S", "en1", "ro1", "de1");
    inSet("S2", "en2", "ro2");
});

describe("L1C-PURGE-SIBLINGS-SITEMAP — a page in no set purges exactly today's targets, with no set read", () => {
    it("L1C-PURGE-SIBLINGS-SITEMAP: keyless content edit → [slug, undefined]; keyless rename → [new, old]; keyless create → [slug]", async () => {
        expect((await update("en3", { title: "Contact us" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/contact", undefined]);
        purge.revalidate.mockReset();
        expect((await update("en3", { slug: "/contact-us" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/contact-us", "/contact"]);
        purge.revalidate.mockReset();
        expect((await create({ title: "New", slug: "/new", status: "Published" })).statusCode).toBe(201);
        expect(purged()).toEqual(["/new"]);
        expect(setQueries()).toEqual([]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: a stored key that is not a non-empty string is no key (the reader's rule) → today's targets", async () => {
        db.put({ ...db.get(T, "CONTENT#en3#LATEST")!, translationKey: 5 });
        expect((await update("en3", { title: "x" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/contact", undefined]);
        expect(setQueries()).toEqual([]);
    });
});

describe("L1C-PURGE-SIBLINGS-SITEMAP — a page in a set (as read or as written): its siblings' addresses + /sitemap.xml", () => {
    const SIBLINGS_OF_EN1 = ["/de/uber", "/ro/despre"];   // membership-item SK order (de1 < ro1)

    it("L1C-PURGE-SIBLINGS-SITEMAP: content-only edit of a member", async () => {
        expect((await update("en1", { title: "About us" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/about", undefined, ...SIBLINGS_OF_EN1, "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: rename of a member → both own slugs, the siblings, the sitemap", async () => {
        expect((await update("en1", { slug: "/about-us" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/about-us", "/about", ...SIBLINGS_OF_EN1, "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: publish and unpublish (Archived) of a member", async () => {
        db.put({ ...db.get(T, "CONTENT#de1#LATEST")!, status: "Draft" });
        expect((await update("de1", { status: "Published" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/de/uber", undefined, "/about", "/ro/despre", "/sitemap.xml"]);
        purge.revalidate.mockReset();
        expect((await update("de1", { status: "Archived" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/de/uber", undefined, "/about", "/ro/despre", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: join — a keyless page joins a keyless target (new set): the target's address + the sitemap", async () => {
        expect((await update("en3", { translationOf: "ro3" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/contact", undefined, "/ro/contact", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: join on create — the new page's set's other addresses + the sitemap", async () => {
        const res = await create({ title: "Team DE", slug: "/de/team", status: "Published", translationOf: "en2" });
        expect(res.statusCode, res.body).toBe(201);
        expect(purged()).toEqual(["/de/team", "/team", "/ro/echipa", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: leave — the set it left (read key): the remaining members + the sitemap", async () => {
        expect((await update("en1", { translationOf: null })).statusCode).toBe(200);
        expect(purged()).toEqual(["/about", undefined, ...SIBLINGS_OF_EN1, "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: move — a de page leaves S2 and joins a new set with the keyless /contact: both sets' other addresses + the sitemap", async () => {
        db.put({ PK: T, SK: "ROUTE#/de/team", TargetNode: "NODE#de2", Type: "Route" });
        db.put({ PK: T, SK: "CONTENT#de2#LATEST", id: "c-de2", nodeId: "de2", slug: "/de/team", title: "x", status: "Published", version: 1, blocks: [] });
        inSet("S2", "de2");
        expect((await update("de2", { translationOf: "en3" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/de/team", undefined, "/team", "/ro/echipa", "/contact", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: the purge reads the sets strongly consistent (after its own write); the C3 check keeps today's read", async () => {
        await update("de1", { translationOf: "en2" }).catch(() => undefined); // C3: S2 has no de → join S2, leave S
        const reads = db.commands.filter((c) => (c instanceof QueryCommand && String(c.input.ExpressionAttributeValues[":sk"]).startsWith("TRANSLATION#"))
            || (c instanceof GetCommand && String(c.input.Key.SK).startsWith("CONTENT#") && c.input.ProjectionExpression === "slug, translationKey"));
        const c3 = reads.filter((c) => c.input.ConsistentRead === undefined);
        const purgeReads = reads.filter((c) => c.input.ConsistentRead === true);
        expect(c3.length).toBeGreaterThan(0);
        expect(purgeReads.length).toBeGreaterThan(0);
        // the purge's reads come after the transaction
        const tx = db.commands.findIndex((c) => c.constructor.name === "TransactWriteCommand");
        expect(db.commands.indexOf(purgeReads[0])).toBeGreaterThan(tx);
        expect(purged()).toEqual(["/de/uber", undefined, "/about", "/ro/despre", "/team", "/ro/echipa", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: a failed set read is logged; the write answers 200 and still purges its own slug and the sitemap", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        db.beforeCommand = {
            match: (c) => c instanceof QueryCommand && c.input.ConsistentRead === true,
            run: async () => { throw new Error("injected read failure"); },
        };
        expect((await update("en1", { title: "x" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/about", undefined, "/sitemap.xml"]);
        expect(error).toHaveBeenCalled();
    });
});

describe("L1C-PURGE-SIBLINGS-SITEMAP — `/` when it serves an affected page (review R-LANG1C-01: the root renders homePageSlug)", () => {
    /** The tenant's `homePageSlug` (a settings value; `/` then renders that page, and the head advertises it at `/`). */
    const homeIs = (slug: string) => db.put({ ...db.get("SYSTEM", "TENANT#t1")!, homePageSlug: slug });

    it("L1C-PURGE-SIBLINGS-SITEMAP: a SIBLING is the home — editing /ro/despre purges /about's slug AND /", async () => {
        homeIs("/about");
        expect((await update("ro1", { title: "Despre 2" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/ro/despre", undefined, "/de/uber", "/about", "/", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: the EDITED page is the home (content edit) → /", async () => {
        homeIs("/about");
        expect((await update("en1", { title: "About 2" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/about", undefined, "/de/uber", "/ro/despre", "/", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: rename of the home member (its slug as read is the home) → both slugs and /", async () => {
        homeIs("/about");
        expect((await update("en1", { slug: "/about-us" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/about-us", "/about", "/de/uber", "/ro/despre", "/", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: publication change of a sibling of the home → /", async () => {
        homeIs("/about");
        db.put({ ...db.get(T, "CONTENT#de1#LATEST")!, status: "Draft" });
        expect((await update("de1", { status: "Published" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/de/uber", undefined, "/about", "/ro/despre", "/", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: leave — the set it left holds the home → /", async () => {
        homeIs("/about");
        expect((await update("ro1", { translationOf: null })).statusCode).toBe(200);
        expect(purged()).toEqual(["/ro/despre", undefined, "/de/uber", "/about", "/", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: create/join — the new page joins the set of the home → /", async () => {
        homeIs("/team");
        const res = await create({ title: "Team DE", slug: "/de/team", status: "Published", translationOf: "en2" });
        expect(res.statusCode, res.body).toBe(201);
        expect(purged()).toEqual(["/de/team", "/team", "/ro/echipa", "/", "/sitemap.xml"]);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: the home is in no affected set → no /; a keyless home page purges as today (no / added, no read)", async () => {
        homeIs("/contact");
        expect((await update("en1", { title: "x" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/about", undefined, "/de/uber", "/ro/despre", "/sitemap.xml"]);
        purge.revalidate.mockReset();
        const before = db.commands.length;
        expect((await update("en3", { title: "Contact 2" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/contact", undefined]);
        expect(db.commands.slice(before).some((c) => c instanceof GetCommand && c.input.Key.PK === "SYSTEM")).toBe(false);
    });

    it("L1C-PURGE-SIBLINGS-SITEMAP: a failed homePageSlug read is logged; the siblings and the sitemap are still purged", async () => {
        homeIs("/about");
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        db.beforeCommand = {
            match: (c) => c instanceof GetCommand && c.input.Key.PK === "SYSTEM" && c.input.ProjectionExpression === "homePageSlug",
            run: async () => { throw new Error("injected read failure"); },
        };
        expect((await update("ro1", { title: "x" })).statusCode).toBe(200);
        expect(purged()).toEqual(["/ro/despre", undefined, "/de/uber", "/about", "/sitemap.xml"]);
        expect(error).toHaveBeenCalled();
    });
});

describe("L1C-PURGE-SIBLINGS-SITEMAP — the bulk writers keep their whole-tenant wrapper (no new purge code)", () => {
    it("L1C-PURGE-SIBLINGS-SITEMAP: restore and the WordPress import are wrapped by withInvalidation(…, purgeStoredPagesOfRequestTenant)", async () => {
        purge.wrappers.length = 0;
        vi.resetModules();
        await import("../../src/content/restore.js");
        await import("../../src/import/wordpress.js");
        const { purgeStoredPagesOfRequestTenant: purgeFn } = await import("../../src/lib/revalidate.js");
        expect(purge.wrappers).toHaveLength(2);
        for (const rest of purge.wrappers) expect(rest).toEqual([purgeFn]);
        expect(purgeFn).toBe(purgeStoredPagesOfRequestTenant);
    });
});
