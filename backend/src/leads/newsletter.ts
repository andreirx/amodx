import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
    IntegrationsSchema, LeadSchema, newsletterTexts, normalizeEmail, readLanguageSettings, resolveLocaleStrings,
    type MailerLiteSettings, type NewsletterPush, type NewsletterPushFailure, type NewsletterSubscription,
} from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { pushSubscriber } from "../lib/mailerlite.js";
import { errorName } from "../lib/value-free.js";

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md) — a newsletter signup on the public lead route (`POST /leads` with
 * `source: "newsletter"`, reached through the renderer proxy `/api/leads`; `leads/create.ts` checks the origin and
 * reCAPTCHA before it calls `newsletterSignup`).
 *
 * Storage (ruling NL1-CONSENT-STORAGE = A): the subscription `NEWSLETTER#<normalized email>` = `{ consent, push }`
 * (shared `NewsletterSubscriptionSchema`) and the lead `LEAD#<normalized email>`, written in ONE transaction: the
 * subscription with its consent, plus — for the lead — a `Put` conditional on its absence when the read found none, or a
 * `ConditionCheck` on its presence when the read found one (an existing lead is never written). A lead created or deleted
 * between the read and the transaction cancels it, and the signup is read and tried again (at most `SIGNUP_TRIES`). The
 * answer is success only after that transaction is durable.
 *
 * Rules:
 *  - ruling 3 / NL1-R3: not a valid address (checked on its normalized form, PD-001), no `consentText` or no
 *    `consentLocale` → 400, nothing stored, nothing sent. The pair (`consentLocale`, `consentText`) must be a line a page
 *    of this tenant shows now (`shownConsentLines`: the default language, then each extra language) — both must match,
 *    the locale is never inferred from the text. Else 409, nothing stored.
 *  - ruling 12 / NL1-R2: a stored consent to the SAME text stays (its id, time and locale); nothing is sent again. A
 *    consent to a DIFFERENT text (the owner changed the line) replaces it — only while the stored consent is still the one
 *    the request read: the write is conditional on that consent's `id`, an identity never reused. A request that lost
 *    the race answers success and changes nothing (the winner is the record).
 *  - ruling 5 / NL1-R4 / NL1-WRITE-ACK-UNCERTAINTY = A: with MailerLite settings, the push runs in this invocation
 *    after the transaction. The answer comes at most `POST_STORE_DEADLINE_MS` after the committed transaction: a timer
 *    RACES the whole post-store work (outside every SDK call, so SDK retries and backoff cannot extend it), and its
 *    expiry also aborts the I/O. The result write's outcome is `recorded` (acknowledged) or `unconfirmed` (no
 *    acknowledgement: its commit is not known to this request). The STORED push state is the only truth; a later read
 *    may show `Pending`, `Sent` or `Failed`, each correct. The answer is success whatever the push did.
 *  - NL1-R5: a cancelled signup transaction is followed by a re-read: a durable subscription with the same text, or a
 *    newer consent than the one this request read, answers success; otherwise the transaction is retried ONCE; a second
 *    cancellation answers 503 ("try again") — never success with nothing stored.
 *  - NL1-R8: one lead identity, the normalized address. The subscription `NEWSLETTER#<n>` exists only together with the
 *    lead `LEAD#<n>` (created here when absent, in the same transaction). A lead item under another spelling of the
 *    address (written by a writer that does not normalize) is a separate item: it is not read, merged or written here.
 *  - ruling 7: no log line holds the address or the token (lib/value-free.ts).
 */

/**
 * The longest time (ms) between the committed signup transaction and the answer: the MailerLite call (at most 3 s,
 * `PUSH_TIMEOUT_MS`) and the result write together. Enforced by a timer race (`pushWithinDeadline`), not by the SDK.
 */
export const POST_STORE_DEADLINE_MS = 4_000;

type Answer = { statusCode: number; body: string };
const json = (statusCode: number, body: unknown): Answer => ({ statusCode, body: JSON.stringify(body) });
const SUBSCRIBED = json(201, { message: "Subscribed" });

/** The site's MailerLite connection from its stored record, or undefined: absent, a legacy boolean, or malformed = off. */
export function mailerLiteSettingsOf(tenant: Record<string, any> | undefined): MailerLiteSettings | undefined {
    const parsed = IntegrationsSchema.shape.mailerlite.safeParse(tenant?.integrations?.mailerlite);
    return parsed.success ? parsed.data : undefined;
}

/** The subscription's key. `email` is normalized here, so every caller (signup, list, delete, Send again) agrees. */
export const newsletterKey = (tenantId: string, email: string) => ({ PK: `TENANT#${tenantId}`, SK: `NEWSLETTER#${normalizeEmail(email)}` });

