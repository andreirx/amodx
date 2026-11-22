/**
 * SCHED-1D2 — POST /scheduling/visitor/holds (renderer op `hold`; docs/slices/sched-1.md § 10.2, § 7.2, § 9) →
 * 201 / 200 `HoldResult`. The only visitor write without a link token (§ 16.3 class 2).
 *
 * Order of checks (§ 7.2, § 9 table):
 * 1. role and switch (`visitorRoute`); body schema (`HoldRequest`, strict; the email normalized, then validated);
 * 2. intent lookup (AP11) → the replay table of § 7.2, WITHOUT reCAPTCHA (a replay creates no inventory; its one side
 *    effect, a new mail, counts in `LIMIT#EMAIL#` inside `mintToken`);
 * 3. for a seat: a person language must be one of the course's languages (§ 4.3: "a run's set tag and a person's
 *    language are one of them"), else 400 `invalid`; the course must exist (404 `notFound`);
 * 4. reCAPTCHA as the commerce order route (`orders/create.ts`): `resolveRecaptchaConfig(tenant.recaptcha)` (the
 *    tenant's pair when it set both keys, else the deployment secret `RECAPTCHA_SECRET_KEY`); no token → 400
 *    `verificationRequired`; `!success || score < threshold` → 403 `verificationFailed`; nothing written. Two
 *    differences: (a) required by § 9.1, `remoteip` is the viewer address the renderer sent (§ 9.2), not the API's
 *    `sourceIp` (the renderer's address), and is absent when no address arrived; (b) operator ruling after review-0,
 *    it FAILS CLOSED: when no configuration resolves (no tenant pair, no deployment secret) → 503
 *    `verificationUnavailable`, logged, nothing written — where the order route skips the check;
 * 5. the hold transaction (`holdSlot` / `holdSeat`, `scheduling-db.ts`): the kernel's slot or seat decision, the
 *    container, the open-hold cap (2), the per-email (5/h) and per-address (20/h) counters, the item set with the
 *    first link token — one transaction. A lost `INTENT#` condition (a double submit) re-reads the intent and answers
 *    by the replay table;
 * 6. after the commit: the `hold` mail with the link (that first token), then `state.mail = sent` → 201, or
 *    `state.mail = failed` → 503 `mailFailed` (the hold stays; a replay of the same form recovers it).
 * No answer carries the booking id or the token (row D5). No audit event (SCHED-AUDIT-PII = C: the `created` history
 * entry is in the hold's own write). Logs: ids only.
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { HoldRequestSchema, type Booking } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { resolveRecaptchaConfig, verifyRecaptcha } from "../../lib/recaptcha.js";
import {
    getCourse, holdSeat, holdSlot, intentFingerprint, iso, markHoldMail, mintToken, replayIntent, schedulingStoreFromEnv,
    type HoldWhatInput, type IntentReplay, type SchedulingStore,
} from "../../lib/scheduling-db.js";
import { answer, parseBody, refusal, type Answer } from "../common.js";
import { readPlace, viewerAddressOf, visitorRefusal, visitorRoute, type VisitorContext } from "./common.js";
import { holdResult } from "./dto.js";
import { sendVisitorMail } from "./mail.js";

const notFoundTarget = () => refusal(404, "notFound", "The service or group was not found.");

/**
 * After the hold (or a recovery / resend mint): send the `hold` mail with `token`, mark `state.mail`, answer.
 * A failure of the place read throws (500) with the mail still `pending`: a replay of the same form recovers it (§ 7.2).
 */
async function mailHold(store: SchedulingStore, ctx: VisitorContext, b: Booking, token: string, status: 200 | 201): Promise<Answer> {
    const place = await readPlace(store, ctx.tenantId, b, false);   // for the mail of exactly `b` (display read)
    const outcome = await sendVisitorMail({ key: "hold", tenantId: ctx.tenantId, tenant: ctx.tenant, settings: ctx.settings, booking: b, place, token });
    const sent = outcome === "sent";
    await markHoldMail(store, ctx.tenantId, b.id, b.rev, sent ? "sent" : "failed");
    if (!sent) return refusal(503, "mailFailed", "The confirmation email could not be sent. Please try again.");
    return answer(status, holdResult(b));
}

