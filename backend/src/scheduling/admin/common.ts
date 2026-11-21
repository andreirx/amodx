/**
 * SCHED-1D1 — the HTTP plumbing of the scheduling admin routes (docs/slices/sched-1.md § 10.3). PROTOTYPE.
 *
 * Every admin route: `x-tenant-id` names the tenant; `requireRole(auth, roles, tenantId)` (GLOBAL_ADMIN passes before
 * the list is read, `auth/policy.ts`); errors are `{ error, code, ...context }`; a stored item that fails its schema
 * is 500 `storedDataInvalid`, logged with its key and never its value (§ 10.2). No customer data is logged: logs carry
 * ids only (packet rule). Admin routes work whether `schedulingEnabled` is on or off (§ 10.3).
 *
 * Abstraction line: `adminRoute` + `parseBody` + `answer` — users: the ten handlers of `scheduling/admin/`; axis:
 * none (one rule for every admin route); rejected: the tenant/role/parse/error block written ten times.
 */
import type { APIGatewayProxyEventV2WithLambdaAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import type { AuthorizerContext } from "../../auth/context.js";
import { requireRole } from "../../auth/policy.js";
import { db, TABLE_NAME } from "../../lib/db.js";
import { SchedulingSettingsSchema, type SchedulingEmailTemplate, type SchedulingEmailKey, type SchedulingSettings } from "@amodx/shared";
import { StoredDataInvalidError } from "../../lib/scheduling-db.js";
import { storedOverrides } from "../../lib/scheduling-email.js";

export type AdminEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>;
export type Answer = APIGatewayProxyStructuredResultV2;

/** § 10.3 `E+T` (as `orders/list.ts`) and `T`. */
export const EDITOR_OR_ADMIN = ["EDITOR", "TENANT_ADMIN"];
export const TENANT_ADMIN = ["TENANT_ADMIN"];

export function answer(statusCode: number, body?: unknown): Answer {
    return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? "" : JSON.stringify(body),
    };
}

/** A refusal: `{ error, code, ...context }` (§ 10.2). */
export function refusal(statusCode: number, code: string, error: string, context: Record<string, unknown> = {}): Answer {
    return answer(statusCode, { error, code, ...context });
}

export type AdminContext = { tenantId: string; auth: AuthorizerContext };

/**
 * The frame of every admin route: tenant header (400), role (403 `forbidden`), then `run`. A
 * `StoredDataInvalidError` → 500 `storedDataInvalid`, logged by its key; any other error → 500 `internal`, logged by
 * the error's NAME only — never its message, which can carry a stored or submitted value (review S1D1-R01).
 * This frame contains the failure of `run`; it does not undo a write `run` already committed. Each handler orders its
 * reads before its write (`bookings-cancel.ts` states its one read that can still come after the commit).
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
    try {
        return await run({ tenantId, auth });
    } catch (e) {
        if (e instanceof StoredDataInvalidError) {
            console.error(`[scheduling] ${route} storedDataInvalid`, e.key);
            return refusal(500, "storedDataInvalid", "A stored scheduling item is not valid.");
        }
        // The error NAME only: a message can carry a stored or submitted value (review S1D1-R01; logs carry ids only).
        console.error(`[scheduling] ${route} failed`, e instanceof Error ? e.name : "unknown error");
        return refusal(500, "internal", "Internal error");
    }
}

/**
 * The request body through `schema`. No body → `{}` is parsed (routes whose body is `{}`). Not JSON, or a schema
 * failure → 400 `invalid` with the issues (path and message only, never the submitted values).
 */
export function parseBody<S extends z.ZodType>(event: AdminEvent, schema: S): { ok: true; value: z.output<S> } | { ok: false; answer: Answer } {
    let raw: unknown = {};
    if (event.body) {
        try {
            raw = JSON.parse(event.body);
        } catch {
            return { ok: false, answer: refusal(400, "invalid", "The body is not JSON.") };
        }
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
        return { ok: false, answer: refusal(400, "invalid", "The request is not valid.", { issues }) };
    }
    return { ok: true, value: parsed.data };
}

