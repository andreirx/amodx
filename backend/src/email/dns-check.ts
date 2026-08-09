import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { Resolver } from "node:dns/promises";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import {
    EMAIL_PROVIDER_RECIPES,
    deriveEmailDnsValue,
    type EmailDnsRecordType,
    type EmailDnsRecipeRecord,
    type EmailDnsMxRecord,
    type EmailDnsCheckRecordResult,
    type EmailDnsCheckResponse,
} from "@amodx/shared";
import { mapDnsResult } from "./dns-map.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * slice email-2 — READ-ONLY guided-DNS checker (docs/plan-email-onboarding.md §4.2,
 * D-EMAIL-4). POST /email/dns-check { provider }.
 *
 * WHAT IT DOES. For the tenant's domain and a chosen provider recipe, it resolves each
 * checkable expected record in PUBLIC DNS and returns per-record {expected, observed,
 * status, detail, observedTtl} plus the query timestamp. It writes NOTHING — to DNS or to
 * DynamoDB. The only DynamoDB access is a single Get of the tenant record to DERIVE the
 * domain server-side (never from the request body — the §4.3 cross-tenant-leak rule applied
 * here: a client cannot make us resolve an arbitrary domain).
 *
 * WHY A PUBLIC RESOLVER. We query 1.1.1.1 / 8.8.8.8 rather than the Lambda's local resolver
 * so the "public DNS" view is what an external mail receiver would see, and so a private
 * VPC resolver's negative cache does not masquerade as "not published". The read-once
 * ambiguity is still labelled by the mapper (`missing`/`error` are never verdicts).
 *
 * TTL: Node's resolver does not expose per-record TTL for MX/TXT/CNAME, so observedTtl is
 * null for these recipes; the verdict is bound to queriedAt + the ambiguity labelling.
 */

const RESOLVER_TIMEOUT_MS = 5000;
const RESOLVER_TRIES = 2;
const PUBLIC_RESOLVERS = ["1.1.1.1", "8.8.8.8"];

/** ENOTFOUND/ENODATA mean "no such record" → the `missing` case, NOT a lookup error. */
const NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA"]);

interface LookupOutcome {
    observed: string[];
    /** MX only: observed (exchange, priority) pairs, so priority can be compared. */
    observedMx?: EmailDnsMxRecord[];
    lookupError?: string;
}

async function lookupRecord(
    resolver: Resolver,
    type: EmailDnsRecordType,
    fqdn: string,
): Promise<LookupOutcome> {
    try {
        if (type === "MX") {
            const recs = await resolver.resolveMx(fqdn);
            // Keep BOTH the exchange (for value matching, case/trailing-dot normalised by the
            // mapper) and the priority (compared by the mapper — a wrong priority is a mismatch).
            return {
                observed: recs.map((r) => r.exchange),
                observedMx: recs.map((r) => ({ exchange: r.exchange, priority: r.priority })),
            };
        }
        if (type === "CNAME") {
            const recs = await resolver.resolveCname(fqdn);
            return { observed: recs };
        }
        // TXT: each record is an array of strings that must be concatenated into one value.
        const recs = await resolver.resolveTxt(fqdn);
        return { observed: recs.map((chunks) => chunks.join("")) };
    } catch (e: any) {
        const code: string = e?.code || "UNKNOWN";
        if (NO_RECORD_CODES.has(code)) {
            return { observed: [] }; // missing, not an error
        }
        return { observed: [], lookupError: code };
    }
}

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers["x-tenant-id"];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const auth = event.requestContext.authorizer.lambda;
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };
        let provider: string;
        try {
            provider = JSON.parse(event.body)?.provider;
        } catch {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
        }

        const recipe = EMAIL_PROVIDER_RECIPES.find((r) => r.id === provider);
        if (!recipe) return { statusCode: 400, body: JSON.stringify({ error: `Unknown provider: ${provider}` }) };

        // Derive the domain from the tenant record — NEVER from the request body.
        const tenantRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
        }));
        const domain: string | undefined = tenantRes.Item?.domain;
        if (!domain) return { statusCode: 404, body: JSON.stringify({ error: "Tenant has no configured domain" }) };

        const resolver = new Resolver({ timeout: RESOLVER_TIMEOUT_MS, tries: RESOLVER_TRIES });
        resolver.setServers(PUBLIC_RESOLVERS);

        // Only checkable records are queried; provider-generated rows (checkable:false) are
        // rendered by admin from the shared recipe but never get a false verdict here. The
        // ORIGINAL index into recipe.records is retained as the row's stable identity — a
        // recipe can hold several records with the same (type, host) (Zoho's three MX rows).
        const checkable = recipe.records
            .map((rec: EmailDnsRecipeRecord, recordIndex: number) => ({ rec, recordIndex }))
            .filter(({ rec }) => rec.checkable !== false);

        const results: EmailDnsCheckRecordResult[] = await Promise.all(
            checkable.map(async ({ rec, recordIndex }): Promise<EmailDnsCheckRecordResult> => {
                const fqdn = rec.host === "@" ? domain : `${rec.host}.${domain}`;
                // `expected` is server-authoritative: static value, or derived from the domain.
                const expected = rec.derive ? deriveEmailDnsValue(rec.derive, domain) : rec.value;
                const { observed, observedMx, lookupError } = await lookupRecord(resolver, rec.type, fqdn);
                const { status, detail } = mapDnsResult({
                    type: rec.type,
                    expected,
                    expectedPriority: rec.priority,
                    observed,
                    observedMx,
                    lookupError,
                });
                return {
                    recordIndex,
                    type: rec.type,
                    host: rec.host,
                    fqdn,
                    expected,
                    expectedPriority: rec.priority,
                    observed,
                    observedMx,
                    status,
                    detail,
                    observedTtl: null, // Node's resolver does not expose TTL for MX/TXT/CNAME
                };
            }),
        );

        const response: EmailDnsCheckResponse = {
            provider: recipe.id,
            domain,
            queriedAt: new Date().toISOString(),
            ambiguityNote:
                "Results reflect a single public-DNS read at the time shown. A missing or errored record is not a permanent verdict — it cannot be told apart from a record that is published but not yet propagated. Re-check after the record's TTL.",
            records: results,
        };

        return { statusCode: 200, body: JSON.stringify(response) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
