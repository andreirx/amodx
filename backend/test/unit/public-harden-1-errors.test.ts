import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

/**
 * PUBLIC-HARDEN-1 (record docs/slices/public-harden-1.md, item B) — a server failure in a handler of a PUBLIC route
 * answers 500 with the fixed text "Internal error"; the failure goes to the log only, with the handler's name.
 *
 * Public routes: the three the authorizer lets through without a token (auth/authorizer.ts: POST /leads, /contact,
 * /consent) and the `noAuth: true` routes of infra/lib/api-commerce.ts and api-engagement.ts. One row per route whose
 * handler this slice changes (forms/public-submit.ts was fixed in form-submit-2 and has its own row there).
 *
 * The REAL handlers over a mocked DynamoDB document client: the origin check's `GSI_Domain` query answers
 * `site.test` → t1 (verifyTenantFromOrigin catches a failure there and answers 403, which is not the case under test);
 * every other DynamoDB call fails with an access-denied text that carries an ARN and the table name. No reCAPTCHA keys.
 * Credential-free.
 */

process.env.TABLE_NAME = "amodx-table";
process.env.SES_FROM_EMAIL = "noreply@platform.test";
delete process.env.RECAPTCHA_SECRET_KEY;
delete process.env.TENANT_VERIFY_PERMISSIVE;

const ddb = mockClient(DynamoDBDocumentClient);

const FAILURE_TEXT = "User: arn:aws:sts::123456789012:assumed-role/x is not authorized to perform: dynamodb:Query on resource: arn:aws:dynamodb:eu-central-1:123456789012:table/amodx-table";

type Row = {
    route: string;
    /** The handler's name as the log line carries it. */
    name: string;
    /** NEWSLETTER-1 (finding NL1-R1, backend/src/lib/value-free.ts): the handler logs ONE line — its name and the error's
     *  NAME, never the error object or message (a message can quote the request: the visitor's address). */
    nameOnlyLog?: true;
    load: () => Promise<{ handler: unknown }>;
    event: Record<string, unknown>;
};

const headers = { "x-tenant-id": "t1", origin: "https://site.test" };
const json = (body: unknown) => JSON.stringify(body);

const ROWS: Row[] = [
    { route: "POST /leads", name: "leads/create", load: () => import("../../src/leads/create.js"), nameOnlyLog: true,
      event: { headers, body: json({ email: "a@b.co" }) } },
    { route: "POST /contact", name: "contact/send", load: () => import("../../src/contact/send.js"),
      event: { headers, body: json({ name: "A", email: "a@b.co", message: "Hi" }) } },
    { route: "POST /consent", name: "consent/create", load: () => import("../../src/consent/create.js"),
      event: { headers, body: json({ visitorId: "v1", choice: "all", timestamp: 1 }) } },
    { route: "GET /public/products", name: "products/public-list", load: () => import("../../src/products/public-list.js"),
      event: { headers } },
    { route: "GET /public/products/{slug}", name: "products/public-get", load: () => import("../../src/products/public-get.js"),
      event: { headers, pathParameters: { slug: "p" } } },
    { route: "GET /public/categories", name: "categories/public-list", load: () => import("../../src/categories/public-list.js"),
      event: { headers } },
    { route: "GET /public/categories/{slug}", name: "categories/public-get", load: () => import("../../src/categories/public-get.js"),
      event: { headers, pathParameters: { slug: "c" } } },
    { route: "POST /public/orders", name: "orders/create", load: () => import("../../src/orders/create.js"),
      event: { headers, body: json({ items: [{ productId: "c0000000-0000-4000-8000-000000000001", quantity: 1 }], customerEmail: "buyer@example.com", customerName: "Buyer", paymentMethod: "cash_on_delivery" }) } },
    { route: "GET /public/orders/{id}", name: "orders/public-get", load: () => import("../../src/orders/public-get.js"),
      event: { headers, pathParameters: { id: "o1" }, queryStringParameters: { email: "a@b.co" } } },
    { route: "GET /public/delivery/dates", name: "delivery/available-dates", load: () => import("../../src/delivery/available-dates.js"),
      event: { headers } },
    { route: "POST /public/coupons/validate", name: "coupons/public-validate", load: () => import("../../src/coupons/public-validate.js"),
      event: { headers, body: json({ code: "X", subtotal: 10 }) } },
    { route: "GET /public/reviews/{productId}", name: "reviews/public-list", load: () => import("../../src/reviews/public-list.js"),
      event: { headers, pathParameters: { productId: "p1" } } },
    { route: "GET /public/popups", name: "popups/public-list", load: () => import("../../src/popups/public-list.js"),
      event: { headers } },
    { route: "POST /public/interest", name: "interest/public", load: () => import("../../src/interest/public.js"),
      event: { headers, routeKey: "POST /public/interest", body: json({ name: "A", email: "a@b.co", items: [{ productId: "p1" }], submissionToken: "t".repeat(32), recaptchaToken: null }) } },
    { route: "POST /public/interest/resolve", name: "interest/public", load: () => import("../../src/interest/public.js"),
      event: { headers, routeKey: "POST /public/interest/resolve", body: json({ productIds: ["p1"] }) } },
];

beforeEach(() => {
    ddb.reset();
    ddb.rejects(new Error(FAILURE_TEXT));
    ddb.on(QueryCommand, { IndexName: "GSI_Domain" }).resolves({ Items: [{ id: "t1" }] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("PUBLIC-HARDEN-1 B — DynamoDB fails in a public handler → 500 \"Internal error\"; the failure is logged, not answered", () => {
    for (const row of ROWS) {
        it(`${row.route} (${row.name})`, async () => {
            const logged = vi.spyOn(console, "error").mockImplementation(() => {});
            const { handler } = await row.load();
            const res = (await (handler as any)({ requestContext: { http: { sourceIp: "127.0.0.1" } }, ...row.event }, {} as any, () => {})) as any;
            expect({ status: res.statusCode, body: JSON.parse(res.body) }).toEqual({ status: 500, body: { error: "Internal error" } });
            expect(res.body).not.toContain("arn:");
            expect(res.body).not.toContain("amodx-table");
            if (row.nameOnlyLog) {
                expect(logged).toHaveBeenCalledWith(`[${row.name}] error=Error`);
                for (const args of logged.mock.calls) expect(JSON.stringify(args)).not.toContain("a@b.co");
            } else {
                expect(logged).toHaveBeenCalledWith(expect.stringContaining(`[${row.name}]`), expect.objectContaining({ message: FAILURE_TEXT }));
            }
        });
    }
});
