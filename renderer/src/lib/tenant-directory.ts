// Host → "is this a wired tenant?" lookup for `middleware.ts` (slice cache-1, D3).
//
// WHY THIS EXISTS SEPARATELY FROM `lib/dynamo.ts` — do not "de-duplicate" the two:
//
//   `lib/dynamo.ts` runs in the Node server runtime, where the AWS SDK's default
//   credential provider chain resolves the Lambda's role credentials from the
//   environment. Middleware runs in Next's **edge runtime**, which bundles the SDK's
//   browser build: `process.env` is fully readable there (measured — 143 keys under
//   `next start`), but the default provider chain is absent and every call fails with
//   `Error: Credential is missing` (measured 2026-07-26 against this repo's next@16.2.9).
//   Credentials therefore have to be handed to the client explicitly. Importing
//   `lib/dynamo.ts` here would also pull the whole renderer data layer and
//   `@amodx/shared` into the edge bundle for a question that needs one COUNT query.
//
// WHY MIDDLEWARE NEEDS THIS AT ALL: a request for a host with no tenant record used to
// reach the render, which answered HTTP 200 with a "Site Not Found" shell — a soft 404,
// and (once cache-1 put the route in the ISR cache) a *cacheable* one. A route in ISR
// mode has no way to emit a non-cacheable response (measured; see
// docs/caching-architecture.md § "Which render outcomes are cacheable"), so the check
// has to happen before the render. Ratified 2026-07-26 (§Ratified resolutions D3).
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";

/**
 * How long a host verdict is trusted, positive or negative.
 *
 * Builder's local choice (the ratification left it open, "~60s order"). 60s bounds two
 * opposite errors symmetrically: a newly wired domain 404s for at most a minute, and a
 * removed tenant keeps serving for at most a minute. Per-instance, so a cold Lambda
 * always re-reads.
 */
const TTL_MS = 60_000;

/**
 * Hard bound on cache size. Keys come from the `Host` header, which is
 * attacker-controlled, so an unbounded map is a memory-exhaustion vector. ≤99 real
 * tenants, so anything above this is junk: drop everything and re-learn.
 */
const MAX_ENTRIES = 512;

type Verdict = { wired: boolean; expires: number };

const cache = new Map<string, Verdict>();

let client: DynamoDBClient | null = null;

function getClient(): DynamoDBClient | null {
    if (client) return client;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    // No static credentials in the environment (local `next dev`, or a deployment that
    // relies on a provider the edge build cannot use) — the caller fails open.
    if (!accessKeyId || !secretAccessKey) return null;

    client = new DynamoDBClient({
        region: process.env.AWS_REGION || "eu-central-1",
        // The edge build does not read AWS_ENDPOINT_URL_DYNAMODB by itself; passing it
        // keeps the documented local-stub reproduction recipe working for middleware too
        // (docs/caching-architecture.md § "Measured serving behaviour").
        endpoint: process.env.AWS_ENDPOINT_URL_DYNAMODB || undefined,
        credentials: {
            accessKeyId,
            secretAccessKey,
            sessionToken: process.env.AWS_SESSION_TOKEN,
        },
    });
    return client;
}

/**
 * `true` = a tenant record exists for this host, `false` = none, `null` = unknown
 * (not configured, or the lookup failed).
 *
 * **Callers must fail open on `null`.** This runs on every production-mode request; a
 * DynamoDB blip must degrade to "render it" (the old behaviour), never to "404 the
 * whole estate".
 *
 * Same lookup `getTenantConfig()` performs — GSI_Domain, `Domain = <host>`, restricted
 * to `TENANT#` items — but `Select: COUNT`, so nothing is unmarshalled and no tenant
 * data crosses into the edge layer.
 */
export async function isWiredTenantHost(host: string): Promise<boolean | null> {
    const table = process.env.TABLE_NAME;
    if (!table || !host) return null;

    const now = Date.now();
    const hit = cache.get(host);
    if (hit && hit.expires > now) return hit.wired;

    const ddb = getClient();
    if (!ddb) return null;

    try {
        const res = await ddb.send(new QueryCommand({
            TableName: table,
            IndexName: "GSI_Domain",
            KeyConditionExpression: "#d = :d",
            FilterExpression: "begins_with(SK, :t)",
            ExpressionAttributeNames: { "#d": "Domain" },
            ExpressionAttributeValues: { ":d": { S: host }, ":t": { S: "TENANT#" } },
            Select: "COUNT",
        }));
        const wired = (res.Count ?? 0) > 0;
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(host, { wired, expires: now + TTL_MS });
        return wired;
    } catch (err) {
        console.error("[tenant-directory] host lookup failed, failing open:", err);
        return null;
    }
}
