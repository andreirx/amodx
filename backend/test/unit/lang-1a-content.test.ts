import { describe, it, expect, beforeEach, vi } from "vitest";
import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { LangTable } from "./lang-1a-table";

/**
 * LANG-1A (docs/slices/lang-1.md § 5.2 C1-C3, § 6.1, § 6.3, § 11) — the content writers and translation sets: POST
 * /content (create.ts), PUT /content/{id} (update.ts), POST /content/{id}/restore (restore.ts), run as the real handlers
 * against an in-memory table that applies each transaction atomically and evaluates its conditions (lang-1a-table.ts).
 * Mocked: `db.js` (the table), audit, the reserved-address check, the ISR purge and the CDN wrapper — each does its own
 * I/O and is not under test. Credential-free.
 *
 * Fixture: tenant t1, default language en (locale en-US), extra languages ro and de. Pages are LATEST items plus their
 * ROUTE# item. "Member of K" below = the page's LATEST holds K AND `TRANSLATION#K#<nodeId>` exists (§ 6.2, 1 and 3).
 */

const table = vi.hoisted(() => ({ current: null as any }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => table.current.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: vi.fn() }));
vi.mock("../../src/lib/slug-guard.js", () => ({ reservedAddressRefusal: vi.fn(async () => null) }));
vi.mock("../../src/lib/revalidate.js", () => ({ revalidateTenantPaths: vi.fn(), purgeStoredPagesOfRequestTenant: vi.fn() }));
vi.mock("../../src/lib/invalidate-cdn.js", () => ({ withInvalidation: (h: any) => h }));

import { handler as createHandler } from "../../src/content/create.js";
import { handler as updateHandler } from "../../src/content/update.js";
import { restoreHandler } from "../../src/content/restore.js";

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
const restore = async (nodeId: string, version: number) => (await (restoreHandler as any)(event({ version }, nodeId), {}, () => {})) as Res;

function page(nodeId: string, slug: string, extra: Record<string, unknown> = {}) {
    db.put({ PK: T, SK: `CONTENT#${nodeId}#LATEST`, id: `c-${nodeId}`, nodeId, slug, title: `Page ${nodeId}`, status: "Published", version: 2, blocks: [], ...extra });
    db.put({ PK: T, SK: `ROUTE#${slug}`, TargetNode: `NODE#${nodeId}`, Type: "Route" });
}
/** Put `nodeIds` into set `key` the way the backend does: the key on each LATEST, one membership item each. */
function inSet(key: string, ...nodeIds: string[]) {
    for (const n of nodeIds) {
        const item = db.get(T, `CONTENT#${n}#LATEST`)!;
        db.put({ ...item, translationKey: key });
        db.put({ PK: T, SK: `TRANSLATION#${key}#${n}`, Type: "Translation" });
    }
}
const keyOf = (n: string) => db.get(T, `CONTENT#${n}#LATEST`)?.translationKey;
const membershipItems = () => db.keysWithPrefix(T, "TRANSLATION#");
const lastTransaction = () => db.commands.filter((c) => c instanceof TransactWriteCommand).at(-1)!.input.TransactItems as any[];
const membershipActions = (tx: any[]) => tx.filter((a) => {
    const body = a.Put ?? a.Delete ?? a.Update ?? a.ConditionCheck;
    const sk = a.Put ? body.Item.SK : body.Key.SK;
    return String(sk).startsWith("TRANSLATION#");
});

beforeEach(() => {
    db = new LangTable();
    table.current = db;
    db.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", domain: "t1.test", locale: "en-US", languages: ["ro", "de"] });
    page("en1", "/about");
    page("ro1", "/ro/despre");
    page("de1", "/de/uber");
    page("en2", "/contact");
    page("ro2", "/ro/contact");
});

