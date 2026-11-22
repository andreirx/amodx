/**
 * SCHED-1D1 — the frame of the scheduling admin routes (docs/slices/sched-1.md § 10.3). PROTOTYPE.
 *
 * Every admin route: `x-tenant-id` names the tenant; `requireRole(auth, roles, tenantId)` (GLOBAL_ADMIN passes before
 * the list is read, `auth/policy.ts`); then the shared failure frame `guarded` (`../common.ts`: errors are
 * `{ error, code, ...context }`; a stored item that fails its schema is 500 `storedDataInvalid`, logged with its key
 * and never its value, § 10.2). No customer data is logged: logs carry ids only (packet rule). Admin routes work
 * whether `schedulingEnabled` is on or off (§ 10.3).
 *
 * SCHED-1D2 moved the parts the visitor routes share (answers, body and path parsers, failure frame, tenant read) to
 * `../common.ts`; the admin handlers import them from there.
 *
 * Abstraction line: `adminRoute` — users: the ten handlers of `scheduling/admin/`; axis: none (one rule for every
 * admin route); rejected: the tenant/role block written ten times.
 */
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { requireRole } from "../../auth/policy.js";
import { guarded, refusal, type Answer, type SchedulingEvent } from "../common.js";

export type AdminEvent = SchedulingEvent;

/** § 10.3 `E+T` (as `orders/list.ts`) and `T`. */
export const EDITOR_OR_ADMIN = ["EDITOR", "TENANT_ADMIN"];
export const TENANT_ADMIN = ["TENANT_ADMIN"];

export type AdminContext = { tenantId: string; auth: AuthorizerContext };

/**
 * The frame of every admin route: tenant header (400), role (403 `forbidden`), then `run` inside `guarded`.
 * Each handler orders its reads before its write (`bookings-cancel.ts` states its one read that can still come after
 * the commit).
 */
export async function adminRoute(event: AdminEvent, route: string, roles: string[], run: (ctx: AdminContext) => Promise<Answer>)
    : Promise<Answer> {
    const tenantId = event.headers["x-tenant-id"];
    if (!tenantId) return refusal(400, "invalid", "Missing x-tenant-id header");
    const auth = event.requestContext.authorizer.lambda;
    try {
        requireRole(auth, roles, tenantId);
    } catch (e) {
        return refusal(403, "forbidden", e instanceof Error ? e.message : "Access Denied");
    }
    return guarded(route, () => run({ tenantId, auth }));
}

/**
 * The admin who acts on a booking, as the `Actor` the booking stores (§ 4.4). A caller without a valid email (a key
 * with no user behind it) cannot act on a booking: the stored actor would fail the booking schema on every later read.
 */
export function adminActor(auth: AuthorizerContext): { kind: "admin"; email: string } | null {
    const email = auth.email;
    return typeof email === "string" && z.string().email().safeParse(email).success ? { kind: "admin", email } : null;
}