/**
 * The consent lines a page of this tenant can show now, each with its locale: the default language's (the tenant's
 * locale table, overrides included) first, then each extra language's (its pack only — LANG-1 § 8.2: an extra-language
 * page gets its pack without the tenant's overrides; renderer `localeInputFor`).
 */
export function shownConsentLines(tenant: Record<string, any> | undefined): { locale: string; text: string }[] {
    const inputs = [tenant ?? {}, ...readLanguageSettings(tenant ?? {}).languages.map((subtag) => ({ locale: subtag }))];
    return inputs.map((input) => {
        const texts = newsletterTexts(resolveLocaleStrings(input));
        return { locale: texts.locale, text: texts.consent };
    });
}

/** A failure reason as one short token for a log line: `http:401`, `timeout`, `network`. */
export function failureText(reason: NewsletterPushFailure): string {
    switch (reason.kind) {
        case "http": return `http:${reason.status}`;
        case "timeout": return "timeout";
        case "network": return "network";
        default: {
            const unreachable: never = reason;
            return unreachable;
        }
    }
}

const isConditionFailure = (error: unknown) => errorName(error) === "ConditionalCheckFailedException";
/** NL1-R5: the transaction is tried once and, after a cancellation that the re-read does not settle, once more. */
const SIGNUP_TRIES = 2;

/** The transaction's lead part: create it when the read found none; only check it is still there when the read found one. */
function leadPart(tenantId: string, address: string, now: string, data: Record<string, unknown> | undefined, exists: boolean) {
    const Key = { PK: `TENANT#${tenantId}`, SK: `LEAD#${address}` };
    if (exists) return { ConditionCheck: { TableName: TABLE_NAME, Key, ConditionExpression: "attribute_exists(SK)" } };
    return {
        Put: {
            TableName: TABLE_NAME,
            Item: {
                ...Key, id: crypto.randomUUID(), tenantId, email: address, source: "newsletter", status: "New",
                ...(data !== undefined ? { data } : {}), createdAt: now, Type: "Lead",
            },
            ConditionExpression: "attribute_not_exists(SK)",
        },
    };
}

/** The codes of a cancelled transaction, by item (`ConditionalCheckFailed`, `None`, …), or null for any other error. */
function cancellationCodes(error: unknown): (string | undefined)[] | null {
    if (errorName(error) !== "TransactionCanceledException") return null;
    return ((error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((r) => r?.Code);
}

export async function newsletterSignup(tenantId: string, tenant: Record<string, any> | undefined, body: Record<string, any>): Promise<Answer> {
    const address = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    if (!LeadSchema.shape.email.safeParse(address).success) return json(400, { error: "A valid email address is required." });
    const consentText = typeof body.consentText === "string" ? body.consentText : "";
    const consentLocale = typeof body.consentLocale === "string" ? body.consentLocale : "";
    if (consentText === "" || consentLocale === "") return json(400, { error: "Consent is required." });

    const shown = shownConsentLines(tenant).find((line) => line.locale === consentLocale && line.text === consentText);
    if (!shown) return json(409, { error: "The consent text has changed. Reload the page." });

    const key = newsletterKey(tenantId, address);
    const settings = mailerLiteSettingsOf(tenant);
    const data = LeadSchema.shape.data.safeParse(body.data);
    let subscription: NewsletterSubscription | undefined;
    for (let attempt = 1; subscription === undefined; attempt++) {
        const [stored, existingLead] = await Promise.all([
            db.send(new GetCommand({ TableName: TABLE_NAME, Key: key, ConsistentRead: true })).then((r) => r.Item),
            db.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: key.PK, SK: `LEAD#${address}` }, ProjectionExpression: "SK", ConsistentRead: true })).then((r) => r.Item),
        ]);
        if (stored && stored.consent?.text === shown.text) return SUBSCRIBED;   // the first consent to this text stays

        const now = new Date().toISOString();
        const candidate: NewsletterSubscription = {
            consent: { id: crypto.randomUUID(), at: now, locale: shown.locale, text: shown.text },
            push: settings ? { state: "Pending", attempt: crypto.randomUUID() } : { state: "NoSettings" },
        };
        const storedId: unknown = stored?.consent?.id;
        const fence = !stored
            ? { ConditionExpression: "attribute_not_exists(SK)" }
            : typeof storedId === "string"
                ? { ConditionExpression: "consent.#cid = :storedId", ExpressionAttributeNames: { "#cid": "id" }, ExpressionAttributeValues: { ":storedId": storedId } }
                : { ConditionExpression: "attribute_exists(SK) AND attribute_not_exists(consent.#cid)", ExpressionAttributeNames: { "#cid": "id" } };
        try {
            await db.send(new TransactWriteCommand({
                TransactItems: [
                    leadPart(tenantId, address, now, data.success ? data.data : undefined, existingLead !== undefined),
                    { Put: { TableName: TABLE_NAME, Item: { ...key, Type: "NewsletterSubscription", email: address, ...candidate }, ...fence } },
                ],
            }));
            subscription = candidate;
        } catch (error) {
            if (cancellationCodes(error) === null) throw error;
            // NL1-R5: a cancellation proves nothing by itself (both items may have been deleted meanwhile). Re-read: a
            // durable subscription with this text, or with a consent newer than the one read above, settles the signup.
            const after = (await db.send(new GetCommand({ TableName: TABLE_NAME, Key: key, ConsistentRead: true }))).Item;
            const afterId: unknown = after?.consent?.id;
            if (after && (after.consent?.text === shown.text || (typeof afterId === "string" && afterId !== storedId))) return SUBSCRIBED;
            if (attempt >= SIGNUP_TRIES) return json(503, { error: "The signup was not stored. Please try again." });
        }
    }

    if (settings && subscription.push.state === "Pending") {
        await pushWithinDeadline(tenantId, address, subscription.consent.id, subscription.push.attempt, settings);
    }
    return SUBSCRIBED;
}

