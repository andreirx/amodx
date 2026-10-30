import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BatchWriteCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
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

let table: MemoryTable;
const bySlug = (slug: string) => table.all("PRODUCT#").find((p) => p.slug === slug)!;
const updates = () => table.commands.filter((c) => c instanceof UpdateCommand && c.input.ConditionExpression === "attribute_exists(PK)");

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
        expect(res.body.counts).toEqual({ ingested: 2, cached: 0, refused: 0, failed: 1 });
        expect(res.body.complete).toBe(true);
        expect(res.body.progress).toEqual({ sourcesAtStart: 3, resolved: 3, remainingOptions: 0, remainingSources: 0 });
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
        expect(res.body.counts).toEqual({ ingested: 0, cached: 2, refused: 0, failed: 1 });
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
            if (cmd instanceof UpdateCommand && cmd.input.ConditionExpression === "attribute_exists(PK)") now += 25_000;
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
            if (cmd instanceof UpdateCommand && cmd.input.ConditionExpression === "attribute_exists(PK)") now += 25_000; // past the update budget
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

describe("CAT-IMAGES-1 slice § 9 — two overlapping requests over the same product converge", () => {
    const X = img(70);
    const Y = img(71);
    const mediaMapItem = (url: string) => ({ PK: "TENANT#t1", SK: `MEDIAMAP#${createHash("md5").update(url).digest("hex")}`, oldUrl: url, newUrl: copied(url), Type: "MediaMap" });

    it.each([
        ["X copied by R1", false, [{ value: "1", imageLink: copied(X) }, { value: "2", imageLink: copied(Y) }], 0],
        ["X dead (removed by R1)", true, [{ value: "1" }, { value: "2", imageLink: copied(Y) }], 1],
    ] as const)("%s: R2's stale write restores X's producer URL; R3 repairs it", async (_label, xDead, converged, r3Fetches) => {
        if (xDead) DEAD.add(X);
        try {
            let now = 1_000_000;
            vi.spyOn(Date, "now").mockImplementation(() => now);
            await importFile(csv({ c: "Plank", p: "P", f: "1", img: X }, { c: "Plank", p: "P", f: "2", img: Y }));
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

            // R2 resumes past its copy budget: it copies nothing, resolves Y from its map, and writes from its STALE read.
            now += COPY_START_BUDGET_MS + 1_000;
            release();
            const second = (await r2).body;
            expect(second.products.updated).toBe(1);
            expect(options()).toEqual([{ value: "1", imageLink: X }, { value: "2", imageLink: copied(Y) }]);
            expect(second).toMatchObject({ complete: false, progress: { remainingOptions: 1 } });

            // R3 repairs it: X from MEDIAMAP# (no fetch) when R1 copied it; fetched again and removed again when dead.
            copy.mockClear();
            const third = (await copyImages()).body;
            expect(third.complete).toBe(true);
            expect(options()).toEqual(converged);
            expect(copy).toHaveBeenCalledTimes(r3Fetches);
            // The same holding (P, option "1") is reported by R1 AND by R3 — a repeated holding the admin page must
            // replace by the latest outcome (review-2 CIM-F2-OVERLAP; admin rule rows in GlamPricelistImport.test.ts).
            const holdingOf = (body: any) => body.sources.find((src: any) => src.url === X)?.holders.find((h: any) => h.option === "1");
            expect(holdingOf(r1)).toMatchObject({ slug: "boen-plank-p", option: "1" });
            expect(holdingOf(third)).toEqual(holdingOf(r1));
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
