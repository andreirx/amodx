// In-process DynamoDB stub for the serving-contract suite (slice test-2).
//
// WHAT IT IS: an HTTP server that speaks enough of the DynamoDB JSON-1.0 wire protocol to
// answer the reads `renderer/src/lib/dynamo.ts`, `renderer/src/lib/tenant-directory.ts` and
// `renderer/src/app/api/posts/route.ts` actually perform against the fixture dataset. The
// renderer reaches it because the AWS SDK v3 honours `AWS_ENDPOINT_URL_DYNAMODB`
// (docs/caching-architecture.md § "Measured serving behaviour" documents this recipe).
//
// WHAT IT IS NOT: a DynamoDB emulator. It supports one index (`GSI_Domain`), exact-key
// GetItem, and the two KeyConditionExpression shapes the renderer emits. Anything else is
// answered with a *loud error* and recorded in `unhandled()` — never with an empty result.
// That is deliberate and mirrors human decision CACHE-1-D4: a stub that invented absence
// would let the suite pass while the renderer read nothing, which is exactly the class of
// defect this suite exists to catch.
//
// CONTROL SURFACE: plain methods on the returned handle — `stats()`, `reset()`,
// `failContentReads(bool)`, `putItem(item)`. The cache-1 probe harness exposed the equivalent over HTTP
// (`/__ctl/fail-content-on`) because its probes were separate shell scripts; here the stub
// and the assertions share one process, so an HTTP control plane would be a second
// mechanism for data already in scope — and a surface the renderer could theoretically
// reach. `failContentReads(true)` is the CACHE-1-D4 case: tenant resolution keeps working,
// every *later* read fails (docs/caching-architecture.md § "Probe: a read that fails AFTER
// tenant resolution"). `putItem(item)` (opennext-1a increment 2, rows B-TAG / B-LISTING) is an
// admin edit: it replaces the item with the same PK+SK (or adds it) in THIS stub's copy of the
// fixture dataset — the shared `ITEMS` array is never mutated, so another stub instance (the
// contract describe's) is unaffected.
//
// TAG TABLE (slice opennext-1a, bundle target only). The OpenNext server bundle has a second
// DynamoDB client: the tag cache (open-next 3.1.3 `cache/tag/dynamodb.js`), on the table named by
// `CACHE_DYNAMO_TABLE`. When `startDdbStub({ tagTable })` names it, this one stub serves both
// tables and dispatches on `TableName`. Tag-table shapes, exactly as that file emits them:
//   Query  IndexName "revalidate", `path = :key`                        (getByPath)
//   Query  IndexName "revalidate", `path = :key AND revalidatedAt > :lm` (getLastModified)
//   Query  no index,               `tag = :tag`                          (getByTag)
//   BatchWriteItem  PutRequest items `{ path, tag, revalidatedAt }`      (writeTags)
// Tag-table calls are counted in `tagCache`, NOT in `render`: `render` means "the renderer's own
// read layer ran", which is what rows (a1)/(a2)/(h1) measure, and the adapter consults the tag
// table on every cache read, HIT included. Fault injection stays on the renderer's table only —
// CACHE-1-D4 is about the renderer's content reads, not the adapter's tag bookkeeping.
import { createServer } from "node:http";
import { ITEMS, TABLE_NAME } from "./fixtures.mjs";

const DOMAIN_INDEX = "GSI_Domain";
/** The tag table's only GSI, as open-next 3.1.3 queries it (`cache/tag/dynamodb.js`). */
const TAG_PATH_INDEX = "revalidate";

// ── AttributeValue codec ────────────────────────────────────────────────────────────────
// Hand-rolled rather than imported from `@aws-sdk/util-dynamodb`: that package is a
// transitive dependency of `@aws-sdk/lib-dynamodb`, not a declared one of `renderer`, and
// the suite adds no dependencies. The fixture dataset uses only these six types.

function marshall(v) {
    if (v === null) return { NULL: true };
    if (typeof v === "string") return { S: v };
    if (typeof v === "number") return { N: String(v) };
    if (typeof v === "boolean") return { BOOL: v };
    if (Array.isArray(v)) return { L: v.map(marshall) };
    if (typeof v === "object") return { M: marshallItem(v) };
    throw new Error(`ddb-stub: cannot marshall ${typeof v}`);
}

