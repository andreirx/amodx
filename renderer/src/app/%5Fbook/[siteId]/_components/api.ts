// SCHED-1G2 — the browser side of the booking proxy: one call to `<base>/api/<op>` on the page's own origin (PD-002:
// the browser talks to the renderer only). A link token travels in a POST body only, never in the query string.
// The answer is a sum: the backend's 2xx body, or the refusal `code` (+ its context) the page turns into a text.
import { bookingBaseOf } from "@/lib/booking-path";

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string | undefined; context: Record<string, unknown> };

export async function callBooking<T>(op: string, request: { query?: Record<string, string>; body?: unknown }): Promise<ApiResult<T>> {
    const base = bookingBaseOf(window.location.pathname);
    const qs = request.query ? `?${new URLSearchParams(request.query)}` : "";
    let res: Response;
    try {
        res = await fetch(`${base}/api/${op}${qs}`, request.body !== undefined
            ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.body), cache: "no-store", credentials: "omit" }
            : { method: "GET", cache: "no-store", credentials: "omit" });
    } catch {
        return { ok: false, status: 0, code: undefined, context: {} };
    }
    let data: unknown = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    if (res.ok) return { ok: true, status: res.status, data: data as T };
    const body = (data !== null && typeof data === "object" ? data : {}) as Record<string, unknown>;
    return { ok: false, status: res.status, code: typeof body.code === "string" ? body.code : undefined, context: body };
}
