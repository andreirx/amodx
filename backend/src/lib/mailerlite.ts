import type { MailerLiteSettings, NewsletterPushFailure } from "@amodx/shared";

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md, ruling 6) — the one outbound call to MailerLite: create or update the
 * subscriber and add it to the site's group. One `fetch`, no SDK, no provider interface (one provider; a port when a
 * second one is named — the specification's Non-scope).
 *
 * Contract, read on 2026-11-27 from https://developers.mailerlite.com/docs/subscribers.html ("Create/upsert
 * subscriber") and https://developers.mailerlite.com/docs/ (authentication, versioning, validation errors, rate limits):
 *  - `POST https://connect.mailerlite.com/api/subscribers` is an upsert: an existing address "will be updated with new
 *    values. This is non-destructive operation, so omitting fields or groups will not remove them". Answers: 201 when
 *    created, 200 when the address "was already in the mailing list" — so the same address twice is not an error.
 *  - Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept: application/json`;
 *    `X-Version: <date>` locks the API version ("provide the current date at the time of implementation").
 *  - Body: `email` and `groups` (existing group ids; a subscriber "can only be added to groups this way and will not be
 *    removed by omission"). Nothing else is sent: no status (new subscribers are `active`, or `unconfirmed` when the
 *    account uses double opt-in — MailerLite's own setting), no IP address, no `resubscribe`.
 *  - Other answers relied on: 422 `{ message, errors }` (invalid data — e.g. an invalid address; also a subscriber who
 *    unsubscribed earlier, because `resubscribe` is not sent: AMODX never reverses an unsubscribe made in MailerLite),
 *    401 `{"message":"Unauthenticated."}` (a wrong token), 429 "Too Many Attempts." (120 requests per minute).
 *
 * Result: `ok` on 200 and 201; otherwise the failure with the HTTP status, or `timeout` / `network` when no answer came.
 * The answer's body is never read and nothing here logs: MailerLite's body can repeat the address, and the token is in
 * the request headers only.
 */
export const MAILERLITE_SUBSCRIBERS_URL = "https://connect.mailerlite.com/api/subscribers";
/** The API version this module was written against (the documented `X-Version` usage: the implementation date). */
export const MAILERLITE_API_VERSION = "2026-11-27";
/**
 * The cap on the call itself (ruling 5): at most 3 s, inside the caller's whole post-store deadline
 * (`POST_STORE_DEADLINE_MS` in leads/newsletter.ts, 4 s), so at least 1 s stays for recording the result. Long enough for
 * one HTTPS round trip to a reachable service; the docs give no timeout value.
 */
export const PUSH_TIMEOUT_MS = 3_000;

export type PushResult = { ok: true } | { ok: false; reason: NewsletterPushFailure };

/** `deadline`: the caller's post-store deadline; the call stops at the earlier of it and `PUSH_TIMEOUT_MS`. */
export async function pushSubscriber(settings: MailerLiteSettings, email: string, deadline: AbortSignal): Promise<PushResult> {
    try {
        const res = await fetch(MAILERLITE_SUBSCRIBERS_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${settings.apiToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-Version": MAILERLITE_API_VERSION,
            },
            body: JSON.stringify({ email, groups: [settings.groupId] }),
            signal: AbortSignal.any([deadline, AbortSignal.timeout(PUSH_TIMEOUT_MS)]),
        });
        // The body is not needed (see above); release it so the connection is not held.
        await res.body?.cancel().catch(() => undefined);
        return res.status === 200 || res.status === 201 ? { ok: true } : { ok: false, reason: { kind: "http", status: res.status } };
    } catch (error) {
        const name = (error as { name?: unknown } | null)?.name;
        return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? { kind: "timeout" } : { kind: "network" } };
    }
}