/** § 7.2 replay table for a stored intent (everything except `new`). */
async function answerReplay(store: SchedulingStore, ctx: VisitorContext, replay: Exclude<IntentReplay, { kind: "new" }>, now: number): Promise<Answer> {
    switch (replay.kind) {
        case "intentReused": return refusal(409, "intentReused", "This form was already used for another booking. Please reload the page.");
        case "intentClosed": return refusal(409, "intentClosed", "This booking is closed. Please start a new booking.");
        case "confirmed": return answer(200, holdResult(replay.booking));
        case "held": {
            if (replay.send === "none") return answer(200, holdResult(replay.booking));
            const minted = await mintToken(store, ctx.tenantId, replay.booking.id, now, { countForEmail: true });
            if (!minted.ok) {
                switch (minted.error.kind) {
                    case "linkNotIssued": return refusal(409, "intentClosed", "This booking is closed. Please start a new booking.");
                    case "tooManyForEmail": return visitorRefusal(minted.error, now, notFoundTarget());
                    case "busy": return visitorRefusal(minted.error, now, notFoundTarget());
                    default: {
                        const never: never = minted.error;
                        throw new Error(`Unhandled mint refusal ${JSON.stringify(never)}`);
                    }
                }
            }
            // `recover` (mail pending or failed) → 201; `resend` (mail sent, resend asked) → 200 (§ 7.2 table).
            return mailHold(store, ctx, minted.value.booking, minted.value.token, replay.send === "recover" ? 201 : 200);
        }
        default: {
            const never: never = replay;
            throw new Error(`Unhandled replay ${JSON.stringify(never)}`);
        }
    }
}

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "holds", { consistent: true }, async (ctx) => {
        const body = parseBody(event, HoldRequestSchema);
        if (!body.ok) return body.answer;
        const req = body.value;
        const { tenantId, tenant, settings } = ctx;
        // The fingerprint's `what` is canonical: a slot start in the fixed-width UTC form of § 4.
        const what: HoldWhatInput = req.what.kind === "slot"
            ? { kind: "slot", serviceId: req.what.serviceId, start: iso(Date.parse(req.what.start)) }
            : { kind: "seat", courseId: req.what.courseId, runId: req.what.runId };
        const fingerprint = intentFingerprint(what, req.who);
        const store = schedulingStoreFromEnv();
        const now = Date.now();

        const replay = await replayIntent(store, tenantId, req.intentId, fingerprint, req.resend === true, now);
        if (replay.kind !== "new") return answerReplay(store, ctx, replay, now);

        if (what.kind === "seat") {
            const course = await getCourse(store, tenantId, what.courseId, true);
            if (course === undefined) return notFoundTarget();
            if (req.who.language !== undefined && !course.languages.includes(req.who.language)) {
                return refusal(400, "invalid", "The request is not valid.", {
                    issues: [{ path: "who.language", message: "Must be one of the course's languages." }],
                });
            }
        }

        const address = viewerAddressOf(event, ctx.auth);

        // reCAPTCHA: the mechanism of `orders/create.ts` (deployment-level mandatory, tenant may override keys/threshold),
        // except that it FAILS CLOSED (operator ruling after review-0): no resolvable configuration → refused, never skipped.
        const recaptchaConfig = resolveRecaptchaConfig(tenant.recaptcha);
        if (recaptchaConfig === null) {
            console.error("[scheduling] holds: no reCAPTCHA configuration resolves; hold refused");
            return refusal(503, "verificationUnavailable", "Booking is temporarily unavailable. Please try again later.");
        }
        if (!req.recaptchaToken) return refusal(400, "verificationRequired", "Verification required");
        const result = await verifyRecaptcha(req.recaptchaToken, recaptchaConfig.secretKey, address?.ip);
        if (!result.success || result.score < recaptchaConfig.threshold) {
            console.warn(`[scheduling] reCAPTCHA failed [${recaptchaConfig.source}]:`, {
                success: result.success, score: result.score, errors: result["error-codes"],
            });
            return refusal(403, "verificationFailed", "Verification failed. Please try again.");
        }

        const common = {
            tenantId, who: req.who, intentId: req.intentId, fingerprint,
            ...(address !== undefined ? { addressKey: address.key } : {}),
            settings: { timezone: settings.timezone, holdMinutes: settings.holdMinutes, bookingHorizonWeeks: settings.bookingHorizonWeeks },
            now,
        };
        const held = what.kind === "slot"
            ? await holdSlot(store, { ...common, serviceId: what.serviceId, start: Date.parse(what.start) })
            : await holdSeat(store, { ...common, courseId: what.courseId, runId: what.runId });
        if (!held.ok) {
            if (held.error.kind === "intentExists") {
                // § 7.2 interleaving (double submit): the other request committed this intent; answer by the table.
                const again = await replayIntent(store, tenantId, req.intentId, fingerprint, req.resend === true, now);
                if (again.kind === "new") return refusal(503, "busy", "Busy, please try again.");
                return answerReplay(store, ctx, again, now);
            }
            return visitorRefusal(held.error, now, notFoundTarget());
        }
        return mailHold(store, ctx, held.value.booking, held.value.token, 201);
    });