function marshallItem(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) out[k] = marshall(v);
    }
    return out;
}

function unmarshall(av) {
    if (!av || typeof av !== "object") throw new Error("ddb-stub: not an AttributeValue");
    if ("S" in av) return av.S;
    if ("N" in av) return Number(av.N);
    if ("BOOL" in av) return av.BOOL;
    if ("NULL" in av) return null;
    if ("L" in av) return av.L.map(unmarshall);
    if ("M" in av) return unmarshallItem(av.M);
    throw new Error(`ddb-stub: unsupported AttributeValue ${Object.keys(av).join(",")}`);
}

function unmarshallItem(m) {
    return Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, unmarshall(v)]));
}

// ── Expression handling ─────────────────────────────────────────────────────────────────

/** Substitutes `#alias` placeholders so the rest of the parser sees real attribute names. */
function resolveNames(expr, names) {
    return (expr || "").replace(/#\w+/g, (m) => (names && names[m] ? names[m] : m));
}

/**
 * Parses the KeyConditionExpression shapes the renderer and the OpenNext tag cache emit:
 *   `#d = :d`                              (GSI_Domain lookups; tag-cache getByPath/getByTag)
 *   `PK = :pk AND begins_with(SK, :sk)`    (main-table adjacency reads)
 *   `path = :key AND revalidatedAt > :lm`  (tag-cache getLastModified, bundle target only)
 * Returns null for anything else so the caller can fail loudly.
 */
function parseKeyCondition(expr, names) {
    const resolved = resolveNames(expr, names).trim();
    const m = resolved.match(
        /^(\w+)\s*=\s*(:\w+)(?:\s+AND\s+(?:begins_with\(\s*(\w+)\s*,\s*(:\w+)\s*\)|(\w+)\s*>\s*(:\w+)))?$/i,
    );
    if (!m) return null;
    return { hashAttr: m[1], hashVal: m[2], rangeAttr: m[3], rangePrefix: m[4], gtAttr: m[5], gtVal: m[6] };
}

/**
 * Evaluates the FilterExpression clauses the current fixtures actually exercise:
 * `begins_with(a, :v)` (the `TENANT#` guard on GSI_Domain lookups) and `a = :v`
 * (`/api/posts`' published-status filter), joined by `AND`.
 *
 * Anything else throws, on purpose. `contains(tags, :tag)` — `getPosts()`' tag filter — is
 * deliberately NOT implemented: no fixture reaches it today, and a clause silently
 * evaluating to "no match" is the fabricated-absence failure mode this whole suite exists
 * to catch. Add the clause when a test needs it; the error message names the clause.
 */
function passesFilter(item, expr, names, values) {
    if (!expr) return true;
    const resolved = resolveNames(expr, names).trim();
    return resolved.split(/\s+AND\s+/i).every((clause) => {
        let m = clause.match(/^begins_with\(\s*(\w+)\s*,\s*(:\w+)\s*\)$/i);
        if (m) return String(item[m[1]] ?? "").startsWith(values[m[2]]);
        m = clause.match(/^(\w+)\s*=\s*(:\w+)$/);
        if (m) return item[m[1]] === values[m[2]];
        throw new Error(`ddb-stub: unsupported FilterExpression clause "${clause}"`);
    });
}

// ── Server ──────────────────────────────────────────────────────────────────────────────

/**
 * Starts the stub on an ephemeral port.
 * @param {{ tagTable?: string }} [options]  `tagTable`: the OpenNext tag-cache table name
 *        (`CACHE_DYNAMO_TABLE`) to serve as well. Omitted on the `next` target, where no
 *        adapter runs — a call naming it there would be unhandled, as any unknown table is.
 * @returns {Promise<{url:string, stats:Function, journal:Function, tagItems:Function,
 *          reset:Function, failContentReads:Function, putItem:Function, close:Function}>}
 */
export async function startDdbStub({ tagTable } = {}) {
    // `tagCache` stays 0 on the `next` target (no tag table is served there).
    const counters = { total: 0, hostGate: 0, render: 0, tagCache: 0 };
    const unhandled = [];
    /** Every request, in order: `{ table: "renderer"|"tag"|<name>, op, index }`. */
    const journal = [];
    /** Tag-table rows written by `BatchWriteItem`, unmarshalled: `{ path, tag, revalidatedAt }`. */
    const tagItems = [];
    let failContent = false;
    /** This stub's copy of the fixture dataset; `putItem` edits it. */
    const items = ITEMS.map((i) => structuredClone(i));

    const server = createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            const target = (req.headers["x-amz-target"] || "").split(".").pop();
            let parsed;
            try {
                parsed = JSON.parse(body || "{}");
            } catch {
                return amzError(res, 400, "ValidationException", "unparseable body");
            }

            counters.total += 1;
            // BatchWriteItem names its table(s) as the keys of `RequestItems`, not in `TableName`.
            const tableName =
                parsed.TableName ?? (parsed.RequestItems ? Object.keys(parsed.RequestItems).join(",") : undefined);
            const table = tableName === TABLE_NAME ? "renderer" : tagTable && tableName === tagTable ? "tag" : tableName;
            journal.push({ table, op: target, index: parsed.IndexName });

            if (table === "tag") {
                counters.tagCache += 1;
                try {
                    if (target === "Query") return queryTags(res, parsed);
                    if (target === "BatchWriteItem") return writeTags(res, parsed);
                } catch (e) {
                    unhandled.push(`tag table ${target}: ${e.message}`);
                    return amzError(res, 400, "ValidationException", e.message);
                }
                unhandled.push(`unsupported tag-table operation ${target}`);
                return amzError(res, 400, "ValidationException", `ddb-stub does not implement ${target} on the tag table`);
            }

            // The middleware host gate is the one read that uses `Select: COUNT`
            // (lib/tenant-directory.ts). Counting it separately is what lets the
            // "zero reads on HIT" assertion distinguish "no SSR ran" from "no I/O at all".
            const isHostGate = parsed.Select === "COUNT" && parsed.IndexName === DOMAIN_INDEX;
            if (isHostGate) counters.hostGate += 1;
            else counters.render += 1;

            if (table !== "renderer") {
                unhandled.push(`TableName=${tableName}`);
                return amzError(res, 400, "ResourceNotFoundException", `no such table ${tableName}`);
            }

            // CACHE-1-D4 fault injection: the tenant lookup stays healthy, everything
            // downstream of it fails. `ValidationException` (HTTP 400) is used rather than
            // a 5xx because it is non-retryable — the property under test is that the error
            // PROPAGATES out of the read helper, not the SDK's retry policy.
            const isTenantResolution =
                parsed.IndexName === DOMAIN_INDEX ||
                (target === "GetItem" && unmarshallItem(parsed.Key).SK?.startsWith?.("TENANT#"));
            if (failContent && !isTenantResolution) {
                return amzError(res, 400, "ValidationException", "injected post-tenant read failure");
            }

            try {
                if (target === "GetItem") return getItem(res, parsed);
                if (target === "Query") return query(res, parsed);
            } catch (e) {
                unhandled.push(`${target}: ${e.message}`);
                return amzError(res, 400, "ValidationException", e.message);
            }

            unhandled.push(`unsupported operation ${target}`);
            return amzError(res, 400, "ValidationException", `ddb-stub does not implement ${target}`);
        });
    });

    function getItem(res, parsed) {
        const key = unmarshallItem(parsed.Key);
        const item = items.find((i) => i.PK === key.PK && i.SK === key.SK);
        return json(res, item ? { Item: marshallItem(item) } : {});
    }

    function query(res, parsed) {
        const names = parsed.ExpressionAttributeNames;
        const values = Object.fromEntries(
            Object.entries(parsed.ExpressionAttributeValues || {}).map(([k, v]) => [k, unmarshall(v)]),
        );
        const cond = parseKeyCondition(parsed.KeyConditionExpression, names);
        if (!cond || cond.gtAttr) throw new Error(`unsupported KeyConditionExpression "${parsed.KeyConditionExpression}"`);
        if (parsed.IndexName && parsed.IndexName !== DOMAIN_INDEX) {
            throw new Error(`unsupported index ${parsed.IndexName}`);
        }

        let found = items.filter((i) => i[cond.hashAttr] === values[cond.hashVal]);
        if (cond.rangeAttr) {
            found = found.filter((i) => String(i[cond.rangeAttr] ?? "").startsWith(values[cond.rangePrefix]));
        }
        found = found.filter((i) => passesFilter(i, parsed.FilterExpression, names, values));
        if (parsed.Limit) found = found.slice(0, parsed.Limit);

        // `Select: COUNT` must not return Items — lib/tenant-directory.ts reads `res.Count`
        // precisely so no tenant data crosses into the edge layer.
        if (parsed.Select === "COUNT") return json(res, { Count: found.length, ScannedCount: found.length });
        // ProjectionExpression is deliberately ignored: returning extra attributes cannot
        // change any assertion here, and honouring it would add a parser with no caller.
        return json(res, { Items: found.map(marshallItem), Count: found.length, ScannedCount: found.length });
    }

    /** The three tag-cache Query shapes (file header). Anything else throws → unhandled. */
    function queryTags(res, parsed) {
        const names = parsed.ExpressionAttributeNames;
        const values = Object.fromEntries(
            Object.entries(parsed.ExpressionAttributeValues || {}).map(([k, v]) => [k, unmarshall(v)]),
        );
        const cond = parseKeyCondition(parsed.KeyConditionExpression, names);
        const byPath = parsed.IndexName === TAG_PATH_INDEX && cond?.hashAttr === "path" && !cond.rangeAttr;
        const byTag = parsed.IndexName === undefined && cond?.hashAttr === "tag" && !cond.rangeAttr && !cond.gtAttr;
        if (!byPath && !byTag) {
            throw new Error(`unsupported shape index=${parsed.IndexName} "${parsed.KeyConditionExpression}"`);
        }
        if (cond.gtAttr && cond.gtAttr !== "revalidatedAt") throw new Error(`unsupported range attribute ${cond.gtAttr}`);
        if (parsed.FilterExpression) throw new Error(`unsupported FilterExpression "${parsed.FilterExpression}"`);
        let items = tagItems.filter((i) => i[cond.hashAttr] === values[cond.hashVal]);
        if (cond.gtAttr) items = items.filter((i) => i.revalidatedAt > values[cond.gtVal]);
        return json(res, { Items: items.map(marshallItem), Count: items.length, ScannedCount: items.length });
    }

    /** BatchWriteItem of PutRequests on the tag table. A put replaces the row with the same key
     *  (`tag` + `path`, the table's hash + range key in infra/lib/renderer-hosting.ts). */
    function writeTags(res, parsed) {
        const requests = parsed.RequestItems[tagTable];
        if (Object.keys(parsed.RequestItems).length !== 1 || !Array.isArray(requests)) {
            throw new Error(`BatchWriteItem must target only ${tagTable}`);
        }
        for (const r of requests) {
            if (!r.PutRequest) throw new Error(`unsupported write request ${Object.keys(r).join(",")}`);
            const item = unmarshallItem(r.PutRequest.Item);
            const at = tagItems.findIndex((i) => i.tag === item.tag && i.path === item.path);
            if (at >= 0) tagItems.splice(at, 1);
            tagItems.push(item);
        }
        return json(res, { UnprocessedItems: {} });
    }

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    return {
        url: `http://127.0.0.1:${server.address().port}`,
        stats: () => ({ ...counters, unhandled: [...unhandled] }),
        /** Every request since start (not cleared by `reset()`): the operation inventory. */
        journal: () => journal.map((e) => ({ ...e })),
        tagItems: () => tagItems.map((i) => ({ ...i })),
        reset: () => {
            counters.total = counters.hostGate = counters.render = counters.tagCache = 0;
        },
        /** CACHE-1-D4 fault injection. See the file header. */
        failContentReads: (on) => {
            failContent = on;
        },
        /** An admin edit (file header): replace-or-add by PK+SK in this stub's dataset. */
        putItem: (item) => {
            const at = items.findIndex((i) => i.PK === item.PK && i.SK === item.SK);
            if (at >= 0) items.splice(at, 1);
            items.push(structuredClone(item));
        },
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

function json(res, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(200, { "content-type": "application/x-amz-json-1.0", "content-length": Buffer.byteLength(body) });
    res.end(body);
}

function amzError(res, status, type, message) {
    const body = JSON.stringify({ __type: `com.amazonaws.dynamodb.v20120810#${type}`, message });
    res.writeHead(status, {
        "content-type": "application/x-amz-json-1.0",
        "x-amzn-errortype": type,
        "content-length": Buffer.byteLength(body),
    });
    res.end(body);
}
