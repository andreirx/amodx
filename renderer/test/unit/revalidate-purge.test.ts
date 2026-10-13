import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * CACHE-10 — the renderer's /api/revalidate route deletes the tenant's S3 ISR cache objects.
 *
 * Each `it` below is bound to one row of the slice's contract table (docs: the CACHE-10 slice
 * packet, and docs/caching-architecture.md § 5). The real POST handler runs; only its module
 * boundaries are replaced:
 *  - `@aws-sdk/client-s3` → an in-memory FAKE BUCKET that implements the two calls the route uses
 *    (ListObjectsV2 with Prefix / Delimiter / pagination, DeleteObjects with per-key errors), so
 *    the assertions are about which objects REMAIN, not about which calls were made.
 *  - `next/cache` → spies (outside a Next request there is no store for revalidatePath to write).
 * No AWS credentials, no network.
 */

const { s3Send, revalidatePathSpy, revalidateTagSpy } = vi.hoisted(() => {
    // The route reads the secret at module load, so it must exist before the import below.
    process.env.REVALIDATION_SECRET = "test-secret";
    return { s3Send: vi.fn(), revalidatePathSpy: vi.fn(), revalidateTagSpy: vi.fn() };
});

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class {
        send = s3Send;
    },
    ListObjectsV2Command: class {
        readonly kind = "List";
        constructor(public input: any) {}
    },
    DeleteObjectsCommand: class {
        readonly kind = "Delete";
        constructor(public input: any) {}
    },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathSpy, revalidateTag: revalidateTagSpy }));

import { POST } from "@/app/api/revalidate/route";

// ---------------------------------------------------------------------------------------------
// Fake bucket
// ---------------------------------------------------------------------------------------------

type Fake = {
    keys: Set<string>;
    pageSize: number; // small, so every listing exercises ContinuationToken pagination
    deleteBatches: number[];
    failList?: Error;
    failDelete?: Error;
    deleteErrorsFor?: Set<string>; // keys DeleteObjects reports as failed (HTTP 200 + Errors[])
};
let fake: Fake;

function list(input: any) {
    if (fake.failList) throw fake.failList;
    const prefix: string = input.Prefix ?? "";
    const delimiter: string | undefined = input.Delimiter;
    const entries = new Map<string, "key" | "prefix">();
    for (const key of fake.keys) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const cut = delimiter ? rest.indexOf(delimiter) : -1;
        if (cut >= 0) entries.set(prefix + rest.slice(0, cut + delimiter!.length), "prefix");
        else entries.set(key, "key");
    }
    const sorted = [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
    const page = sorted.slice(start, start + fake.pageSize);
    const next = start + fake.pageSize;
    return {
        Contents: page.filter(([, t]) => t === "key").map(([Key]) => ({ Key })),
        CommonPrefixes: page.filter(([, t]) => t === "prefix").map(([Prefix]) => ({ Prefix })),
        IsTruncated: next < sorted.length,
        NextContinuationToken: next < sorted.length ? String(next) : undefined,
    };
}

function del(input: any) {
    if (fake.failDelete) throw fake.failDelete;
    const objects: Array<{ Key: string }> = input.Delete.Objects;
    if (objects.length > 1000) throw new Error("MalformedXML: more than 1000 keys");
    fake.deleteBatches.push(objects.length);
    const Errors: any[] = [];
    for (const { Key } of objects) {
        if (fake.deleteErrorsFor?.has(Key)) Errors.push({ Key, Code: "AccessDenied", Message: "denied" });
        else fake.keys.delete(Key);
    }
    return Errors.length ? { Errors } : {};
}

// ---------------------------------------------------------------------------------------------
// Fixtures — the VERIFIED next 16.3.8 layout plus the legacy layout
// ---------------------------------------------------------------------------------------------

const P = "_cache";
const B1 = "VTbSGfT3XkHrt8wJr7GTh";
const B2 = "OldBuild_42-x";
const H_PAGE = "7153e226028fa34f6df005d3266e3119babe6d3e0cf1e05f2ae43ed8e9cda978";
const H_PROD = "aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44";

const newKey = (build: string, kind: string, hash: string, path: string) =>
    `${P}/${build}/route-cache/${kind}/${hash}/$/${path}.cache`;
