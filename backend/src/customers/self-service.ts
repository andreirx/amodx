import type { APIGatewayProxyEventV2WithLambdaAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { ZodType } from "zod";
import {
    CustomerSelfRequestSchema, ORDER_VIEW_FIELDS, OrderLookupRequestSchema, normalizeEmail,
    type CustomerProfileView, type OrderHistoryEntry, type OrderView, type StoredValue,
} from "@amodx/shared";
import { db } from "../lib/db.js";
import { customerOrdersQuery, customerRef, orderIdOfCustomerOrder, orderRef } from "../lib/commerce-db.js";
import type { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { errorName } from "../lib/value-free.js";

/**
 * CMRC-1B, CMRC-1L (docs/slices/cmrc-1b.md, docs/slices/cmrc-1l.md; docs/slices/cmrc-1.md § 5.6, § 5.7; PROTOTYPE) —
 * the customer reads of the public site, for the RENDERER. Two for a signed-in customer's account page, one for the
 * order confirmation and tracking pages:
 *
 *   POST /customer/order-history   { email }           →  200 { orders: OrderHistoryEntry[] }        (`orderHistoryHandler`)
 *   POST /customer/profile-read    { email }           →  200 { profile: CustomerProfileView | null } (`profileReadHandler`)
 *   POST /customer/order-lookup    { orderId, email }  →  200 { order: OrderView } | 404 notFound     (`orderLookupHandler`)
 *
 * Why they exist: before CMRC-1B / CMRC-1L the public renderer read these items from DynamoDB itself. Track B moves
 * them to a table the renderer cannot read (docs/VISION.md, guarantee 2), so the renderer must ask the backend
 * instead. The reads go through `lib/commerce-db.ts`; this file writes no key and names no table.
 *
 * WHO MAY CALL (PD-002, renderer-proxy model). The API gateway's authorizer admits any valid credential and passes its
 * role; THIS file refuses every role but the renderer's. `requireRole(auth, ["RENDERER"])` admits the renderer key
 * and — whatever the list says — `GLOBAL_ADMIN` (the master key; `auth/policy.ts`). Every other role (TENANT_ADMIN,
 * EDITOR, SERVICE, CUSTOMER, none) → 403, and nothing is read. No target tenant is given to `requireRole`: the
 * renderer key's tenant is "ALL", as on the scheduling visitor routes (`scheduling/visitor/common.ts`).
 *
 * WHOSE DATA. A route trusts the body and the `x-tenant-id` header BECAUSE the caller is the renderer; a browser
 * cannot reach these routes: it has no renderer key. The renderer takes the tenant from the record of the request's
 * host, never from the browser. The email differs per route:
 *  - order-history, profile-read: the email of the validated SESSION (`renderer/src/app/api/account/orders/route.ts`,
 *    `api/profile/route.ts`). PD-002, session variant.
 *  - order-lookup: the order id and the email of the PAGE ADDRESS — a guest has no session. The authority is
 *    possession of the order id and an email equal to the stored one. This is an EXCEPTION to PD-002, not
 *    conformance (docs/platform-decisions.md, PD-002 amendment of 2026-11-28: an operator ruling, not yet confirmed
 *    by the human). The exception covers this read and its 17 answered fields only.
 *
 * INPUT RULE. The body is checked for STRUCTURE only (exactly the route's fields, each a non-empty string). There is
 * no format rule and no length bound: `normalizeEmail()` is applied to the email and the read runs; a value that
 * matches no stored record answers `{ orders: [] }` / `{ profile: null }` / 404 `notFound`, never an error.
 *
 * VALUE RULE. Every field of an answer is the stored attribute, passed through: no parse against a schema, no
 * default, no `null` removed. A field is absent exactly when the stored item lacks the attribute.
 *
 * Order of checks: role → `x-tenant-id` → body structure → `normalizeEmail` → the read. A DynamoDB failure (or any
 * other unexpected error) is not a refusal: 500 `{ code: "internal" }`, logged with the route and the error's NAME
 * only — never its message, the email, the order id or the body.
 *
 * Abstraction lines:
 * - `SelfServiceRefusal` (a closed sum, exhaustive `switch`, no `default` arm) — users: the three handlers; axis:
 *   fixed variants, so a new refusal breaks the compile at `refusalAnswer` (CMRC-1L added `notFound`: that was the
 *   one site the compiler named); rejected: a status code written at each `return`.
 * - `selfServiceRoute` — users: the three handlers; axis: the request schema and the read (given by each handler);
 *   the access and input rule is one for all; rejected: the block written three times.
 * - `ReadResult` — users: the three reads; axis: fixed (an answer, or a refusal the read itself decides — today only
 *   `notFound` of order-lookup); rejected: a thrown "not found" (an expected outcome hidden from the signature).
 */

type SelfServiceEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>;
type Answer = APIGatewayProxyStructuredResultV2;

/** The renderer key; `requireRole` admits GLOBAL_ADMIN before it reads this list. */
const SELF_SERVICE_CALLERS = ["RENDERER"];

type Issue = { path: string; message: string };

type SelfServiceRefusal =
    | { kind: "forbidden" }                                // `requireRole` refused the caller
    | { kind: "missingTenant" }                            // no `x-tenant-id` header
    | { kind: "malformedRequest"; issues: Issue[] }        // the body is not exactly the route's non-empty string fields
    | { kind: "notFound" };                                // D3 only: no such order, or the email is not the stored one

const json = (statusCode: number, body: unknown): Answer => ({
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
});

function refusalAnswer(refusal: SelfServiceRefusal): Answer {
    switch (refusal.kind) {
        case "forbidden": return json(403, { code: "forbidden" });
        case "missingTenant": return json(400, { code: "missingTenant" });
        case "malformedRequest": return json(400, { code: "malformedRequest", issues: refusal.issues });
        case "notFound": return json(404, { code: "notFound" });
    }
}

/** A request body of these routes: the route's own fields, of which `email` is one. */
type WithEmail = { email: string };

type Admitted<R extends WithEmail> =
    | { ok: true; tenantId: string; normalizedEmail: string; request: R }
    | { ok: false; refusal: SelfServiceRefusal };

/** What a read gives the frame: the 200 body, or a refusal that only the stored data can decide. */
type ReadResult = { ok: true; body: unknown } | { ok: false; refusal: SelfServiceRefusal };

/** Role, tenant header and body structure (against the route's `schema`), in that order. Reads nothing. */
function admit<R extends WithEmail>(event: SelfServiceEvent, schema: ZodType<R>): Admitted<R> {
    try {
        requireRole(event.requestContext.authorizer.lambda, SELF_SERVICE_CALLERS);
    } catch {
        return { ok: false, refusal: { kind: "forbidden" } };   // also: no authorizer context at all
    }

    const tenantId = event.headers["x-tenant-id"];
    if (!tenantId) return { ok: false, refusal: { kind: "missingTenant" } };

    let raw: unknown;
    try {
        raw = JSON.parse(event.body ?? "");
    } catch {
        return { ok: false, refusal: { kind: "malformedRequest", issues: [{ path: "", message: "The body is not JSON." }] } };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        // Path and message of each issue. The one zod message that quotes request text — the NAME of an unknown
        // field — is replaced, so no part of the request is in the answer.
        const issues = parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.code === "unrecognized_keys" ? "Unrecognized field." : issue.message,
        }));
        return { ok: false, refusal: { kind: "malformedRequest", issues } };
    }
    return { ok: true, tenantId, normalizedEmail: normalizeEmail(parsed.data.email), request: parsed.data };
}