/**
 * What one push attempt knows when it ends (NL1-WRITE-ACK-UNCERTAINTY = A). `attempted`: the state the MailerLite answer
 * means — absent when no answer came before the deadline. `resultWrite`: `recorded` — the conditional write of that
 * state was acknowledged; `unconfirmed` — no acknowledgement (the deadline came first, the write failed or was not
 * sent, or its condition found a newer consent or attempt). An unconfirmed write may or may not have committed: the
 * STORED push state is the only truth, and a later read may show `Pending`, `Sent` or `Failed`.
 */
export type ResultWrite = "recorded" | "unconfirmed";
export type PushOutcome = { attempted?: NewsletterPush; resultWrite: ResultWrite };

/**
 * `pushAndRecord` raced against a timer of `ms` (default `POST_STORE_DEADLINE_MS`). The timer is outside every SDK call,
 * so SDK retries and backoff cannot extend the bound; at expiry it also aborts the call and the write (their I/O), and
 * the answer is `{ resultWrite: "unconfirmed" }`. Never throws. Users: `newsletterSignup`, "Send again" (`leads/push.ts`).
 */
export async function pushWithinDeadline(
    tenantId: string, email: string, consentId: string, attempt: string, settings: MailerLiteSettings, ms = POST_STORE_DEADLINE_MS,
): Promise<PushOutcome> {
    const controller = new AbortController();
    const seen: { attempted?: NewsletterPush } = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<PushOutcome>((resolve) => {
        timer = setTimeout(() => {
            controller.abort();
            console.warn(`[newsletter] push result unconfirmed: tenant=${tenantId} reason=deadline`);
            resolve({ ...(seen.attempted ? { attempted: seen.attempted } : {}), resultWrite: "unconfirmed" });
        }, ms);
    });
    try {
        return await Promise.race([pushAndRecord(tenantId, email, consentId, attempt, settings, controller.signal, seen), expiry]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Sends the subscriber to MailerLite and writes the result — conditional on the stored subscription still holding
 * consent `consentId` AND push attempt `attempt` (NL1-R2). `signal` aborts the call and the write; `seen` receives the
 * MailerLite answer as soon as it is known. Never throws; logs the tenant and an error name only. Callers bound it with
 * `pushWithinDeadline`.
 */
export async function pushAndRecord(
    tenantId: string, email: string, consentId: string, attempt: string, settings: MailerLiteSettings, signal: AbortSignal,
    seen: { attempted?: NewsletterPush } = {},
): Promise<PushOutcome> {
    const result = await pushSubscriber(settings, email, signal);
    const at = new Date().toISOString();
    const attempted: NewsletterPush = result.ok ? { state: "Sent", at, attempt } : { state: "Failed", at, reason: result.reason, attempt };
    seen.attempted = attempted;   // the deadline's answer can still say what MailerLite answered
    if (!result.ok) console.warn(`[newsletter] push failed: tenant=${tenantId} reason=${failureText(result.reason)}`);
    if (signal.aborted) return { attempted, resultWrite: "unconfirmed" };
    try {
        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: newsletterKey(tenantId, email),
            UpdateExpression: "SET #push = :push",
            ConditionExpression: "consent.#cid = :consentId AND #push.#attempt = :attempt",
            ExpressionAttributeNames: { "#push": "push", "#cid": "id", "#attempt": "attempt" },
            ExpressionAttributeValues: { ":push": attempted, ":consentId": consentId, ":attempt": attempt },
        }), { abortSignal: signal });
        return { attempted, resultWrite: "recorded" };
    } catch (error) {
        const reason = isConditionFailure(error) ? "superseded" : signal.aborted ? "deadline" : errorName(error);
        console.warn(`[newsletter] push result unconfirmed: tenant=${tenantId} reason=${reason}`);
        return { attempted, resultWrite: "unconfirmed" };
    }
}
