import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { MemoryTable } from "./memory-table.js";

/**
 * BULK-PURGE-FOOTER-1 Part A (docs/slices/bulk-purge-footer-1.md) — a bulk mutation (a handler wrapped by
 * `withInvalidation()`) purges the tenant's stored S3 ISR pages through the renderer — the same `/api/revalidate` call
 * `revalidateTenantPaths` makes for Layer 2 — and only THEN writes the `CDN_PENDING` marker (CACHE-10: S3 before edge).
 *
 *  A1  every bulk export purges (the set is pinned below from the source), the purge precedes the marker;
 *  A2  an ordinary handler (content/update) makes exactly one renderer call per mutation — no second purge;
 *  A3  the tenant: the `x-tenant-id` header; `tenant/create` the created tenant's domain; no tenant → no purge, no error;
 *  A4  `PUT /settings` with a new domain purges the old AND the new domain;
 *  A5  a failing purge (renderer down, renderer 500, lookup error, a throwing purge function) never changes the response;
 *  A6  a dry run (glam-pricelist `?dryRun=1`, the bulk-price preview) purges nothing.
 *
 * Credential-free: `db.js` (a `vi.fn` or the in-memory table), `events.js` and Secrets Manager are mocked; `fetch` is
 * stubbed. `revalidate.ts` reads RENDERER_URL / REVALIDATION_SECRET_NAME at import, so each test re-imports the modules
 * under test after setting them (the revalidate-order.test.ts pattern); the variables are removed after the file.
 */

const { ddbSend, mockAudit, holder } = vi.hoisted(() => ({
    ddbSend: vi.fn(), mockAudit: vi.fn(), holder: { table: null as MemoryTable | null },
}));
vi.mock("../../src/lib/db.js", () => ({
    db: { send: (cmd: any) => (holder.table ? holder.table.send(cmd) : ddbSend(cmd)) },
    TABLE_NAME: "test-table",
}));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("../../src/lib/slug-guard.js", () => ({ checkSlugCommerceConflict: vi.fn(async () => null) }));
vi.mock("@aws-sdk/client-secrets-manager", () => ({
    SecretsManagerClient: class {
        send = async () => ({ SecretString: "s3cret" });
    },
    GetSecretValueCommand: class {
        constructor(public input: any) {}
    },
}));

const RENDERER = "https://renderer.test";
const fetchSpy = vi.fn();

/** Re-import a module under test with the renderer configured, or (`rendererUrl: null`) not. */
async function load<M>(modulePath: string, rendererUrl: string | null = RENDERER): Promise<M> {
    vi.resetModules();
    if (rendererUrl) process.env.RENDERER_URL = rendererUrl;
    else delete process.env.RENDERER_URL;
    process.env.REVALIDATION_SECRET_NAME = "revalidation-secret";
    return (await import(modulePath)) as M;
}
afterAll(() => {
    delete process.env.RENDERER_URL;
    delete process.env.REVALIDATION_SECRET_NAME;
});

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const GLOBAL_ADMIN = { sub: "g1", email: "root@amodx.test", role: "GLOBAL_ADMIN", tenantId: "GLOBAL" };
const ROUTING = { domain: "acme.test" };

