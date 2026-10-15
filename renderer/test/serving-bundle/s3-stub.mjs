// In-process S3 stub for the built-bundle serving harness (slice opennext-1a).
//
// WHAT IT IS: an HTTP server that speaks enough of the S3 REST-XML protocol to answer the five
// operations the OpenNext server bundle and the renderer's own CACHE-10 purge can emit against
// the ISR cache bucket: PutObject, GetObject, HeadObject, DeleteObject, ListObjectsV2. The
// bundle reaches it because the AWS SDK v3 honours `AWS_ENDPOINT_URL_S3` (lambda-host.mjs sets
// it; the operator verified the smithy env-endpoint config is inlined into the bundle).
//
// WHAT IT IS NOT: an S3 emulator. One bucket (the name the harness hands the bundle as
// `CACHE_BUCKET_NAME`), no versioning, no multipart, no ACLs. Anything else — another bucket,
// another operation — is answered with a LOUD error and recorded in `unhandled()`. Same rule as
// `ddb-stub.mjs` and human decision CACHE-1-D4: the adapter swallows S3 errors (a failed get is a
// MISS, a failed put is a log line — open-next `adapters/cache.js`), so a stub that answered
// "nothing here" for a request it did not understand would let the suite pass while the cache
// was never exercised. The journal row in `contract.test.mjs` turns `unhandled()` into a red row.
//
// ADDRESSING. Both styles are decoded, and the journal records which one each request used:
//   path-style     Host 127.0.0.1:<port>,             path /<bucket>/<key>
//   virtual-host   Host <bucket>.<anything>:<port>,   path /<key>
// The harness sets the endpoint to `http://127.0.0.1:<port>`. The S3 endpoint rules of SDK v3
// fall back to path-style for an IP-address endpoint, so no DNS shim is needed — VERIFIED per
// run by the journal (every entry's `addressing` is `path`), not assumed.
//
// JOURNAL. Every request appends `{ op, bucket, key, addressing, status }`; PutObject entries
// also carry the stored body's parsed `meta.status` (the ISR entry's HTTP status) so a row can
// prove what was written without re-reading state. `objects()` is the current bucket state.
import { createServer } from "node:http";
import { createHash } from "node:crypto";

/**
 * Starts the stub on an ephemeral port.
 * @param {{ bucket: string }} options  the only bucket this stub serves
 */
