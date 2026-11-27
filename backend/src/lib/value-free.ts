/**
 * NEWSLETTER-1 (ruling 7, review finding NL1-R1) — the value-free rule for the handlers that receive a visitor's address
 * or the MailerLite token (POST /leads, GET /leads, DELETE /leads/{email}, POST /leads/{email}/push, GET/PUT /settings,
 * GET /settings/secrets): a malformed body answers 400 with a fixed text, and an unexpected error is logged by its NAME
 * only and answered with a fixed text. An error's message, the error object and the request text never reach a log
 * line or an answer — a `SyntaxError` from `JSON.parse` quotes the body, and an SDK error can quote request values.
 */

/** The error's name (`ValidationException`, `SyntaxError`, `TimeoutError`, …) — never its message. */
export function errorName(e: unknown): string {
    if (e !== null && typeof e === "object" && typeof (e as { name?: unknown }).name === "string") return (e as { name: string }).name;
    return "unknown error";
}

/** A request body that is a JSON object, or `{ ok: false }` (not JSON, or JSON that is not an object). Never throws. */
export function parseJsonObject(raw: string | null | undefined): { ok: true; value: Record<string, any> } | { ok: false } {
    try {
        const value: unknown = JSON.parse(raw ?? "");
        return value !== null && typeof value === "object" && !Array.isArray(value) ? { ok: true, value: value as Record<string, any> } : { ok: false };
    } catch {
        return { ok: false };
    }
}

export const MALFORMED_BODY = { statusCode: 400, body: JSON.stringify({ error: "The request body is not a JSON object." }) };
export const INTERNAL_ERROR = { statusCode: 500, body: JSON.stringify({ error: "Internal error" }) };