/** A path parameter, or a 400 when the route was called without it. */
export function pathParam(event: AdminEvent, name: string): { ok: true; value: string } | { ok: false; answer: Answer } {
    const value = event.pathParameters?.[name];
    if (!value || value.includes("#")) return { ok: false, answer: refusal(400, "invalid", `Missing or invalid path parameter ${name}.`) };
    return { ok: true, value };
}

/**
 * The tenant record (main table, `SYSTEM` / `TENANT#<id>`); `undefined` when the tenant has no record.
 * `consistent`, as in `scheduling-db.ts` (§ 6.4 rule 4, review S1D1-R07): `true` for a read whose result decides
 * whether a write runs (a missing record answers 404 instead of writing); `false` for a display read.
 */
export async function readTenantRecord(tenantId: string, consistent: boolean): Promise<Record<string, any> | undefined> {
    const res = await db.send(new GetCommand({
        TableName: TABLE_NAME, Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }, ConsistentRead: consistent,
    }));
    return res.Item;
}

/** The tenant record as a scheduling handler uses it: every scheduling attribute already parsed by its shared schema. */
export type SchedulingTenant = {
    name: string | undefined;
    domain: string | undefined;
    /** `TenantConfig.scheduling` with the schema's defaults applied; `undefined` when the record has none. */
    scheduling: SchedulingSettings | undefined;
    /** `TenantConfig.schedulingEmailConfig.templates` (absent → `{}`). */
    templates: Partial<Record<SchedulingEmailKey, SchedulingEmailTemplate>>;
};

/**
 * The ONE way a scheduling admin handler reads the stored scheduling attributes of its tenant (review S1D1-R01):
 * `scheduling` through `SchedulingSettingsSchema` (an IANA time zone, `bookingHorizonWeeks` 1-52, … — § 4.5) and
 * `schedulingEmailConfig` through `SchedulingEmailConfigSchema`. A stored value that fails → `StoredDataInvalidError`
 * keyed `TENANT#<id>.<attribute>` (500 `storedDataInvalid` through `adminRoute`, logged by key, never the value;
 * § 10.2: never read as absent or replaced by a default). Callers read it BEFORE any write, so a broken stored value
 * changes nothing. `undefined` when the tenant has no record. `consistent` as `readTenantRecord`: `true` before a write.
 */
export async function readSchedulingTenant(tenantId: string, consistent: boolean): Promise<SchedulingTenant | undefined> {
    const record = await readTenantRecord(tenantId, consistent);
    if (record === undefined) return undefined;
    let scheduling: SchedulingSettings | undefined;
    if (record.scheduling !== undefined) {
        const parsed = SchedulingSettingsSchema.safeParse(record.scheduling);
        if (!parsed.success) throw new StoredDataInvalidError(`TENANT#${tenantId}.scheduling`);
        scheduling = parsed.data;
    }
    const templates = storedOverrides(record.schedulingEmailConfig);
    if (templates === null) throw new StoredDataInvalidError(`TENANT#${tenantId}.schedulingEmailConfig`);
    return {
        name: typeof record.name === "string" ? record.name : undefined,
        domain: typeof record.domain === "string" ? record.domain : undefined,
        scheduling,
        templates,
    };
}

/**
 * The admin who acts on a booking, as the `Actor` the booking stores (§ 4.4). A caller without a valid email (a key
 * with no user behind it) cannot act on a booking: the stored actor would fail the booking schema on every later read.
 */
export function adminActor(auth: AuthorizerContext): { kind: "admin"; email: string } | null {
    const email = auth.email;
    return typeof email === "string" && z.string().email().safeParse(email).success ? { kind: "admin", email } : null;
}
