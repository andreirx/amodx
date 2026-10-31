import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { MemoryTable } from "./memory-table.js";

/**
 * CAT-IMPORT-1 — the handler `POST /import/glam-pricelist` (docs/slices/cat-import-1.md § 5: lock rows,
 * reconciliation rows, integration rows). The real handler, `requireRole`, `catalog-product.ts`, `catprod.ts` and
 * `withInvalidation` run against an IN-MEMORY table that implements exactly the DynamoDB behaviour they use:
 * Get / Put / Delete with the three condition forms the handler sends, Query on the base table (begins_with, page
 * size, `LastEvaluatedKey`) and on `GSI_Slug`, BatchWrite / BatchGet with injectable `Unprocessed*`, projections,
 * and removal of undefined attributes (the document client's `removeUndefinedValues`). Only `db.js` and `events.js`
 * are replaced. Credential-free.
 */

type Item = Record<string, any>;

const { holder, mockAudit } = vi.hoisted(() => ({ holder: { table: null as any }, mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => holder.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { handler, acquireLock, releaseLock, LOCK_DURATION_MS } from "../../src/import/glam-pricelist.js";
import { parseCsvRecords } from "../../src/import/glam/parse.js";
import { codeHits } from "./glam-code-hits.js";

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────

const HEADER = "colectie,produs,cod vechi,pret achizitie,pret lista,cod nou,unitate,impachetare,comanda minima,imagine,specificatii,format";
const q = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
interface R { c: string; p: string; f?: string; img?: string; specs?: string }
/** Every row carries a code and prices in columns 2–5: they must never reach a written item. */
const csv = (...rows: R[]) => [HEADER, ...rows.map((r) =>
    [r.c, r.p, "OLD-CODE-1", "111.11", "222.22", "NEW-CODE-2", "mp", "", "", r.img ?? "", r.specs ?? "", r.f ?? ""].map(q).join(","))].join("\n") + "\n";
const img = (n: number) => `https://img.test/${n}.jpg`;

const FILE = csv(
    { c: "Herringbone", p: "Oak Vivo", f: "120", img: img(1), specs: "Spec A" },
    { c: "Herringbone", p: "Oak Vivo", f: "140", img: img(2) },
    { c: "Herringbone", p: "Ash", f: "120" },
    { c: "Chevron", p: "Oak Vivo", f: "90", img: img(3) },
);
const SLUGS = ["boen-herringbone-oak-vivo", "boen-herringbone-ash", "boen-chevron-oak-vivo"];

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const SYSTEM_TENANT = (extra: Item = {}) => ({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Glam", catalogMode: true, ...extra });

const event = (body: unknown, opts: { dryRun?: boolean; auth?: any; tenant?: string } = {}) => ({
    headers: { "x-tenant-id": opts.tenant ?? "t1" },
    queryStringParameters: opts.dryRun ? { dryRun: "1" } : undefined,
    routeKey: "POST /import/glam-pricelist",
    requestContext: { authorizer: { lambda: opts.auth ?? TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}) as any;
const call = async (e: any) => {
    const res = (await handler(e, {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};
const body = (csvContent = FILE, extra: Item = {}) => ({ csvContent, producer: "BOEN", sheet: "PL", variantName: "Format", ...extra });

let table: MemoryTable;
const products = () => table.all("PRODUCT#");
const catprod = (categoryId: string) => table.all(`CATPROD#${categoryId}#`).map((i) => i.id).sort();
/** Write commands sent, excluding the CDN markers of `withInvalidation` (`PK SYSTEM`, `SK CDN_*`; checked by `cdnMarkerWritten`). */
const dataWrites = () => table.commands.filter((c) =>
    (c instanceof PutCommand || c instanceof DeleteCommand || c instanceof BatchWriteCommand || c instanceof UpdateCommand) &&
    !String(c.input.Item?.SK ?? c.input.Key?.SK ?? "").startsWith("CDN_"));
const cdnMarkerWritten = () => table.commands.some((c) => (c instanceof PutCommand && c.input.Item?.SK === "CDN_LAST_CHANGE"));
const lockCommands = () => table.commands.filter((c) => String(c.input.Item?.SK ?? c.input.Key?.SK ?? "") === "IMPORTLOCK#glam");

beforeEach(() => {
    table = new MemoryTable();
    holder.table = table;
    table.put(SYSTEM_TENANT());
    mockAudit.mockReset().mockResolvedValue(undefined);
    vi.spyOn(Math, "random").mockReturnValue(0); // full-jitter waits become 0 ms
});
afterEach(() => vi.restoreAllMocks());

// ── integration rows ──────────────────────────────────────────────────────────────────────────────────────────────

describe("CAT-IMPORT-1 integration (in-memory store)", () => {
    it("first import creates N styles + their categories; CATPROD# projections exact; the lock is released", async () => {
        const res = await call(event(body()));
        expect(res.status).toBe(200);
        expect(res.body.counts).toEqual({ deleted: 0, products: 3, options: 4, deduped: 0, skipped: 0 });
        expect(res.body.categoriesCreated).toBe(3);
        expect(products().map((p) => p.slug).sort()).toEqual([...SLUGS].sort());
        expect(products().every((p) => p.importSource === "glam:boen/pl" && p.brand === "BOEN" && p.status === "active")).toBe(true);
        expect(table.all("CATEGORY#").map((c) => [c.slug, c.parentId]).sort()).toEqual([
            ["boen", null], ["boen-chevron", "boen"], ["boen-herringbone", "boen"],
        ]);
        const id = (slug: string) => products().find((p) => p.slug === slug)!.id;
        expect(catprod("boen")).toEqual(products().map((p) => p.id).sort());
        expect(catprod("boen-herringbone")).toEqual([id(SLUGS[0]), id(SLUGS[1])].sort());
        expect(catprod("boen-chevron")).toEqual([id(SLUGS[2])]);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
        // report: products[].productId is the stored id; every row once
        expect(res.body.products.map((p: any) => p.productId).sort()).toEqual(products().map((p) => p.id).sort());
        expect(res.body.rows.map((r: any) => r.status)).toEqual(["created", "option", "created", "created"]);
        expect(cdnMarkerWritten()).toBe(true);
    });

    it("the stored product: one variant group, derived images, attributes; no monetary key and no code anywhere", async () => {
        await call(event(body()));
        const oak = products().find((p) => p.slug === SLUGS[0])!;
        expect(oak.variants).toHaveLength(1);
        expect(oak.variants[0]).toMatchObject({ name: "Format", options: [{ value: "120", imageLink: img(1) }, { value: "140", imageLink: img(2) }] });
        expect(oak.imageLink).toBe(img(1));
        expect(oak.additionalImageLinks).toEqual([img(2)]);
        expect(oak.longDescription).toBe("<p>Spec A</p>");
        expect(oak.attributes).toEqual([{ key: "colecție", value: "Herringbone" }, { key: "unitate", value: "mp" }]);
        const ash = products().find((p) => p.slug === SLUGS[1])!;
        expect("imageLink" in ash).toBe(false);
        for (const p of products()) {
            for (const key of ["price", "salePrice", "volumePricing", "personalizations", "sku"]) expect(key in p).toBe(false);
            for (const o of p.variants[0].options) expect(Object.keys(o).every((k) => k === "value" || k === "imageLink")).toBe(true);
        }
        for (const projection of table.all("CATPROD#")) {
            expect("price" in projection || "salePrice" in projection).toBe(false);
            expect(projection.volumePricing).toEqual([]); // buildCatProdItem's shape, empty
        }
        const everything = JSON.stringify([...table.items.values()]);
        for (const leaked of ["OLD-CODE-1", "111.11", "222.22", "NEW-CODE-2"]) expect(everything).not.toContain(leaked);
    });

    it("re-import of the same file → the same set and slugs, new ids; the old items and projections are gone", async () => {
        await call(event(body()));
        const firstIds = products().map((p) => p.id);
        const res = await call(event(body()));
        expect(res.status).toBe(200);
        expect(res.body.counts.deleted).toBe(3);
        expect(res.body.categoriesCreated).toBe(0);
        expect(products().map((p) => p.slug).sort()).toEqual([...SLUGS].sort());
        expect(products().some((p) => firstIds.includes(p.id))).toBe(false);
        expect(catprod("boen")).toEqual(products().map((p) => p.id).sort());
        expect(table.all("CATEGORY#")).toHaveLength(3);
    });

    it("a changed spec → the style is updated", async () => {
        await call(event(body()));
        await call(event(body(FILE.replace("Spec A", "Spec B"))));
        expect(products().find((p) => p.slug === SLUGS[0])!.longDescription).toBe("<p>Spec B</p>");
    });

    it("previous set deleted: a style absent from the new file disappears with its projections; categories are never deleted", async () => {
        await call(event(body()));
        const smaller = csv({ c: "Herringbone", p: "Ash", f: "120" });
        const res = await call(event(body(smaller)));
        expect(res.body.counts).toMatchObject({ deleted: 3, products: 1 });
        expect(products().map((p) => p.slug)).toEqual([SLUGS[1]]);
        expect(catprod("boen-chevron")).toEqual([]);
        expect(catprod("boen")).toEqual([products()[0].id]);
        expect(table.all("CATEGORY#")).toHaveLength(3);
    });

    it("another sheet's products and hand-made products are not deleted", async () => {
        table.put({ PK: "TENANT#t1", SK: "PRODUCT#other", id: "other", title: "Other sheet", slug: "x", importSource: "glam:boen/pl2", categoryIds: [] });
        table.put({ PK: "TENANT#t1", SK: "PRODUCT#hand", id: "hand", title: "Hand made", slug: "y", categoryIds: [] });
        await call(event(body()));
        await call(event(body()));
        expect(table.get("TENANT#t1", "PRODUCT#other")).toBeDefined();
        expect(table.get("TENANT#t1", "PRODUCT#hand")).toBeDefined();
    });

    it("reconciliation exact: a stale projection is removed, a member of any origin missing its projection gets it, paginated reads", async () => {
        table.pageSize = 2; // every Query paginates
        table.put({ PK: "TENANT#t1", SK: "CATEGORY#boen", id: "boen", slug: "boen", name: "BOEN" });
        // a hand-made product in the producer category, its projection lost by an earlier unacknowledged batch
        table.put({ PK: "TENANT#t1", SK: "PRODUCT#hand", id: "hand", title: "Hand", slug: "hand", status: "active", availability: "in_stock", categoryIds: ["boen"] });
        // a projection whose product no longer exists
        table.put({ PK: "TENANT#t1", SK: "CATPROD#boen#ghost", id: "ghost", title: "Ghost" });
        const res = await call(event(body()));
        expect(res.status).toBe(200);
        expect(catprod("boen")).toEqual([...products().map((p) => p.id)].sort());
        expect(catprod("boen")).toContain("hand");
        expect(catprod("boen")).not.toContain("ghost");
        // the reconciliation read every page of the projections
        const catprodPages = table.commands.filter((c) => c instanceof QueryCommand && c.input.ExpressionAttributeValues[":sk"] === "CATPROD#boen#");
        expect(catprodPages.length).toBeGreaterThan(1);
        expect(catprodPages.every((c) => c.input.ConsistentRead === true)).toBe(true);
    });

    it("an admin-created category (CATEGORY#<uuid>) with the producer's slug is matched by slug, not duplicated", async () => {
        table.put({ PK: "TENANT#t1", SK: "CATEGORY#uuid-1", TenantSlug: "t1#boen", id: "uuid-1", slug: "boen", name: "Boen" });
        const res = await call(event(body()));
        expect(res.body.categoriesCreated).toBe(2);
        expect(table.all("CATEGORY#").filter((c) => c.slug === "boen")).toHaveLength(1);
        expect(products().every((p) => p.categoryIds[0] === "uuid-1")).toBe(true);
        expect(table.get("TENANT#t1", "CATEGORY#boen-chevron")!.parentId).toBe("uuid-1");
    });

    it("the previous-set read is a strongly consistent PRODUCT# query without FilterExpression", async () => {
        await call(event(body()));
        const q = table.commands.find((c) => c instanceof QueryCommand && c.input.ExpressionAttributeValues[":sk"] === "PRODUCT#");
        // CAT-IMPORT-PROFILE-1 § 3.4: the projection gains `importProfileRevision` (the sheet discovery).
        expect(q.input).toMatchObject({ ConsistentRead: true, ProjectionExpression: "id, title, categoryIds, importSource, importProfileRevision" });
        expect(q.input.FilterExpression).toBeUndefined();
    });
});

describe("CAT-IMPORT-1 dry run, refusals and binding", () => {
    it("dry run: reports the previous set (count + first ten titles) and the plan; writes nothing, not even the CDN marker", async () => {
        for (let i = 0; i < 12; i++) {
            table.put({ PK: "TENANT#t1", SK: `PRODUCT#old${String(i).padStart(2, "0")}`, id: `old${i}`, title: `Old ${i}`, importSource: "glam:boen/pl", categoryIds: [] });
        }
        const before = JSON.stringify([...table.items.entries()]);
        const res = await call(event(body(), { dryRun: true }));
        expect(res.status).toBe(200);
        expect(res.body.dryRun).toBe(true);
        expect(res.body.previousSet.count).toBe(12);
        expect(res.body.previousSet.firstTitles).toHaveLength(10);
        expect(res.body.counts).toEqual({ deleted: 12, products: 3, options: 4, deduped: 0, skipped: 0 });
        expect(res.body.categoriesCreated).toBe(3);
        expect(res.body.products.every((p: any) => !("productId" in p))).toBe(true);
        expect(JSON.stringify([...table.items.entries()])).toBe(before);
        expect(dataWrites()).toEqual([]);
        expect(cdnMarkerWritten()).toBe(false);
        expect(lockCommands()).toEqual([]);
    });

    it.each([
        ["missing tenant record → 404", null, 404],
        ["non-catalog tenant → 403", SYSTEM_TENANT({ catalogMode: false }), 403],
    ])("%s, read with ConsistentRead, before the lock: nothing written", async (_n, tenant, status) => {
        table.items.clear();
        if (tenant) table.put(tenant);
        const res = await call(event(body()));
        expect(res.status).toBe(status);
        const tenantRead = table.commands.find((c) => c instanceof GetCommand && c.input.Key.SK === "TENANT#t1");
        expect(tenantRead.input.ConsistentRead).toBe(true);
        expect(lockCommands()).toEqual([]);
        expect(dataWrites()).toEqual([]);
    });

    it.each([
        ["producer with /", { producer: "a/b", sheet: "c" }],
        ["sheet with /", { producer: "a", sheet: "b/c" }],
        ["producer with U+001F", { producer: "a\u001f", sheet: "c" }],
        ["missing csvContent", { csvContent: "" }],
        ["a 13-cell row", { csvContent: `${HEADER}\nC,P,1,2,3,4,5,6,7,8,9,10,11\n` }],
    ])("400 before any read or write: %s", async (_n, extra) => {
        const res = await call(event(body(FILE, extra)));
        expect(res.status).toBe(400);
        expect(table.commands).toEqual([]);
    });

    it("a file with no product row → 400 with the report; nothing deleted", async () => {
        await call(event(body()));
        table.commands = [];
        const res = await call(event(body(csv({ c: "", p: "Oak" }))));
        expect(res.status).toBe(400);
        expect(res.body.rows).toEqual([{ status: "skipped", index: 2, reason: "no-collection" }]);
        expect(products()).toHaveLength(3);
        expect(dataWrites()).toEqual([]);
    });

    it("tenant binding: a TENANT_ADMIN of another tenant → 403, nothing read", async () => {
        const res = await call(event(body(), { auth: { ...TENANT_ADMIN, tenantId: "t2" } }));
        expect(res.status).toBe(403);
        expect(table.commands).toEqual([]);
    });

    it("an EDITOR of the tenant may import (IMPORT-POLICY-1 D1 rule)", async () => {
        const res = await call(event(body(), { dryRun: true, auth: { ...TENANT_ADMIN, role: "EDITOR" } }));
        expect(res.status).toBe(200);
    });

    it("service key: catalog:write for its own tenant → admitted; without it → 403 before any read", async () => {
        const key = (scopes: string) => ({ sub: "service:k1", role: "SERVICE", tenantId: "t1", scopes, keyId: "k1" });
        expect((await call(event(body(), { dryRun: true, auth: key("catalog:write") }))).status).toBe(200);
        table.commands = [];
        const refused = await call(event(body(), { dryRun: true, auth: key("catalog:read") }));
        expect(refused.status).toBe(403);
        expect(refused.body.error).toMatch(/lacks scope catalog:write/);
        expect(table.commands).toEqual([]);
    });
});

// ── lock rows ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe("CAT-IMPORT-1 lock (IMPORTLOCK#glam)", () => {
    it("acquire: conditional put attribute_not_exists(SK) with an owner token and expiresAt = now + 15 min", async () => {
        expect(await acquireLock("t1", "me")).toBe(true);
        const put = lockCommands()[0];
        expect(put).toBeInstanceOf(PutCommand);
        expect(put.input.ConditionExpression).toBe("attribute_not_exists(SK)");
        const lock = table.get("TENANT#t1", "IMPORTLOCK#glam")!;
        expect(lock.owner).toBe("me");
        expect(lock.expiresAt - Date.now()).toBeGreaterThan(LOCK_DURATION_MS - 5000);
        expect(LOCK_DURATION_MS).toBe(15 * 60 * 1000);
    });

    it("a contender of a live lock → 409 and touches nothing (neither writes nor deletes the lock)", async () => {
        table.put({ PK: "TENANT#t1", SK: "IMPORTLOCK#glam", owner: "other", expiresAt: Date.now() + 60_000 });
        const res = await call(event(body()));
        expect(res.status).toBe(409);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")!.owner).toBe("other");
        expect(lockCommands().filter((c) => c instanceof DeleteCommand)).toEqual([]);
        expect(products()).toEqual([]);
        expect(dataWrites().filter((c) => !(c instanceof PutCommand && c.input.ConditionExpression === "attribute_not_exists(SK)"))).toEqual([]);
        expect(cdnMarkerWritten()).toBe(false);
    });

    it("stale takeover: a lock past expiresAt is taken with a condition on the observed expiresAt; the import runs", async () => {
        const observed = Date.now() - 1;
        table.put({ PK: "TENANT#t1", SK: "IMPORTLOCK#glam", owner: "dead", expiresAt: observed });
        const res = await call(event(body()));
        expect(res.status).toBe(200);
        const takeover = lockCommands().find((c) => c instanceof PutCommand && c.input.ConditionExpression === "expiresAt = :observed");
        expect(takeover.input.ExpressionAttributeValues[":observed"]).toBe(observed);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
    });

    it("two takeovers of one stale lock: only the first wins", async () => {
        table.put({ PK: "TENANT#t1", SK: "IMPORTLOCK#glam", owner: "dead", expiresAt: Date.now() - 1 });
        const realSend = table.send.bind(table);
        const staleRead = { ...table.get("TENANT#t1", "IMPORTLOCK#glam") };
        expect(await acquireLock("t1", "first")).toBe(true);
        // the second job's consistent read saw the stale lock before the first job's takeover landed
        table.send = async (cmd: any) => (cmd instanceof GetCommand && cmd.input.Key.SK === "IMPORTLOCK#glam" ? { Item: staleRead } : realSend(cmd));
        expect(await acquireLock("t1", "second")).toBe(false);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")!.owner).toBe("first");
    });

    it("owner-only release: DeleteCommand conditioned on owner = :me; a successor's lock is kept", async () => {
        table.put({ PK: "TENANT#t1", SK: "IMPORTLOCK#glam", owner: "successor", expiresAt: Date.now() + 60_000 });
        await releaseLock("t1", "me");
        const del = lockCommands().find((c) => c instanceof DeleteCommand);
        expect(del.input).toMatchObject({ ConditionExpression: "#owner = :me", ExpressionAttributeNames: { "#owner": "owner" }, ExpressionAttributeValues: { ":me": "me" } });
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")!.owner).toBe("successor");
        await releaseLock("t1", "successor");
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
    });

    it("a failure part-way → 500 naming the step; the lock is released in finally; no CDN marker", async () => {
        table.failOn = (cmd) => cmd instanceof PutCommand && String(cmd.input.Item?.SK).startsWith("PRODUCT#");
        const res = await call(event(body()));
        expect(res.status).toBe(500);
        expect(res.body.failedStep).toBe("create");
        expect(res.body.recovery).toBe("Import the same file again: it replaces the sheet's products in full.");
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
        expect(cdnMarkerWritten()).toBe(false);
        // recovery: the same file again
        const again = await call(event(body()));
        expect(again.status).toBe(200);
        expect(products()).toHaveLength(3);
    });
});

// ── reconciliation rows (unprocessed retries, 503) ────────────────────────────────────────────────────────────────

describe("CAT-IMPORT-1 reconciliation — acknowledged writes and complete reads", () => {
    it("UnprocessedItems are resent (within 5 resends) until acknowledged → 200, projections exact", async () => {
        let left = 3;
        table.unprocessedWrites = (requests) => (left-- > 0 ? requests.slice(0, 1) : []);
        const res = await call(event(body()));
        expect(res.status).toBe(200);
        expect(catprod("boen")).toEqual(products().map((p) => p.id).sort());
    });

    it("UnprocessedItems still left after 5 resends → 503 with incompleteCategories naming each category; no CDN marker", async () => {
        // every reconciliation write of the producer category stays unprocessed
        table.unprocessedWrites = (requests) => requests.filter((r) => String(r.PutRequest?.Item?.SK ?? r.DeleteRequest?.Key?.SK).startsWith("CATPROD#boen#")
            && table.commands.some((c) => c instanceof BatchGetCommand));
        const res = await call(event(body()));
        expect(res.status).toBe(503);
        expect(res.body.incompleteCategories).toEqual([{ categoryId: "boen", unreadProducts: 0, unwrittenProjections: 3 }]);
        expect(res.body.counts.products).toBe(3); // the full report is returned
        const reconcileWrites = table.commands.filter((c) => c instanceof BatchWriteCommand
            && c.input.RequestItems["test-table"].some((r: any) => String(r.PutRequest?.Item?.SK).startsWith("CATPROD#boen#"))
            && table.commands.indexOf(c) > table.commands.findIndex((x) => x instanceof BatchGetCommand));
        expect(reconcileWrites).toHaveLength(6); // first send + 5 resends
        expect(cdnMarkerWritten()).toBe(false);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
    });

    it("UnprocessedKeys left after 5 resends → 503 unreadProducts; nothing is written for the unread ids", async () => {
        // The category being reconciled = the one whose CATPROD# read came last; record its unread ids.
        const currentCategory = () => {
            const q = [...table.commands].reverse().find((c) => c instanceof QueryCommand && String(c.input.ExpressionAttributeValues[":sk"]).startsWith("CATPROD#"));
            return String(q.input.ExpressionAttributeValues[":sk"]).slice("CATPROD#".length, -1);
        };
        const unreadIn = new Map<string, Set<string>>();
        table.unprocessedKeys = (keys) => {
            const stuck = keys.filter((k) => k.SK === keys[0].SK);
            const category = currentCategory();
            if (!unreadIn.has(category)) unreadIn.set(category, new Set());
            for (const k of stuck) unreadIn.get(category)!.add(String(k.SK).slice("PRODUCT#".length));
            return stuck;
        };
        const res = await call(event(body()));
        expect(res.status).toBe(503);
        const incomplete = res.body.incompleteCategories;
        expect(incomplete.length).toBe(3);
        expect(incomplete.every((c: any) => c.unreadProducts === 1 && c.unwrittenProjections === 0)).toBe(true);
        // no reconciliation write of category C (after the first BatchGet) names a product unread in C
        const firstGet = table.commands.findIndex((c) => c instanceof BatchGetCommand);
        const reconcileRequests = table.commands.slice(firstGet).filter((c) => c instanceof BatchWriteCommand)
            .flatMap((c) => c.input.RequestItems["test-table"]);
        expect(unreadIn.size).toBe(3);
        for (const r of reconcileRequests) {
            const sk = String(r.PutRequest?.Item?.SK ?? r.DeleteRequest?.Key?.SK);
            const [, category, id] = sk.split("#");
            expect(unreadIn.get(category)?.has(id) ?? false).toBe(false);
        }
    });

    it("BatchGet chunks of at most 100 keys (150 products in one category)", async () => {
        const rows: R[] = Array.from({ length: 150 }, (_, i) => ({ c: "Herringbone", p: `Oak ${i}` }));
        const res = await call(event(body(csv(...rows))));
        expect(res.status).toBe(200);
        const gets = table.commands.filter((c) => c instanceof BatchGetCommand);
        expect(gets.every((c) => c.input.RequestItems["test-table"].Keys.length <= 100)).toBe(true);
        expect(catprod("boen")).toHaveLength(150);
    });
});

// ── cycle 2 (review-0 corrections, cat-import-1 § 9) ──────────────────────────────────────────────────────────────

describe("CAT-IMPORT-1 category matching by slug (review-0 correction 1, § 9 CI1-CATEGORY-OCCUPANCY)", () => {
    const seedPrevious = () => table.put({ PK: "TENANT#t1", SK: "PRODUCT#old", id: "old", title: "Old", importSource: "glam:boen/pl", categoryIds: [] });

    it("renamed category: CATEGORY#boen whose stored slug is now 'renamed-boen' → 409 naming it, decided under the lock, before any deletion", async () => {
        seedPrevious();
        table.put({ PK: "TENANT#t1", SK: "CATEGORY#boen", TenantSlug: "t1#renamed-boen", id: "boen", slug: "renamed-boen", name: "Boen" });
        const res = await call(event(body()));
        expect(res.status).toBe(409);
        expect(res.body.categoryConflicts).toEqual([{ slug: "boen", storedSlug: "renamed-boen" }]);
        expect(res.body.error).toMatch(/"boen" \(now "renamed-boen"\)/);
        expect(table.get("TENANT#t1", "PRODUCT#old")).toBeDefined();
        expect(table.get("TENANT#t1", "CATEGORY#boen")!.slug).toBe("renamed-boen");
        // the only writes are the lock's own: taken, then released by its owner
        expect(dataWrites().map((c) => [c.constructor.name, c.input.Item?.SK ?? c.input.Key?.SK])).toEqual([
            ["PutCommand", "IMPORTLOCK#glam"], ["DeleteCommand", "IMPORTLOCK#glam"],
        ]);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
    });

    it("overlapping imports (review-1 R1): B pauses before taking the lock while A runs completely → B decides categories under the lock → 200, the same set", async () => {
        const realSend = table.send.bind(table);
        let paused = false;
        let a: any;
        table.send = async (cmd: any) => {
            if (!paused && cmd instanceof PutCommand && cmd.input.Item?.SK === "IMPORTLOCK#glam") {
                paused = true; // B has read the tenant (categories absent) and is about to take the lock
                a = await call(event(body()));
            }
            return realSend(cmd);
        };
        const b = await call(event(body()));
        expect(a.status).toBe(200);
        expect(a.body.categoriesCreated).toBe(3);
        expect(b.status).toBe(200);
        expect(b.body.counts.deleted).toBe(3);
        expect(b.body.categoriesCreated).toBe(0);
        expect(products().map((p) => p.slug).sort()).toEqual([...SLUGS].sort());
        expect(table.all("CATEGORY#")).toHaveLength(3);
        expect(catprod("boen")).toEqual(products().map((p) => p.id).sort());
    });

    it("a category renamed between the tenant read and the lock is seen under the lock → 409, nothing deleted, lock released", async () => {
        seedPrevious();
        table.put({ PK: "TENANT#t1", SK: "CATEGORY#boen", TenantSlug: "t1#boen", id: "boen", slug: "boen", name: "Boen" });
        const realSend = table.send.bind(table);
        table.send = async (cmd: any) => {
            if (cmd instanceof PutCommand && cmd.input.Item?.SK === "IMPORTLOCK#glam") {
                table.put({ PK: "TENANT#t1", SK: "CATEGORY#boen", TenantSlug: "t1#renamed-boen", id: "boen", slug: "renamed-boen", name: "Boen" });
            }
            return realSend(cmd);
        };
        const res = await call(event(body()));
        expect(res.status).toBe(409);
        expect(res.body.categoryConflicts).toEqual([{ slug: "boen", storedSlug: "renamed-boen" }]);
        expect(table.get("TENANT#t1", "PRODUCT#old")).toBeDefined();
        expect(table.commands.some((c) => c instanceof DeleteCommand && String(c.input.Key.SK).startsWith("PRODUCT#"))).toBe(false);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
    });

    it("renamed category: a dry run reports the conflict (200) and writes nothing", async () => {
        table.put({ PK: "TENANT#t1", SK: "CATEGORY#boen", TenantSlug: "t1#renamed-boen", id: "boen", slug: "renamed-boen", name: "Boen" });
        const res = await call(event(body(), { dryRun: true }));
        expect(res.status).toBe(200);
        expect(res.body.categoryConflicts).toEqual([{ slug: "boen", storedSlug: "renamed-boen" }]);
        expect(res.body.categoriesCreated).toBe(2); // the two children; the parent is neither matched nor created
        expect(dataWrites()).toEqual([]);
    });

    it("an admin-created category found on GSI page two is matched, not duplicated; the lookup projects SK, id, slug", async () => {
        table.pageSize = 1;
        // page one of GSI_Slug "t1#boen": a product that shares the index key; page two: the category
        table.put({ PK: "TENANT#t1", SK: "PRODUCT#same-slug", TenantSlug: "t1#boen", id: "same-slug", title: "X", slug: "boen", categoryIds: [] });
        table.put({ PK: "TENANT#t1", SK: "CATEGORY#uuid-9", TenantSlug: "t1#boen", id: "uuid-9", slug: "boen", name: "Boen" });
        const res = await call(event(body()));
        expect(res.status).toBe(200);
        expect(table.all("CATEGORY#").filter((c) => c.slug === "boen").map((c) => c.id)).toEqual(["uuid-9"]);
        expect(products().filter((p) => p.importSource).every((p) => p.categoryIds[0] === "uuid-9")).toBe(true);
        const gsi = table.commands.filter((c) => c instanceof QueryCommand && c.input.IndexName === "GSI_Slug" && c.input.ExpressionAttributeValues[":ts"] === "t1#boen");
        expect(gsi.length).toBe(2);
        expect(gsi[1].input.ExclusiveStartKey).toBeDefined();
        expect(gsi.every((c) => c.input.ProjectionExpression === "SK, id, slug")).toBe(true);
    });

    it("a GSI item whose stored slug differs from the requested one is not a match", async () => {
        table.put({ PK: "TENANT#t1", SK: "CATEGORY#uuid-7", TenantSlug: "t1#boen", id: "uuid-7", slug: "something-else", name: "Stale" });
        const res = await call(event(body()));
        expect(res.status).toBe(200);
        expect(table.get("TENANT#t1", "CATEGORY#boen")).toBeDefined();
        expect(products().every((p) => p.categoryIds[0] === "boen")).toBe(true);
    });

    it("a category key occupied between the lookup and the create (an overlapping admin edit) is never overwritten → 500 at step categories", async () => {
        const realSend = table.send.bind(table);
        table.send = async (cmd: any) => {
            // the previous-set read comes after the category lookup and before the category create
            if (cmd instanceof QueryCommand && cmd.input.ExpressionAttributeValues[":sk"] === "PRODUCT#") {
                table.put({ PK: "TENANT#t1", SK: "CATEGORY#boen-chevron", id: "boen-chevron", slug: "boen-chevron", name: "Admin's" });
            }
            return realSend(cmd);
        };
        const res = await call(event(body()));
        expect(res.status).toBe(500);
        expect(res.body.failedStep).toBe("categories");
        expect(table.get("TENANT#t1", "CATEGORY#boen-chevron")!.name).toBe("Admin's");
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
    });
});

describe("CAT-IMPORT-1 request contract and early failures (review-0 correction 5)", () => {
    it.each([["null", "null"], ["an array", "[]"], ["a string", '"x"'], ["a number", "1"]])("a JSON body that is %s → 400, nothing read", async (_n, raw) => {
        const e = event({});
        e.body = raw;
        const res = await call(e);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("The request body must be a JSON object.");
        expect(table.commands).toEqual([]);
    });

    it.each([
        // [step, failing command, lock acquired before the failure?]
        ["tenant-read", (c: any) => c instanceof GetCommand && c.input.Key.SK === "TENANT#t1", false],
        ["lock", (c: any) => c instanceof PutCommand && c.input.Item?.SK === "IMPORTLOCK#glam", false],
        ["categories-lookup", (c: any) => c instanceof GetCommand && String(c.input.Key.SK).startsWith("CATEGORY#"), true],
        ["previous-set", (c: any) => c instanceof QueryCommand && c.input.ExpressionAttributeValues?.[":sk"] === "PRODUCT#", true],
    ])("a failure at step %s → 500 naming it; nothing changed; the lock is released only if it was acquired", async (stepName, predicate, acquired) => {
        table.put({ PK: "TENANT#t1", SK: "PRODUCT#old", id: "old", title: "Old", importSource: "glam:boen/pl", categoryIds: [] });
        table.failOn = predicate as (c: any) => boolean;
        const res = await call(event(body()));
        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({ failedStep: stepName, recovery: "No product or category was changed. Try again." });
        const releases = table.commands.filter((c) => c instanceof DeleteCommand && c.input.Key.SK === "IMPORTLOCK#glam");
        expect(releases).toHaveLength(acquired ? 1 : 0);
        expect(table.commands.some((c) => c instanceof DeleteCommand && String(c.input.Key.SK).startsWith("PRODUCT#"))).toBe(false);
        expect(products().map((p) => p.id)).toEqual(["old"]);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
        expect(cdnMarkerWritten()).toBe(false);
    });

    it("mutation-phase boundary: a failure after it, with an empty previous set and nothing committed, still gives the conservative re-import recovery", async () => {
        table.failOn = (c: any) => c instanceof PutCommand && String(c.input.Item?.SK).startsWith("CATEGORY#");
        const res = await call(event(body()));
        expect(res.status).toBe(500);
        expect(res.body.failedStep).toBe("categories");
        expect(res.body.recovery).toBe("Import the same file again: it replaces the sheet's products in full.");
        expect(table.all("CATEGORY#")).toEqual([]);
        expect(products()).toEqual([]);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
    });

    it("a dry-run failure is step-labelled too (previous-set)", async () => {
        table.failOn = (c) => c instanceof QueryCommand && c.input.ExpressionAttributeValues[":sk"] === "PRODUCT#";
        const res = await call(event(body(), { dryRun: true }));
        expect(res.status).toBe(500);
        expect(res.body.failedStep).toBe("previous-set");
    });
});

// ── the acceptance fixture through the handler (call counts for the implementation record) ──────────────────────

describe("CAT-IMPORT-1 BOEN PL.csv through the handler", () => {
    it("import then re-import: report counts equal the acceptance block; the DynamoDB calls by kind are recorded", async () => {
        const { readFileSync } = await import("fs");
        const path = await import("path");
        const dir = path.resolve(__dirname, "fixtures/glam");
        const expected = JSON.parse(readFileSync(path.join(dir, "cat-import-1-expected-counts.json"), "utf8")).acceptance["BOEN/PL"];
        const file = readFileSync(path.join(dir, "boen-PL.csv"), "utf8");

        const kinds = () => {
            const count: Record<string, number> = {};
            for (const c of table.commands) {
                const sk = String(c.input.Item?.SK ?? c.input.Key?.SK ?? c.input.ExpressionAttributeValues?.[":sk"] ?? "");
                const kind = c instanceof QueryCommand ? (c.input.IndexName ? "Query GSI_Slug" : `Query ${sk.split("#")[0]}#`)
                    : c instanceof BatchWriteCommand ? "BatchWrite CATPROD#"
                    : c instanceof BatchGetCommand ? "BatchGet PRODUCT#"
                    : `${c.constructor.name.replace("Command", "")} ${sk.startsWith("CDN_") ? "CDN marker" : sk.split("#")[0] + "#"}`;
                count[kind] = (count[kind] ?? 0) + 1;
            }
            return count;
        };

        table.writes = [];
        const first = await call(event({ csvContent: file, producer: "BOEN", sheet: "PL", variantName: "Format" }));
        const firstWrites = table.writes;
        expect(first.status).toBe(200);
        expect(first.body.counts).toEqual({ deleted: 0, products: expected.styles, options: expected.options, deduped: expected.deduped, skipped: 0 });
        expect(first.body.categoriesCreated).toBe(expected.collections + 1);
        console.log("[CAT-IMPORT-1] BOEN first import DynamoDB calls:", JSON.stringify(kinds()), "total", table.commands.length);
        const slugs = products().map((p) => p.slug).sort();

        table.commands = [];
        table.writes = [];
        const second = await call(event({ csvContent: file, producer: "BOEN", sheet: "PL", variantName: "Format" }));
        const secondWrites = table.writes;
        expect(second.status).toBe(200);
        expect(second.body.counts.deleted).toBe(expected.styles);
        expect(products().map((p) => p.slug).sort()).toEqual(slugs);
        console.log("[CAT-IMPORT-1] BOEN re-import DynamoDB calls:", JSON.stringify(kinds()), "total", table.commands.length);
        expect(catprod("boen")).toHaveLength(expected.styles);
        expect(table.all("CATPROD#")).toHaveLength(2 * expected.styles);

        // § 9 code-removal oracle over the WRITE HISTORY of both imports (review-1 R3): every product, category and
        // projection payload the handler wrote — including first-import items the re-import deleted and projection
        // versions the reconciliation overwrote — image fields excepted: no field holds a column-2/5 value of any row.
        const records = parseCsvRecords(file);
        if (records.kind !== "records") throw new Error(records.error);
        const codes = [...new Set(records.records.slice(1).flatMap((r) => [r[2], r[5]]).map((c) => c.trim()).filter(Boolean))];
        const bySk = (ws: Item[], prefix: string) => ws.filter((w) => String(w.SK).startsWith(prefix)).length;
        expect([bySk(firstWrites, "PRODUCT#"), bySk(firstWrites, "CATEGORY#"), bySk(firstWrites, "CATPROD#")]).toEqual([437, 28, 1748]);
        expect([bySk(secondWrites, "PRODUCT#"), bySk(secondWrites, "CATEGORY#"), bySk(secondWrites, "CATPROD#")]).toEqual([437, 0, 1748]);
        expect(codeHits(firstWrites, codes)).toEqual([]);
        expect(codeHits(secondWrites, codes)).toEqual([]);
        // positive control: a code in a non-image field of a written payload is detected; in the image fields it is not
        const product = firstWrites.find((w) => String(w.SK).startsWith("PRODUCT#"))!;
        expect(codeHits([{ ...product, description: `${product.description} ${codes[0]}` }], codes)).toHaveLength(1);
        expect(codeHits([{ ...product, attributes: [{ key: "unitate", value: codes[1] }] }], codes)).toHaveLength(1);
        expect(codeHits([{ imageLink: codes[0], additionalImageLinks: [codes[0]], variants: [{ options: [{ value: "v", imageLink: codes[0] }] }] }], codes)).toEqual([]);
        expect(codeHits(second.body, codes).filter((h) => !h.includes(".sourceUrl"))).toEqual([]); // report: only the image source cell
    });
});

// ── CAT-IMPORT-PROFILE-1A: the import profile through the handler (docs/slices/cat-import-profile-1.md § 7.4) ───────

describe("CAT-IMPORT-PROFILE-1A import profile (stored item, acceptance, stamps, failures)", () => {
    const DEFAULT = { version: 1, grouping: { kind: "as-is" }, collection: { kind: "column" }, specKeys: [], facetModes: { attributes: [] } };
    const P1 = { ...DEFAULT, specKeys: [{ key: "Wood", action: "attribute", label: "Esență", split: "none" }], facetModes: { attributes: [{ key: "Esență", mode: "always" }] } };
    const P2 = { ...DEFAULT, specKeys: [{ key: "Wood", action: "attribute", label: "Lemn", split: "none" }], facetModes: { attributes: [] } };
    const P3 = { ...DEFAULT, specKeys: [{ key: "Wood", action: "prose-only" }], facetModes: { attributes: [] } };
    const WOOD = csv(
        { c: "Herringbone", p: "Oak Vivo", f: "120", img: img(1), specs: "Wood: Oak" },
        { c: "Herringbone", p: "Oak Vivo", f: "140", img: img(2), specs: "Wood: Oak\nPrice: 9 EUR" },
        { c: "Chevron", p: "Ash", f: "90", specs: "Wood: Ash" },
    );
    const choice = (profile: unknown, baseRevision: number | null) => ({ profileChoice: { profile, baseRevision } });
    const profileItem = () => table.get("TENANT#t1", "IMPORTPROFILE#glam#boen");
    const storeProfile = (profile: unknown, revision: number) =>
        table.put({ PK: "TENANT#t1", SK: "IMPORTPROFILE#glam#boen", Type: "ImportProfile", producer: "BOEN", profile, revision });
    const profilePuts = () => table.commands.filter((c) => c instanceof PutCommand && c.input.Item?.SK === "IMPORTPROFILE#glam#boen");
    const productWrites = () => table.commands.filter((c) => String(c.input.Item?.SK ?? c.input.Key?.SK ?? "").startsWith("PRODUCT#")
        && (c instanceof PutCommand || c instanceof DeleteCommand));

    it("explicit profile, none stored → the item (revision 1) is written BEFORE the first product write; every product stamped", async () => {
        const res = await call(event(body(WOOD, choice(P1, null))));
        expect(res.status).toBe(200);
        expect(profileItem()).toMatchObject({ Type: "ImportProfile", producer: "BOEN", profile: P1, revision: 1, updatedBy: "admin@t1.test" });
        const order = table.commands.indexOf(profilePuts()[0]);
        expect(order).toBeGreaterThan(-1);
        expect(order).toBeLessThan(table.commands.indexOf(productWrites()[0]));
        expect(profilePuts()[0].input.ConditionExpression).toBe("attribute_not_exists(SK)");
        expect(products().every((p) => p.importProfileRevision === 1)).toBe(true);
        expect(products().every((p) => JSON.stringify(p.facetModes) === JSON.stringify(P1.facetModes))).toBe(true);
        expect(products().find((p) => p.slug === "boen-herringbone-oak-vivo")!.attributes)
            .toEqual([{ key: "colecție", value: "Herringbone" }, { key: "unitate", value: "mp" }, { key: "Esență", value: "Oak" }]);
        expect(res.body.profile).toEqual({ source: "explicit", revision: 1, value: P1, stored: { kind: "none" } });
        expect(res.body.sheets).toEqual([{ importSource: "glam:boen/pl", products: 2, state: "current", revisions: [1], unstamped: 0 }]);
        expect(res.body.specLineRefusals).toEqual([]);
        expect(mockAudit.mock.calls[0][0].details).toMatchObject({ profileRevision: 1, profileSource: "explicit" });
    });

    it("dry run with an explicit profile writes nothing; drafts are the execution's items; siteProducts carry only the listing/facet fields", async () => {
        table.put({ PK: "TENANT#t1", SK: "PRODUCT#hand", id: "hand", title: "Hand", status: "active", categoryIds: ["boen"], brand: "X", price: "1", attributes: [{ key: "a", value: "b" }] });
        table.put({ PK: "TENANT#t1", SK: "PRODUCT#old", id: "old", title: "Old", importSource: "glam:boen/pl", categoryIds: [] });
        const before = JSON.stringify([...table.items.entries()]);
        const res = await call(event(body(WOOD, choice(P1, null)), { dryRun: true }));
        expect(res.status).toBe(200);
        expect(JSON.stringify([...table.items.entries()])).toBe(before);
        expect(dataWrites()).toEqual([]);
        expect(lockCommands()).toEqual([]);
        expect(res.body.profile).toMatchObject({ source: "explicit", revision: 1 });
        expect(res.body.drafts.map((d: any) => [d.id, d.importProfileRevision, d.categoryIds])).toEqual([
            ["preview:boen-herringbone-oak-vivo", 1, ["new:boen", "new:boen-herringbone"]],
            ["preview:boen-chevron-ash", 1, ["new:boen", "new:boen-chevron"]],
        ]);
        expect(res.body.drafts.every((d: any) => !("PK" in d) && !("SK" in d) && !("TenantSlug" in d) && d.status === "active")).toBe(true);
        expect(res.body.siteProducts).toEqual([{ id: "hand", status: "active", categoryIds: ["boen"], brand: "X", attributes: [{ key: "a", value: "b" }] }]);
        const wood = res.body.specKeys.find((k: any) => k.key === "Wood");
        expect(wood).toMatchObject({ rows: 3, products: 2, distinctValues: 2, rule: { action: "attribute", label: "Esență", split: "none" } });
        expect(res.body.specKeys.find((k: any) => k.key === "Price")).toMatchObject({ refused: [{ rowIndex: 3, reason: "money" }], samples: [], rule: { action: "not-reviewed" } });
    });

    it("re-import without profileChoice (the MCP form) applies the stored profile: source stored, no profile write, same stamp", async () => {
        await call(event(body(WOOD, choice(P1, null))));
        table.commands = [];
        const res = await call(event(body(WOOD)));
        expect(res.status).toBe(200);
        expect(res.body.profile).toEqual({ source: "stored", revision: 1, value: P1 });
        expect(profilePuts()).toEqual([]);
        expect(products().every((p) => p.importProfileRevision === 1)).toBe(true);
        expect(mockAudit.mock.calls.at(-1)![0].details).toMatchObject({ profileRevision: 1, profileSource: "stored" });
    });

    it("acceptance: baseRevision equal → revision + 1 (conditioned on the observed revision); stale base but equal content → accepted, no write", async () => {
        storeProfile(P1, 1);
        let res = await call(event(body(WOOD, choice(P2, 1))));
        expect(res.status).toBe(200);
        expect(profileItem()).toMatchObject({ profile: P2, revision: 2 });
        expect(profilePuts()[0].input).toMatchObject({ ConditionExpression: "#revision = :observed", ExpressionAttributeValues: { ":observed": 1 } });
        table.commands = [];
        res = await call(event(body(WOOD, choice(P2, 1))));
        expect(res.status).toBe(200);
        expect(res.body.profile).toMatchObject({ source: "explicit", revision: 2, stored: { kind: "supported", revision: 2 } });
        expect(profilePuts()).toEqual([]);
        expect(products().every((p) => p.importProfileRevision === 2 && !("facetModes" in p))).toBe(true);
    });

    it("acceptance: base and content both differ → 409 before the lock; nothing written", async () => {
        storeProfile(P1, 1);
        await call(event(body(WOOD)));
        const before = JSON.stringify(products());
        table.commands = [];
        const res = await call(event(body(WOOD, choice(P2, 7))));
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ storedRevision: 1, baseRevision: 7 });
        expect(res.body.error).toMatch(/changed by another import/);
        expect(dataWrites()).toEqual([]);
        expect(lockCommands()).toEqual([]);
        expect(JSON.stringify(products())).toBe(before);
    });

    it("a profile changed between the early read and the lock is seen under the lock → 409, nothing changed, lock released", async () => {
        storeProfile(P1, 1);
        const send = table.send.bind(table);
        let reads = 0;
        table.send = async (cmd: any) => {
            const out = await send(cmd);
            if (cmd instanceof GetCommand && cmd.input.Key.SK === "IMPORTPROFILE#glam#boen" && ++reads === 1) storeProfile(P3, 2);
            return out;
        };
        const res = await call(event(body(WOOD, choice(P2, 1))));
        expect(res.status).toBe(409);
        expect(reads).toBe(2);
        expect(productWrites()).toEqual([]);
        expect(profilePuts()).toEqual([]);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
    });

    it("step `profile` fails → 500 'the profile may have been saved'; no product or category changed; the retry is accepted", async () => {
        table.failOn = (c) => c instanceof PutCommand && c.input.Item?.SK === "IMPORTPROFILE#glam#boen";
        let res = await call(event(body(WOOD, choice(P1, null))));
        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({ failedStep: "profile", recovery: expect.stringMatching(/^No product or category was changed; the profile may have been saved/) });
        expect(products()).toEqual([]);
        expect(table.all("CATEGORY#")).toEqual([]);
        expect(table.get("TENANT#t1", "IMPORTLOCK#glam")).toBeUndefined();
        res = await call(event(body(WOOD, choice(P1, null))));
        expect(res.status).toBe(200);
        expect(profileItem()).toMatchObject({ revision: 1 });
    });

    it("step `profile` saved but its answer was lost → the retry with the same choice is accepted by 'stored equals sent'", async () => {
        const send = table.send.bind(table);
        let lost = false;
        table.send = async (cmd: any) => {
            const out = await send(cmd);
            if (!lost && cmd instanceof PutCommand && cmd.input.Item?.SK === "IMPORTPROFILE#glam#boen") { lost = true; throw new Error("timeout"); }
            return out;
        };
        expect((await call(event(body(WOOD, choice(P1, null))))).status).toBe(500);
        expect(profileItem()).toMatchObject({ revision: 1 });
        expect(products()).toEqual([]);
        const res = await call(event(body(WOOD, choice(P1, null))));
        expect(res.status).toBe(200);
        expect(res.body.profile).toMatchObject({ source: "explicit", revision: 1, stored: { kind: "supported", revision: 1 } });
        expect(products().every((p) => p.importProfileRevision === 1)).toBe(true);
    });

    it("a failure after the mutation phase → the retry with the same snapshot reproduces the plan of that profile", async () => {
        const clean = new MemoryTable();
        clean.put(SYSTEM_TENANT());
        holder.table = clean;
        await call(event(body(WOOD, choice(P1, null))));
        const expected = clean.all("PRODUCT#").map((p) => [p.slug, p.attributes, p.importProfileRevision]).sort();
        holder.table = table;
        table.failOn = (c) => c instanceof PutCommand && String(c.input.Item?.SK).startsWith("PRODUCT#");
        const failed = await call(event(body(WOOD, choice(P1, null))));
        expect(failed.status).toBe(500);
        expect(failed.body.recovery).toBe("Import the same file again: it replaces the sheet's products in full.");
        const res = await call(event(body(WOOD, choice(P1, null))));
        expect(res.status).toBe(200);
        expect(products().map((p) => [p.slug, p.attributes, p.importProfileRevision]).sort()).toEqual(expected);
    });

    it("sheet states: current / stale / mixed / no-profile, from the products' stamps (another producer excluded)", async () => {
        storeProfile(P1, 2);
        const seed = (id: string, importSource: string, importProfileRevision?: number) =>
            table.put({ PK: "TENANT#t1", SK: `PRODUCT#${id}`, id, title: id, importSource, categoryIds: [], ...(importProfileRevision ? { importProfileRevision } : {}) });
        seed("a1", "glam:boen/a", 2); seed("a2", "glam:boen/a", 2);
        seed("b1", "glam:boen/b", 1);
        seed("c1", "glam:boen/c", 2); seed("c2", "glam:boen/c");
        seed("d1", "glam:boen/d");
        seed("x1", "glam:itc/x", 2);
        const res = await call(event(body(WOOD), { dryRun: true }));
        expect(res.body.sheets.map((s: any) => [s.importSource, s.state, s.revisions, s.unstamped])).toEqual([
            ["glam:boen/a", "current", [2], 0], ["glam:boen/b", "stale", [1], 0], ["glam:boen/c", "mixed", [2], 1], ["glam:boen/d", "no-profile", [], 1],
        ]);
    });

    it.each([
        ["an unknown key", { ...P1, valueMap: {} }, /valueMap/],
        ["an unknown enum value", { ...P1, grouping: { kind: "trailing-letter" } }, /grouping/],
        ["version 2", { ...P1, version: 2 }, /version/],
    ])("versioning: a stored profile with %s → dry run 'unsupported' (unprofiled plan); execution 409; replaced only with its revision", async (_n, stored, reason) => {
        storeProfile(stored, 4);
        const dry = await call(event(body(WOOD), { dryRun: true }));
        expect(dry.status).toBe(200);
        expect(dry.body.profile).toMatchObject({ source: "unsupported", revision: 4, reason: expect.stringMatching(reason) });
        expect(dry.body.drafts.every((d: any) => !("importProfileRevision" in d))).toBe(true);
        table.commands = [];
        const refused = await call(event(body(WOOD)));
        expect(refused.status).toBe(409);
        expect(refused.body.error).toMatch(/cannot apply/);
        expect(dataWrites()).toEqual([]);
        expect((await call(event(body(WOOD, choice(P2, 3))))).status).toBe(409);
        expect(profileItem()).toMatchObject({ revision: 4 });
        const replaced = await call(event(body(WOOD, choice(P2, 4))));
        expect(replaced.status).toBe(200);
        expect(profileItem()).toMatchObject({ profile: P2, revision: 5 });
        expect(products().every((p) => p.importProfileRevision === 5)).toBe(true);
    });

    it("intervening import: stored m=2 after a failed import with n=1 → admin retry (n, base 1) 409; (n, base 2) accepted; MCP form applies m", async () => {
        storeProfile(P1, 1);           // the failed import's snapshot n
        storeProfile(P2, 2);           // another import stored m
        expect((await call(event(body(WOOD, choice(P1, 1))))).status).toBe(409);
        const mcp = await call(event(body(WOOD)));
        expect(mcp.body.profile).toMatchObject({ source: "stored", revision: 2 });
        expect(products().every((p) => p.importProfileRevision === 2)).toBe(true);
        const overwrite = await call(event(body(WOOD, choice(P1, 2))));
        expect(overwrite.status).toBe(200);
        expect(profileItem()).toMatchObject({ profile: P1, revision: 3 });
    });

    it("an invalid profileChoice → 400 before any read", async () => {
        for (const bad of [choice({ ...P1, version: 2 }, null), choice(P1, 0), { profileChoice: "x" },
            choice({ ...DEFAULT, specKeys: [{ key: "Wood", action: "attribute", label: "colecție", split: "none" }] }, null)]) {
            table.commands = [];
            const res = await call(event(body(WOOD, bad)));
            expect(res.status).toBe(400);
            expect(table.commands).toEqual([]);
        }
    });

    it("O-CODES-4 (handler): a cross-row code in a selected line is refused (row 3, code); no written payload holds it outside images", async () => {
        const file = [HEADER,
            "Coll,Oak,AAA-1,1.00,2.00,,mp,,,https://img.test/1.jpg,Wood: Oak,1",
            `Coll,Oak,BBB-2,1.00,2.00,,mp,,,https://img.test/2.jpg,"Wood: Oak\nAlternate article: AAA-1",2`].join("\n") + "\n";
        table.writes = [];
        const res = await call(event(body(file, choice({ ...DEFAULT, specKeys: [{ key: "Alternate article", action: "attribute", label: "Articol", split: "none" }] }, null))));
        expect(res.status).toBe(200);
        expect(res.body.specLineRefusals).toEqual([{ key: "Alternate article", rowIndex: 3, reason: "code" }]);
        expect(codeHits(table.writes, ["AAA-1", "BBB-2"])).toEqual([]);
        expect(products()[0].attributes.some((a: any) => a.key === "Articol")).toBe(false);
    });

    it("O-CODES-3 + O-PRICES-1 (BOEN, worst-case profile: every key an attribute, split comma): no code in the write history outside images; no monetary key", async () => {
        const { readFileSync } = await import("fs");
        const path = await import("path");
        const file = readFileSync(path.resolve(__dirname, "fixtures/glam/boen-PL.csv"), "utf8");
        const records = parseCsvRecords(file);
        if (records.kind !== "records") throw new Error(records.error);
        const codes = [...new Set(records.records.slice(1).flatMap((r) => [r[2], r[5]]).map((c) => c.trim()).filter(Boolean))];
        const keys = [...new Set(records.records.slice(1).flatMap((r) => r[10].split(/\r\n|\r|\n/)).map((l) => l.split(":")[0].trim()).filter(Boolean))];
        const worst = { ...DEFAULT, specKeys: keys.map((k) => ({ key: k, action: "attribute", label: `L ${k}`, split: "comma" })) };
        table.writes = [];
        const res = await call(event({ csvContent: file, producer: "BOEN", sheet: "PL", variantName: "Format", ...choice(worst, null) }));
        expect(res.status).toBe(200);
        expect(res.body.counts).toMatchObject({ products: 437, options: 455 });
        expect(products().filter((p) => p.attributes.some((a: any) => a.key.startsWith("L "))).length).toBe(280);
        expect(codeHits(table.writes, codes)).toEqual([]);
        const product = table.writes.find((w) => String(w.SK).startsWith("PRODUCT#"))!;
        expect(codeHits([{ ...product, attributes: [{ key: "L Wood", value: codes[0] }] }], codes)).toHaveLength(1); // positive control
        for (const item of table.writes) {
            for (const key of ["price", "salePrice", "volumePricing", "personalizations", "sku"]) {
                if (String(item.SK).startsWith("PRODUCT#")) expect(key in item).toBe(false);
            }
            if (String(item.SK).startsWith("CATPROD#")) expect("price" in item || "salePrice" in item).toBe(false);
        }
    });
});
