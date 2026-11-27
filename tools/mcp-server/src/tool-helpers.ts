// HELPER: tool error result that keeps the backend's own reason. Handlers answer either a
// JSON body {error} or a plain-text body; axios' error.message alone says only the status.
export const apiError = (error: any) => {
    const body = error.response?.data;
    const reason = typeof body === "string" ? body : body?.error;
    const status = error.response?.status;
    const text = status ? `HTTP ${status}${reason ? `: ${reason}` : ""}` : error.message;
    return { content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true };
};

// Cache wording rule for tools added in mcp-sync-1: a cache or publication effect is stated only
// as a best-effort backend ATTEMPT, never as an outcome. Two backend paths exist:
//  - `withInvalidation()` (backend/src/lib/invalidate-cdn.ts): on a 2xx it calls markCdnPending(),
//    which skips the write when TABLE_NAME is unset and logs-and-swallows a failed write; the
//    request still succeeds. The scheduled debounce-flush job acts on the marker later.
//  - `revalidateTenantPaths()` (backend/src/lib/revalidate.ts): best-effort ISR purge + edge
//    enqueue + marker; failures are logged and swallowed; skipped when the site has no domain.
export const PENDING_MARKER_ATTEMPT =
    "On success the backend attempts a best-effort write of the deployment-wide pending-invalidation marker " +
    "(a failed write is logged and ignored; the request still succeeds); a scheduled job later attempts the CDN flush when a marker is due. " +
    "Nothing returned here confirms that a marker was written or that a flush ran.";
export const PAGE_REVALIDATION_ATTEMPT =
    "On success the backend attempts a best-effort cache revalidation of the product URL and attempts to mark listings pending " +
    "(failures are logged and ignored; skipped when the site has no domain). Until a refresh completes, the old page may still be served.";

// HELPER: every JSON-string input of a tool that promises an array or an object goes through
// this check BEFORE any request: wrong syntax or wrong top-level shape → isError naming the
// expected shape, and nothing is sent.
export type JsonInput = { ok: true; value: any } | { ok: false; result: ReturnType<typeof apiError> };
export const parseJsonInput = (raw: string, shape: "array" | "object", name: string): JsonInput => {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        value = undefined;
    }
    const fits = shape === "array"
        ? Array.isArray(value)
        : typeof value === "object" && value !== null && !Array.isArray(value);
    if (fits) return { ok: true, value };
    const expected = shape === "array" ? "a JSON array ([...])" : "a JSON object ({...})";
    return { ok: false, result: { content: [{ type: "text" as const, text: `Error: ${name} must be ${expected}; no request was sent.` }], isError: true } };
};
