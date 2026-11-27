// Email DNS onboarding: the guided-DNS provider recipes and the read-only DNS-check DTO (slice email-2).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

// =============================================================================
// Email DNS onboarding  (slice email-2 — guided DNS + read-only checker)
// docs/plan-email-onboarding.md §4.2, D-EMAIL-3 (neutral recipes), D-EMAIL-4 (read-only)
//
// WHY THIS LIVES IN packages/shared (recipe-data-location decision, D-EMAIL-3):
//   BOTH admin and backend consume this catalogue, which is the slice's own gate for
//   promotion to shared ("Lives in packages/shared ONLY IF both admin and backend
//   consume it"). Admin renders the recipe table + copy buttons + lastVerified. The
//   backend DNS-check handler consumes the SAME records to know what to look up and
//   what value to expect — so the "expected" side of every check is server-authoritative
//   and never asserted by the browser. Rejected alternative: keep recipes in admin and
//   have the client POST the records to a generic checker — smaller in the backend, but
//   it makes "expected" client-controlled and permits arbitrary-host lookups, defeating
//   the tenant-scoped, trustworthy-diagnostic property §4.2 requires.
//
// The record VALUES below are provider-documentation snapshots (INFERRED from public
// provider docs, NOT verified live) carrying a `lastVerified` date that the UI shows, so
// a stale recipe reads as a mismatch against observed DNS rather than as silent breakage.
//
// DELIBERATELY EXCLUDED: `_dmarc` records. DMARC presence/policy is the sending-side
// health surface owned by `email-3` (plan §4.3, F-EMAIL-4). Publishing a `p=none` DMARC
// value here is scope creep and can downgrade a tenant's existing DMARC policy — so these
// mailbox recipes carry MX/SPF/DKIM only.
// =============================================================================

/** RR types the guided-DNS recipes and the read-only checker support. */
export type EmailDnsRecordType = "MX" | "TXT" | "CNAME";

/**
 * A recipe value that is COMPUTED from the tenant's domain rather than published as a
 * static string. Sum type (variants fixed, one operation `deriveEmailDnsValue` over it):
 * adding a variant deliberately breaks the exhaustive switch below — that is the feature.
 *
 * - `m365-mx`: Microsoft 365's per-domain MX target is `<domain-with-dots-as-dashes>`
 *   `.mail.protection.outlook.com` — a deterministic transform of the domain, so it is
 *   knowable server-side and therefore CHECKABLE, unlike a console-generated DKIM key.
 */
export type EmailDnsDerivation = "m365-mx";

/**
 * Compute a derived recipe value for a tenant domain. Consumed on BOTH sides of the
 * boundary: the backend checker uses it as the server-authoritative `expected` value, and
 * admin uses it to render the same copyable target. Pure — no I/O, unit-testable.
 */
export function deriveEmailDnsValue(kind: EmailDnsDerivation, domain: string): string {
    switch (kind) {
        case "m365-mx":
            return `${domain.replace(/\./g, "-")}.mail.protection.outlook.com`;
        default: {
            // Exhaustiveness guard: a new EmailDnsDerivation variant must handle itself here.
            const _exhaustive: never = kind;
            throw new Error(`Unhandled EmailDnsDerivation: ${_exhaustive as string}`);
        }
    }
}

/** One publishable DNS record inside a provider recipe. */
export interface EmailDnsRecipeRecord {
    type: EmailDnsRecordType;
    /** Host label RELATIVE to the tenant domain. "@" = apex. e.g. "autodiscover", "selector1._domainkey". */
    host: string;
    /**
     * Static expected RDATA: MX exchange, or the full TXT/CNAME string. Empty ONLY when the
     * value is not statically known — i.e. `derive` is set (computed from the domain) or
     * `checkable === false` (generated in the provider console).
     */
    value: string;
    /** MX preference. MX rows only. Compared by the checker — a wrong priority is a mismatch. */
    priority?: number;
    /** Operator guidance shown next to the row (e.g. how a provider-generated value is derived). */
    note?: string;
    /**
     * When set, `value` is empty and the concrete expected value is COMPUTED from the tenant
     * domain via `deriveEmailDnsValue`. Such a row IS checkable (the value is knowable
     * server-side). Concrete user: the Microsoft 365 MX row.
     */
    derive?: EmailDnsDerivation;
    /**
     * false = the concrete value is generated per-tenant in the provider console (DKIM
     * selectors) and CANNOT be statically compared. Such rows are rendered with their setup
     * guidance but are NOT sent to the read-only checker — comparing them would emit a
     * permanent false "mismatch". Default (undefined) = true = checkable (possibly via `derive`).
     */
    checkable?: boolean;
}

/** A mailbox provider's full record set (D-EMAIL-3: neutral, provider-agnostic). */
export interface EmailProviderRecipe {
    id: string;
    label: string;
    /** ISO YYYY-MM-DD snapshot date, shown in the UI so a stale recipe is visible as stale. */
    lastVerified: string;
    /** true when publishing this recipe's MX repoints the domain's mail delivery domain-wide. */
    replacesMailRouting: boolean;
    docsUrl?: string;
    records: EmailDnsRecipeRecord[];
}

/**
 * Neutral provider recipes. "keep-existing" is the no-op recipe for a tenant staying on
 * their current cPanel/host mail — it publishes nothing and carries no destructive warning.
 */