describe("absent translationOf — today's writes (preservation)", () => {
    it("L1A-CONTENT-NO-TRANSOF: create sends today's transaction — the page Put with no condition, the conditional route Put", async () => {
        const res = await create({ title: "New page", slug: "/new", status: "Draft" });
        expect(res.statusCode, res.body).toBe(201);
        const tx = lastTransaction();
        expect(tx).toHaveLength(2);
        expect(tx[0].Put.ConditionExpression).toBeUndefined();
        expect(Object.hasOwn(tx[0].Put.Item, "translationKey")).toBe(false);
        expect(tx[1].Put).toMatchObject({ Item: { SK: "ROUTE#/new" }, ConditionExpression: "attribute_not_exists(SK)" });
    });

    it("L1A-CONTENT-NO-TRANSOF: update sends today's transaction — snapshot Put + LATEST Update with HEAD's expression and no condition", async () => {
        const res = await update("en1", { title: "About us" });
        expect(res.statusCode, res.body).toBe(200);
        const tx = lastTransaction();
        expect(tx).toHaveLength(2);
        expect(tx[0].Put.Item.SK).toBe("CONTENT#en1#v2");
        expect(tx[1].Update.UpdateExpression).toBe("SET title = :t, blocks = :b, #s = :s, commentsMode = :cm, accessPolicy = :ap, seoTitle = :st, seoDescription = :sd, seoKeywords = :sk, featuredImage = :fi, tags = :tags, hideNav = :hn, hideFooter = :hf, hideSharing = :hs, themeOverride = :to, schemaType = :sch, updatedAt = :u, updatedBy = :ub, version = :v");
        expect(tx[1].Update.ConditionExpression).toBeUndefined();
        expect(Object.keys(tx[1].Update.ExpressionAttributeValues).sort()).toEqual([":ap", ":b", ":cm", ":fi", ":hf", ":hn", ":hs", ":s", ":sch", ":sd", ":sk", ":st", ":t", ":tags", ":to", ":u", ":ub", ":v"]);
        // A rename keeps HEAD's four actions, the route condition included.
        await update("en2", { slug: "/contact-us" });
        expect(lastTransaction().map((a) => Object.keys(a)[0])).toEqual(["Put", "Put", "Put", "Update"]);
        expect(lastTransaction()[3].Update.ConditionExpression).toBeUndefined();
    });

    it("L1A-CONTENT-NO-TRANSOF: rule C1 — a `translationKey` in the body is never stored (create and update)", async () => {
        const res = await create({ title: "Sneaky", slug: "/sneaky", translationKey: "forged" });
        expect(res.statusCode).toBe(201);
        const { nodeId } = JSON.parse(res.body);
        expect(keyOf(nodeId)).toBeUndefined();
        expect((await update("en1", { translationKey: "forged" })).statusCode).toBe(200);
        expect(keyOf("en1")).toBeUndefined();
        expect(membershipItems()).toEqual([]);
    });

    it("L1A-CONTENT-NO-TRANSOF: translationOf null on a page in no set changes nothing (create and update)", async () => {
        expect((await create({ title: "N", slug: "/n", translationOf: null })).statusCode).toBe(201);
        expect(lastTransaction()).toHaveLength(2);
        expect((await update("en1", { translationOf: null })).statusCode).toBe(200);
        expect(lastTransaction()[1].Update.ConditionExpression).toBeUndefined();
        expect(membershipItems()).toEqual([]);
    });
});

