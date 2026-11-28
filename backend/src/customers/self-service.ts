import type { APIGatewayProxyEventV2WithLambdaAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
    CustomerSelfRequestSchema, normalizeEmail,
    type CustomerProfileView, type OrderHistoryEntry, type StoredValue,
} from "@amodx/shared";
import { db } from "../lib/db.js";
import { customerOrdersQuery, customerRef, orderIdOfCustomerOrder } from "../lib/commerce-db.js";
import type { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { errorName } from "../lib/value-free.js";

/**
 * CMRC-1B (docs/slices/cmrc-1b.md; docs/slices/cmrc-1.md § 5.6, § 5.7; PROTOTYPE) — the two reads a signed-in customer's
 * account page needs, for the RENDERER:
 *
 *   POST /customer/order-history   { email }  →  200 { orders: OrderHistoryEntry[] }        (`orderHistoryHandler`)
 *   POST /customer/profile-read    { email }  →  200 { profile: CustomerProfileView | null } (`profileReadHandler`)
 *
 * Why they exist: before CMRC-1B the public renderer read these items from DynamoDB itself. Track B moves them to a
 * table the renderer cannot read (docs/VISION.md, guarantee 2), so the renderer must ask the backend instead. The
 * reads go through `lib/commerce-db.ts`; this file writes no key and names no table.
 *
 * WHO MAY CALL (PD-002, renderer-proxy model). The API gateway's authorizer admits any valid credential and passes its
 * role; THIS file refuses every role but the renderer's. `requireRole(auth, ["RENDERER"])` admits the renderer key
 * and — whatever the list says — `GLOBAL_ADMIN` (the master key; `auth/policy.ts`). Every other role (TENANT_ADMIN,
 * EDITOR, SERVICE, CUSTOMER, none) → 403, and nothing is read. No target tenant is given to `requireRole`: the
 * renderer key's tenant is "ALL", as on the scheduling visitor routes (`scheduling/visitor/common.ts`).
 *
 * WHOSE DATA. The route trusts the `email` of the body and the `x-tenant-id` header BECAUSE the caller is the
 * renderer: the renderer takes the email from the validated session and the tenant from the record of the request's
 * host, never from the browser (`renderer/src/app/api/account/orders/route.ts`, `api/profile/route.ts`). A browser
 * cannot reach these routes: it has no renderer key.
 *
 * INPUT RULE. The body is checked for STRUCTURE only (exactly `{ email: non-empty string }`). There is no format rule
 * and no length bound: `normalizeEmail()` is applied and the read runs; an email that matches no stored record
 * answers `{ orders: [] }` / `{ profile: null }`, never an error.
 *
 * VALUE RULE. Every field of an answer is the stored attribute, passed through: no parse against a schema, no
 * default, no `null` removed. A field is absent exactly when the stored item lacks the attribute.
 *
 * Order of checks: role → `x-tenant-id` → body structure → `normalizeEmail` → the read. A DynamoDB failure (or any
 * other unexpected error) is not a refusal: 500 `{ code: "internal" }`, logged with the route and the error's NAME
 * only — never its message, the email or the body.
 *
 * Abstraction lines:
 * - `SelfServiceRefusal` (a closed sum, exhaustive `switch`, no `default` arm) — users: the two handlers; axis: fixed
 *   variants, so a new refusal (part L adds `notFound`) breaks the compile at `refusalAnswer`; rejected: a status
 *   code written at each `return`.
 * - `selfServiceRoute` — users: the two handlers; axis: none (one access and input rule for both); rejected: the
 *   block written twice.
 */

type SelfServiceEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>;
type Answer = APIGatewayProxyStructuredResultV2;

/** The renderer key; `requireRole` admits GLOBAL_ADMIN before it reads this list. */
const SELF_SERVICE_CALLERS = ["RENDERER"];

type Issue = { path: string; message: string };

type SelfServiceRefusal =
    | { kind: "forbidden" }                                // `requireRole` refused the caller
    | { kind: "missingTenant" }                            // no `x-tenant-id` header
    | { kind: "malformedRequest"; issues: Issue[] };       // the body is not `{ email: non-empty string }` exactly

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
    }
}

type Admitted =
    | { ok: true; tenantId: string; normalizedEmail: string }
    | { ok: false; refusal: SelfServiceRefusal };

/** Role, tenant header and body structure, in that order. Reads nothing. */
function admit(event: SelfServiceEvent): Admitted {
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
    const parsed = CustomerSelfRequestSchema.safeParse(raw);
    if (!parsed.success) {
        // Path and message of each issue. The one zod message that quotes request text — the NAME of an unknown
        // field — is replaced, so no part of the request is in the answer.
        const issues = parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.code === "unrecognized_keys" ? "Unrecognized field." : issue.message,
        }));
        return { ok: false, refusal: { kind: "malformedRequest", issues } };
    }
    return { ok: true, tenantId, normalizedEmail: normalizeEmail(parsed.data.email) };
}

/** The frame of both routes: the checks of `admit`, then `read`; its result is the 200 body. */
async function selfServiceRoute(route: string, event: SelfServiceEvent,
    read: (tenantId: string, normalizedEmail: string) => Promise<unknown>): Promise<Answer> {
    try {
        const admitted = admit(event);
        if (!admitted.ok) return refusalAnswer(admitted.refusal);
        return json(200, await read(admitted.tenantId, admitted.normalizedEmail));
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
    selfServiceRoute("POST /customer/order-history", event, async (tenantId, normalizedEmail) => {
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
        return { orders };
    });

/**
 * D2 — the customer's profile: the stored item reduced to five attributes, or `null` when there is no item. An item
 * with none of the five is `{}`. `name` is a DynamoDB reserved word: it needs an alias.
 */
export const profileReadHandler = (event: SelfServiceEvent): Promise<Answer> =>
    selfServiceRoute("POST /customer/profile-read", event, async (tenantId, normalizedEmail) => {
        const result = await db.send(new GetCommand({
            ...customerRef(tenantId, normalizedEmail),
            ProjectionExpression: "email, #n, phone, birthday, defaultAddress",
            ExpressionAttributeNames: { "#n": "name" },
        }));
        const profile: CustomerProfileView | null = (result.Item as CustomerProfileView | undefined) ?? null;
        return { profile };
    });
