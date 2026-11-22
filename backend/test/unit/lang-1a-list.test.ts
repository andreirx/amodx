import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { LangTable } from "./lang-1a-table";

/**
 * LANG-1A (docs/slices/lang-1.md § 6.2, § 10; review R-L1A-01) — GET /content (content/list.ts) gives the editor what the
 * membership rule needs: `translationKey` on each LATEST, and for a page that holds a key, `hasTranslationItem` = the
 * item `TRANSLATION#<that key>#<nodeId>` exists. A site where no page holds a key gets today's response and one query.
 * Real handler against the in-memory table (lang-1a-table.ts); only `db.js` is mocked. Credential-free.
 */

const h = vi.hoisted(() => ({ table: null as any }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => h.table.send(cmd) }, TABLE_NAME: "test-table" }));

import { handler } from "../../src/content/list.js";

const T = "TENANT#t1";
let db: LangTable;
const list = async () => {
    const res = await (handler as any)({
        headers: { "x-tenant-id": "t1" }, queryStringParameters: undefined,
        requestContext: { authorizer: { lambda: { sub: "u1", role: "TENANT_ADMIN", tenantId: "t1" } }, requestId: "r1" },
    }, {}, () => {});
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body).items as Record<string, any>[];
};
const byNode = (items: Record<string, any>[]) => Object.fromEntries(items.map((i) => [i.nodeId, i]));
const latest = (nodeId: string, slug: string, extra: Record<string, unknown> = {}) =>
    db.put({ PK: T, SK: `CONTENT#${nodeId}#LATEST`, id: `c-${nodeId}`, nodeId, slug, title: nodeId, status: "Published", blocks: [{ big: true }], ...extra });

beforeEach(() => {
    db = new LangTable();
    h.table = db;
    latest("en1", "/about");
    db.put({ PK: T, SK: "CONTENT#en1#v1", nodeId: "en1", slug: "/about", status: "Draft" });
    latest("ro1", "/ro/despre");
});

describe("GET /content — membership evidence (LANG-1A)", () => {
    it("L1A-LIST-MEMBERSHIP: no page holds a key → today's response (no new field) and one query", async () => {
        const items = await list();
        expect(items.map((i) => i.nodeId).sort()).toEqual(["en1", "ro1"]);
        for (const i of items) {
            expect(Object.hasOwn(i, "hasTranslationItem"), i.nodeId).toBe(false);
            expect(Object.hasOwn(i, "translationKey"), i.nodeId).toBe(false);
            expect(Object.hasOwn(i, "blocks"), i.nodeId).toBe(false);
        }
        expect(db.commands.filter((c) => c instanceof QueryCommand)).toHaveLength(1);
    });

    it("L1A-LIST-MEMBERSHIP: a member → true; a key without its item (missing membership) → false; a stale item for an old key → false", async () => {
        latest("en1", "/about", { translationKey: "K1" });
        latest("ro1", "/ro/despre", { translationKey: "K1" });
        latest("de1", "/de/uber", { translationKey: "K1" });            // holds K1, no item
        latest("fr1", "/fr/a", { translationKey: "K2" });               // stale item for K1 below; holds K2 without item
        for (const n of ["en1", "ro1"]) db.put({ PK: T, SK: `TRANSLATION#K1#${n}`, Type: "Translation" });
        db.put({ PK: T, SK: "TRANSLATION#K1#fr1", Type: "Translation" });
        latest("x", "/x");
        const items = byNode(await list());
        expect(items.en1).toMatchObject({ translationKey: "K1", hasTranslationItem: true });
        expect(items.ro1).toMatchObject({ translationKey: "K1", hasTranslationItem: true });
        expect(items.de1).toMatchObject({ translationKey: "K1", hasTranslationItem: false });
        expect(items.fr1).toMatchObject({ translationKey: "K2", hasTranslationItem: false });
        expect(Object.hasOwn(items.x, "hasTranslationItem")).toBe(false);
    });

    it("L1A-LIST-MEMBERSHIP: the membership items are read on every query page", async () => {
        for (let i = 0; i < 5; i++) {
            latest(`p${i}`, `/ro/p${i}`, { translationKey: "K" });
            db.put({ PK: T, SK: `TRANSLATION#K#p${i}`, Type: "Translation" });
        }
        db.pageSize = 2;
        const items = byNode(await list());
        for (let i = 0; i < 5; i++) expect(items[`p${i}`].hasTranslationItem, `p${i}`).toBe(true);
    });
});