const event = (body: unknown, opts: { tenant?: string | null; auth?: any; extra?: Record<string, unknown> } = {}) => ({
    headers: opts.tenant === null ? {} : { "x-tenant-id": opts.tenant ?? "t1" },
    requestContext: { authorizer: { lambda: opts.auth ?? TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
    ...opts.extra,
}) as any;
const invoke = async (handler: any, e: any) => (await handler(e, {} as any, () => {})) as { statusCode: number; body: string };

/** The renderer calls made: the parsed JSON body of each `fetch` to `/api/revalidate`. */
const rendererCalls = () => fetchSpy.mock.calls.map((c) => {
    expect(c[0]).toBe(`${RENDERER}/api/revalidate`);
    expect(c[1].headers["x-revalidation-token"]).toBe("s3cret");
    return JSON.parse(c[1].body);
});
/** Call order of the `CDN_PENDING` marker writes (UpdateCommand on SYSTEM / CDN_PENDING), from the `vi.fn` table. */
const pendingMarkerOrders = () => ddbSend.mock.calls
    .map((c, i) => ({ cmd: c[0], order: ddbSend.mock.invocationCallOrder[i] }))
    .filter(({ cmd }) => cmd instanceof UpdateCommand && cmd.input.Key?.PK === "SYSTEM" && cmd.input.Key?.SK === "CDN_PENDING")
    .map(({ order }) => order);
const tenantReads = () => ddbSend.mock.calls.filter((c) => c[0] instanceof GetCommand && c[0].input.Key?.SK === "TENANT#t1");

beforeEach(() => {
    holder.table = null;
    ddbSend.mockReset().mockImplementation(async (cmd: any) => (
        cmd instanceof GetCommand && cmd.input.Key?.PK === "SYSTEM" && cmd.input.Key?.SK === "TENANT#t1" ? { Item: { ...ROUTING } } : {}
    ));
    mockAudit.mockReset().mockResolvedValue(undefined);
    fetchSpy.mockReset().mockImplementation(async () => new Response(JSON.stringify({ revalidated: true, purged: 4 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
});

const POPUP = { name: "Spring sale" };

describe("A1 — a bulk handler purges the tenant's stored pages, then marks the CDN", () => {
    it("popups/create (2xx): one renderer call for the tenant's domain, BEFORE the CDN_PENDING marker", async () => {
        const { handler } = await load<any>("../../src/popups/create.js");
        const res = await invoke(handler, event(POPUP));
        expect(res.statusCode).toBe(201);
        expect(rendererCalls()).toEqual([{ domain: "acme.test", slug: "/" }]);
        const [marker] = pendingMarkerOrders();
        expect(marker).toBeDefined();
        expect(fetchSpy.mock.invocationCallOrder[0]).toBeLessThan(marker);
    });

    it("a refused request (non-2xx) purges nothing and writes no marker", async () => {
        const { handler } = await load<any>("../../src/popups/create.js");
        expect((await invoke(handler, event({ name: "" }))).statusCode).toBe(500); // PopupSchema refuses an empty name
        expect((await invoke(handler, event(POPUP, { tenant: null, auth: GLOBAL_ADMIN }))).statusCode).toBe(400);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(pendingMarkerOrders()).toEqual([]);
    });

    it("renderer not configured: no tenant read, no renderer call — the marker is still written", async () => {
        const { handler } = await load<any>("../../src/popups/create.js", null);
        expect((await invoke(handler, event(POPUP))).statusCode).toBe(201);
        expect(tenantReads()).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(pendingMarkerOrders()).toHaveLength(1);
    });

    it("a tenant without a domain: no renderer call, the marker is still written", async () => {
        ddbSend.mockImplementation(async (cmd: any) => (cmd instanceof GetCommand ? { Item: {} } : {}));
        const { handler } = await load<any>("../../src/popups/create.js");
        expect((await invoke(handler, event(POPUP))).statusCode).toBe(201);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(pendingMarkerOrders()).toHaveLength(1);
    });
});

describe("A3 — which tenant", () => {
    it("a 2xx answer to a request without x-tenant-id: no purge, no error; the marker is still written", async () => {
        const { withInvalidation } = await load<any>("../../src/lib/invalidate-cdn.js");
        const { purgeStoredPagesOfRequestTenant } = await import("../../src/lib/revalidate.js");
        const ok = { statusCode: 200, body: "{}" };
        const wrapped = withInvalidation(async () => ok, purgeStoredPagesOfRequestTenant);
        expect(await wrapped({ headers: {} })).toBe(ok);
        expect(await wrapped(undefined)).toBe(ok);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(tenantReads()).toEqual([]);
        expect(pendingMarkerOrders()).toHaveLength(2);
    });

    it("tenant/create purges the CREATED tenant's domain (held by the handler — no tenant read), then marks", async () => {
        const { handler } = await load<any>("../../src/tenant/create.js");
        const res = await invoke(handler, event({ name: "New Shop", domain: "new-shop.test" }, { tenant: "t1", auth: GLOBAL_ADMIN }));
        expect(res.statusCode).toBe(201);
        expect(rendererCalls()).toEqual([{ domain: "new-shop.test", slug: "/" }]);
        expect(ddbSend.mock.calls.filter((c) => c[0] instanceof GetCommand)).toEqual([]);
        expect(fetchSpy.mock.invocationCallOrder[0]).toBeLessThan(pendingMarkerOrders()[0]);
    });

    it("themes/manage is not tenant-scoped (PK SYSTEM / THEME#): it marks the CDN and purges nothing", async () => {
        const { createHandler } = await load<any>("../../src/themes/manage.js");
        expect((await invoke(createHandler, event({ name: "Dark", theme: {} }))).statusCode).toBe(201);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(pendingMarkerOrders()).toHaveLength(1);
    });
});

describe("A4 — PUT /settings purges the domain before and after the save", () => {
    const STORED = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Acme", domain: "acme.test", Domain: "acme.test" };
    beforeEach(() => {
        ddbSend.mockImplementation(async (cmd: any) => {
            if (cmd instanceof GetCommand) return { Item: structuredClone(STORED) };
            if (cmd.constructor.name === "QueryCommand") return { Items: [] };
            return {};
        });
    });

    it("a domain change: the old and the new domain, each once, before the marker", async () => {
        const { updateHandler } = await load<any>("../../src/tenant/settings.js");
        const res = await invoke(updateHandler, event({ domain: "shop.acme.test" }));
        expect(res).toEqual({ statusCode: 200, body: JSON.stringify({ message: "Settings Saved" }) });
        expect(rendererCalls()).toEqual([{ domain: "acme.test", slug: "/" }, { domain: "shop.acme.test", slug: "/" }]);
        expect(Math.max(...fetchSpy.mock.invocationCallOrder)).toBeLessThan(pendingMarkerOrders()[0]);
    });

    it("no domain change: one purge of the tenant's domain", async () => {
        const { updateHandler } = await load<any>("../../src/tenant/settings.js");
        expect((await invoke(updateHandler, event({ name: "Acme 2" }))).statusCode).toBe(200);
        expect(rendererCalls()).toEqual([{ domain: "acme.test", slug: "/" }]);
    });

    it("a body domain that is not a string is not purged and does not change the answer", async () => {
        const { updateHandler } = await load<any>("../../src/tenant/settings.js");
        expect(await invoke(updateHandler, event({ domain: 123 }))).toEqual({ statusCode: 200, body: JSON.stringify({ message: "Settings Saved" }) });
        expect(rendererCalls()).toEqual([{ domain: "acme.test", slug: "/" }]);
    });

    it("a refused save (400) purges nothing", async () => {
        const { updateHandler } = await load<any>("../../src/tenant/settings.js");
        expect((await invoke(updateHandler, event({ footer: { width: "x" } }))).statusCode).toBe(400);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe("A5 — a failing purge never changes the response", () => {
    const failures: [string, () => void][] = [
        ["the renderer is unreachable (fetch rejects)", () => fetchSpy.mockRejectedValue(new TypeError("fetch failed"))],
        ["the renderer answers 500 (S3 purge failed)", () => fetchSpy.mockResolvedValue(new Response("{\"error\":\"x\"}", { status: 500 }))],
        ["the tenant lookup fails", () => ddbSend.mockImplementation(async (cmd: any) => {
            if (cmd instanceof GetCommand) throw new Error("AccessDeniedException");
            return {};
        })],
    ];
    for (const [name, fail] of failures) {
        it(`${name}: same status and body as a successful purge; the marker is still written`, async () => {
            const { handler } = await load<any>("../../src/categories/create.js");
            vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
            vi.useFakeTimers({ now: new Date("2026-11-02T10:00:00.000Z"), toFake: ["Date"] });
            try {
                const body = { name: "Floors", slug: "floors" };
                const good = await invoke(handler, event(body));
                expect(good.statusCode).toBe(201);
                fetchSpy.mockClear();
                ddbSend.mockClear();
                fail();
                const bad = await invoke(handler, event(body));
                expect(bad).toEqual(good);
                expect(pendingMarkerOrders()).toHaveLength(1);
            } finally {
                vi.useRealTimers();
                vi.restoreAllMocks();
            }
        });
    }

    it("a purge function that throws: the wrapper logs it, returns the handler's response and still writes the marker", async () => {
        const { withInvalidation } = await load<any>("../../src/lib/invalidate-cdn.js");
        const ok = { statusCode: 201, body: "{\"id\":\"x\"}" };
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const wrapped = withInvalidation(async () => ok, async () => { throw new Error("boom"); });
            expect(await wrapped({ headers: { "x-tenant-id": "t1" } })).toBe(ok);
            expect(pendingMarkerOrders()).toHaveLength(1);
            expect(errors.mock.calls.some((c) => String(c[0]).includes("Stored-page purge threw"))).toBe(true);
        } finally {
            errors.mockRestore();
        }
    });
});

describe("A2 — an ordinary handler makes exactly one renderer call per mutation", () => {
    it("content/update (slug unchanged): one renderer call, one marker — no second purge", async () => {
        const PAGE = { PK: "TENANT#t1", SK: "CONTENT#n1#LATEST", title: "Old", slug: "/about", status: "Published", blocks: [], version: 3 };
        ddbSend.mockImplementation(async (cmd: any) => {
            if (cmd instanceof GetCommand && cmd.input.Key?.SK === "TENANT#t1") return { Item: { ...ROUTING } };
            if (cmd instanceof GetCommand) return { Item: structuredClone(PAGE) };
            return {};
        });
        const { handler } = await load<any>("../../src/content/update.js");
        const res = await invoke(handler, event({ title: "New" }, { extra: { pathParameters: { id: "n1" } } }));
        expect(res.statusCode).toBe(200);
        expect(rendererCalls()).toEqual([{ domain: "acme.test", slug: "/about" }]);
        expect(pendingMarkerOrders()).toHaveLength(1);
    });
});

describe("A6 — dry runs purge nothing", () => {
    const PRODUCT = { PK: "TENANT#t1", SK: "PRODUCT#p1", id: "p1", title: "Oak", slug: "oak", price: "100.00", categoryIds: [] };
    beforeEach(() => {
        ddbSend.mockImplementation(async (cmd: any) => {
            if (cmd instanceof GetCommand && cmd.input.Key?.SK === "TENANT#t1") return { Item: { ...ROUTING } };
            if (cmd.constructor.name === "QueryCommand") return { Items: [structuredClone(PRODUCT)] };
            return {};
        });
    });

    it("products/bulk-price preview (dryRun, the default): no renderer call", async () => {
        const { handler } = await load<any>("../../src/products/bulk-price.js");
        const res = await invoke(handler, event({ percent: 10 }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).preview).toHaveLength(1);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("products/bulk-price apply (dryRun: false): one renderer call for the tenant, before the marker", async () => {
        const { handler } = await load<any>("../../src/products/bulk-price.js");
        const res = await invoke(handler, event({ percent: 10, dryRun: false }));
        expect(JSON.parse(res.body).count).toBe(1);
        expect(rendererCalls()).toEqual([{ domain: "acme.test", slug: "/" }]);
        expect(fetchSpy.mock.invocationCallOrder[0]).toBeLessThan(pendingMarkerOrders()[0]);
    });

    describe("import/glam-pricelist (in-memory table)", () => {
        const csv = [
            "colectie,produs,cod vechi,pret achizitie,pret lista,cod nou,unitate,impachetare,comanda minima,imagine,specificatii,format",
            "Herringbone,Oak Vivo,OLD-CODE-1,111.11,222.22,NEW-CODE-2,mp,,,,,120",
        ].join("\n") + "\n";
        const glamEvent = (dryRun: boolean) => event(
            { csvContent: csv, producer: "BOEN", sheet: "PL", variantName: "Format" },
            { extra: { routeKey: "POST /import/glam-pricelist", queryStringParameters: dryRun ? { dryRun: "1" } : undefined } },
        );
        beforeEach(() => {
            holder.table = new MemoryTable();
            holder.table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Glam", catalogMode: true, domain: "glam.test" });
            vi.spyOn(Math, "random").mockReturnValue(0);
        });

        it("dry run: 200, no renderer call", async () => {
            const { handler } = await load<any>("../../src/import/glam-pricelist.js");
            expect((await invoke(handler, glamEvent(true))).statusCode).toBe(200);
            expect(fetchSpy).not.toHaveBeenCalled();
            vi.restoreAllMocks();
        });

        it("import: 200, one renderer call for the tenant's domain, before the marker", async () => {
            const { handler } = await load<any>("../../src/import/glam-pricelist.js");
            expect((await invoke(handler, glamEvent(false))).statusCode).toBe(200);
            expect(rendererCalls()).toEqual([{ domain: "glam.test", slug: "/" }]);
            const commands = holder.table!.commands;
            const marker = commands.findIndex((c) => c instanceof UpdateCommand && c.input.Key?.SK === "CDN_PENDING");
            const routing = commands.findIndex((c) => c instanceof GetCommand && c.input.ProjectionExpression === "#domain, urlPrefixes");
            expect(routing).toBeGreaterThan(-1);
            expect(marker).toBeGreaterThan(routing);
            vi.restoreAllMocks();
        });
    });
});

/**
 * A1 — the bulk set, read from the source (deterministic: every `const … = withInvalidation(` declaration at the start of
 * a line under backend/src — the doc examples in invalidate-cdn.ts sit in a comment and do not match). Each
 * either passes `purgeStoredPagesOfRequestTenant`, or is one of the named exceptions, which purge inside the handler
 * (`purgeStoredPagesOf…` call) or not at all (themes/manage). A new wrapped handler fails here until it chooses.
 */
describe("A1 — every wrapped handler chooses its purge", () => {
    const SRC = path.resolve(__dirname, "../../src");
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
        const p = path.join(dir, n);
        return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
    });
    const sites = files(SRC).flatMap((file) => {
        const rel = path.relative(SRC, file).replace(/\\/g, "/").replace(/\.ts$/, "");
        return [...readFileSync(file, "utf8").matchAll(/^(?:export )?const \w+ = withInvalidation\((\w+)(, (\w+))?\);/gm)].map((m) => ({ rel, purge: m[3] ?? null }));
    });

    it("18 files pass purgeStoredPagesOfRequestTenant; tenant/create, tenant/settings, products/bulk-price purge inside; themes/manage not at all", () => {
        const withPurge = sites.filter((s) => s.purge === "purgeStoredPagesOfRequestTenant").map((s) => s.rel).sort();
        expect(withPurge).toEqual([
            "categories/create", "content/restore", "forms/create", "forms/delete", "forms/update",
            "import/glam-images", "import/glam-pricelist", "import/media", "import/reviews", "import/woocommerce", "import/wordpress",
            "popups/create", "popups/delete", "popups/update", "products/create",
            "reviews/create", "reviews/delete", "reviews/update",
        ]);
        expect(sites.filter((s) => s.purge !== null && s.purge !== "purgeStoredPagesOfRequestTenant")).toEqual([]);
        const without = sites.filter((s) => s.purge === null).map((s) => s.rel).sort();
        expect(without).toEqual(["products/bulk-price", "tenant/create", "tenant/settings", "themes/manage", "themes/manage"]);
        const source = (rel: string) => readFileSync(path.join(SRC, `${rel}.ts`), "utf8");
        expect(source("products/bulk-price")).toMatch(/await purgeStoredPagesOfTenant\(tenantId\);/);
        expect(source("tenant/create")).toMatch(/await purgeStoredPagesOfDomains\(\[validTenant\.domain\]\);/);
        expect(source("tenant/settings")).toMatch(/await purgeStoredPagesOfDomains\(\[current\.domain, merged\.domain\]\);/);
        expect(source("themes/manage")).not.toMatch(/purgeStoredPages/);
    });

    it("the six ordinary handlers are not wrapped (their purge is revalidateTenantPaths, once)", () => {
        const ordinary = ["content/create", "content/update", "products/update", "products/delete", "categories/update", "categories/delete"];
        for (const rel of ordinary) expect(sites.some((s) => s.rel === rel), rel).toBe(false);
    });
});
