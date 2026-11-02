import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BatchWriteCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { MemoryTable, type Item } from "./memory-table.js";

/**
 * CAT-IMAGES-1 — `POST /import/glam-pricelist/images` (slice docs/slices/cat-images-1.md § 5 integration rows, § 7
 * CIM-A1-1). The real function (`glam-pricelist.ts` dispatching on `routeKey`) runs the real import first, then the
 * image copy, against the in-memory table: `requireRole`, `catalog-product.ts`, `catprod.ts`, `media-map.ts` and
 * `withInvalidation` are real. Replaced: `db.js` (the table), `events.js` (audit), and `copyImageToTenantMedia` — the
 * copy port, whose policy is tested in image-destination-policy.test.ts. Credential-free, no network.
 */

const { holder, mockAudit, copy } = vi.hoisted(() => ({ holder: { table: null as any }, mockAudit: vi.fn(), copy: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => holder.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/image-upload.js", () => ({ copyImageToTenantMedia: copy }));

import { handler } from "../../src/import/glam-pricelist.js";
import { COPY_START_BUDGET_MS } from "../../src/import/glam-images.js";
import { parseCsvRecords, parseGlamCsv } from "../../src/import/glam/parse.js";
import { checkUpload, planGlamImport } from "../../src/import/glam/map.js";

const CDN = "https://cdn.test";
const HEADER = "colectie,produs,cod vechi,pret achizitie,pret lista,cod nou,unitate,impachetare,comanda minima,imagine,specificatii,format";
interface R { c: string; p: string; f?: string; img?: string }
const csv = (...rows: R[]) => [HEADER, ...rows.map((r) => [r.c, r.p, "", "", "", "", "mp", "", "", r.img ?? "", "", r.f ?? ""].join(","))].join("\n") + "\n";
const img = (n: number) => `https://img.test/${n}.jpg`;
const copied = (url: string) => `${CDN}/t1/copy-of-${url.split("/").pop()}`;

/** 3 styles; img(1) — the main image of the first style — is dead. */
const FILE = csv(
    { c: "Herringbone", p: "Oak Vivo", f: "120", img: img(1) },
    { c: "Herringbone", p: "Oak Vivo", f: "140", img: img(2) },
    { c: "Herringbone", p: "Ash", f: "120" },
    { c: "Chevron", p: "Oak Vivo", f: "90", img: img(3) },
);
const DEAD = new Set([img(1)]);
const fakeCopy = async (_tenant: string, url: string) => (DEAD.has(url)
    ? { kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 } }
    : { kind: "copied", cdnUrl: copied(url) });

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const IMPORT = "POST /import/glam-pricelist";
const IMAGES = "POST /import/glam-pricelist/images";

const event = (routeKey: string, body: unknown, opts: { auth?: any; tenant?: string } = {}) => ({
    routeKey,
    headers: { "x-tenant-id": opts.tenant ?? "t1" },
    requestContext: { authorizer: { lambda: opts.auth ?? TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}) as any;
const call = async (e: any) => {
    const res = (await handler(e, {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};
const importFile = (csvContent = FILE) => call(event(IMPORT, { csvContent, producer: "BOEN", sheet: "PL", variantName: "Format" }));
const copyImages = (extra: Item = {}) => call(event(IMAGES, { producer: "BOEN", sheet: "PL", ...extra }));
const DEFAULT_PROFILE_DTO = { version: 1, grouping: { kind: "as-is" }, collection: { kind: "column" }, specKeys: [], facetModes: { attributes: [] } };
/** An import whose profile publishes products without images (every product `active`; saved as revision 1 on a fresh table). */
const importPublished = (csvContent = FILE) => call(event(IMPORT, {
    csvContent, producer: "BOEN", sheet: "PL", variantName: "Format",
    profileChoice: { profile: { ...DEFAULT_PROFILE_DTO, publishWithoutImages: true }, baseRevision: null },
}));

let table: MemoryTable;
const bySlug = (slug: string) => table.all("PRODUCT#").find((p) => p.slug === slug)!;
/** The product writes of the image copy (every one starts with the existence guard). */
const updates = () => table.commands.filter((c) => c instanceof UpdateCommand && String(c.input.ConditionExpression).startsWith("attribute_exists(PK)"));

beforeEach(() => {
    table = new MemoryTable();
    holder.table = table;
    table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Glam", catalogMode: true });
    mockAudit.mockReset().mockResolvedValue(undefined);
    copy.mockReset().mockImplementation(fakeCopy);
    process.env.UPLOADS_BUCKET = "uploads-test";
    process.env.UPLOADS_CDN_URL = CDN;
    vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => vi.restoreAllMocks());

describe("CAT-IMAGES-1 integration (in-memory store)", () => {
    it("3 styles, one dead URL → 2 ingested, 1 reported; the option imageless; derived fields recomputed; CATPROD# rewritten", async () => {
        expect((await importFile()).status).toBe(200);
        table.commands = [];

        const res = await copyImages();
        expect(res.status).toBe(200);
        expect(res.body.counts).toEqual({ ingested: 2, cached: 0, refused: 0, failed: 1, extras: { ingested: 0, cached: 0, refused: 0, failed: 0 } });
        expect(res.body.complete).toBe(true);
        expect(res.body.progress).toEqual({ sourcesAtStart: 3, resolved: 3, remainingOptions: 0, remainingExtras: 0, remainingSources: 0 });
        const herringbone = bySlug("boen-herringbone-oak-vivo");
        expect(res.body.sources).toContainEqual({
            kind: "failed", url: img(1),
            failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 },
            holders: [{ productId: herringbone.id, slug: "boen-herringbone-oak-vivo", option: "120" }],
        });

        // The dead source is REMOVED from its option (label kept); the next option image became the main one.
        expect(herringbone.variants[0].options).toEqual([{ value: "120" }, { value: "140", imageLink: copied(img(2)) }]);
        expect(herringbone.imageLink).toBe(copied(img(2)));
        expect(herringbone.additionalImageLinks).toEqual([]);
        expect(bySlug("boen-chevron-oak-vivo").imageLink).toBe(copied(img(3)));
        // The imageless style was not touched.
        expect(bySlug("boen-herringbone-ash").imageLink).toBeUndefined();

        // One conditional UpdateCommand per touched product (2), then its CATPROD# items carry the new image.
        expect(updates()).toHaveLength(2);
        for (const c of table.all("CATPROD#").filter((i) => i.id === herringbone.id)) expect(c.imageLink).toBe(copied(img(2)));
        // Each success recorded in MEDIAMAP#; the copy port named its caller and the media bucket.
        expect(table.all("MEDIAMAP#").map((m) => m.oldUrl).sort()).toEqual([img(2), img(3)]);
        expect(copy.mock.calls.map((c) => c.slice(2))).toEqual(expect.arrayContaining([["uploads-test", CDN, "glam-pricelist-images"]]));
        // withInvalidation marked the CDN; the audit names the actor and a readable target.
        expect(table.commands.some((c) => c instanceof PutCommand && c.input.Item?.SK === "CDN_LAST_CHANGE")).toBe(true);
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: "GLAM_PRICELIST_IMAGES",
            actor: { id: "u1", email: "admin@t1.test" },
            target: { title: "Imagini BOEN / PL", id: "glam:boen/pl" },
        }));
    });

    it("a re-run of the copy → 0 fetches, nothing written, complete", async () => {
        await importFile();
        await copyImages();
        copy.mockClear();
        table.commands = [];
        const res = await copyImages();
        expect(res.status).toBe(200);
        expect(copy).not.toHaveBeenCalled();
        expect(updates()).toHaveLength(0);
        expect(res.body).toMatchObject({ counts: { ingested: 0, cached: 0, refused: 0, failed: 0 }, complete: true });
    });

    it("a re-import then a copy → the copied sources come from MEDIAMAP# (0 fetches for them); the dead URL is retried", async () => {
        await importFile();
        await copyImages();
        await importFile(); // new product ids, producer URLs again
        copy.mockClear();
        const res = await copyImages();
        expect(res.body.counts).toEqual({ ingested: 0, cached: 2, refused: 0, failed: 1, extras: { ingested: 0, cached: 0, refused: 0, failed: 0 } });
        expect(copy.mock.calls.map((c) => c[1])).toEqual([img(1)]); // failures are not in MEDIAMAP#: retried by design
        expect(bySlug("boen-chevron-oak-vivo").imageLink).toBe(copied(img(3)));
    });

    it("the update condition cancelled (product replaced meanwhile) → reported, no write, no CATPROD# write for it", async () => {
        await importFile();
        const chevron = bySlug("boen-chevron-oak-vivo");
        const realSend = table.send.bind(table);
        table.send = async (cmd: any) => {
            if (cmd instanceof UpdateCommand && cmd.input.Key.SK === `PRODUCT#${chevron.id}`) table.items.delete(`TENANT#t1\u0000PRODUCT#${chevron.id}`);
            return realSend(cmd);
        };
        table.commands = [];
        const res = await copyImages();
        expect(res.status).toBe(200);
        expect(res.body.products.replaced).toEqual([{ productId: chevron.id, slug: "boen-chevron-oak-vivo" }]);
        expect(res.body.products.updated).toBe(1);
        expect(table.get("TENANT#t1", `PRODUCT#${chevron.id}`)).toBeUndefined(); // never re-created (no upsert)
        const catprodWrites = table.commands.filter((c) => c instanceof BatchWriteCommand)
            .flatMap((c) => Object.values(c.input.RequestItems as Record<string, any[]>)[0])
            .map((r: any) => String(r.PutRequest?.Item?.SK ?? r.DeleteRequest?.Key?.SK));
        expect(catprodWrites.some((sk) => sk.endsWith(`#${chevron.id}`))).toBe(false);
        expect(res.body.complete).toBe(true); // the replaced product left the set
    });

    it("repeated requests terminate: each request lowers the remaining holdings; no source is fetched twice", async () => {
        // 9 styles × 1 image, one of them dead. Each copy charges 5 s of a fake clock when it starts, so the workers see
        // 0 s, 5 s, 10 s (3 starts) and the 4th sees 15 s ≥ the 12 s budget → 3 sources per request: 9 → 6 → 3 → 0.
        const rows: R[] = Array.from({ length: 9 }, (_, i) => ({ c: "Plank", p: `Style ${i}`, f: "1", img: img(10 + i) }));
        DEAD.add(img(14));
        let now = 1_000_000;
        vi.spyOn(Date, "now").mockImplementation(() => now);
        copy.mockImplementation(async (tenant: string, url: string) => { now += 5_000; return fakeCopy(tenant, url); });
        await importFile(csv(...rows));

        const remaining: number[] = [];
        for (let request = 0; request < 10; request++) {
            now += 60_000; // the next request starts later; its budget starts at its own entry
            const res = await copyImages();
            expect(res.status).toBe(200);
            remaining.push(res.body.progress.remainingOptions);
            if (res.body.complete) break;
        }
        DEAD.delete(img(14));
        expect(remaining).toEqual([6, 3, 0]);
        expect(COPY_START_BUDGET_MS).toBe(12_000);
        expect(copy).toHaveBeenCalledTimes(9);
        expect(new Set(copy.mock.calls.map((c) => c[1])).size).toBe(9);
        expect(bySlug("boen-plank-style-4").imageLink).toBeUndefined();
    });
});

describe("CAT-IMAGES-1 review-0 CIM-F2 — a source shared by two products, the second product deferred by the update budget", () => {
    const SHARED = img(50);
    const FILE2 = csv({ c: "Plank", p: "A", f: "1", img: SHARED }, { c: "Plank", p: "B", f: "1", img: SHARED });
    const SLUGS2 = ["boen-plank-a", "boen-plank-b"];

    /** Every product update moves a fake clock past the 24 s update budget, so each request writes exactly one product. */
    async function twoBatches() {
        let now = 1_000_000;
        vi.spyOn(Date, "now").mockImplementation(() => now);
        await importFile(FILE2);
        const realSend = table.send.bind(table);
        table.send = async (cmd: any) => {
            if (cmd instanceof UpdateCommand && String(cmd.input.ConditionExpression).startsWith("attribute_exists(PK)")) now += 25_000;
            return realSend(cmd);
        };
        const batches = [];
        for (let i = 0; i < 2; i++) {
            now += 60_000;
            batches.push((await copyImages()).body);
        }
        return batches;
    }

    it.each([
        ["copied", [{ kind: "copied", cdnUrl: copied(SHARED) }], ["ingested", "cached"], 1],
        ["dead both times", [{ kind: "failed", failure: { kind: "error", code: "ENOTFOUND" } }], ["failed", "failed"], 2],
        ["failure, then success", [{ kind: "failed", failure: { kind: "error", code: "ETIMEDOUT" } }, { kind: "copied", cdnUrl: copied(SHARED) }], ["failed", "ingested"], 2],
    ] as const)("%s → each request reports ONLY the holding it wrote; holdings 2 → 1 → 0", async (_label, outcomes, kinds, fetches) => {
        let call = 0;
        copy.mockImplementation(async () => outcomes[Math.min(call++, outcomes.length - 1)]);
        const [first, second] = await twoBatches();

        for (const [batch, kind] of [[first, kinds[0]], [second, kinds[1]]] as const) {
            expect(batch.sources).toHaveLength(1);
            expect(batch.sources[0]).toMatchObject({ url: SHARED, kind });
            expect(batch.sources[0].holders).toHaveLength(1); // the deferred holder is NOT reported before its write
            expect(batch.products.updated).toBe(1);
        }
        expect([first.sources[0].holders[0].slug, second.sources[0].holders[0].slug].sort()).toEqual(SLUGS2);
        expect([first.progress.remainingOptions, second.progress.remainingOptions]).toEqual([1, 0]);
        expect([first.progress.remainingSources, second.progress.remainingSources]).toEqual([1, 0]);
        expect([first.complete, second.complete]).toEqual([false, true]);
        expect(copy).toHaveBeenCalledTimes(fetches); // a copied source comes from MEDIAMAP# for the second holder
    });
});

describe("CAT-IMAGES-1 review-1 CIM-F2 — copy provenance apart from committed holders", () => {
    it("two sources copied in request 1 whose second product is deferred → `copied` names both; request 2 writes it from MEDIAMAP# (cached), no refetch, no failure claim", async () => {
        let now = 1_000_000;
        vi.spyOn(Date, "now").mockImplementation(() => now);
        await importFile(csv({ c: "Plank", p: "A", f: "1", img: img(60) }, { c: "Plank", p: "B", f: "1", img: img(61) }));
        const realSend = table.send.bind(table);
        table.send = async (cmd: any) => {
            if (cmd instanceof UpdateCommand && String(cmd.input.ConditionExpression).startsWith("attribute_exists(PK)")) now += 25_000; // past the update budget
            return realSend(cmd);
        };
        now += 60_000;
        const first = (await copyImages()).body;
        now += 60_000;
        const second = (await copyImages()).body;

        expect(first.copied.map((c: any) => c.url).sort()).toEqual([img(60), img(61)]);
        expect(first.sources).toHaveLength(1);
        expect(first.sources[0]).toMatchObject({ kind: "ingested" });
        const deferredUrl = [img(60), img(61)].find((u) => u !== first.sources[0].url);
        expect(second.copied).toEqual([]);
        expect(second.sources).toEqual([expect.objectContaining({ kind: "cached", url: deferredUrl, cdnUrl: copied(deferredUrl!) })]);
        expect([first.complete, second.complete]).toEqual([false, true]);
        expect(copy).toHaveBeenCalledTimes(2);
    });
});

// CAT-IMAGE-GATE-1: these rows import with `publishWithoutImages: true` (products `active`), so no publication is at
// stake and the stale write commits exactly as CAT-IMAGES-1 § 9 rules. With the default (`draft`), R1 publishes the
// product and R2's stale write is cancelled and re-planned — rows "CAT-IMAGE-GATE-1 CIG-R1" below.
describe("CAT-IMAGES-1 slice § 9, as corrected by cat-images-1.md § 11 (CIG-STALE-WRITE) — two overlapping requests over the same product converge (no publication at stake)", () => {
    const X = img(70);
    const Y = img(71);
    const mediaMapItem = (url: string) => ({ PK: "TENANT#t1", SK: `MEDIAMAP#${createHash("md5").update(url).digest("hex")}`, oldUrl: url, newUrl: copied(url), Type: "MediaMap" });

    it.each([
        ["X copied by R1", false, [{ value: "1", imageLink: copied(X) }, { value: "2", imageLink: copied(Y) }]],
        ["X dead (removed by R1)", true, [{ value: "1" }, { value: "2", imageLink: copied(Y) }]],
    ] as const)("%s: R2's stale write is cancelled (variants changed since its read) and re-planned on the fresh read — nothing to restore; R3 finds nothing", async (_label, xDead, converged) => {
        if (xDead) DEAD.add(X);
        try {
            let now = 1_000_000;
            vi.spyOn(Date, "now").mockImplementation(() => now);
            await importPublished(csv({ c: "Plank", p: "P", f: "1", img: X }, { c: "Plank", p: "P", f: "2", img: Y }));
            table.put(mediaMapItem(Y)); // Y copied in an earlier session
            const options = () => bySlug("boen-plank-p").variants[0].options;

            // R2 reads the product and MEDIAMAP# (snapshot: X, Y on producer URLs; map = {Y}), then is held.
            let reached!: () => void;
            const atGate = new Promise<void>((r) => { reached = r; });
            let release!: () => void;
            const gate = new Promise<void>((r) => { release = r; });
            const realSend = table.send.bind(table);
            let held = false;
            table.send = async (cmd: any) => {
                const res = await realSend(cmd);
                if (!held && cmd instanceof QueryCommand && cmd.input.ExpressionAttributeValues[":sk"] === "MEDIAMAP#") {
                    held = true;
                    reached();
                    await gate;
                }
                return res;
            };
            const r2 = copyImages();
            await atGate;

            // R1 runs to the end meanwhile and writes the product.
            const r1 = (await copyImages()).body;
            expect(r1.complete).toBe(true);
            expect(options()).toEqual(converged);

            // R2 resumes past its copy budget: it copies nothing and resolves Y from its map. Its write, planned from its
            // STALE read, names the `variants` it read; R1 changed them, so the write is cancelled. R2 re-reads and
            // re-plans: X has no result in R2 and Y is already copied → nothing to write. (Before § 11 the stale write
            // committed and restored X's producer URL, and R3 repaired it.)
            now += COPY_START_BUDGET_MS + 1_000;
            release();
            const second = (await r2).body;
            expect(second.products).toMatchObject({ updated: 0, replaced: [] });
            expect(options()).toEqual(converged);
            const cancelled = updates().filter((u) => u.input.ExpressionAttributeValues[":readVariants"]?.[0]?.options?.[0]?.imageLink === X);
            expect(cancelled.length).toBeGreaterThanOrEqual(2); // R1's committed write and R2's cancelled one, both planned from the import's variants
            expect(second).toMatchObject({ complete: true, progress: { remainingOptions: 0 } });

            // R3: nothing left — no fetch, no write; the holding (P, option "1") was reported once, by R1.
            copy.mockClear();
            table.commands = [];
            const third = (await copyImages()).body;
            expect(third).toMatchObject({ complete: true, sources: [], products: { updated: 0 } });
            expect(options()).toEqual(converged);
            expect(copy).not.toHaveBeenCalled();
            expect(updates()).toHaveLength(0);
            const holdingOf = (body: any) => body.sources.find((src: any) => src.url === X)?.holders.find((h: any) => h.option === "1");
            expect(holdingOf(r1)).toMatchObject({ slug: "boen-plank-p", option: "1" });
            expect(holdingOf(second)).toBeUndefined();
        } finally {
            DEAD.delete(X);
        }
    });
});

describe("CAT-IMAGES-1 admission and dispatch", () => {
    it("a foreign tenant header → 403 before any read", async () => {
        const res = await call(event(IMAGES, { producer: "BOEN", sheet: "PL" }, { tenant: "t2" }));
        expect(res.status).toBe(403);
        expect(table.commands).toHaveLength(0);
    });

    it("a service key with catalog:write is admitted; without it → 403", async () => {
        const key = (scopes: string) => ({ sub: "service:k1", role: "SERVICE", tenantId: "t1", scopes, keyId: "k1" });
        expect((await call(event(IMAGES, { producer: "BOEN", sheet: "PL" }, { auth: key("catalog:write") }))).status).toBe(200);
        expect((await call(event(IMAGES, { producer: "BOEN", sheet: "PL" }, { auth: key("catalog:read") }))).status).toBe(403);
    });

    it("a non-catalog tenant → 403; a missing producer → 400; nothing copied", async () => {
        expect((await copyImages({ producer: "" })).status).toBe(400);
        table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Glam", catalogMode: false });
        expect((await copyImages()).status).toBe(403);
        expect(copy).not.toHaveBeenCalled();
    });

    it("an unknown route key → 404, nothing read", async () => {
        const res = await call(event("POST /import/glam-pricelist/other", {}));
        expect(res.status).toBe(404);
        expect(table.commands).toHaveLength(0);
    });
});

// ── CAT-IMAGE-GATE-1: the copy publishes (docs/slices/cat-image-gate-1.md § 3 items 3, 4; § 5 units) ─────────────────

describe("CAT-IMAGE-GATE-1 the image copy publishes a hidden product in its image write", () => {
    const DEFAULT = { version: 1, grouping: { kind: "as-is" }, collection: { kind: "column" }, specKeys: [], facetModes: { attributes: [] } };
    const allDead = async () => ({ kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 } });
    const cards = (productId: string) => table.all("CATPROD#").filter((i) => i.id === productId);

    it("draft + one copied image → active in ONE conditional write; CATPROD# carries active; the product without a source is untouched, stays draft and is listed", async () => {
        await importFile();
        expect(table.all("PRODUCT#").every((p) => p.status === "draft")).toBe(true);
        table.commands = [];
        const res = await copyImages();
        expect(res.status).toBe(200);
        const herringbone = bySlug("boen-herringbone-oak-vivo"); // img(1) dead, img(2) copied
        const chevron = bySlug("boen-chevron-oak-vivo");
        const ash = bySlug("boen-herringbone-ash"); // no image cell
        expect([herringbone.status, chevron.status, ash.status]).toEqual(["active", "active", "draft"]);
        // one write per published product: images and status together, the existence condition kept; since
        // CIG-STALE-WRITE (cat-images-1.md § 11) also the `variants` value the write was planned from
        expect(updates()).toHaveLength(2);
        for (const u of updates()) {
            expect(u.input.UpdateExpression).toContain("#status = :active");
            expect(u.input.ConditionExpression).toBe("attribute_exists(PK) AND #status = :read AND #variants = :readVariants");
            expect(u.input.ExpressionAttributeNames["#variants"]).toBe("variants");
            expect(u.input.ExpressionAttributeValues[":readVariants"]).toEqual([expect.objectContaining({ options: expect.any(Array) })]);
            expect(u.input.ExpressionAttributeValues[":read"]).toBe("draft");
            expect(u.input.ExpressionAttributeNames["#status"]).toBe("status");
        }
        expect(table.commands.filter((c) => c instanceof UpdateCommand && String(c.input.Key?.SK).startsWith("PRODUCT#"))).toHaveLength(2);
        // set order = store order (`PRODUCT#<random id>`): compared without order
        expect([...res.body.products.published].sort((a: any, b: any) => a.slug.localeCompare(b.slug))).toEqual([
            { productId: chevron.id, slug: "boen-chevron-oak-vivo" },
            { productId: herringbone.id, slug: "boen-herringbone-oak-vivo" },
        ]);
        expect(cards(herringbone.id).length).toBeGreaterThan(0);
        expect(cards(herringbone.id).every((c) => c.status === "active")).toBe(true);
        expect(cards(ash.id).every((c) => c.status === "draft")).toBe(true);
        expect(updates().some((u) => u.input.Key.SK === `PRODUCT#${ash.id}`)).toBe(false);
        expect(res.body.hiddenWithoutImage).toEqual([{ productId: ash.id, slug: "boen-herringbone-ash", title: "Ash" }]);
        expect(mockAudit.mock.calls.find((c) => c[0].action === "GLAM_PRICELIST_IMAGES")![0].details).toMatchObject({ productsPublished: 2 });
    });

    it("every source failed → the image write keeps draft (no status in the expression); the product is listed hidden; its failed source names it", async () => {
        await importFile();
        copy.mockImplementation(allDead);
        table.commands = [];
        const res = await copyImages();
        expect(res.status).toBe(200);
        expect(table.all("PRODUCT#").every((p) => p.status === "draft")).toBe(true);
        expect(updates()).toHaveLength(2);
        for (const u of updates()) expect(u.input.UpdateExpression).not.toContain("#status"); // the condition reads it; the write keeps it
        expect(res.body.products.published).toEqual([]);
        expect(res.body.hiddenWithoutImage.map((h: any) => h.slug).sort()).toEqual(["boen-chevron-oak-vivo", "boen-herringbone-ash", "boen-herringbone-oak-vivo"]);
        const chevron = bySlug("boen-chevron-oak-vivo");
        expect(res.body.sources.find((s: any) => s.url === img(3))).toMatchObject({ kind: "failed", holders: [{ productId: chevron.id }] });
    });

    it("publishWithoutImages: true → the import writes active; the copy never changes a status; nothing is listed hidden", async () => {
        const res0 = await call(event(IMPORT, { csvContent: FILE, producer: "BOEN", sheet: "PL", variantName: "Format", profileChoice: { profile: { ...DEFAULT, publishWithoutImages: true }, baseRevision: null } }));
        expect(res0.status).toBe(200);
        expect(table.all("PRODUCT#").every((p) => p.status === "active")).toBe(true);
        copy.mockImplementation(allDead);
        table.commands = [];
        const res = await copyImages();
        expect(updates()).toHaveLength(2);
        for (const u of updates()) expect(u.input.UpdateExpression).not.toContain("#status");
        expect(table.all("PRODUCT#").every((p) => p.status === "active")).toBe(true);
        expect(res.body.products.published).toEqual([]);
        expect(res.body.hiddenWithoutImage).toEqual([]);
    });

    it("the update condition cancelled (replaced meanwhile) → nothing written, not published, reported as replaced", async () => {
        await importFile();
        const chevron = bySlug("boen-chevron-oak-vivo");
        const realSend = table.send.bind(table);
        table.send = async (cmd: any) => {
            if (cmd instanceof UpdateCommand && cmd.input.Key.SK === `PRODUCT#${chevron.id}`) table.items.delete(`TENANT#t1\u0000PRODUCT#${chevron.id}`);
            return realSend(cmd);
        };
        const res = await copyImages();
        expect(res.body.products.replaced).toEqual([{ productId: chevron.id, slug: "boen-chevron-oak-vivo" }]);
        expect(res.body.products.published.map((p: any) => p.slug)).toEqual(["boen-herringbone-oak-vivo"]);
        expect(table.get("TENANT#t1", `PRODUCT#${chevron.id}`)).toBeUndefined();
        expect(res.body.hiddenWithoutImage.map((h: any) => h.slug)).toEqual(["boen-herringbone-ash"]); // a replaced product is not listed
    });

    it("only the copy's own import set: a draft product of another sheet with a producer image is not touched", async () => {
        table.put({ PK: "TENANT#t1", SK: "PRODUCT#other", id: "other", slug: "other", title: "Other", status: "draft", importSource: "glam:boen/other",
            variants: [{ id: "v", name: "F", options: [{ value: "1", imageLink: img(9) }] }], imageLink: img(9) });
        await importFile();
        const res = await copyImages();
        expect(res.status).toBe(200);
        expect(table.get("TENANT#t1", "PRODUCT#other")).toMatchObject({ status: "draft", imageLink: img(9) });
        expect(res.body.hiddenWithoutImage.some((h: any) => h.productId === "other")).toBe(false);
    });
});

// ── CAT-IMAGE-GATE-1 review-0: overlapping copies with opposing outcomes (CIG-R1), an image already on the CDN (CIG-R2) ──

describe("CAT-IMAGE-GATE-1 CIG-R1 — overlapping copies of one draft product with opposing outcomes converge to a correct terminal state", () => {
    const X = img(80);
    const Y = img(81);
    const failed = { kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 } };

    /**
     * R2 reads the set and MEDIAMAP# and is held; R1 runs to the end; then R2 resumes (it copies after the hold). Copy
     * outcomes are dealt per URL in call order (`plan[url]`), so R1 gets the first outcome of each URL and R2 the second.
     */
    async function overlap(rows: R[], plan: Record<string, ("ok" | "dead")[]>) {
        await importFile(csv(...rows));
        const queue = Object.fromEntries(Object.entries(plan).map(([u, o]) => [u, [...o]]));
        copy.mockImplementation(async (_t: string, url: string) => (queue[url].shift() === "ok" ? { kind: "copied", cdnUrl: copied(url) } : failed));
        let reached!: () => void;
        const atGate = new Promise<void>((r) => { reached = r; });
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const realSend = table.send.bind(table);
        let held = false;
        table.send = async (cmd: any) => {
            const res = await realSend(cmd);
            if (!held && cmd instanceof QueryCommand && cmd.input.ExpressionAttributeValues[":sk"] === "MEDIAMAP#") {
                held = true;
                reached();
                await gate;
            }
            return res;
        };
        const r2 = copyImages();
        await atGate;
        const r1 = (await copyImages()).body;
        release();
        const r2body = (await r2).body;
        table.send = realSend;
        copy.mockImplementation(async () => { throw new Error("no fetch expected after convergence"); });
        const r3 = (await copyImages()).body;
        return { r1, r2: r2body, r3 };
    }
    const product = () => bySlug("boen-plank-p");
    const cardsOf = (id: string) => table.all("CATPROD#").filter((c) => c.id === id);
    /** Terminal: nothing left to copy, a further copy writes nothing. */
    const terminal = (r3: any) => {
        expect(r3).toMatchObject({ complete: true, sources: [], products: { updated: 0, replaced: [], published: [] } });
    };

    it("success committed first, then the stale failure: the failure write is cancelled and re-planned to nothing — active WITH its copied image, cards too", async () => {
        const { r1, r2, r3 } = await overlap([{ c: "Plank", p: "P", f: "1", img: X }], { [X]: ["ok", "dead"] });
        expect(r1.products.published.map((p: any) => p.slug)).toEqual(["boen-plank-p"]);
        expect(r2).toMatchObject({ sources: [], products: { updated: 0, replaced: [], published: [] }, hiddenWithoutImage: [] });
        expect(product()).toMatchObject({ status: "active", imageLink: copied(X), variants: [{ options: [{ value: "1", imageLink: copied(X) }] }] });
        expect(cardsOf(product().id).every((c) => c.status === "active" && c.imageLink === copied(X))).toBe(true);
        terminal(r3);
        expect(r3.hiddenWithoutImage).toEqual([]);
    });

    it("failure committed first, then the stale success: the status is unchanged, so the success commits and publishes — active with the image", async () => {
        const { r1, r2, r3 } = await overlap([{ c: "Plank", p: "P", f: "1", img: X }], { [X]: ["dead", "ok"] });
        expect(r1.hiddenWithoutImage.map((h: any) => h.slug)).toEqual(["boen-plank-p"]); // decided hidden by R1 …
        expect(r2.products.published.map((p: any) => p.slug)).toEqual(["boen-plank-p"]); // … and published by R2
        expect(r2.sources).toEqual([expect.objectContaining({ kind: "ingested", url: X, holders: [expect.objectContaining({ option: "1" })] })]);
        expect(r2.hiddenWithoutImage).toEqual([]);
        expect(product()).toMatchObject({ status: "active", imageLink: copied(X) });
        expect(cardsOf(product().id).every((c) => c.status === "active" && c.imageLink === copied(X))).toBe(true);
        terminal(r3);
    });

    it("R1 removes X (failed) and publishes through Y; R2's stale write (X copied) is cancelled, re-planned on the fresh read, restores X; reports only the holding it changed", async () => {
        const { r1, r2, r3 } = await overlap(
            [{ c: "Plank", p: "P", f: "1", img: X }, { c: "Plank", p: "P", f: "2", img: Y }],
            { [X]: ["dead", "ok"], [Y]: ["ok", "ok"] },
        );
        expect(r1.products.published.map((p: any) => p.slug)).toEqual(["boen-plank-p"]);
        const writes = updates().filter((u) => u.input.Key.SK === `PRODUCT#${product().id}`);
        expect(writes.map((u) => u.input.ExpressionAttributeValues[":read"])).toEqual(["draft", "draft", "active"]); // R1, R2 cancelled, R2 re-planned
        expect(product()).toMatchObject({ status: "active", variants: [{ options: [{ value: "1", imageLink: copied(X) }, { value: "2", imageLink: copied(Y) }] }] });
        expect(r2.products).toMatchObject({ updated: 1, replaced: [], published: [] });
        expect(r2.sources).toEqual([expect.objectContaining({ kind: "ingested", url: X, holders: [expect.objectContaining({ option: "1" })] })]);
        terminal(r3);
    });

    it("both copies fail: the product ends draft, no producer URL left, listed hidden by the last request; no active imageless state", async () => {
        const { r2, r3 } = await overlap([{ c: "Plank", p: "P", f: "1", img: X }], { [X]: ["dead", "dead"] });
        expect(product().status).toBe("draft");
        expect(product().imageLink).toBeUndefined();
        expect(r2.hiddenWithoutImage.map((h: any) => h.slug)).toEqual(["boen-plank-p"]);
        terminal(r3);
        expect(r3.hiddenWithoutImage.map((h: any) => h.slug)).toEqual(["boen-plank-p"]);
    });
});

describe("CAT-IMAGE-GATE-1 CIG-R2 — an imported image already under the tenant CDN publishes on the copy", () => {
    it("import → draft with the CDN image; copy → ONE publish-only write (no image rewrite, no fetch), active, cards active, complete", async () => {
        const onCdn = `${CDN}/t1/earlier-copy.jpg`;
        const imported = await importFile(csv({ c: "Plank", p: "P", f: "1", img: onCdn }));
        expect(imported.body.publication).toEqual({ status: "draft", startHidden: 1, withoutImageAddress: [] });
        table.commands = [];
        const res = await copyImages();
        expect(copy).not.toHaveBeenCalled();
        expect(updates()).toHaveLength(1);
        expect(updates()[0].input.UpdateExpression).toBe("SET #updatedAt = :now, #status = :active");
        expect(bySlug("boen-plank-p")).toMatchObject({ status: "active", imageLink: onCdn });
        expect(table.all("CATPROD#").filter((c) => c.id === bySlug("boen-plank-p").id).every((c) => c.status === "active")).toBe(true);
        expect(res.body).toMatchObject({ complete: true, sources: [], products: { updated: 1, published: [{ slug: "boen-plank-p" }] }, hiddenWithoutImage: [] });
        expect((await copyImages()).body.products.updated).toBe(0); // published once; nothing more to write
    });
});

// ── CAT-IMPORT-GALLERY-1: a 13-column import, then the copy with a failing extra ────────────────────────────────────

describe("CAT-IMPORT-GALLERY-1 integration — extras through the import and the copy (in-memory store)", () => {
    const HEADER13 = `${HEADER},imagini suplimentare`;
    const csv13 = (...rows: (R & { g: string })[]) =>
        [HEADER13, ...rows.map((r) => [r.c, r.p, "", "", "", "", "mp", "", "", r.img ?? "", "", r.f ?? "", r.g].join(","))].join("\n") + "\n";
    // img(12) is dead; "Elm" has no main image, only an extra.
    const FILE13 = csv13(
        { c: "Herringbone", p: "Oak", f: "120", img: img(10), g: `${img(11)}|${img(12)}` },
        { c: "Herringbone", p: "Oak", f: "140", img: img(14), g: img(11) },
        { c: "Herringbone", p: "Elm", f: "90", g: img(13) },
    );
    beforeEach(() => {
        copy.mockImplementation(async (_t: string, url: string) => (url === img(12)
            ? { kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 } }
            : { kind: "copied", cdnUrl: copied(url) }));
    });

    it("the import stores each option's extras and the derived gallery; the copy copies extras, removes the failed one, reports extras apart", async () => {
        const imported = await importFile(FILE13);
        expect(imported.status).toBe(200);
        expect(imported.body.gallery).toEqual({ rows: 3, addresses: 4, dropped: 0 });
        const oak = bySlug("boen-herringbone-oak");
        expect(oak.variants[0].options).toEqual([
            { value: "120", imageLink: img(10), additionalImageLinks: [img(11), img(12)] },
            { value: "140", imageLink: img(14), additionalImageLinks: [img(11)] },
        ]);
        expect([oak.imageLink, ...oak.additionalImageLinks]).toEqual([img(10), img(11), img(12), img(14)]);
        expect(bySlug("boen-herringbone-elm").status).toBe("draft");

        const res = await copyImages();
        expect(res.status).toBe(200);
        expect(res.body.complete).toBe(true);
        expect(res.body.progress).toMatchObject({ remainingOptions: 0, remainingExtras: 0, remainingSources: 0 });
        // sources: img(10), img(11) (two extra holders), img(12) dead extra, img(14), img(13) Elm's extra
        expect(res.body.counts).toEqual({ ingested: 4, cached: 0, refused: 0, failed: 1, extras: { ingested: 2, cached: 0, refused: 0, failed: 1 } });
        const after = bySlug("boen-herringbone-oak");
        expect(res.body.sources).toContainEqual({
            kind: "failed", url: img(12),
            failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 },
            holders: [{ productId: after.id, slug: "boen-herringbone-oak", option: "120", extra: true }],
        });
        expect(res.body.sources.find((s: any) => s.url === img(11)).holders).toEqual([
            { productId: after.id, slug: "boen-herringbone-oak", option: "120", extra: true },
            { productId: after.id, slug: "boen-herringbone-oak", option: "140", extra: true },
        ]);
        // The failed extra is removed from its option; the copied ones are CDN URLs; the gallery derived again.
        expect(after.variants[0].options).toEqual([
            { value: "120", imageLink: copied(img(10)), additionalImageLinks: [copied(img(11))] },
            { value: "140", imageLink: copied(img(14)), additionalImageLinks: [copied(img(11))] },
        ]);
        expect([after.imageLink, ...after.additionalImageLinks]).toEqual([copied(img(10)), copied(img(11)), copied(img(14))]);
        expect(after.status).toBe("active");
        // Elm's only copied image is an extra: it stays hidden and is listed (an extra never publishes).
        const elm = bySlug("boen-herringbone-elm");
        expect(elm.variants[0].options).toEqual([{ value: "90", additionalImageLinks: [copied(img(13))] }]);
        expect(elm.status).toBe("draft");
        expect(res.body.products.published.map((p: any) => p.slug)).toEqual(["boen-herringbone-oak"]);
        expect(res.body.hiddenWithoutImage.map((p: any) => p.slug)).toEqual(["boen-herringbone-elm"]);
        // A second copy: nothing left, nothing written.
        table.commands = [];
        const again = await copyImages();
        expect(again.body).toMatchObject({ complete: true, counts: { ingested: 0, failed: 0 } });
        expect(updates()).toHaveLength(0);
    });
});

