/**
 * SCHED-1G2 — the renderer booking proxy (docs/slices/sched-1.md § 10.1 "Handlers", § 9.2, § 12, § 16.3 PD-002
 * booking-token variant). PROTOTYPE.
 *
 * The browser talks to the renderer only. Each public operation `<base>/api/<op>` (and the feed URL) is forwarded to
 * EXACTLY ONE backend visitor route with:
 *   - the renderer key (`x-api-key`, `getRendererKey`), which the backend resolves to the `RENDERER` role;
 *   - `x-tenant-id` = the id of the tenant record found for the `[siteId]` route segment. That segment is written only
 *     by the middleware (the request host, or the id of a `/_site/<id>/_booking` path on a preview host); a wire
 *     request to the internal tree is refused there (row G5). No tenant comes from the body or a browser header;
 *   - NO `x-viewer-address`, permanently in this version (ruling SCHED-ADDR-INFRA = A, 2026-11-22; § 9.2): the staging
 *     witness G13 showed that the renderer receives one `X-Forwarded-For` value that the caller controls and no
 *     `CloudFront-Viewer-Address` (the origin request policy is full at ten headers), so no trusted client address
 *     exists here. The backend then applies no per-address limit and sends no `remoteip`. What protects the anonymous
 *     hold (§ 9, backend `visitor/holds.ts`): reCAPTCHA (a token minted on the tenant's page), at most five holds per
 *     email per hour and at most two open holds per email (both counted per tenant), and hold expiry (an unconfirmed
 *     hold ends after the tenant's `holdMinutes`). No browser header is forwarded: the backend request carries only
 *     the headers `forward` writes;
 *   - a body that passed the route's own strict schema from `@amodx/shared` (size ≤ 8 KB first; checked BEFORE anything
 *     is forwarded), so it holds known fields only.
 * The backend status and JSON body are passed through; the answer is `Cache-Control: private, no-store` (the feed:
 * `private, max-age=300` on 200, § 12). Nothing here logs a body, a token, a feed secret or an address.
 *
 * Abstraction lines:
 * - `BOOKING_OPS` (a closed table: op → method, backend route, input check) — users: the one API route handler and the
 *   unit tests; axis: the seven visitor routes of § 10.2 (fixed by the deployed backend); rejected: seven route files
 *   with the same frame (method, size, tenant, key, pass-through) written seven times.
 * - `forward` — users: the API handler and the feed handler; axis: none; rejected: two copies of the backend call.
 */
import { HoldRequestSchema, KeyPart, LocalDateSchema, MoveBodySchema } from "@amodx/shared";
import { getTenantConfig } from "@/lib/dynamo";
import { getBookingTenant } from "@/lib/booking-tenant";
import { callBackend as forward } from "@/lib/api-client";   // CMRC-1B: `forward` is `callBackend` of api-client.ts (moved there, unchanged)

/** § 10.1: a request body larger than this is refused (413) before it is parsed. */
export const MAX_BODY_BYTES = 8 * 1024;

// ── Input checks ───────────────────────────────────────────────────────────────────────────────────────────────────
// RULE (review-0 S1G2-R2; operator ruling SCHED-1G2-ZOD-DEP = C): a request is checked with the SAME schema its backend
// route parses, imported from `@amodx/shared` — `HoldRequestSchema` (holds.ts), `MoveBodySchema` (bookings-move.ts),
// `KeyPart` and `LocalDateSchema` (slots.ts query) — through `safeParse`; a failure answers 400 `invalid` with the
// issues in the backend's own form (`parseValue`, backend/src/scheduling/common.ts: path and message, never a value).
// So the proxy forwards exactly what the backend accepts and nothing it refuses. The schemas are `.strict()`, so a body
// that passes holds only known fields; it is forwarded as received (the backend normalizes the email itself). The
// renderer imports no `zod` itself (test/unit/sched-1g-proxy.test.ts checks the sources).
// One backend rule is not a zod schema in `@amodx/shared` and is written here, named after its backend source: the
// link token format (`parseLinkBody`); and the token routes accept no field besides the token (backend `NoMoreFields`
// = `z.object({}).strict()`).

type Issue = { path: string; message: string };
type Checked<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/** backend/src/scheduling/common.ts `parseValue`: each zod issue as its path and message. */
const issuesOf = (error: { issues: { path: PropertyKey[]; message: string }[] }): Issue[] =>
    error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));