const legacyKey = (build: string, path: string) => `${P}/${build}/${path}.cache`;

/** Every cache object a tenant could have: home + pages, both layouts, two builds, two owners. */
function tenantObjects(domain: string): string[] {
    return [
        newKey(B1, "APP_PAGE", H_PAGE, domain),
        newKey(B1, "APP_PAGE", H_PAGE, `${domain}/about`),
        newKey(B1, "APP_PAGE", H_PAGE, `${domain}/blog/post-1`),
        newKey(B1, "APP_PAGE", H_PROD, `${domain}/products/p1`),
        newKey(B1, "APP_ROUTE", H_PROD, `${domain}/sitemap.xml`),
        newKey(B2, "APP_PAGE", H_PAGE, domain),
        newKey(B2, "APP_PAGE", H_PAGE, `${domain}/about`),
        legacyKey(B1, domain),
        legacyKey(B1, `${domain}/about`),
        legacyKey(B2, `${domain}/blog/post-1`),
    ];
}

const FETCH_CACHE = `${P}/__fetch/${B1}/0f1e2d3c4b5a`;
const STATIC_ASSET = `_assets/_next/static/chunks/main.js`;

const req = (body: Record<string, unknown>, token = "test-secret") =>
    ({ headers: new Headers({ "x-revalidation-token": token }), json: async () => body }) as any;

const listCalls = () => s3Send.mock.calls.filter(([c]) => c.kind === "List").length;
const deleteCalls = () => s3Send.mock.calls.filter(([c]) => c.kind === "Delete").length;

beforeEach(() => {
    fake = { keys: new Set(), pageSize: 3, deleteBatches: [] };
    s3Send.mockReset();
    s3Send.mockImplementation(async (cmd: any) => (cmd.kind === "List" ? list(cmd.input) : del(cmd.input)));
    revalidatePathSpy.mockReset();
    revalidateTagSpy.mockReset();
    process.env.CACHE_BUCKET_NAME = "cache-bucket";
    process.env.CACHE_BUCKET_KEY_PREFIX = P;
    process.env.CACHE_BUCKET_REGION = "eu-central-1";
});

// ---------------------------------------------------------------------------------------------
// The contract table
// ---------------------------------------------------------------------------------------------

