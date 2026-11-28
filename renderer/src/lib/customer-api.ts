/**
 * CMRC-1B (docs/slices/cmrc-1b.md; docs/slices/cmrc-1.md § 5.4, § 5.6, § 5.7; PD-002; PROTOTYPE) — the customer reads
 * of the account pages, OVER HTTP: the renderer asks the backend; it does not read the customer's items from DynamoDB.
 *
 * Before CMRC-1B two functions with these names read DynamoDB (`lib/dynamo-customer-reads.ts`). The names are kept
 * because the contract is the same — the same arguments, the same result — and only the transport changed. Why the
 * transport changed: Track B moves these items to a table the renderer's role cannot read (docs/VISION.md, guarantee
 * 2); after that move a direct read would find nothing.
 *
 * WHO CALLS, AND WITH WHAT (PD-002). `app/api/account/orders/route.ts` and `app/api/profile/route.ts` (GET), each
 * AFTER it validated the NextAuth session. `tenantId` is the id of the tenant record found for the request's host;
 * `email` is the session's email. Neither may be a value the browser sent: the backend trusts both because the call
 * carries the renderer key.
 *
 * Each function makes ONE `callBackend` call (`lib/api-client.ts`): POST, the body `{ email }`. Result:
 *   200 with the route's answer → the value;
 *   anything else → `CustomerApiError`. "Nothing found" is NOT an error: it is the 200 answers `{ orders: [] }` and
 *   `{ profile: null }`. So a failed dependency can never look like a customer without orders or without a profile.
 * The two routes already catch every error of their read and answer 500 with a fixed text.
 *
 * Abstraction line: this module — users: the two account routes; axis: the transport of the customer reads, changed by
 * the ratified Track B (DynamoDB before, the backend now; part L of `cmrc-1` adds the order-page read here); rejected:
 * a `callBackend` call inside each route — about 25 lines less, but the rule "what counts as an answer" would be
 * written in each route, and the routes' own lines (session, tenant, answer) would not stay untouched.
 */
import type { CustomerProfileView, OrderHistoryEntry } from "@amodx/shared";
import { callBackend } from "@/lib/api-client";

const ORDER_HISTORY = "/customer/order-history";
const PROFILE_READ = "/customer/profile-read";

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

/** One POST `{ email }` to `route`; the JSON object of a 200 answer, or a `CustomerApiError`. */
async function readForCustomer(route: string, tenantId: string, email: string): Promise<Record<string, unknown>> {
    const answer = await callBackend(route, tenantId, { email });
    if (answer === null) throw new CustomerApiError(route, "unreachable");
    if (answer.status !== 200) throw new CustomerApiError(route, answer.status);
    let body: unknown;
    try {
        body = await answer.json();
    } catch {
        throw new CustomerApiError(route, "malformedAnswer");
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new CustomerApiError(route, "malformedAnswer");
    return body as Record<string, unknown>;
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
