/**
 * CMRC-1B, CMRC-1L (docs/slices/cmrc-1b.md, docs/slices/cmrc-1l.md; docs/slices/cmrc-1.md § 5.4, § 5.6, § 5.7; PD-002;
 * PROTOTYPE) — the customer reads of the public site, OVER HTTP: the renderer asks the backend; it does not read a
 * customer's or an order's item from DynamoDB.
 *
 * Before CMRC-1B / CMRC-1L three functions with these names read DynamoDB (`lib/dynamo-customer-reads.ts`, deleted by
 * CMRC-1L). The names are kept because the contract is the same — the same arguments, the same result rule — and
 * only the transport changed. Why the transport changed: Track B moves these items to a table the renderer's role
 * cannot read (docs/VISION.md, guarantee 2); after that move a direct read would find nothing.
 *
 * WHO CALLS, AND WITH WHAT. `tenantId` is always the id of the tenant record found for the request's host, never a
 * value the browser sent. The email differs:
 *  - `getCustomerOrders`, `getCustomerProfile` — `app/api/account/orders/route.ts` and `app/api/profile/route.ts`
 *    (GET), each AFTER it validated the NextAuth session; `email` is the session's email (PD-002, session variant).
 *  - `getOrderForCustomer` — `components/SitePage.tsx`, for the order confirmation and tracking pages; `orderId` and
 *    `email` are the values of the PAGE ADDRESS (a guest has no session). An EXCEPTION to PD-002, not conformance
 *    (docs/platform-decisions.md, PD-002 amendment of 2026-11-28: an operator ruling, not yet confirmed by the human).
 *
 * Each function makes ONE `callBackend` call (`lib/api-client.ts`): POST with a JSON body. Result:
 *   the route's answer → the value;
 *   anything else → `CustomerApiError`. "Nothing found" is NOT an error: it is the 200 answers `{ orders: [] }` and
 *   `{ profile: null }`, and the order lookup's own 404 `{ code: "notFound" }`. So a failed dependency can never look
 *   like a customer without orders, without a profile, or like an order that does not exist.
 * The two account routes catch every error of their read and answer 500 with a fixed text. `SitePage` catches
 * nothing: a failed order read fails the render (docs/caching-architecture.md § "Failed reads throw").
 *
 * Abstraction line: this module — users: the two account routes and `SitePage`; axis: the transport of the customer
 * reads, changed by the ratified Track B (DynamoDB before, the backend now); rejected: a `callBackend` call inside each
 * caller — fewer lines, but the rule "what counts as an answer" would be written in each caller, and the callers' own
 * lines (session, tenant, page state) would not stay untouched.
 */
import type { CustomerProfileView, OrderHistoryEntry, OrderView } from "@amodx/shared";
import { callBackend } from "@/lib/api-client";

const ORDER_HISTORY = "/customer/order-history";
const PROFILE_READ = "/customer/profile-read";
const ORDER_LOOKUP = "/customer/order-lookup";

/**
 * A customer read did not get the route's answer. `status`: the backend's HTTP status when it is not 200;
 * `"unreachable"` when no call could be made or it failed (`callBackend` returned `null`); `"malformedAnswer"` for a
 * 200 whose body is not the route's answer. Carries the route, never the email.
 */
export class CustomerApiError extends Error {
    constructor(readonly route: string, readonly status: number | "unreachable" | "malformedAnswer") {
        super(`customer-api ${route}: ${status}`);
        this.name = "CustomerApiError";
    }
}

/** The body of `answer` when it is a JSON object; `undefined` when it is not JSON or not an object. */
async function jsonObjectOf(answer: globalThis.Response): Promise<Record<string, unknown> | undefined> {
    let body: unknown;
    try {
        body = await answer.json();
    } catch {
        return undefined;
    }
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
}

/** One POST `{ email }` to `route`; the JSON object of a 200 answer, or a `CustomerApiError`. */
async function readForCustomer(route: string, tenantId: string, email: string): Promise<Record<string, unknown>> {
    const answer = await callBackend(route, tenantId, { email });
    if (answer === null) throw new CustomerApiError(route, "unreachable");
    if (answer.status !== 200) throw new CustomerApiError(route, answer.status);
    const body = await jsonObjectOf(answer);
    if (body === undefined) throw new CustomerApiError(route, "malformedAnswer");
    return body;
}

/** The customer's orders, newest first (the backend sorts); `[]` when there is none. */
export async function getCustomerOrders(tenantId: string, email: string): Promise<OrderHistoryEntry[]> {
    const { orders } = await readForCustomer(ORDER_HISTORY, tenantId, email);
    if (!Array.isArray(orders)) throw new CustomerApiError(ORDER_HISTORY, "malformedAnswer");
    return orders as OrderHistoryEntry[];
}

/** The customer's stored profile attributes; `null` when no record is stored. */
export async function getCustomerProfile(tenantId: string, email: string): Promise<CustomerProfileView | null> {
    const { profile } = await readForCustomer(PROFILE_READ, tenantId, email);
    if (profile === null) return null;
    if (typeof profile !== "object" || Array.isArray(profile)) throw new CustomerApiError(PROFILE_READ, "malformedAnswer");
    return profile as CustomerProfileView;
}

/**
 * The order that the confirmation page or the tracking page shows: the stored order reduced to the 17 fields the two
 * pages read (`OrderView`), or `null` when the backend finds no order for this id and email. `null` stands for "no
 * such order", "an order of another tenant" and "the email is not the stored one" alike — the page cannot tell them
 * apart, as before CMRC-1L. `orderId` and `email` are sent as given: the backend holds the one `normalizeEmail` rule.
 *
 * "Not found" is ONLY the route's own answer, 404 with `code: "notFound"`. A 404 without that code comes from the API
 * gateway (the route does not exist: a deploy in progress, a wrong `API_URL`): that is a failed dependency and throws,
 * so a buyer never reads "Order Not Found" because of it.
 */
export async function getOrderForCustomer(tenantId: string, orderId: string, email: string): Promise<OrderView | null> {
    const answer = await callBackend(ORDER_LOOKUP, tenantId, { orderId, email });
    if (answer === null) throw new CustomerApiError(ORDER_LOOKUP, "unreachable");
    if (answer.status !== 200 && answer.status !== 404) throw new CustomerApiError(ORDER_LOOKUP, answer.status);
    const body = await jsonObjectOf(answer);
    if (answer.status === 404) {
        if (body?.code === "notFound") return null;
        throw new CustomerApiError(ORDER_LOOKUP, 404);
    }
    const order = body?.order;
    if (order === null || typeof order !== "object" || Array.isArray(order)) throw new CustomerApiError(ORDER_LOOKUP, "malformedAnswer");
    return order as OrderView;
}