// ── CAT-IMPORT-GALLERY-1 § 5 — the 13-column fixtures (10 rows each, copied from glamCRM pl-tools/out/*/catalog/ at
// glamCRM f6e0d19, price columns 3–4 blanked as every glam fixture, codes kept; the record lists the source rows) ──────

describe("CAT-IMPORT-GALLERY-1 end-to-end — real 13-column rows: import report, options with extras, gallery order, copy", () => {
    const fixture = (name: string) => readFileSync(path.resolve(__dirname, "fixtures/glam", name), "utf8");
    /** The raw records of a fixture (header dropped): the oracle reads the cells, not the importer's result. */
    const records = (name: string) => {
        const parsed = parseCsvRecords(fixture(name));
        if (parsed.kind !== "records") throw new Error(parsed.error);
        return parsed.records.slice(1);
    };
    const parts = (cell: string) => cell.split("|").map((p) => p.trim()).filter((p) => p !== "");

    it("BOEN (column 13 empty in glamCRM's file): the 13-column plan equals the plan of the same rows as a 12-column file", () => {
        const q = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
        const text13 = fixture("boen-PL-catalog-10.csv");
        const all = parseCsvRecords(text13);
        if (all.kind !== "records") throw new Error(all.error);
        expect(all.records.every((r) => r.length === 13)).toBe(true);
        const text12 = all.records.map((r) => r.slice(0, 12).map(q).join(",")).join("\n") + "\n";
        const upload = checkUpload({ producer: "BOEN", sheet: "PL", variantName: "Format" });
        const p13 = parseGlamCsv(text13);
        const p12 = parseGlamCsv(text12);
        if (upload.kind !== "accepted" || p13.kind !== "parsed" || p12.kind !== "parsed") throw new Error("fixture must parse");
        const { gallery, ...plan13 } = planGlamImport(p13.rows, upload.upload);
        expect(gallery).toEqual({ rows: 0, addresses: 0, dropped: 0 });
        expect(plan13).toEqual(planGlamImport(p12.rows, upload.upload));
    });

    it("ALPOD HER: every option stores its column-13 images; the product gallery is col 9 then col 13 of each row, in file order; the copy keeps the order", async () => {
        const NAME = "alpod-HER-catalog-10.csv";
        const raw = records(NAME);
        const dead = parts(raw[0][12])[1]; // the second extra of the first row is dead
        copy.mockImplementation(async (_t: string, url: string) => (url === dead
            ? { kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 } }
            : { kind: "copied", cdnUrl: copied(url) }));

        const imported = await call(event(IMPORT, { csvContent: fixture(NAME), producer: "ALPOD", sheet: "HER", variantName: "Format" }));
        expect(imported.status).toBe(200);
        // the report: column-13 counts from the cells (rows with ≥ 1 address, the addresses, none dropped)
        const galleries = raw.map((r) => parts(r[12]));
        expect(imported.body.gallery).toEqual({
            rows: galleries.filter((g) => g.length > 0).length,
            addresses: galleries.reduce((n, g) => n + g.length, 0),
            dropped: 0,
        });
        expect(imported.body.gallery).toEqual({ rows: 9, addresses: 27, dropped: 0 });

        // per product: the stored options and the derived gallery, against the raw cells of its rows (one row per option here)
        const products = table.all("PRODUCT#");
        expect(products).toHaveLength(8);
        for (const product of imported.body.products) {
            const stored = products.find((p) => p.id === product.productId)!;
            const rows = product.rowIndexes.map((i: number) => raw[i - 2]);
            expect(stored.variants[0].options.map((o: any) => [o.imageLink, o.additionalImageLinks]))
                .toEqual(rows.map((r: string[]) => [r[9] || undefined, parts(r[12]).length > 0 ? parts(r[12]) : undefined]));
            const expected = rows.flatMap((r: string[]) => [r[9], ...parts(r[12])]).filter((u: string) => u !== "");
            expect([stored.imageLink, ...stored.additionalImageLinks].filter((u) => u !== undefined)).toEqual(expected);
            // the report lists the same extras per option
            expect(product.options.map((o: any) => o.additionalImageLinks)).toEqual(rows.map((r: string[]) => (parts(r[12]).length > 0 ? parts(r[12]) : undefined)));
        }
        // a style of two rows: option 1's images, then option 2's
        const walnut = products.find((p) => p.slug === "alpod-heritage-lounge-3-layer-wood-floors-wide-plank-am-walnut-lacquer")!;
        expect(walnut.variants[0].options).toHaveLength(2);
        expect([walnut.imageLink, ...walnut.additionalImageLinks]).toEqual([raw[6][9], ...parts(raw[6][12]), raw[8][9], ...parts(raw[8][12])]);

        // the copy: every source copied except the dead extra, which is removed from its option and reported as an extra
        const res = await copyImages({ producer: "ALPOD", sheet: "HER" });
        expect(res.status).toBe(200);
        expect(res.body.complete).toBe(true);
        expect(res.body.counts).toEqual({ ingested: 35, cached: 0, refused: 0, failed: 1, extras: { ingested: 26, cached: 0, refused: 0, failed: 1 } });
        expect(res.body.sources.find((s: any) => s.url === dead).holders).toEqual([expect.objectContaining({ extra: true })]);
        const first = table.all("PRODUCT#").find((p) => p.slug === imported.body.products[0].slug)!;
        expect(first.variants[0].options[0].additionalImageLinks).toEqual(parts(raw[0][12]).filter((u) => u !== dead).map(copied));
        const walnutAfter = table.all("PRODUCT#").find((p) => p.id === walnut.id)!;
        expect([walnutAfter.imageLink, ...walnutAfter.additionalImageLinks])
            .toEqual([raw[6][9], ...parts(raw[6][12]), raw[8][9], ...parts(raw[8][12])].map(copied));
        // 7 products publish through their main image; the row without an image (Oak Aspen oil) stays hidden
        expect(res.body.products.published).toHaveLength(7);
        expect(res.body.hiddenWithoutImage.map((h: any) => h.slug)).toEqual(["alpod-heritage-alpine-3-layer-wood-floors-narrow-plank-oak-aspen-oil"]);
    });
});

