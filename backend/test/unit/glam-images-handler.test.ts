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
describe("CAT-IMAGES-1 slice § 9 — two overlapping requests over the same product converge (no publication at stake)", () => {
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
        // one write per published product: images and status together, the existence condition kept
        expect(updates()).toHaveLength(2);
        for (const u of updates()) {
            expect(u.input.UpdateExpression).toContain("#status = :active");
            expect(u.input.ConditionExpression).toBe("attribute_exists(PK) AND #status = :read");
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
