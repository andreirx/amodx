import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

/**
 * DIGITAL-FILE-GUARD-1 (docs/slices/digital-file-guard-1.md) — a paid digital product's private file cannot be
 * obtained through the lead form, and the public product route does not name it.
 *
 * The real handlers run (`leads/create.ts`, `products/public-get.ts`, `resources/presign.ts` `downloadHandler`) with
 * the real `lib/resource-products.ts`, `tenant-verify.ts` and `recaptcha.ts`. Mocked: `db.js` (its `send`, an
 * in-memory answer per command) and the S3 presigner (it returns a fixed fake string, so no real link exists in this
 * test). Credential-free. reCAPTCHA is off: no tenant keys and no `RECAPTCHA_SECRET_KEY`.
 */

const { ddbSend, signUrl } = vi.hoisted(() => {
    process.env.PRIVATE_BUCKET = "test-private-bucket";
    delete process.env.RECAPTCHA_SECRET_KEY;
    return { ddbSend: vi.fn(), signUrl: vi.fn(async () => "fake-signed-link") };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: signUrl }));

import { handler as createLead } from "../../src/leads/create.js";
import { handler as productPublicGet } from "../../src/products/public-get.js";
import { downloadHandler } from "../../src/resources/presign.js";
import { productIdsReferencingResource } from "../../src/lib/resource-products.js";

const T = "t1";
const EMAIL = "visitor@example.test";

/** Stored RESOURCE# items, by table key. `r-free` and `r-paid` belong to t1; `r-other` to t2 only. */
const RESOURCES: Record<string, Record<string, any>> = {
    "TENANT#t1|RESOURCE#r-free": { id: "r-free", s3Key: "t1/r-free-guide.pdf" },
    "TENANT#t1|RESOURCE#r-paid": { id: "r-paid", s3Key: "t1/r-paid-course.zip" },
    "TENANT#t2|RESOURCE#r-other": { id: "r-other", s3Key: "t2/r-other.pdf" },
};

/** The `PRODUCT#` pages of t1's partition as DynamoDB would read them before the filter; each page is one answer.
 *  `productPages` is the state after every completed write: what a strongly consistent read (`ConsistentRead: true`)
 *  returns. `stalePages`, when set, is what an eventually consistent read returns instead (a recent write not yet
 *  visible); when null, both reads see `productPages`. */
let productPages: Record<string, any>[][] = [];
let stalePages: Record<string, any>[][] | null = null;
let productQueryFails = false;

function mockDb() {
    ddbSend.mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) {
            const { PK, SK } = cmd.input.Key as { PK: string; SK: string };
            if (PK === "SYSTEM") return { Item: { id: T } }; // tenant record, no reCAPTCHA keys
            const item = RESOURCES[`${PK}|${SK}`];
            return item ? { Item: structuredClone(item) } : {};
        }
        if (cmd instanceof QueryCommand) {
            const values = cmd.input.ExpressionAttributeValues as Record<string, any>;
            if (values[":sk"] === "PRODUCT#") {
                if (productQueryFails) throw new Error("ProvisionedThroughputExceededException");
                const view = cmd.input.ConsistentRead === true ? productPages : (stalePages ?? productPages);
                const page = cmd.input.ExclusiveStartKey ? Number(cmd.input.ExclusiveStartKey.page) : 0;
                const items = (view[page] ?? [])
                    .filter((p) => p.resourceId === values[":resourceId"])
                    .map((p) => ({ id: p.id }));
                const next = page + 1 < view.length ? { LastEvaluatedKey: { page: String(page + 1) } } : {};
                return { Items: items, ...next };
            }
            return { Items: [] }; // CUSTORDER# (presign purchase check)
        }
        return {};
    });
}

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const productQueries = () =>
    commands().filter((c) => c instanceof QueryCommand && (c.input.ExpressionAttributeValues as any)[":sk"] === "PRODUCT#");