// ── CAT-IMPORT-GALLERY-1 R-CIG-REBASE: overlapping copies with opposing outcomes for an EXTRA (CIG-R1 harness) ──────

describe("CAT-IMPORT-GALLERY-1 R-CIG-REBASE — overlapping copies of one product's extra converge (both commit orders)", () => {
    const X = img(90);   // the main image
    const E = img(91);   // its extra
    const failed = { kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 } };
    const FILE_X_E = `${HEADER},imagini suplimentare\nPlank,P,,,,,mp,,,${X},,1,${E}\n`;

    /** As the CIG-R1 harness: R2 reads the set and MEDIAMAP# and is held; R1 runs to the end; R2 resumes. Outcomes per URL
     *  in call order (R1 first). Then R3 must find nothing to do. */
    async function overlap(plan: Record<string, ("ok" | "dead")[]>) {
        expect((await importFile(FILE_X_E)).status).toBe(200);
        const queue = Object.fromEntries(Object.entries(plan).map(([u, o]) => [u, [...o]]));
        copy.mockImplementation(async (_t: string, url: string) => (queue[url].shift() === "ok" ? { kind: "copied", cdnUrl: copied(url) } : failed));
        let reached!: () => void;
        const atGate = new Promise<void>((r) => { reached = r; });
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const realSend = table.send.bind(table);
        let held = false;
        table.send = async (cmd: any) => {
            const res = await realSend(cmd);
            if (!held && cmd instanceof QueryCommand && cmd.input.ExpressionAttributeValues[":sk"] === "MEDIAMAP#") {
                held = true;
                reached();
                await gate;
            }
            return res;
        };
        const r2 = copyImages();
        await atGate;
        const r1 = (await copyImages()).body;
        release();
        const r2body = (await r2).body;
        table.send = realSend;
        copy.mockImplementation(async () => { throw new Error("no fetch expected after convergence"); });
        const r3 = (await copyImages()).body;
        return { r1, r2: r2body, r3 };
    }
    const product = () => bySlug("boen-plank-p");
    const terminal = (r3: any) => expect(r3).toMatchObject({ complete: true, sources: [], products: { updated: 0, replaced: [], published: [] } });

    it("extra failure committed first (R1 removes E, publishes through X), then the stale success: R2 is re-planned and RESTORES E from its read, and reports that holding", async () => {
        const { r1, r2, r3 } = await overlap({ [X]: ["ok", "dead"], [E]: ["dead", "ok"] });
        expect(r1.products.published.map((p: any) => p.slug)).toEqual(["boen-plank-p"]);
        expect(r1.sources.find((s: any) => s.url === E)).toMatchObject({ kind: "failed", holders: [{ option: "1", extra: true }] });
        expect(product()).toMatchObject({ status: "active", variants: [{ options: [{ value: "1", imageLink: copied(X), additionalImageLinks: [copied(E)] }] }] });
        expect([product().imageLink, ...product().additionalImageLinks]).toEqual([copied(X), copied(E)]);
        expect(r2.products).toMatchObject({ updated: 1, replaced: [], published: [] });
        expect(r2.sources).toEqual([expect.objectContaining({ kind: "ingested", url: E, holders: [expect.objectContaining({ option: "1", extra: true })] })]);
        terminal(r3);
    });

    it("extra success committed first (R1 copies X and E), then the stale failure: R2 is re-planned to nothing — the copied extra is kept", async () => {
        const { r1, r2, r3 } = await overlap({ [X]: ["ok", "dead"], [E]: ["ok", "dead"] });
        expect(r1.products.published.map((p: any) => p.slug)).toEqual(["boen-plank-p"]);
        expect(r2).toMatchObject({ sources: [], products: { updated: 0, replaced: [], published: [] } });
        expect(product()).toMatchObject({ status: "active", variants: [{ options: [{ value: "1", imageLink: copied(X), additionalImageLinks: [copied(E)] }] }] });
        terminal(r3);
    });
});

