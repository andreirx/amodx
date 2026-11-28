// Local stand-in for the BACKEND API, for ONE route (slice cmrc-1l, test T9 of docs/slices/cmrc-1.md § 5.9).
//
// WHY IT EXISTS. Since cmrc-1l the order confirmation page and the order tracking page do not read the order from
// DynamoDB: the renderer calls `POST /customer/order-lookup` on the backend (`renderer/src/lib/customer-api.ts`). The
// rows that request those pages WITH an order (`loc1-*`, `cm1-*`, `cdl2-*`) therefore need a backend that answers
// that route from the same fixture items the DynamoDB stub serves. Without it those pages would fail (HTTP 500), as
// they must when the backend cannot be reached.
//
// WHAT IT ANSWERS. Exactly one route:
//
//   POST /customer/order-lookup   x-api-key = the harness's constructed renderer key, x-tenant-id, body { orderId, email }
//     → 200 { order }            the fixture item `TENANT#<x-tenant-id>` / `ORDER#<orderId>` reduced to
//                                `ORDER_VIEW_FIELDS`, when its `customerEmail` === normalizeEmail(email)
//     → 404 { code: "notFound" } no such item, an item of another tenant, or another email
//     → 403 { message: "Forbidden" }  another key (what the API gateway's authorizer answers)
//
// EVERY OTHER REQUEST — any other path or method — gets NO answer: the socket is destroyed. For the renderer that is
// the same as the unreachable address it had before this stub existed (`fetch` fails), so the rows that depend on
// "there is no backend" keep their meaning: a booking-proxy request that passes every renderer check still ends at the
// forward step with 503 `unavailable` (rows `sched1g-*`).
//
// WHAT IT PROVES AND WHAT IT DOES NOT. It is a second, hand-written statement of the backend's rule, so it proves the
// RENDERER side only: that the pages render from the route's answer, and that the 17-field answer is enough for them
// (rows compare these pages with captures taken when the renderer read the whole item). The backend's rule itself is
// `backend/test/unit/cmrc-1-order-lookup.test.ts`; both rules meeting on the same stored items is
// `renderer/test/unit/cmrc-1-order-pages.test.ts` (the real handler). The field list and `normalizeEmail` are imported
// from `@amodx/shared`, so the stub cannot drift from the list the real handler uses.
//
// It holds no request text in its journal: route and outcome only.
import { createServer } from "node:http";
import { ORDER_VIEW_FIELDS, normalizeEmail } from "@amodx/shared";
import { ITEMS } from "./fixtures.mjs";

/** The constructed renderer key of the serving suites: a test value, never the operator's (harness.mjs `rendererEnv`). */
export const RENDERER_TEST_KEY = "serving-contract-renderer-key";

const ORDER_LOOKUP = "POST /customer/order-lookup";

function orderLookup(headers, body) {
    if (headers["x-api-key"] !== RENDERER_TEST_KEY) return { status: 403, body: { message: "Forbidden" } };
    let request;
    try {
        request = JSON.parse(body);
    } catch {
        return { status: 400, body: { code: "malformedRequest" } };
    }
    const tenantId = headers["x-tenant-id"];
    if (!tenantId || typeof request?.orderId !== "string" || typeof request?.email !== "string") return { status: 400, body: { code: "malformedRequest" } };
    const item = ITEMS.find((i) => i.PK === `TENANT#${tenantId}` && i.SK === `ORDER#${request.orderId}`);
    if (!item || item.customerEmail !== normalizeEmail(request.email)) return { status: 404, body: { code: "notFound" } };
    return { status: 200, body: { order: Object.fromEntries(ORDER_VIEW_FIELDS.filter((f) => f in item).map((f) => [f, item[f]])) } };
}

/**
 * Starts the stub on an ephemeral loopback port → `{ url, journal, close }`.
 * `journal()`: one `{ route, outcome }` per request, oldest first — `outcome` is the status answered, or `"dropped"`.
 */
export async function startBackendStub() {
    const journal = [];
    const server = createServer((req, res) => {
        const route = `${req.method} ${new URL(req.url, "http://127.0.0.1").pathname}`;
        if (route !== ORDER_LOOKUP) {
            journal.push({ route, outcome: "dropped" });
            req.socket.destroy();
            return;
        }
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
            const answer = orderLookup(req.headers, body);
            journal.push({ route, outcome: answer.status });
            res.writeHead(answer.status, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify(answer.body));
        });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        journal: () => [...journal],
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    };
}