const leadPuts = () => commands().filter((c) => c instanceof PutCommand && String(c.input.Item!.SK).startsWith("LEAD#"));

function leadEvent(body: Record<string, unknown>) {
    return {
        headers: { "x-tenant-id": T },
        requestContext: { authorizer: { lambda: { role: "RENDERER" } }, http: { sourceIp: "127.0.0.1" } },
        body: JSON.stringify({ email: EMAIL, ...body }),
    } as any;
}
const postLead = async (body: Record<string, unknown>) =>
    (await (createLead as any)(leadEvent(body), {} as any, () => {})) as { statusCode: number; body: string };

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    ddbSend.mockReset();
    signUrl.mockClear();
    productPages = [];
    stalePages = null;
    productQueryFails = false;
    mockDb();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("G1 — POST /leads never signs a link for a product's file", () => {
    it("L1: no resourceId → 201, lead stored, no link, no product read", async () => {
        const res = await postLead({});
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).downloadUrl).toBeUndefined();
        expect(leadPuts()).toHaveLength(1);
        expect(productQueries()).toHaveLength(0);
        expect(signUrl).not.toHaveBeenCalled();
    });

    it("L1: a resourceId that is not a string is no resource id", async () => {
        const res = await postLead({ resourceId: { $ne: "" } });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).downloadUrl).toBeUndefined();
        expect(commands().filter((c) => c instanceof GetCommand && (c.input.Key as any).SK.startsWith("RESOURCE#"))).toHaveLength(0);
    });

    it("L2: resource referenced by no product → 201 with the link (as before)", async () => {
        productPages = [[{ id: "p1", resourceId: "r-paid", status: "active" }]];
        const res = await postLead({ resourceId: "r-free" });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).downloadUrl).toBe("fake-signed-link");
        expect(signUrl).toHaveBeenCalledTimes(1);
        expect((signUrl.mock.calls[0] as any[])[1].input).toEqual({ Bucket: "test-private-bucket", Key: "t1/r-free-guide.pdf" });
        expect(warn).not.toHaveBeenCalled();
    });

    for (const status of ["active", "draft", "archived"]) {
        it(`L3: resource referenced by a ${status} product → 201, no link, one warning without the email`, async () => {
            productPages = [[{ id: "p9", resourceId: "r-paid", status }]];
            const res = await postLead({ resourceId: "r-paid" });
            expect(res.statusCode).toBe(201);
            expect(JSON.parse(res.body)).toEqual({ message: "Subscribed" });
            expect(leadPuts()).toHaveLength(1);
            expect(signUrl).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledTimes(1);
            const line = String(warn.mock.calls[0][0]);
            expect(line).toContain(`tenant=${T}`);
            expect(line).toContain("resource=r-paid");
            expect(line).not.toContain(EMAIL);
            expect(warn.mock.calls[0]).toHaveLength(1);
        });
    }

    it("L3: the lookup has no status condition, only the resource id (any status counts)", async () => {
        productPages = [[{ id: "p9", resourceId: "r-paid", status: "draft" }]];
        await postLead({ resourceId: "r-paid" });
        const [q] = productQueries();
        expect(q.input.FilterExpression).toBe("resourceId = :resourceId");
        expect(q.input.ExpressionAttributeValues).toEqual({ ":pk": "TENANT#t1", ":sk": "PRODUCT#", ":resourceId": "r-paid" });
    });

    it("L3: a referencing product on a later page is found (all pages are read)", async () => {
        productPages = [
            [{ id: "p1", status: "active" }, { id: "p2", resourceId: "r-free", status: "active" }],
            [{ id: "p3", status: "active" }],
            [{ id: "p4", resourceId: "r-paid", status: "archived" }],
        ];
        const res = await postLead({ resourceId: "r-paid" });
        expect(JSON.parse(res.body).downloadUrl).toBeUndefined();
        expect(productQueries()).toHaveLength(3);
        expect(signUrl).not.toHaveBeenCalled();
    });

    it("L3: a product reference committed just before the lead is seen (consistent read on every page)", async () => {
        // The product's resourceId was saved a moment ago: the consistent view has it (on page 2), the eventually
        // consistent view does not yet. An eventually consistent lookup would return [] and sign the file.
        productPages = [[{ id: "p1", status: "active" }], [{ id: "p2", resourceId: "r-paid", status: "draft" }]];
        stalePages = [[{ id: "p1", status: "active" }], [{ id: "p2", status: "draft" }]];
        const res = await postLead({ resourceId: "r-paid" });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).downloadUrl).toBeUndefined();
        expect(signUrl).not.toHaveBeenCalled();
        const queries = productQueries();
        expect(queries).toHaveLength(2);
        expect(queries[1].input.ExclusiveStartKey).toBeDefined();
        for (const q of queries) expect(q.input.ConsistentRead).toBe(true);
    });

    it("L4: unknown resource id → 201, no link, no product read", async () => {
        const res = await postLead({ resourceId: "r-missing" });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).downloadUrl).toBeUndefined();
        expect(productQueries()).toHaveLength(0);
        expect(signUrl).not.toHaveBeenCalled();
    });

    it("L4: another tenant's resource → 201, no link (the read is keyed by the caller's tenant)", async () => {
        const res = await postLead({ resourceId: "r-other" });
        expect(res.statusCode).toBe(201);
        expect(JSON.parse(res.body).downloadUrl).toBeUndefined();
        expect(signUrl).not.toHaveBeenCalled();
    });

    it("L5: the product lookup throws → 500, lead stored, no link (fail closed)", async () => {
        productQueryFails = true;
        const res = await postLead({ resourceId: "r-free" });
        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res.body)).toEqual({ error: "Internal error" });
        expect(res.body).not.toContain("fake-signed-link");
        expect(leadPuts()).toHaveLength(1);
        expect(signUrl).not.toHaveBeenCalled();
    });
});

