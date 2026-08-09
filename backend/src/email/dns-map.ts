import type { EmailDnsRecordType, EmailDnsCheckStatus, EmailDnsMxRecord } from "@amodx/shared";

/**
 * slice email-2 — the DNS-result MAPPER: (expected value, observed values, lookup outcome)
 * → a status + a human-readable detail. This is the tested core of the read-only checker.
 *
 * PURE by construction. It performs NO I/O — the DNS reads happen in `dns-check.ts` at the
 * edge and hand this function their raw results. That split is what lets the whole verdict
 * logic (including the propagation-ambiguity labelling) be unit-tested without a network,
 * an AWS account, or a live domain (`npm run test:unit`).
 *
 * The propagation-ambiguity rule (§4.2, D-EMAIL-4): a read that finds NOTHING, or a read
 * that ERRORED, must never be reported as a permanent verdict. "not published" and "not
 * yet propagated / negative-cached" are indistinguishable from a single read, and the
 * detail text for `missing`/`error` says so explicitly.
 */

/**
 * Normalise one RDATA value for comparison. DNS is case-insensitive for host names and
 * routinely returns exchange/CNAME targets with a trailing dot; TXT strings can arrive
 * split and padded. We compare on a canonical form so cosmetic differences are not
 * reported as mismatches, while genuine content differences still are.
 */
export function normalizeDnsValue(type: EmailDnsRecordType, value: string): string {
    const trimmed = value.trim();
    if (type === "TXT") {
        // TXT content is compared verbatim except for whitespace: collapse runs of internal
        // whitespace (a resolver may join multi-string TXT with spaces) and trim the ends.
        // SPF/DMARC tokens are case-sensitive in practice, so case is preserved.
        return trimmed.replace(/\s+/g, " ");
    }
    // MX exchange / CNAME target: host name → case-insensitive, trailing dot insignificant.
    return trimmed.replace(/\.$/, "").toLowerCase();
}

export interface MapDnsResultArgs {
    type: EmailDnsRecordType;
    expected: string;
    /** Expected MX preference (MX rows only). When set, the observed priority is also compared. */
    expectedPriority?: number;
    /** Raw observed RDATA values (already string-rendered by the caller). */
    observed: string[];
    /**
     * Observed MX (exchange, priority) pairs (MX rows only). Carried so a matching exchange
     * published with the WRONG priority is reported as a mismatch, not a false "match".
     */
    observedMx?: EmailDnsMxRecord[];
    /**
     * Present when the lookup itself failed for a reason OTHER than "no such record".
     * ENOTFOUND/ENODATA are NOT errors — they are the `missing` (empty observed) case.
     */
    lookupError?: string;
}

export interface MapDnsResult {
    status: EmailDnsCheckStatus;
    detail: string;
}

/** The re-used tail on every non-verdict status. Kept in one place so it cannot drift. */
const AMBIGUITY_TAIL =
    "A single read cannot tell “not published” apart from “published but not yet propagated” — re-check after the record’s TTL.";

export function mapDnsResult(args: MapDnsResultArgs): MapDnsResult {
    const { type, expected, expectedPriority, observed, observedMx, lookupError } = args;

    if (lookupError) {
        return {
            status: "error",
            detail: `DNS lookup failed (${lookupError}). This is not a verdict about the record. ${AMBIGUITY_TAIL}`,
        };
    }

    if (observed.length === 0) {
        return {
            status: "missing",
            detail: `No ${type} record found. ${AMBIGUITY_TAIL}`,
        };
    }

    const wantedNorm = normalizeDnsValue(type, expected);

    // MX with a known expected priority: the exchange AND the preference must both match.
    // A right exchange at the wrong priority changes mail-server ordering, so it is a
    // mismatch, never a "Published" verdict (reviewer finding, iteration 0).
    if (type === "MX" && expectedPriority !== undefined && observedMx) {
        const sameExchange = observedMx.filter(
            (m) => normalizeDnsValue("MX", m.exchange) === wantedNorm,
        );
        if (sameExchange.length === 0) {
            return {
                status: "mismatch",
                detail: `MX exchange ${expected} is not published. Observed: ${observed.join(", ")}.`,
            };
        }
        if (sameExchange.some((m) => m.priority === expectedPriority)) {
            return { status: "match", detail: `Expected MX record is published (priority ${expectedPriority}).` };
        }
        const observedPriorities = sameExchange.map((m) => m.priority).join(", ");
        return {
            status: "mismatch",
            detail: `MX exchange ${expected} is published but with priority ${observedPriorities}, expected ${expectedPriority}.`,
        };
    }

    const observedNorm = observed.map((o) => normalizeDnsValue(type, o));

    if (observedNorm.includes(wantedNorm)) {
        return { status: "match", detail: `Expected ${type} record is published.` };
    }

    return {
        status: "mismatch",
        detail: `${type} record(s) exist but none match the expected value. Observed: ${observed.join(", ")}.`,
    };
}