export async function startS3Stub({ bucket }) {
    /** key -> { body: Buffer, lastModified: Date, etag: string } */
    const store = new Map();
    const journal = [];
    const unhandled = [];

    const server = createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const url = new URL(req.url, "http://stub");
            const { bucket: reqBucket, key, addressing } = decodeAddress(req.headers.host ?? "", url.pathname);
            const op = operationOf(req.method, key, url.searchParams);
            const entry = { op, bucket: reqBucket, key, addressing };
            journal.push(entry);
            const reply = (status, headers, body) => {
                entry.status = status;
                res.writeHead(status, headers);
                res.end(body);
            };

            if (reqBucket !== bucket) {
                unhandled.push(`${op} on bucket "${reqBucket}" (stub serves "${bucket}")`);
                return reply(...xmlError(404, "NoSuchBucket", `s3-stub serves only ${bucket}`));
            }

            if (op === "PutObject") {
                const body = decodeBody(req.headers, Buffer.concat(chunks));
                const etag = `"${createHash("md5").update(body).digest("hex")}"`;
                store.set(key, { body, lastModified: new Date(), etag });
                entry.storedStatus = storedStatusOf(body);
                return reply(200, { etag, "content-length": 0 }, "");
            }
            if (op === "GetObject" || op === "HeadObject") {
                const obj = store.get(key);
                if (!obj) {
                    // HEAD answers carry no body by protocol; the SDK maps the bare 404 to NotFound.
                    return op === "HeadObject"
                        ? reply(404, { "content-length": 0 }, "")
                        : reply(...xmlError(404, "NoSuchKey", "The specified key does not exist.", key));
                }
                const headers = {
                    // RFC 7231 date: S3's LastModified has 1-second resolution, and so does this.
                    "last-modified": obj.lastModified.toUTCString(),
                    etag: obj.etag,
                    "content-type": "application/octet-stream",
                    "content-length": obj.body.length,
                };
                return reply(200, headers, op === "HeadObject" ? "" : obj.body);
            }
            if (op === "DeleteObject") {
                store.delete(key);
                return reply(204, {}, "");
            }
            if (op === "ListObjectsV2") {
                return reply(200, { "content-type": "application/xml" }, listXml(url.searchParams.get("prefix") ?? ""));
            }

            unhandled.push(`unsupported operation ${req.method} ${req.url}`);
            return reply(...xmlError(400, "NotImplemented", `s3-stub does not implement ${req.method} ${req.url}`));
        });
    });

    function listXml(prefix) {
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
        const contents = keys
            .map((k) => {
                const o = store.get(k);
                return `<Contents><Key>${escapeXml(k)}</Key><LastModified>${o.lastModified.toISOString()}</LastModified>` +
                    `<ETag>${escapeXml(o.etag)}</ETag><Size>${o.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
            })
            .join("");
        return `<?xml version="1.0" encoding="UTF-8"?>` +
            `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${escapeXml(bucket)}</Name>` +
            `<Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys>` +
            `<IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
    }

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    return {
        url: `http://127.0.0.1:${server.address().port}`,
        journal: () => journal.map((e) => ({ ...e })),
        unhandled: () => [...unhandled],
        /** Current bucket state: `[{ key, body: string, lastModified: Date }]`. */
        objects: () =>
            [...store.entries()].map(([key, o]) => ({ key, body: o.body.toString("utf8"), lastModified: o.lastModified })),
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

/** Splits a request into bucket + key, and says which addressing style it used. */
function decodeAddress(hostHeader, pathname) {
    const host = hostHeader.replace(/:\d+$/, "");
    const isBareHost = host === "127.0.0.1" || host === "localhost";
    if (isBareHost) {
        const [, bucket = "", ...rest] = pathname.split("/");
        return { bucket, key: decodeURIComponent(rest.join("/")), addressing: "path" };
    }
    // `<bucket>.127.0.0.1` / `<bucket>.localhost`: the bucket is everything before the base host.
    const bucket = host.replace(/\.(127\.0\.0\.1|localhost)$/, "");
    return { bucket, key: decodeURIComponent(pathname.slice(1)), addressing: "virtual-host" };
}

/** The S3 operation a request is. Unknown shapes return a descriptive non-operation name. */
function operationOf(method, key, params) {
    if (method === "GET" && !key && params.get("list-type") === "2") return "ListObjectsV2";
    if (!key) return `${method} (bucket-level, unsupported)`;
    // Sub-resource queries (?acl, ?tagging, ?uploads, …) are other operations, not these five.
    const sub = [...params.keys()].filter((k) => k !== "x-id");
    if (sub.length > 0) return `${method} ?${sub.join("&")} (unsupported)`;
    if (method === "PUT") return "PutObject";
    if (method === "GET") return "GetObject";
    if (method === "HEAD") return "HeadObject";
    if (method === "DELETE") return "DeleteObject";
    return `${method} (unsupported)`;
}

/**
 * The object bytes as the client meant them.
 *
 * SDK v3 (≥ 3.729) computes a CRC32 checksum for every PutObject. For a body of known length it
 * sends the checksum as a header and the body as-is; for a streamed body it uses `aws-chunked`
 * framing with the checksum as a trailer. Both are decoded here so the stub never stores framing
 * bytes as content.
 */
function decodeBody(headers, raw) {
    const encoding = String(headers["content-encoding"] ?? "");
    const sha = String(headers["x-amz-content-sha256"] ?? "");
    if (!encoding.includes("aws-chunked") && !sha.startsWith("STREAMING-")) return raw;
    const out = [];
    let at = 0;
    for (;;) {
        const lineEnd = raw.indexOf("\r\n", at);
        if (lineEnd < 0) break;
        const size = parseInt(raw.subarray(at, lineEnd).toString("latin1").split(";")[0], 16);
        if (!size) break; // the zero-size chunk; trailers follow and are not content
        out.push(raw.subarray(lineEnd + 2, lineEnd + 2 + size));
        at = lineEnd + 2 + size + 2;
    }
    return Buffer.concat(out);
}

/**
 * The HTTP status an ISR entry stores, read from the object the adapter wrote.
 *
 * open-next 3.1.3 `adapters/cache.js` `set()` writes `{ type, …, meta: { status, headers } }` for
 * `app`/`route` entries and `{ type: "redirect", props }` for Next's REDIRECT kind. Absent status
 * = 200, the same convention as Next's filesystem `.meta`. Returns `null` for a body that is not
 * an ISR entry (a fetch-cache entry, or unparseable).
 */
export function storedStatusOf(body) {
    let value;
    try {
        value = JSON.parse(body.toString("utf8"));
    } catch {
        return null;
    }
    if (value?.type === "redirect") return value.props?.statusCode ?? value.props?.status ?? null;
    if (value?.type === "app" || value?.type === "route" || value?.type === "page") return value.meta?.status ?? 200;
    return null;
}

function xmlError(status, code, message, key) {
    const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code>` +
        `<Message>${escapeXml(message)}</Message>${key ? `<Key>${escapeXml(key)}</Key>` : ""}</Error>`;
    return [status, { "content-type": "application/xml", "content-length": Buffer.byteLength(body) }, body];
}

function escapeXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