/** `parseLinkBody` / `getBookingByToken` (backend/src/scheduling/visitor/common.ts): 43 characters of base64url. */
const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** `{ token }` and more: the token is checked first and in full; a malformed one is the one answer 404 (§ 8.4). */
type LinkBody = { kind: "linkNotValid" } | { kind: "ok"; token: string; rest: Record<string, unknown> };
function linkBody(raw: unknown): LinkBody {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { kind: "linkNotValid" };
    const { token, ...rest } = raw as Record<string, unknown>;
    return typeof token === "string" && LINK_TOKEN.test(token) ? { kind: "ok", token, rest } : { kind: "linkNotValid" };
}

/** A query of a GET op: exactly the listed parameters, each once; `null` = absent. */
function queryOf(params: URLSearchParams, allowed: string[]): Checked<Record<string, string | null>> {
    const issues: Issue[] = [];
    const out: Record<string, string | null> = Object.fromEntries(allowed.map((k) => [k, null]));
    for (const key of new Set(params.keys())) {
        if (!allowed.includes(key)) issues.push({ path: key, message: "Unknown parameter." });
        else if (params.getAll(key).length > 1) issues.push({ path: key, message: "Given more than once." });
        else out[key] = params.get(key);
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: out };
}

// ── The operations ─────────────────────────────────────────────────────────────────────────────────────────────────

/** What one checked request forwards: the backend path (with its query) and, for a POST, the JSON body. */
type Forward = { path: string; body?: Record<string, unknown> };
type Prepared = { ok: true; forward: Forward } | { ok: false; status: number; code: string; error: string; issues?: Issue[] };

const invalid = (issues: Issue[]): Prepared => ({ ok: false, status: 400, code: "invalid", error: "The request is not valid.", issues });
const linkNotValidPrepared: Prepared = { ok: false, status: 404, code: "linkNotValid", error: "This link is not valid." };

type GetOp = { method: "GET"; prepare: (query: URLSearchParams) => Prepared };
type PostOp = { method: "POST"; prepare: (body: unknown) => Prepared };

const tokenOnly = (route: string): PostOp => ({
    method: "POST",
    prepare: (body) => {
        const link = linkBody(body);
        if (link.kind === "linkNotValid") return linkNotValidPrepared;
        const extra = Object.keys(link.rest);   // backend `NoMoreFields`: no field besides the token
        return extra.length > 0
            ? invalid(extra.map((k) => ({ path: "", message: `Unrecognized key: "${k}"` })))
            : { ok: true, forward: { path: route, body: { token: link.token } } };
    },
});

/** The seven visitor operations of § 10.2 (the feed has its own handler, `handleBookingFeed`). */
export const BOOKING_OPS: Readonly<Record<string, GetOp | PostOp>> = {
    offer: {
        method: "GET",
        prepare: (query) => {
            const q = queryOf(query, []);   // the backend route takes no parameter
            return q.ok ? { ok: true, forward: { path: "/scheduling/visitor/offer" } } : invalid(q.issues);
        },
    },
    slots: {
        method: "GET",
        prepare: (query) => {
            const q = queryOf(query, ["serviceId", "from", "to"]);
            if (!q.ok) return invalid(q.issues);
            const { serviceId, from, to } = q.value;
            const issues: Issue[] = [];
            for (const [name, value, schema] of [["serviceId", serviceId, KeyPart], ["from", from, LocalDateSchema], ["to", to, LocalDateSchema]] as const) {
                const checked = schema.safeParse(value);
                if (!checked.success) issues.push(...issuesOf(checked.error).map((i) => ({ ...i, path: name })));
            }
            if (issues.length > 0) return invalid(issues);
            const search = new URLSearchParams({ serviceId: serviceId as string, from: from as string, to: to as string });
            return { ok: true, forward: { path: `/scheduling/visitor/slots?${search}` } };
        },
    },
    hold: {
        method: "POST",
        prepare: (body) => {
            const checked = HoldRequestSchema.safeParse(body);
            return checked.success
                ? { ok: true, forward: { path: "/scheduling/visitor/holds", body: body as Record<string, unknown> } }
                : invalid(issuesOf(checked.error));
        },
    },
    view: tokenOnly("/scheduling/visitor/bookings/view"),
    confirm: tokenOnly("/scheduling/visitor/bookings/confirm"),
    cancel: tokenOnly("/scheduling/visitor/bookings/cancel"),
    move: {
        method: "POST",
        prepare: (body) => {
            const link = linkBody(body);
            if (link.kind === "linkNotValid") return linkNotValidPrepared;
            const target = MoveBodySchema.safeParse(link.rest);
            return target.success
                ? { ok: true, forward: { path: "/scheduling/visitor/bookings/move", body: { token: link.token, ...link.rest } } }
                : invalid(issuesOf(target.error));
        },
    },
};

// ── Answers and the backend call ───────────────────────────────────────────────────────────────────────────────────