/** The frame of every route: the checks of `admit`, then `read`; its result is the 200 body or a refusal. */
async function selfServiceRoute<R extends WithEmail>(route: string, event: SelfServiceEvent, schema: ZodType<R>,
    read: (tenantId: string, normalizedEmail: string, request: R) => Promise<ReadResult>): Promise<Answer> {
    try {
        const admitted = admit(event, schema);
        if (!admitted.ok) return refusalAnswer(admitted.refusal);
        const result = await read(admitted.tenantId, admitted.normalizedEmail, admitted.request);
        return result.ok ? json(200, result.body) : refusalAnswer(result.refusal);
    } catch (e) {
        console.error(`[customer-self-service] ${route} failed`, errorName(e));
        return json(500, { code: "internal" });
    }
}

/** The sort value of a stored `createdAt`, whatever its stored type (text that is not a date → NaN, as before). */
const timeOf = (createdAt: StoredValue | undefined): number => new Date(createdAt as string | number).getTime();

/**
 * D1 — the customer's order list from the email → order index. All pages are read. Each row keeps the stored
 * `orderNumber`, `total`, `status`, `createdAt` (in this key order: the account route's JSON text depends on it).
 * Newest `createdAt` first; rows that compare equal keep the order of the Query (the sort-key order).
 * `total` and `status` are DynamoDB reserved words: each needs an alias (PROJECTION-RESERVED-1).
 */