export const EMAIL_PROVIDER_RECIPES: readonly EmailProviderRecipe[] = [
    {
        id: "google-workspace",
        label: "Google Workspace",
        lastVerified: "2026-08-01",
        replacesMailRouting: true,
        docsUrl: "https://support.google.com/a/answer/140034",
        records: [
            { type: "MX", host: "@", value: "smtp.google.com", priority: 1 },
            { type: "TXT", host: "@", value: "v=spf1 include:_spf.google.com ~all" },
            {
                type: "TXT", host: "google._domainkey", value: "", checkable: false,
                note: "DKIM key is generated in Google Admin console (Apps → Gmail → Authenticate email). Publish the exact value it gives you.",
            },
        ],
    },
    {
        id: "microsoft-365",
        label: "Microsoft 365",
        lastVerified: "2026-08-01",
        replacesMailRouting: true,
        docsUrl: "https://learn.microsoft.com/microsoft-365/admin/get-help-with-domains/create-dns-records-at-any-dns-hosting-provider",
        records: [
            {
                type: "MX", host: "@", value: "", priority: 0, derive: "m365-mx",
                note: "M365 MX target is derived from your domain: <your-domain-with-dots-as-dashes>.mail.protection.outlook.com. Confirm it matches the Microsoft 365 admin center before publishing.",
            },
            { type: "TXT", host: "@", value: "v=spf1 include:spf.protection.outlook.com -all" },
            { type: "CNAME", host: "autodiscover", value: "autodiscover.outlook.com" },
            {
                type: "CNAME", host: "selector1._domainkey", value: "", checkable: false,
                note: "M365 DKIM selector 1 — enable DKIM in the Microsoft 365 Defender portal (Email & collaboration → Policies & rules → Threat policies → DKIM). It generates a CNAME target of the form selector1-<domain-with-dashes>._domainkey.<your-tenant>.onmicrosoft.com. Publish the exact value it shows.",
            },
            {
                type: "CNAME", host: "selector2._domainkey", value: "", checkable: false,
                note: "M365 DKIM selector 2 — the second CNAME from the same DKIM setup screen.",
            },
        ],
    },
    {
        id: "zoho-mail",
        label: "Zoho Mail",
        lastVerified: "2026-08-01",
        replacesMailRouting: true,
        docsUrl: "https://www.zoho.com/mail/help/adminconsole/configure-email-delivery.html",
        records: [
            { type: "MX", host: "@", value: "mx.zoho.com", priority: 10 },
            { type: "MX", host: "@", value: "mx2.zoho.com", priority: 20 },
            { type: "MX", host: "@", value: "mx3.zoho.com", priority: 50 },
            { type: "TXT", host: "@", value: "v=spf1 include:zoho.com ~all" },
            {
                type: "TXT", host: "zmail._domainkey", value: "", checkable: false,
                note: "DKIM key is generated in the Zoho Mail admin console. Publish the exact value it gives you.",
            },
        ],
    },
    {
        id: "keep-existing",
        label: "Keep my existing cPanel / host mail",
        lastVerified: "2026-08-01",
        replacesMailRouting: false,
        records: [],
    },
];

// ----- DNS-check DTO (crosses the admin <-> backend boundary; raw JSON, no framework types) -----

/**
 * match    — an observed record equals the expected value.
 * mismatch — records of this type exist but none match (something else is published).
 * missing  — NO record of this type found. AMBIGUOUS: indistinguishable from "published but
 *            not yet propagated" / a negative-cache TTL. Never a permanent verdict.
 * error    — the lookup itself failed (timeout/SERVFAIL). Also NOT a verdict about the record.
 */
export type EmailDnsCheckStatus = "match" | "mismatch" | "missing" | "error";

/** One observed MX record: exchange + preference. Carried so a wrong priority is visible. */
export interface EmailDnsMxRecord {
    exchange: string;
    priority: number;
}

/** Per-record result of one read-only DNS check. */
export interface EmailDnsCheckRecordResult {
    /**
     * Index of this result's row in the recipe's `records` array. The stable, collision-free
     * identity admin uses to attach a verdict to a row — REQUIRED because a recipe can carry
     * several records with the same (type, host) (e.g. Zoho's three `MX @` rows), which a
     * `type|host` key would collapse.
     */
    recordIndex: number;
    type: EmailDnsRecordType;
    host: string;
    /** The fully-qualified name actually queried (host expanded against the tenant domain). */
    fqdn: string;
    /** Server-authoritative expected value (static, or derived from the domain for `derive` rows). */
    expected: string;
    /** Expected MX preference (MX rows only). Compared against the observed priority. */
    expectedPriority?: number;
    /** Raw observed RDATA values at query time (MX exchanges, or full TXT/CNAME strings). */
    observed: string[];
    /** Observed MX (exchange, priority) pairs at query time (MX rows only). */
    observedMx?: EmailDnsMxRecord[];
    status: EmailDnsCheckStatus;
    /** Human-readable explanation; for `missing`/`error` it states the propagation ambiguity. */
    detail: string;
    /**
     * Observed record TTL in seconds when the resolver exposes it. Node's resolver does NOT
     * return TTL for MX/TXT/CNAME, so this is null for the email recipes; the verdict is
     * instead bound to `queriedAt` and the `missing`/`error` ambiguity labelling. The UI
     * renders this null explicitly as the resolver limitation, never hides it.
     */
    observedTtl: number | null;
}

/** Response body of POST /email/dns-check. Only `checkable` records appear here. */
export interface EmailDnsCheckResponse {
    provider: string;
    domain: string;
    /** ISO timestamp the checks ran; every verdict is bound to this instant, never permanent. */
    queriedAt: string;
    /** Global statement of the read-once ambiguity, shown once above the result list. */
    ambiguityNote: string;
    records: EmailDnsCheckRecordResult[];
}