// ── CAT-IMPORT-GALLERY-1 R-CIG-NEGATIVE: rule 3 through the import, and a policy-refused extra through the copy ─────

describe("CAT-IMPORT-GALLERY-1 R-CIG-NEGATIVE — column 13 holds addresses only; a refused extra is removed and reported", () => {
    const FILE13 = (gallery: string) => `${HEADER},imagini suplimentare\nPlank,P,,,,,mp,,,${img(95)},,1,${gallery}\n`;
    const PRICE_URL = "https://img.test/price-eur.jpg";

    it("non-http(s) parts are dropped, counted and never stored; an https address that names a price word is an address (kept)", async () => {
        // Rule 3: of these five parts only the https URL is an http(s) address; the empty part is not a part (rule 2).
        const res = await importFile(FILE13(`99 EUR|javascript:alert(1)|${PRICE_URL}|ftp://img.test/x.jpg| `));
        expect(res.status).toBe(200);
        expect(res.body.gallery).toEqual({ rows: 1, addresses: 1, dropped: 3 });
        expect(res.body.products[0].options).toEqual([{ value: "1", imageLink: img(95), additionalImageLinks: [PRICE_URL], rowIndexes: [2] }]);
        const stored = bySlug("boen-plank-p");
        expect(stored.variants[0].options).toEqual([{ value: "1", imageLink: img(95), additionalImageLinks: [PRICE_URL] }]);
        expect([stored.imageLink, ...stored.additionalImageLinks]).toEqual([img(95), PRICE_URL]);
        const everything = JSON.stringify(table.all(""));   // every item (`all` filters by SK prefix; "" = all)
        expect(everything).toContain(PRICE_URL);            // the dump is not empty: the kept address is in it
        for (const leak of ["99 EUR", "javascript:", "ftp://"]) expect(everything).not.toContain(leak);
    });

    it("only non-addresses in column 13: the option has no additionalImageLinks key; dropped counted", async () => {
        const res = await importFile(FILE13("99 EUR|n/a"));
        expect(res.body.gallery).toEqual({ rows: 0, addresses: 0, dropped: 2 });
        expect("additionalImageLinks" in bySlug("boen-plank-p").variants[0].options[0]).toBe(false);
    });

    it("an extra the copy policy REFUSES is removed from its option and reported as refused, with its holder marked extra", async () => {
        const BLOCKED = "https://img.test/blocked.jpg";
        copy.mockImplementation(async (_t: string, url: string) => (url === BLOCKED
            ? { kind: "refused", rule: "destination not allowed" }
            : { kind: "copied", cdnUrl: copied(url) }));
        await importFile(FILE13(`${BLOCKED}|${img(96)}`));
        const res = await copyImages();
        expect(res.body.counts).toEqual({ ingested: 2, cached: 0, refused: 1, failed: 0, extras: { ingested: 1, cached: 0, refused: 1, failed: 0 } });
        const p = bySlug("boen-plank-p");
        expect(res.body.sources).toContainEqual({
            kind: "refused", url: BLOCKED, rule: "destination not allowed",
            holders: [{ productId: p.id, slug: "boen-plank-p", option: "1", extra: true }],
        });
        expect(p.variants[0].options).toEqual([{ value: "1", imageLink: copied(img(95)), additionalImageLinks: [copied(img(96))] }]);
        expect(p.status).toBe("active"); // published by its main image, not by the extra
        expect(res.body.complete).toBe(true);
    });
});

