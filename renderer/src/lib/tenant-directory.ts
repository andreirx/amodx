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
//   `@amodx/shared` into the edge bundle for a question that needs one small query.
//   LANG-1B: the one shared piece the gate needs — the language READ rule — is imported from the built,
//   import-free module `@amodx/shared/dist/languages.js` only (docs/slices/lang-1.md § 7.1).
//
// WHY MIDDLEWARE NEEDS THIS AT ALL: a request for a host with no tenant record used to
// reach the render, which answered HTTP 200 with a "Site Not Found" shell — a soft 404,
// and (once cache-1 put the route in the ISR cache) a *cacheable* one. A route in ISR
// mode has no way to emit a non-cacheable response (measured; see
// docs/caching-architecture.md § "Which render outcomes are cacheable"), so the check
// has to happen before the render. Ratified 2026-07-26 (§Ratified resolutions D3).
import { DynamoDBClient, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { readLanguageSettings } from "@amodx/shared/dist/languages.js";

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

/**
 * LANG-1B (docs/slices/lang-1.md § 7.1) — what the gate knows about a host. Replaces `boolean | null`, now that a wired
 * verdict carries the tenant's extra languages (the middleware puts a listed language into the internal segment).
 *  - `unknown`: no table name, no static credentials, an empty host, or the read failed. Callers fail OPEN (render),
 *    except for language-shaped paths, which fail closed to the uncached twin (§ 7.1);
 *  - `unwired`: the read succeeded and found no `TENANT#` item for the host → the caller answers 404 no-store;
 *  - `wired`: a tenant item exists; `languages` = `readLanguageSettings` of its stored `languages` (the same read rule
 *    `mapTenant` applies, § 5.1), `[]` for a one-language tenant.
 * Abstraction line (§ 14): sum type — users: the middleware's booking branch (A3) and production branch — axis: none,
 * variants fixed (exhaustive `switch` at each site) — rejected: a second function reading the same cache entry (two
 * awaits, a boolean and a list that can disagree).
 */
export type HostVerdict = { kind: "unknown" } | { kind: "unwired" } | { kind: "wired"; languages: readonly string[] };

type CachedVerdict = { verdict: Exclude<HostVerdict, { kind: "unknown" }>; expires: number };

const cache = new Map<string, CachedVerdict>();

const UNKNOWN: HostVerdict = { kind: "unknown" };

/**
 * The plain (DocumentClient) form of one projected AttributeValue (docs/slices/lang-1.md § 5.1, the input boundary):
 * `S` → string, `L` → array (each element the same way), `M` → object; every other type (`N`, `BOOL`, `NULL`, `SS`, …)
 * → `null`. `readLanguageSettings` drops `null` exactly as it drops the number, boolean, null or `Set` that the
 * DocumentClient would give, so the gate and `mapTenant` reach the same language list for the same stored item.
 */
function plainOf(value: AttributeValue | undefined): unknown {
    if (value === undefined) return undefined;
    if (value.S !== undefined) return value.S;
    if (value.L !== undefined) return value.L.map(plainOf);
    if (value.M !== undefined) {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value.M)) out[key] = plainOf(inner);
        return out;
    }
    return null;
}

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
 * The host's verdict (see `HostVerdict`). `unwired` and `wired` are cached per instance for `TTL_MS`; `unknown` is never
 * cached, so the next request retries.
 *
 * **Callers must fail open on `unknown`.** This runs on every production-mode request; a DynamoDB blip must degrade to
 * "render it" (the old behaviour), never to "404 the whole estate".
 *
 * Same lookup `getTenantConfig()` performs — GSI_Domain, `Domain = <host>`, restricted to `TENANT#` items — with
 * `ProjectionExpression: "SK, #l"` (LANG-1B, in place of `Select: COUNT`): `SK` keeps a tenant without `languages` from
 * coming back as an empty item, `languages` is the only tenant data that crosses into the edge layer (public: a few
 * language subtags). The first item is the tenant, as in `getTenantConfig` (`Items[0]`).
 */
export async function hostVerdict(host: string): Promise<HostVerdict> {
    const table = process.env.TABLE_NAME;
    if (!table || !host) return UNKNOWN;

    const now = Date.now();
    const hit = cache.get(host);
    if (hit && hit.expires > now) return hit.verdict;

    const ddb = getClient();
    if (!ddb) return UNKNOWN;

    try {
        const res = await ddb.send(new QueryCommand({
            TableName: table,
            IndexName: "GSI_Domain",
            KeyConditionExpression: "#d = :d",
            FilterExpression: "begins_with(SK, :t)",
            ExpressionAttributeNames: { "#d": "Domain", "#l": "languages" },
            ExpressionAttributeValues: { ":d": { S: host }, ":t": { S: "TENANT#" } },
            ProjectionExpression: "SK, #l",
        }));
        const item = res.Items?.[0];
        const verdict: CachedVerdict["verdict"] = item === undefined
            ? { kind: "unwired" }
            : { kind: "wired", languages: readLanguageSettings({ languages: plainOf(item.languages) }).languages };
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(host, { verdict, expires: now + TTL_MS });
        return verdict;
    } catch (err) {
        console.error("[tenant-directory] host lookup failed, failing open:", err);
        return UNKNOWN;
    }
}