describe("joining, leaving and moving sets (§ 6.3)", () => {
    it("L1A-SET-NEW-ID: the first link of two unlinked pages (update) makes ONE random id, not a nodeId, on both pages + two items", async () => {
        const res = await update("ro1", { translationOf: "en1" });
        expect(res.statusCode, res.body).toBe(200);
        const k = keyOf("ro1");
        expect(typeof k).toBe("string");
        expect(k).toMatch(/^[0-9a-f-]{36}$/);
        expect(k).not.toBe("ro1");
        expect(k).not.toBe("en1");
        expect(keyOf("en1")).toBe(k);
        expect(membershipItems()).toEqual([`TRANSLATION#${k}#en1`, `TRANSLATION#${k}#ro1`].sort());
        expect(db.get(T, `TRANSLATION#${k}#ro1`)).toEqual({ PK: T, SK: `TRANSLATION#${k}#ro1`, Type: "Translation" });
        // One transaction: snapshot, own LATEST (conditioned on no key), own item, target Update (conditioned), target item.
        const tx = lastTransaction();
        expect(tx[1].Update.ConditionExpression).toBe("attribute_not_exists(translationKey)");
        expect(tx.find((a) => a.Update?.Key.SK === "CONTENT#en1#LATEST").Update.ConditionExpression).toBe("attribute_not_exists(translationKey)");
    });

    it("L1A-SET-NEW-ID: create with translationOf — the new page and the target share one new id; two items", async () => {
        const res = await create({ title: "Uber", slug: "/de/ueber-uns", translationOf: "en2" });
        expect(res.statusCode, res.body).toBe(201);
        const { nodeId } = JSON.parse(res.body);
        const k = keyOf(nodeId);
        expect(k).toMatch(/^[0-9a-f-]{36}$/);
        expect(keyOf("en2")).toBe(k);
        expect(membershipItems()).toEqual([`TRANSLATION#${k}#${nodeId}`, `TRANSLATION#${k}#en2`].sort());
        expect(lastTransaction()[0].Put.ConditionExpression).toBe("attribute_not_exists(translationKey)");
    });

    it("L1A-SET-NEW-ID: create joining an EXISTING set takes its id; the target gets a ConditionCheck, not a write", async () => {
        inSet("K1", "en1", "ro1");
        const res = await create({ title: "Uber", slug: "/de/ueber", translationOf: "en1" });
        expect(res.statusCode, res.body).toBe(201);
        const { nodeId } = JSON.parse(res.body);
        expect(keyOf(nodeId)).toBe("K1");
        const target = lastTransaction().find((a) => (a.ConditionCheck ?? a.Update)?.Key?.SK === "CONTENT#en1#LATEST");
        expect(target.ConditionCheck).toMatchObject({ ConditionExpression: "translationKey = :tpRead", ExpressionAttributeValues: { ":tpRead": "K1" } });
    });

    it("L1A-SET-SAME-NOOP: translationOf naming a page of the set the page is already in → no membership action, no condition", async () => {
        inSet("K1", "en1", "ro1", "de1");
        const before = membershipItems();
        const res = await update("ro1", { title: "Despre noi", translationOf: "de1" });
        expect(res.statusCode, res.body).toBe(200);
        const tx = lastTransaction();
        expect(membershipActions(tx)).toEqual([]);
        expect(tx).toHaveLength(2);
        expect(tx[1].Update.ConditionExpression).toBeUndefined();
        expect(keyOf("ro1")).toBe("K1");
        expect(membershipItems()).toEqual(before);
    });

    it("L1A-SET-LEAVE: null → REMOVE translationKey (conditioned on the key read) + Delete of the own item, in the update's transaction", async () => {
        inSet("K1", "en1", "ro1");
        const res = await update("ro1", { translationOf: null });
        expect(res.statusCode, res.body).toBe(200);
        const tx = lastTransaction();
        expect(tx[1].Update.UpdateExpression).toMatch(/ REMOVE translationKey$/);
        expect(tx[1].Update).toMatchObject({ ConditionExpression: "translationKey = :tkRead", ExpressionAttributeValues: { ":tkRead": "K1" } });
        expect(membershipActions(tx)).toEqual([{ Delete: { TableName: "test-table", Key: { PK: T, SK: "TRANSLATION#K1#ro1" } } }]);
        expect(keyOf("ro1")).toBeUndefined();
        expect(keyOf("en1")).toBe("K1");
        expect(membershipItems()).toEqual(["TRANSLATION#K1#en1"]);
    });

    it("L1A-SET-MOVE: from S1 to S2 — Delete the S1 item, Put the S2 item, ConditionCheck the target; no item gets two actions", async () => {
        inSet("S1", "en1", "ro1");
        inSet("S2", "en2", "de1");
        const res = await update("ro1", { translationOf: "en2" });
        expect(res.statusCode, res.body).toBe(200);
        const tx = lastTransaction();
        expect(membershipActions(tx)).toEqual([
            { Delete: { TableName: "test-table", Key: { PK: T, SK: "TRANSLATION#S1#ro1" } } },
            { Put: { TableName: "test-table", Item: { PK: T, SK: "TRANSLATION#S2#ro1", Type: "Translation" } } },
        ]);
        expect(tx.filter((a) => a.ConditionCheck)).toHaveLength(1);
        const keys = tx.map((a) => { const b = a.Put ?? a.Update ?? a.Delete ?? a.ConditionCheck; return a.Put ? b.Item.SK : b.Key.SK; });
        expect(new Set(keys).size).toBe(keys.length);
        expect(keyOf("ro1")).toBe("S2");
        expect(membershipItems()).toEqual(["TRANSLATION#S1#en1", "TRANSLATION#S2#de1", "TRANSLATION#S2#en2", "TRANSLATION#S2#ro1"]);
    });

    it("L1A-SET-NO-REUSE: A and B share K; A leaves; a new translation of A gets a new id; B keeps K alone", async () => {
        inSet("K", "en1", "ro1");
        expect((await update("en1", { translationOf: null })).statusCode).toBe(200);
        expect((await update("en1", { translationOf: "de1" })).statusCode).toBe(200);
        const k2 = keyOf("en1");
        expect(k2).not.toBe("K");
        expect(k2).toMatch(/^[0-9a-f-]{36}$/);
        expect(keyOf("de1")).toBe(k2);
        expect(keyOf("ro1")).toBe("K");
        expect(membershipItems()).toEqual(["TRANSLATION#K#ro1", `TRANSLATION#${k2}#de1`, `TRANSLATION#${k2}#en1`].sort());
    });
});