const NO_STORE = "private, no-store";

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": NO_STORE, ...extra },
    });
}
const refusal = (status: number, code: string, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    json(status, { error, code, ...extra }, headers);
const unavailable = () => refusal(503, "unavailable", "Booking is temporarily unavailable.");
const linkNotValidResponse = () => refusal(404, "linkNotValid", "This link is not valid.");

/** The body as text, or `tooLarge` past `MAX_BODY_BYTES` (read stops there; the declared length is checked first). */
async function readBoundedText(req: Request): Promise<{ ok: true; text: string } | { ok: false }> {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false };
    if (req.body === null) return { ok: true, text: "" };
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
            await reader.cancel();
            return { ok: false };
        }
        chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    return { ok: true, text: new TextDecoder().decode(all) };
}

/**
 * `<base>/api/<op>` → `app/%5Fbook/[siteId]/api/[op]/route.ts`. Order: op known (404) → method (405 with `Allow`) →
 * body size (413) → JSON (400) → input check (400, or 404 `linkNotValid` for a malformed token) → tenant record
 * (absent → 403 `notAvailable`, the backend's answer for a tenant without a record) → backend call → pass-through.
 */
export async function handleBookingApi(req: Request, siteId: string, op: string): Promise<Response> {
    const spec = Object.prototype.hasOwnProperty.call(BOOKING_OPS, op) ? BOOKING_OPS[op] : undefined;
    if (spec === undefined) return refusal(404, "notFound", "Unknown operation.");
    if (req.method !== spec.method) return refusal(405, "methodNotAllowed", "Method not allowed.", {}, { allow: spec.method });

    let prepared: Prepared;
    if (spec.method === "GET") {
        prepared = spec.prepare(new URL(req.url).searchParams);
    } else {
        const text = await readBoundedText(req);
        if (!text.ok) return refusal(413, "tooLarge", "The request is too large.");
        let raw: unknown;
        try {
            raw = JSON.parse(text.text);
        } catch {
            return refusal(400, "invalid", "The body is not JSON.");
        }
        prepared = spec.prepare(raw);
    }
    if (!prepared.ok) {
        return refusal(prepared.status, prepared.code, prepared.error, prepared.issues !== undefined ? { issues: prepared.issues } : {});
    }

    const config = await getTenantConfig(siteId);
    if (config === null) return refusal(403, "notAvailable", "Booking is not available on this site.");

    const answer = await forward(prepared.forward.path, config.id, prepared.forward.body);
    if (answer === null) return unavailable();
    const retryAfter = answer.headers.get("retry-after");
    return new Response(await answer.text(), {
        status: answer.status,
        headers: {
            "content-type": answer.headers.get("content-type") ?? "application/json",
            "cache-control": NO_STORE,
            ...(retryAfter !== null ? { "retry-after": retryAfter } : {}),
        },
    });
}

/** § 12 feed file name: `<secret>.ics`, the secret in the § 12 format (43 characters of base64url). */
const FEED_FILE = /^([A-Za-z0-9_-]{43})\.ics$/;

/**
 * `<base>/feed/<resourceId>/<secret>.ics` → POST `/scheduling/visitor/feed` `{ resourceId, secret }` (a POST keeps the
 * secret out of the API logs, § 10.2). One answer for a URL holder (§ 12): a malformed resource id or file name, a
 * tenant without a record, a tenant with scheduling off (SCHED-1G3, `getBookingTenant`; answered here, no backend
 * call), and every 404 of the backend are 404 `linkNotValid`, the same body, `private, no-store`. 200 → the backend's
 * calendar text, `text/calendar`, `Cache-Control: private, max-age=300` (§ 12; `private` keeps it out of CloudFront).
 */
export async function handleBookingFeed(siteId: string, resourceId: string, file: string): Promise<Response> {
    const match = FEED_FILE.exec(file);
    if (match === null || resourceId.length < 1 || resourceId.length > 200 || resourceId.includes("#")) return linkNotValidResponse();
    const config = await getBookingTenant(siteId);
    if (config === null) return linkNotValidResponse();   // no record, or scheduling off (SCHED-1G3): no backend call
    const answer = await forward("/scheduling/visitor/feed", config.id, { resourceId, secret: match[1] });
    if (answer === null) return unavailable();
    if (answer.status === 404) return linkNotValidResponse();
    if (answer.status !== 200) {
        return new Response(await answer.text(), {
            status: answer.status,
            headers: { "content-type": answer.headers.get("content-type") ?? "application/json", "cache-control": NO_STORE },
        });
    }
    return new Response(await answer.text(), {
        status: 200,
        headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300" },
    });
}
