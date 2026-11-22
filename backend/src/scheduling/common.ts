/**
 * SCHED-1D1/1D2 — the HTTP plumbing shared by the scheduling admin routes (`admin/`) and the visitor routes
 * (`visitor/`) (docs/slices/sched-1.md § 10.2, § 10.3). PROTOTYPE.
 *
 * Moved here from `admin/common.ts` by SCHED-1D2 (unchanged in behaviour except the three tenant fields the visitor
 * routes read, see `SchedulingTenant`): answers and refusals `{ error, code, ...context }`; the body, value and path parsers (400
 * `invalid` with the issue paths, never the submitted values); the failure frame (`guarded`: 500 `storedDataInvalid`
 * logged by key, any other error 500 `internal` logged by its NAME only); the tenant record read.
 *
 * Abstraction line: `guarded` + `parseBody`/`parseValue`/`pathParam` + `answer`/`refusal` + `readSchedulingTenant` — users: the ten admin
 * handlers (through `adminRoute`) and the eight visitor handlers (through `visitorRoute`); axis: none (one rule for
 * every scheduling route, so the two frames cannot log or answer a failure differently); rejected: a second copy in
 * `visitor/`, or visitor modules importing a module named `admin/common` (the name would no longer say who uses it).
 */
import type { APIGatewayProxyEventV2WithLambdaAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import type { AuthorizerContext } from "../auth/context.js";
import { db, TABLE_NAME } from "../lib/db.js";
import { SchedulingSettingsSchema, type SchedulingEmailTemplate, type SchedulingEmailKey, type SchedulingSettings } from "@amodx/shared";
import { StoredDataInvalidError } from "../lib/scheduling-db.js";
import { storedOverrides } from "../lib/scheduling-email.js";

export type SchedulingEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>;
export type Answer = APIGatewayProxyStructuredResultV2;

export function answer(statusCode: number, body?: unknown, headers: Record<string, string> = {}): Answer {
    return {
        statusCode,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? "" : JSON.stringify(body),
    };
}

/** A refusal: `{ error, code, ...context }` (§ 10.2). */
export function refusal(statusCode: number, code: string, error: string, context: Record<string, unknown> = {},
    headers: Record<string, string> = {}): Answer {
    return answer(statusCode, { error, code, ...context }, headers);
}

/**
 * The failure frame of every scheduling route: runs `run`; a `StoredDataInvalidError` → 500 `storedDataInvalid`,
 * logged by its key; any other error → 500 `internal`, logged by the error's NAME only — never its message, which can
 * carry a stored or submitted value (review S1D1-R01; logs carry ids only). The frame contains the failure of `run`;
 * it does not undo a write `run` already committed.
 */
export async function guarded(route: string, run: () => Promise<Answer>): Promise<Answer> {
    try {
        return await run();
    } catch (e) {
        if (e instanceof StoredDataInvalidError) {
            console.error(`[scheduling] ${route} storedDataInvalid`, e.key);
            return refusal(500, "storedDataInvalid", "A stored scheduling item is not valid.");
        }
        console.error(`[scheduling] ${route} failed`, e instanceof Error ? e.name : "unknown error");
        return refusal(500, "internal", "Internal error");
    }
}

/**
 * The request body through `schema`. No body → `{}` is parsed (routes whose body is `{}`). Not JSON, or a schema
 * failure → 400 `invalid` with the issues (path and message only, never the submitted values).
 */
export function parseBody<S extends z.ZodType>(event: SchedulingEvent, schema: S): { ok: true; value: z.output<S> } | { ok: false; answer: Answer } {
    let raw: unknown = {};
    if (event.body) {
        try {
            raw = JSON.parse(event.body);
        } catch {
            return { ok: false, answer: refusal(400, "invalid", "The body is not JSON.") };
        }
    }
    return parseValue(raw, schema);
}

/** `raw` through `schema`: the parsed value, or 400 `invalid` with the issue paths (never the values). */
export function parseValue<S extends z.ZodType>(raw: unknown, schema: S): { ok: true; value: z.output<S> } | { ok: false; answer: Answer } {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
        return { ok: false, answer: refusal(400, "invalid", "The request is not valid.", { issues }) };
    }
    return { ok: true, value: parsed.data };
}