describe("productIdsReferencingResource — the shared lookup", () => {
    it("returns the ids of every match across pages, in read order", async () => {
        productPages = [[{ id: "a", resourceId: "r" }], [{ id: "b" }], [{ id: "c", resourceId: "r" }]];
        expect(await productIdsReferencingResource(T, "r")).toEqual(["a", "c"]);
    });

    it("second caller: the download route reads it too (non-admin, linked product, no purchase → 403 purchase)", async () => {
        productPages = [[{ id: "p1" }], [{ id: "p2", resourceId: "r-paid" }]];
        const event = {
            headers: { "x-tenant-id": T },
            pathParameters: { id: "r-paid" },
            requestContext: { authorizer: { lambda: { role: "CUSTOMER", email: EMAIL } } },
        } as any;
        const res = (await (downloadHandler as any)(event, {} as any, () => {})) as { statusCode: number; body: string };
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body)).toEqual({ error: "Purchase required to download this resource" });
        expect(productQueries()).toHaveLength(2);
        expect(signUrl).not.toHaveBeenCalled();
    });
});

describe("G2 — GET /public/products/{slug} never answers resourceId", () => {
    it("a stored product WITH resourceId → the answer has none; the other stored fields are unchanged", async () => {
        const stored = {
            PK: "TENANT#t1", SK: "PRODUCT#p9", TenantSlug: "t1#course", Type: "Product", id: "p9", tenantId: T,
            status: "active", slug: "course", title: "Course", price: "49", productType: "digital",
            paymentLinkId: "pri_1", resourceId: "r-paid",
        };
        ddbSend.mockImplementation(async () => ({ Items: [structuredClone(stored)] }));
        const res = (await (productPublicGet as any)(
            { headers: { "x-tenant-id": T }, pathParameters: { slug: "course" } }, {} as any, () => {},
        )) as { statusCode: number; body: string };
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect("resourceId" in body).toBe(false);
        expect(res.body).not.toContain("r-paid");
        const { resourceId: _r, ...rest } = stored;
        expect(body).toEqual(rest);
    });
});