// ── CAT-IMPORT-GALLERY-1 round 3: CIG-STALE-WRITE and R-CIG-REBASE by original holding (copies named per call) ─────

describe("CAT-IMPORT-GALLERY-1 round 3 — a stale write never commits over another request's images; one stored image per holding, in read order, when every stored copy is identified by its MEDIAMAP# entry", () => {
    const X = img(100);
    const failed = { kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 } };
    const fileOf = (extras: string[]) => `${HEADER},imagini suplimentare\nPlank,P,,,,,mp,,,${X},,1,${extras.join("|")}\n`;
    /** Each successful copy gets its own name, as production's `randomUUID()` does: `<CDN>/t1/r<n>-<file>`. */
    let n = 0;
    const named = (url: string) => `${CDN}/t1/r${++n}-${url.split("/").pop()}`;

    /** The CIG-R1 harness (R2 reads the set and MEDIAMAP#, is held; R1 runs to the end; R2 resumes), outcomes per URL in
     *  call order (R1 first); every copy recorded with its per-call name. */
    async function overlap(extras: string[], plan: Record<string, ("ok" | "dead")[]>) {
        expect((await importFile(fileOf(extras))).status).toBe(200);
        const queue = Object.fromEntries(Object.entries(plan).map(([u, o]) => [u, [...o]]));
        const made: Record<string, string[]> = {};
        copy.mockImplementation(async (_t: string, url: string) => {
            if (queue[url].shift() !== "ok") return failed;
            const cdnUrl = named(url);
            (made[url] ??= []).push(cdnUrl);
            return { kind: "copied", cdnUrl };
        });
        let reached!: () => void;
        const atGate = new Promise<void>((r) => { reached = r; });
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const realSend = table.send.bind(table);
        let held = false;
        table.send = async (cmd: any) => {
            const res = await realSend(cmd);
            if (!held && cmd instanceof QueryCommand && cmd.input.ExpressionAttributeValues[":sk"] === "MEDIAMAP#") {
                held = true;
                reached();
                await gate;
            }
            return res;
        };
        const r2 = copyImages();
        await atGate;
        const r1 = (await copyImages()).body;
        release();
        const r2body = (await r2).body;
        table.send = realSend;
        copy.mockImplementation(async () => { throw new Error("no fetch expected after convergence"); });
        const r3 = (await copyImages()).body;
        return { r1, r2: r2body, r3, made };
    }
    const product = () => bySlug("boen-plank-p");
    const terminal = (r3: any) => expect(r3).toMatchObject({ complete: true, sources: [], products: { updated: 0, replaced: [], published: [] } });
    beforeEach(() => { n = 0; });

    it("CIG-STALE-WRITE (status unchanged): R1 main dead + extra copied (stays draft); R2's stale write (main copied, extra dead) is cancelled by the variants condition, re-planned, and KEEPS R1's extra", async () => {
        const E = img(101);
        const { r1, r2, r3, made } = await overlap([E], { [X]: ["dead", "ok"], [E]: ["ok", "dead"] });
        expect(r1.products.published).toEqual([]); // the extra never publishes: the status stays draft
        expect(product()).toMatchObject({
            status: "active",
            variants: [{ options: [{ value: "1", imageLink: made[X][0], additionalImageLinks: [made[E][0]] }] }],
        });
        expect(r2.products.published.map((p: any) => p.slug)).toEqual(["boen-plank-p"]);
        // R2's first write was cancelled (variants changed), its re-planned write committed
        const writes = updates().filter((u) => u.input.Key.SK === `PRODUCT#${product().id}`);
        expect(writes.map((u) => u.input.ExpressionAttributeValues[":read"])).toEqual(["draft", "draft", "draft"]);
        expect(r2.sources.find((s: any) => s.url === E)).toBeUndefined(); // R2's failure removed nothing, so it reports nothing for E
        terminal(r3);
    });

    it("two overlapping SUCCESSFUL copies of one extra (different names): the first stored copy is kept, the second is never appended", async () => {
        const E = img(102);
        const { r2, r3, made } = await overlap([E], { [X]: ["ok", "ok"], [E]: ["ok", "ok"] });
        expect(made[E]).toHaveLength(2);
        expect(made[E][0]).not.toBe(made[E][1]);
        expect(product().variants[0].options).toEqual([{ value: "1", imageLink: made[X][0], additionalImageLinks: [made[E][0]] }]);
        expect([product().imageLink, ...product().additionalImageLinks]).toEqual([made[X][0], made[E][0]]);
        expect(r2.products).toMatchObject({ updated: 0, replaced: [], published: [] });
        terminal(r3);
    });

    it("mixed outcomes over three extras: the final gallery is the read order — R2's restored copies and R1's kept copy, each holding once", async () => {
        const [E1, E2, E3] = [img(103), img(104), img(105)];
        const { r2, r3, made } = await overlap([E1, E2, E3], { [X]: ["ok", "dead"], [E1]: ["dead", "ok"], [E2]: ["ok", "dead"], [E3]: ["dead", "ok"] });
        // R1: E1, E3 removed, E2 copied, published by X; R2: E1, E3 copied, E2 dead — re-planned on R1's write
        expect(product().variants[0].options).toEqual([{ value: "1", imageLink: made[X][0], additionalImageLinks: [made[E1][0], made[E2][0], made[E3][0]] }]);
        expect(r2.sources.filter((s: any) => s.kind === "ingested").map((s: any) => s.url).sort()).toEqual([E1, E3].sort());
        terminal(r3);
    });
});