export const orderHistoryHandler = (event: SelfServiceEvent): Promise<Answer> =>
    selfServiceRoute("POST /customer/order-history", event, CustomerSelfRequestSchema, async (tenantId, normalizedEmail) => {
        const rows: Record<string, StoredValue>[] = [];
        let lastKey: Record<string, unknown> | undefined;
        do {
            const page = await db.send(new QueryCommand({
                ...customerOrdersQuery(tenantId, normalizedEmail),
                ProjectionExpression: "orderNumber, #total, #s, createdAt, SK",
                ExpressionAttributeNames: { "#s": "status", "#total": "total" },
                ExclusiveStartKey: lastKey,
            }));
            rows.push(...((page.Items ?? []) as Record<string, StoredValue>[]));
            lastKey = page.LastEvaluatedKey;
        } while (lastKey);

        const orders: OrderHistoryEntry[] = rows
            .map((row) => ({
                orderNumber: row.orderNumber,
                total: row.total,
                status: row.status,
                createdAt: row.createdAt,
                orderId: orderIdOfCustomerOrder(String(row.SK)),
            }))
            .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
        return { ok: true, body: { orders } };
    });

/**
 * D2 — the customer's profile: the stored item reduced to five attributes, or `null` when there is no item. An item
 * with none of the five is `{}`. `name` is a DynamoDB reserved word: it needs an alias.
 */
export const profileReadHandler = (event: SelfServiceEvent): Promise<Answer> =>
    selfServiceRoute("POST /customer/profile-read", event, CustomerSelfRequestSchema, async (tenantId, normalizedEmail) => {
        const result = await db.send(new GetCommand({
            ...customerRef(tenantId, normalizedEmail),
            ProjectionExpression: "email, #n, phone, birthday, defaultAddress",
            ExpressionAttributeNames: { "#n": "name" },
        }));
        const profile: CustomerProfileView | null = (result.Item as CustomerProfileView | undefined) ?? null;
        return { ok: true, body: { profile } };
    });

/**
 * The projection of D3: the 17 `ORDER_VIEW_FIELDS` and `customerEmail` (compared, never answered). EVERY name gets an
 * alias (`#total` → `total`), so no name of the list can meet a DynamoDB reserved word (`items`, `status` and `total`
 * are reserved; PROJECTION-RESERVED-1) — also not a name added to the list later.
 */
const ORDER_LOOKUP_ATTRIBUTES = [...ORDER_VIEW_FIELDS, "customerEmail"] as const;
const ORDER_LOOKUP_PROJECTION = ORDER_LOOKUP_ATTRIBUTES.map((name) => `#${name}`).join(", ");
const ORDER_LOOKUP_NAMES = Object.fromEntries(ORDER_LOOKUP_ATTRIBUTES.map((name) => [`#${name}`, name]));

/**
 * D3 (CMRC-1L) — one order for the order confirmation page and the order tracking page: the stored item reduced to the
 * 17 `ORDER_VIEW_FIELDS`, when the stored `customerEmail` is strictly equal to `normalizeEmail(email)` of the request.
 *
 * ONE 404 answer for "no such order", "an order of another tenant" (the key holds the tenant) and "the email is not
 * the stored one": the caller cannot tell them apart, as the page could not before CMRC-1L. Only the REQUEST side is
 * normalized — exactly the rule of the renderer read this replaces (ORDER-EMAIL-1): a stored email that is not in
 * normalized form is reached by no request. This is NOT the looser rule of `orders/public-get.ts`.
 *
 * The answer is built by PICKING the listed fields, so "the 17 fields and no other" does not depend on the projection
 * being honoured. A field is absent exactly when the stored item lacks it; `null` stays `null`.
 */
export const orderLookupHandler = (event: SelfServiceEvent): Promise<Answer> =>
    selfServiceRoute("POST /customer/order-lookup", event, OrderLookupRequestSchema, async (tenantId, normalizedEmail, request) => {
        const result = await db.send(new GetCommand({
            ...orderRef(tenantId, request.orderId),
            ProjectionExpression: ORDER_LOOKUP_PROJECTION,
            ExpressionAttributeNames: ORDER_LOOKUP_NAMES,
        }));
        const item = result.Item as Record<string, StoredValue> | undefined;
        if (!item || item.customerEmail !== normalizedEmail) return { ok: false, refusal: { kind: "notFound" } };

        const order: OrderView = {};
        for (const field of ORDER_VIEW_FIELDS) {
            if (field in item) order[field] = item[field];
        }
        return { ok: true, body: { order } };
    });
