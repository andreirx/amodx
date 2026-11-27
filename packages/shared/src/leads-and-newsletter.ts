// Leads and the newsletter subscription stored beside a lead (NEWSLETTER-1).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

// --- CRM / LEADS ---
// People who gave us an email but don't have a login
export const LeadSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    email: z.string().email(),
    name: z.string().optional(),
    source: z.string().optional(), // e.g. "Footer Form", "Hero CTA"
    status: z.enum(["New", "Contacted", "Converted", "Archived"]).default("New"),
    data: z.record(z.string(), z.any()).optional(), // Custom form fields
    createdAt: z.string(),
});
export type Lead = z.infer<typeof LeadSchema>;

// --- NEWSLETTER SUBSCRIPTION (NEWSLETTER-1, docs/slices/newsletter-1.md) ---
// Stored as the item `NEWSLETTER#<normalized email>` (`normalizeEmail`) in the tenant partition, beside the lead (ruling
// NL1-CONSENT-STORAGE = A). A separate item because three writers replaced the whole lead item (`leads/create.ts` lead
// magnet, `contact/send.ts`, `comments/create.ts`): consent stored on the lead would be erased by the next download,
// message or comment (since LEAD-NORMALIZE-1 they never change a stored lead value; the separate item stays). A signup
// writes it in one transaction with the lead (the lead only when absent); a lead deletion
// removes both in one transaction. GET /leads gives each lead its subscription as `newsletter`. The renderer never reads it.

/**
 * The consent the visitor gave (ruling 3): when, in which locale, and the exact line shown next to the box. The text is
 * stored itself, not a version id: the tenant can edit the line (Labels page), and no store of past texts exists, so
 * only the text itself stays true for ever. The backend stores it only when it equals the line the tenant's locale table
 * gives at that moment (the same `newsletterTexts` the page used) — the text the visitor saw.
 */
export const NewsletterConsentSchema = z.object({
    // A new random id per stored consent, never reused (NL1-R2): every later write of the subscription is conditional on
    // the id it read, so a delayed request can never replace a consent it did not see, and a push result can never land
    // on a newer consent. `at` is evidence only, never a fence (two signups can share a millisecond).
    id: z.string().min(1),
    at: z.string(),       // ISO time the backend received the signup
    locale: z.string(),   // the tenant's normalised locale that selected the text
    text: z.string().min(1),
});
export type NewsletterConsent = z.infer<typeof NewsletterConsentSchema>;

/** Why a push failed: the MailerLite answer's HTTP status, or no answer (timeout after the bound, or no connection). */
export const NewsletterPushFailureSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("http"), status: z.number().int() }),
    z.object({ kind: z.literal("timeout") }),
    z.object({ kind: z.literal("network") }),
]);
export type NewsletterPushFailure = z.infer<typeof NewsletterPushFailureSchema>;

/**
 * Where the subscriber is on its way to MailerLite (ruling 4). `NoSettings`: the site had no MailerLite connection when
 * the state was written — nothing was sent. `Pending`: written before the call (with the signup, or by "Send again");
 * no result of that attempt is stored (yet). Whether a dispatched result write committed is not always known to the
 * request that sent it (NL1-WRITE-ACK-UNCERTAINTY = A): the STORED state is the only truth, and "Send again" is offered
 * for `Pending` and `Failed` (an upsert, harmless if MailerLite already holds the subscriber).
 * `Sent`: MailerLite answered 200 or 201. `Failed`: any other answer, or none. `attempt` (NL1-R2): the random id of the
 * push attempt that wrote the state; a result is recorded only while the stored state still names its own attempt, so a
 * concurrent "Send again" or a later signup supersedes it instead of being overwritten.
 */
export const NewsletterPushSchema = z.discriminatedUnion("state", [
    z.object({ state: z.literal("NoSettings") }),
    z.object({ state: z.literal("Pending"), attempt: z.string().min(1) }),
    z.object({ state: z.literal("Sent"), at: z.string(), attempt: z.string().min(1) }),
    z.object({ state: z.literal("Failed"), at: z.string(), reason: NewsletterPushFailureSchema, attempt: z.string().min(1) }),
]);
export type NewsletterPush = z.infer<typeof NewsletterPushSchema>;

export const NewsletterSubscriptionSchema = z.object({
    consent: NewsletterConsentSchema,
    push: NewsletterPushSchema,
});
export type NewsletterSubscription = z.infer<typeof NewsletterSubscriptionSchema>;

/**
 * Whether the admin "Send again" (POST /leads/{email}/push) may send a subscription in this state. Not `Sent`: sending
 * again could reverse an unsubscribe the person made in MailerLite since. Exhaustive: a new state must decide here.
 * Users: the backend handler (`leads/push.ts`) and the admin Leads page (whether the button shows).
 */
export function newsletterCanSendAgain(push: NewsletterPush): boolean {
    switch (push.state) {
        case "NoSettings":
        case "Pending":
        case "Failed":
            return true;
        case "Sent":
            return false;
        default: {
            const unreachable: never = push;
            return unreachable;
        }
    }
}