// ── RESIDUAL CAT-IMAGES-OVERLAP-1 (characterization, not a conformity oracle): the two-request path ──────────────────
describe("RESIDUAL CAT-IMAGES-OVERLAP-1 (characterization, not a conformity oracle) — two overlapping requests reach the fallback defect", () => {
    const X = img(110), A = img(111), B = img(112);
    const failed = { kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 10 } };
    let n = 0;

    it("R1: A dead, B copied (B-r1); R2 (read before R1): A and B copied, its MEDIAMAP# writes overwrite B's entry, its write is cancelled and re-planned → extras B-r1, B-r2 — A's copy suppressed, B twice (the follow-up must replace this expectation with A-r2, B-r1)", async () => {
        n = 0;
        expect((await importFile(`${HEADER},imagini suplimentare\nPlank,P,,,,,mp,,,${X},,1,${A}|${B}\n`)).status).toBe(200);
        const plan: Record<string, ("ok" | "dead")[]> = { [X]: ["ok", "ok"], [A]: ["dead", "ok"], [B]: ["ok", "ok"] };
        const made: Record<string, string[]> = {};
        copy.mockImplementation(async (_t: string, url: string) => {
            if (plan[url].shift() !== "ok") return failed;
            const cdnUrl = `${CDN}/t1/r${++n}-${url.split("/").pop()}`;
            (made[url] ??= []).push(cdnUrl);
            return { kind: "copied", cdnUrl };
        });
        let reached!: () => void;
        const atGate = new Promise<void>((r) => { reached = r; });
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const realSend = table.send.bind(table);
        let held = false;
        table.send = async (cmd: any) => {
            const res = await realSend(cmd);
            if (!held && cmd instanceof QueryCommand && cmd.input.ExpressionAttributeValues[":sk"] === "MEDIAMAP#") {
                held = true;
                reached();
                await gate;
            }
            return res;
        };
        const r2 = copyImages();
        await atGate;
        await copyImages(); // R1
        release();
        await r2;
        table.send = realSend;
        const extras = bySlug("boen-plank-p").variants[0].options[0].additionalImageLinks;
        const [Br1, Br2] = made[B];
        expect(made[A]).toHaveLength(1); // R2's copy of A exists …
        expect(extras).toEqual([Br1, Br2]); // … but is not stored; B is stored twice (defect)
    });
});