/** A path parameter, or a 400 when the route was called without it (a `#` would make a key ambiguous). */
export function pathParam(event: SchedulingEvent, name: string): { ok: true; value: string } | { ok: false; answer: Answer } {
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
    /** § 4.1 `schedulingEnabled`: on only when the stored value is exactly `true` (absent or anything else = off). */
    enabled: boolean;
    /** `TenantConfig.scheduling` with the schema's defaults applied; `undefined` when the record has none. */
    scheduling: SchedulingSettings | undefined;
    /** `TenantConfig.schedulingEmailConfig.templates` (absent → `{}`). */
    templates: Partial<Record<SchedulingEmailKey, SchedulingEmailTemplate>>;
    /**
     * `TenantConfig.recaptcha` exactly as stored (`siteKey`, `secretKey`, `threshold`), for `resolveRecaptchaConfig`
     * — the value the commerce order route passes (`orders/create.ts`). Never logged, never in an answer.
     */
    recaptcha: { siteKey?: string; secretKey?: string; threshold?: number } | undefined;
    /** `integrations.contactEmail`: the owner copy of a mail (§ 11.1); `undefined` when not a non-empty string. */
    contactEmail: string | undefined;
};

/**
 * The ONE way a scheduling handler reads the stored scheduling attributes of its tenant (review S1D1-R01):
 * `scheduling` through `SchedulingSettingsSchema` (an IANA time zone, `bookingHorizonWeeks` 1-52, … — § 4.5) and
 * `schedulingEmailConfig` through `SchedulingEmailConfigSchema`. A stored value that fails → `StoredDataInvalidError`
 * keyed `TENANT#<id>.<attribute>` (500 `storedDataInvalid` through `guarded`, logged by key, never the value;
 * § 10.2: never read as absent or replaced by a default). Callers read it BEFORE any write, so a broken stored value
 * changes nothing. `undefined` when the tenant has no record. `consistent` as `readTenantRecord`: `true` before a write.
 */
export async function readSchedulingTenant(tenantId: string, consistent: boolean): Promise<SchedulingTenant | undefined> {
    const record = await readTenantRecord(tenantId, consistent);
    return record === undefined ? undefined : parseSchedulingTenant(tenantId, record);
}

/**
 * The parse half of `readSchedulingTenant`, for a record already read (SCHED-1D2: the visitor frame checks the switch
 * on the raw record FIRST, row D1, then parses). Same rules and the same `StoredDataInvalidError` keys.
 */
export function parseSchedulingTenant(tenantId: string, record: Record<string, any>): SchedulingTenant {
    let scheduling: SchedulingSettings | undefined;
    if (record.scheduling !== undefined) {
        const parsed = SchedulingSettingsSchema.safeParse(record.scheduling);
        if (!parsed.success) throw new StoredDataInvalidError(`TENANT#${tenantId}.scheduling`);
        scheduling = parsed.data;
    }
    const templates = storedOverrides(record.schedulingEmailConfig);
    if (templates === null) throw new StoredDataInvalidError(`TENANT#${tenantId}.schedulingEmailConfig`);
    const contactEmail = record.integrations?.contactEmail;
    return {
        name: typeof record.name === "string" ? record.name : undefined,
        domain: typeof record.domain === "string" ? record.domain : undefined,
        enabled: record.schedulingEnabled === true,
        scheduling,
        templates,
        recaptcha: record.recaptcha !== null && typeof record.recaptcha === "object" ? record.recaptcha : undefined,
        contactEmail: typeof contactEmail === "string" && contactEmail !== "" ? contactEmail : undefined,
    };
}