describe("CACHE-10 /api/revalidate — S3 ISR purge contract", () => {
    it("bucket env absent → skips the purge, still 200 for the revalidatePath part (purged: null)", async () => {
        delete process.env.CACHE_BUCKET_NAME;
        fake.keys = new Set(tenantObjects("acme.test"));

        const res = await POST(req({ domain: "acme.test", slug: "/about" }));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toMatchObject({ revalidated: true, path: "/acme.test/about", purged: null });
        expect(revalidatePathSpy).toHaveBeenCalledWith("/acme.test/about");
        expect(revalidatePathSpy).toHaveBeenCalledWith("/acme.test", "layout");
        expect(s3Send).not.toHaveBeenCalled();
        expect(fake.keys.size).toBe(tenantObjects("acme.test").length);
    });

    it("domain absent → existing 400, unchanged, touches nothing", async () => {
        const res = await POST(req({ slug: "/about" }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "Missing domain or tag" });
        expect(revalidatePathSpy).not.toHaveBeenCalled();
        expect(s3Send).not.toHaveBeenCalled();
    });

    it("domain that could alias a fixed key segment (no '.', or a '/') → 400 before any S3 call", async () => {
        fake.keys = new Set([...tenantObjects("acme.test"), ...tenantObjects("other.test")]);
        const before = new Set(fake.keys);

        for (const domain of ["route-cache", "__fetch", "localhost", "acme.test/../x", "a/b.c"]) {
            const res = await POST(req({ domain, slug: "/" }));
            expect(res.status, domain).toBe(400);
        }
        expect(s3Send).not.toHaveBeenCalled();
        expect(revalidatePathSpy).not.toHaveBeenCalled();
        expect(fake.keys).toEqual(before);
    });

    it("domain with no cached objects → 0 deletions, 200, no DeleteObjects request", async () => {
        fake.keys = new Set([...tenantObjects("other.test"), FETCH_CACHE]);
        const before = new Set(fake.keys);

        const res = await POST(req({ domain: "acme.test", slug: "/about" }));

        expect(res.status).toBe(200);
        expect((await res.json()).purged).toBe(0);
        expect(deleteCalls()).toBe(0);
        expect(fake.keys).toEqual(before);
    });

    it("objects in new + legacy layout, several buildIds and owner hashes → all deleted, other tenants untouched", async () => {
        const mine = tenantObjects("acme.test");
        const others = [...tenantObjects("other.test"), FETCH_CACHE, STATIC_ASSET];
        fake.keys = new Set([...mine, ...others]);

        const res = await POST(req({ domain: "acme.test", slug: "/about" }));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.purged).toBe(mine.length);
        expect([...fake.keys].sort()).toEqual([...others].sort());
    });

    it("domain that is a prefix of another tenant's domain → the other tenant is untouched", async () => {
        const mine = tenantObjects("shop.example.com");
        const evil = tenantObjects("shop.example.com.evil");
        const dashed = tenantObjects("shop.example.com-x.net");
        fake.keys = new Set([...mine, ...evil, ...dashed]);

        const res = await POST(req({ domain: "shop.example.com", slug: "/" }));

        expect(res.status).toBe(200);
        expect((await res.json()).purged).toBe(mine.length);
        expect([...fake.keys].sort()).toEqual([...evil, ...dashed].sort());
    });

    it("S3 List throws → 500 (not 200), revalidatePath was still called first", async () => {
        fake.keys = new Set(tenantObjects("acme.test"));
        fake.failList = new Error("AccessDenied: s3:ListBucket");

        const res = await POST(req({ domain: "acme.test", slug: "/about" }));
        const body = await res.json();

        expect(res.status).toBe(500);
        expect(body.error).toMatch(/ISR S3 purge failed: AccessDenied: s3:ListBucket/);
        expect(revalidatePathSpy).toHaveBeenCalledTimes(2);
        expect(revalidatePathSpy.mock.invocationCallOrder[0]).toBeLessThan(s3Send.mock.invocationCallOrder[0]);
    });

    it("S3 DeleteObjects throws → 500", async () => {
        fake.keys = new Set(tenantObjects("acme.test"));
        fake.failDelete = new Error("SlowDown");

        const res = await POST(req({ domain: "acme.test", slug: "/about" }));

        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/ISR S3 purge failed: SlowDown/);
    });

    it("DeleteObjects answers 200 but lists per-key Errors → 500 (S3 does not throw for these)", async () => {
        const mine = tenantObjects("acme.test");
        fake.keys = new Set(mine);
        fake.deleteErrorsFor = new Set([mine[1]]);

        const res = await POST(req({ domain: "acme.test", slug: "/about" }));

        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/DeleteObjects failed for 1 of \d+ key\(s\); first: .*AccessDenied/);
    });

    it("paginates every listing and deletes in batches of at most 1000", async () => {
        const many = Array.from({ length: 2500 }, (_, i) => newKey(B1, "APP_PAGE", H_PAGE, `acme.test/p/${i}`));
        fake.keys = new Set([...many, ...tenantObjects("other.test")]);
        fake.pageSize = 7;

        const res = await POST(req({ domain: "acme.test", slug: "/p/1" }));

        expect(res.status).toBe(200);
        expect((await res.json()).purged).toBe(2500);
        expect(fake.deleteBatches).toEqual([1000, 1000, 500]);
        expect([...fake.keys].sort()).toEqual(tenantObjects("other.test").sort());
        expect(listCalls()).toBeGreaterThan(2500 / 7);
    });
});

describe("CACHE-10 — branches the slice leaves unchanged", () => {
    it("tag branch → revalidateTag(tag, 'max'), 200, no S3 purge", async () => {
        fake.keys = new Set(tenantObjects("acme.test"));

        const res = await POST(req({ tag: "product-1" }));

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ revalidated: true, tag: "product-1" });
        expect(revalidateTagSpy).toHaveBeenCalledWith("product-1", "max");
        expect(s3Send).not.toHaveBeenCalled();
    });

    it("wrong token → 401, no purge", async () => {
        fake.keys = new Set(tenantObjects("acme.test"));
        const res = await POST(req({ domain: "acme.test", slug: "/" }, "wrong"));
        expect(res.status).toBe(401);
        expect(s3Send).not.toHaveBeenCalled();
    });
});