describe("refusals (C2, C3) and concurrency", () => {
    it("L1A-TRANSOF-REFUSED: no languages; an unknown page; the page itself → 400, nothing written", async () => {
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", locale: "en-US" });
        const noLangs = await update("ro1", { translationOf: "en1" });
        expect(noLangs.statusCode).toBe(400);
        expect(JSON.parse(noLangs.body).error).toMatch(/^translationOf: this site has no extra languages/);
        expect((await create({ title: "X", slug: "/ro/x", translationOf: "en1" })).statusCode).toBe(400);
        db.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", locale: "en-US", languages: ["ro", "de"] });
        const unknown = await update("ro1", { translationOf: "nope" });
        expect(unknown.statusCode).toBe(400);
        expect(JSON.parse(unknown.body).error).toMatch(/^translationOf: no page with the id "nope"/);
        const self = await update("ro1", { translationOf: "ro1" });
        expect(self.statusCode).toBe(400);
        expect(JSON.parse(self.body).error).toMatch(/^translationOf: a page cannot be a translation of itself/);
        expect(db.commands.filter((c) => c instanceof TransactWriteCommand)).toEqual([]);
        expect(membershipItems()).toEqual([]);
    });

    it("L1A-SET-SAME-LANGUAGE: a target in this page's language, or a set that already has a page in it → 409, nothing written", async () => {
        const same = await update("ro2", { translationOf: "ro1" });
        expect(same.statusCode).toBe(409);
        expect(JSON.parse(same.body).error).toMatch(/same language \(ro\)/);
        expect((await update("en2", { translationOf: "en1" })).statusCode).toBe(409);       // two default-language pages
        inSet("K1", "en1", "ro1");
        const taken = await update("ro2", { translationOf: "en1" });
        expect(taken.statusCode).toBe(409);
        expect(JSON.parse(taken.body).error).toMatch(/already has a page in ro \("\/ro\/despre"\)/);
        expect((await create({ title: "R", slug: "/ro/r", translationOf: "en1" })).statusCode).toBe(409);
        // The language is the one AFTER this write: a rename of ro2 to /de/… in the same request is allowed.
        const renamed = await update("ro2", { slug: "/de/kontakt", translationOf: "en1" });
        expect(renamed.statusCode, renamed.body).toBe(200);
        expect(keyOf("ro2")).toBe("K1");
        expect(db.commands.filter((c) => c instanceof TransactWriteCommand)).toHaveLength(1);
    });

    it("L1A-SET-SAME-LANGUAGE: an item whose page now holds another key does not block (membership rule, condition 3)", async () => {
        inSet("K1", "en1", "ro1");
        db.put({ ...db.get(T, "CONTENT#ro1#LATEST")!, translationKey: "OTHER" });   // stale item TRANSLATION#K1#ro1
        const res = await update("ro2", { translationOf: "en1" });
        expect(res.statusCode, res.body).toBe(200);
        expect(keyOf("ro2")).toBe("K1");
    });

    it("L1A-SET-CONCURRENT: two links of one unlinked page into two sets — the second fails on the page condition → 409; one item matches", async () => {
        inSet("S2", "en2", "de1");
        let second: Res | undefined;
        // Request A (ro1 → en1, a new set) has read ro1 (no key); before its transaction, request B (ro1 → en2) runs whole.
        db.beforeCommand = { match: (c) => c instanceof TransactWriteCommand, run: async () => { second = await update("ro1", { translationOf: "en2" }); } };
        const first = await update("ro1", { translationOf: "en1" });
        expect(second!.statusCode, second!.body).toBe(200);
        expect(first.statusCode).toBe(409);
        expect(JSON.parse(first.body).error).toBe("The page or its translation set changed while saving; load it again.");
        expect(keyOf("ro1")).toBe("S2");
        expect(keyOf("en1")).toBeUndefined();
        expect(membershipItems().filter((sk) => sk.endsWith("#ro1"))).toEqual(["TRANSLATION#S2#ro1"]);
    });

    it("L1A-SET-TARGET-CHANGED: the target's key changed between read and write → its ConditionCheck (or Update) fails → 409", async () => {
        inSet("K1", "en1", "de1");
        db.beforeCommand = { match: (c) => c instanceof TransactWriteCommand, run: async () => { db.put({ ...db.get(T, "CONTENT#en1#LATEST")!, translationKey: "K9" }); } };
        const res = await update("ro1", { translationOf: "en1" });
        expect(res.statusCode).toBe(409);
        expect(keyOf("ro1")).toBeUndefined();
        expect(membershipItems()).toEqual(["TRANSLATION#K1#de1", "TRANSLATION#K1#en1"]);
        // Target without a key that another request links first: the target's Update condition fails.
        db.beforeCommand = { match: (c) => c instanceof TransactWriteCommand, run: async () => { db.put({ ...db.get(T, "CONTENT#en2#LATEST")!, translationKey: "K7" }); } };
        expect((await create({ title: "R", slug: "/ro/r", translationOf: "en2" })).statusCode).toBe(409);
        expect(membershipItems()).toEqual(["TRANSLATION#K1#de1", "TRANSLATION#K1#en1"]);
    });

    it("a rename whose new route is taken still answers today's slug message when set actions are present", async () => {
        const res = await update("ro2", { slug: "/de/uber", translationOf: "en1" });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).error).toMatch(/the new slug is already taken/);
    });
});

