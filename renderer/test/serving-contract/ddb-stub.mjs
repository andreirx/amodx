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
// `failContentReads(bool)`. The cache-1 probe harness exposed the equivalent over HTTP
// (`/__ctl/fail-content-on`) because its probes were separate shell scripts; here the stub
// and the assertions share one process, so an HTTP control plane would be a second
// mechanism for data already in scope — and a surface the renderer could theoretically
// reach. `failContentReads(true)` is the CACHE-1-D4 case: tenant resolution keeps working,
// every *later* read fails (docs/caching-architecture.md § "Probe: a read that fails AFTER
// tenant resolution").
import { createServer } from "node:http";
import { ITEMS, TABLE_NAME } from "./fixtures.mjs";

const DOMAIN_INDEX = "GSI_Domain";

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
 * Parses the two KeyConditionExpression shapes the renderer emits:
 *   `#d = :d`                              (GSI_Domain lookups)
 *   `PK = :pk AND begins_with(SK, :sk)`    (main-table adjacency reads)
 * Returns null for anything else so the caller can fail loudly.
 */
function parseKeyCondition(expr, names) {
    const resolved = resolveNames(expr, names).trim();
    const m = resolved.match(
        /^(\w+)\s*=\s*(:\w+)(?:\s+AND\s+begins_with\(\s*(\w+)\s*,\s*(:\w+)\s*\))?$/i,
    );
    if (!m) return null;
    return { hashAttr: m[1], hashVal: m[2], rangeAttr: m[3], rangePrefix: m[4] };
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
 * @returns {Promise<{url:string, stats:Function, reset:Function, failContentReads:Function, close:Function}>}
 */
export async function startDdbStub() {
    const counters = { total: 0, hostGate: 0, render: 0 };
    const unhandled = [];
    let failContent = false;

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

            // The middleware host gate is the one read that uses `Select: COUNT`
            // (lib/tenant-directory.ts). Counting it separately is what lets the
            // "zero reads on HIT" assertion distinguish "no SSR ran" from "no I/O at all".
            const isHostGate = parsed.Select === "COUNT" && parsed.IndexName === DOMAIN_INDEX;
            if (isHostGate) counters.hostGate += 1;
            else counters.render += 1;

            if (parsed.TableName !== TABLE_NAME) {
                unhandled.push(`TableName=${parsed.TableName}`);
                return amzError(res, 400, "ResourceNotFoundException", `no such table ${parsed.TableName}`);
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
        const item = ITEMS.find((i) => i.PK === key.PK && i.SK === key.SK);
        return json(res, item ? { Item: marshallItem(item) } : {});
    }

    function query(res, parsed) {
        const names = parsed.ExpressionAttributeNames;
        const values = Object.fromEntries(
            Object.entries(parsed.ExpressionAttributeValues || {}).map(([k, v]) => [k, unmarshall(v)]),
        );
        const cond = parseKeyCondition(parsed.KeyConditionExpression, names);
        if (!cond) throw new Error(`unsupported KeyConditionExpression "${parsed.KeyConditionExpression}"`);
        if (parsed.IndexName && parsed.IndexName !== DOMAIN_INDEX) {
            throw new Error(`unsupported index ${parsed.IndexName}`);
        }

        let items = ITEMS.filter((i) => i[cond.hashAttr] === values[cond.hashVal]);
        if (cond.rangeAttr) {
            items = items.filter((i) => String(i[cond.rangeAttr] ?? "").startsWith(values[cond.rangePrefix]));
        }
        items = items.filter((i) => passesFilter(i, parsed.FilterExpression, names, values));
        if (parsed.Limit) items = items.slice(0, parsed.Limit);

        // `Select: COUNT` must not return Items — lib/tenant-directory.ts reads `res.Count`
        // precisely so no tenant data crosses into the edge layer.
        if (parsed.Select === "COUNT") return json(res, { Count: items.length, ScannedCount: items.length });
        // ProjectionExpression is deliberately ignored: returning extra attributes cannot
        // change any assertion here, and honouring it would add a parser with no caller.
        return json(res, { Items: items.map(marshallItem), Count: items.length, ScannedCount: items.length });
    }

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    return {
        url: `http://127.0.0.1:${server.address().port}`,
        stats: () => ({ ...counters, unhandled: [...unhandled] }),
        reset: () => {
            counters.total = counters.hostGate = counters.render = 0;
        },
        /** CACHE-1-D4 fault injection. See the file header. */
        failContentReads: (on) => {
            failContent = on;
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