describe("restore (§ 6.3, ruling LANG1-RESTORE-SCOPE = A)", () => {
    const history = (nodeId: string, version: number, fields: Record<string, unknown>) =>
        db.put({ PK: T, SK: `CONTENT#${nodeId}#v${version}`, id: `c-${nodeId}`, nodeId, title: "Old title", status: "Published", version, blocks: [{ type: "p" }], snapshotCreatedAt: "2026-01-01T00:00:00.000Z", ...fields });

    it("L1A-RESTORE-KEEPS-KEY-SLUG: a history with another slug and another key → the current slug and key kept; Put conditioned on both", async () => {
        inSet("K1", "en1", "ro1");
        history("ro1", 1, { slug: "/ro/vechi", translationKey: "OLD" });
        const res = await restore("ro1", 1);
        expect(res.statusCode, res.body).toBe(200);
        const latest = db.get(T, "CONTENT#ro1#LATEST")!;
        expect(latest).toMatchObject({ slug: "/ro/despre", translationKey: "K1", title: "Old title", version: 3, restoredFromVersion: 1 });
        const put = db.commands.filter((c) => c instanceof PutCommand).at(-1)!;
        expect(put.input.ConditionExpression).toBe("slug = :readSlug AND translationKey = :readKey");
        expect(put.input.ExpressionAttributeValues).toEqual({ ":readSlug": "/ro/despre", ":readKey": "K1" });
    });

    it("L1A-RESTORE-VS-RENAME: restore reads /old; a concurrent rename to /new (key unchanged) → the restore's condition fails → 409; LATEST keeps /new", async () => {
        page("m1", "/ro/old");
        inSet("K1", "en1", "m1");
        history("m1", 1, { slug: "/ro/old" });
        db.beforeCommand = { match: (c) => c instanceof PutCommand, run: async () => { expect((await update("m1", { slug: "/ro/new" })).statusCode).toBe(200); } };
        const res = await restore("m1", 1);
        expect(res.statusCode).toBe(409);
        expect(db.get(T, "CONTENT#m1#LATEST")).toMatchObject({ slug: "/ro/new", translationKey: "K1", title: "Page m1" });
    });

    it("L1A-RESTORE-THEN-EDIT: an update after a keyed restore keeps the set — its condition holds", async () => {
        inSet("K1", "en1", "ro1");
        history("ro1", 1, { slug: "/ro/despre" });
        expect((await restore("ro1", 1)).statusCode).toBe(200);
        const res = await update("ro1", { title: "Edited", translationOf: "en1" });   // a no-op link: already in K1
        expect(res.statusCode, res.body).toBe(200);
        const leave = await update("ro1", { translationOf: null });                    // conditioned on K1 as read
        expect(leave.statusCode, leave.body).toBe(200);
        expect(keyOf("ro1")).toBeUndefined();
        expect(membershipItems()).toEqual(["TRANSLATION#K1#en1"]);
    });

    it("L1A-RESTORE-NO-KEY-AS-HEAD: a keyless page — the stored item equals HEAD's for the same history (a history slug that differs from the served one)", async () => {
        history("en1", 1, { slug: "/about-old", seoTitle: null, tags: ["x"] });
        const res = await restore("en1", 1);
        expect(res.statusCode, res.body).toBe(200);
        const { updatedAt, ...stored } = db.get(T, "CONTENT#en1#LATEST")!;
        expect(typeof updatedAt).toBe("string");
        // HEAD's restore.ts: { ...history, SK: LATEST, version: current + 1, updatedAt, updatedBy, restoredFromVersion },
        // `snapshotCreatedAt` removed; the history slug written back, no route moved.
        expect(stored).toEqual({
            PK: T, SK: "CONTENT#en1#LATEST", id: "c-en1", nodeId: "en1", title: "Old title", status: "Published", version: 3,
            blocks: [{ type: "p" }], slug: "/about-old", seoTitle: null, tags: ["x"], updatedBy: "u1", restoredFromVersion: 1,
        });
        expect(db.get(T, "ROUTE#/about")).toMatchObject({ TargetNode: "NODE#en1" });
        expect(db.get(T, "ROUTE#/about-old")).toBeUndefined();
    });

    it("L1A-RESTORE-NO-KEY-AS-HEAD: the keyless Put is conditioned attribute_not_exists(translationKey); a history key is not copied", async () => {
        history("en1", 1, { slug: "/about", translationKey: "FROM-HISTORY" });
        expect((await restore("en1", 1)).statusCode).toBe(200);
        const put = db.commands.filter((c) => c instanceof PutCommand).at(-1)!;
        expect(put.input.ConditionExpression).toBe("attribute_not_exists(translationKey)");
        expect(put.input.ExpressionAttributeValues).toBeUndefined();
        expect(keyOf("en1")).toBeUndefined();
    });
});
