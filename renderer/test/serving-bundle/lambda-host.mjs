// Lambda host for the built-bundle serving harness (slice opennext-1a, spec
// docs/slices/opennext-1-upgrade.md § 8.1 item 3).
//
// WHAT IT RUNS. The exact artefact CDK uploads as the RendererServer Lambda —
// `renderer/.open-next/server-functions/default` (infra/lib/renderer-hosting.ts, `code:
// lambda.Code.fromAsset(path.join(openNextPath, 'server-functions/default'))`, handler
// `index.handler`) — in ONE child Node process whose cwd is that directory, exactly as Lambda
// loads it from /var/task. The child imports `./index.mjs` and calls its `handler` export with
// Function URL payload v2.0 events. Nothing of OpenNext is imported into the test process.
//
// WARM AND COLD. Module state (the tenant-directory TTL cache, OpenNext's globals, the SDK
// clients) lives as long as the child: one child = one warm Lambda container. `restart()` kills
// it and spawns a new one = a cold container.
//
// TWO WAYS IN.
//   1. HTTP on `port` — a viewer request THROUGH THE EDGE. The child rewrites the headers the way
//      CloudFront does for this distribution (`edgeRequestHeaders` below), converts the request
//      to a Function URL event (`toFunctionUrlEvent`), calls the handler and maps the result
//      back to HTTP (`toHttpResponse`). `harness.request()` works against it unchanged.
//   2. `invoke(event)` over the child's IPC channel — a raw Lambda invocation, NO edge in front.
//      For events that are not HTTP requests (the warmer, B-WARM) and for a request that
//      bypasses CloudFront (direct Function URL access, the threat `ORIGIN_VERIFY_SECRET` is for).
//
// The child announces readiness by printing one line `LAMBDA_HOST_READY <json>` on stdout,
// carrying its ephemeral port and `globalThis.openNextVersion` — the version string the bundle's
// own banner set while loading (open-next `build/helper.js` writes it into every function).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);

/** `Host` of a Lambda Function URL. CloudFront dials the origin by this name, so it is the Host
 *  the function sees (the viewer's host travels in `x-forwarded-host`). Fake but well-formed. */
const FUNCTION_URL_HOST = "abc.lambda-url.eu-central-1.on.aws";

/**
 * The headers CloudFront lets through to the renderer Lambda — everything else a viewer sends is
 * deleted at the edge, on a MISS as well as a HIT. Two sources, both from
 * infra/lib/renderer-hosting.ts, each pinned there by an infra test:
 *
 *   `RendererOriginPolicy` header allowlist — the transport list. Pinned by infra test `(h)`
 *     (infra/test/amodx-stack.test.ts, "header allowlist is EXACTLY the ten forwarded headers"
 *     — the title still says ten; the asserted list is these EIGHT since the 2026-10-13 removal
 *     of `x-isr` / `x-prerender-revalidate`).
 *   `RendererCachePolicy` header allowlist — CloudFront always forwards the headers it keys on
 *     (AWS: "headers included in the cache key are automatically included in origin requests").
 *     Pinned by infra test `(a1)`. `x-forwarded-host` and `x-has-session` are overwritten by
 *     the viewer-request Function below anyway.
 *
 * Lowercased. Cookies are NOT a header here: the ORP forwards all cookies (`cookieBehavior:
 * all`), and the Function URL event carries them in `cookies[]`.
 *
 * Kept as a literal rather than imported from infra: a renderer test must not depend on the infra
 * package (no cross-package import, slice packet § 1); the two infra tests pin the same literals.
 */
const EDGE_FORWARDED_HEADERS = [
    // RendererOriginPolicy (infra test (h))
    "accept",
    "accept-language",
    "content-type",
    "x-forwarded-host",
    "x-origin-verify",
    "x-tenant-id",
    "x-automation-key",
    "x-revalidation-token",
    // RendererCachePolicy (infra test (a1)) — the ones not already above
    "rsc",
    "next-router-prefetch",
    "next-router-state-tree",
    "next-router-segment-prefetch",
    "x-has-session",
];

/** The session predicate of the viewer-request Function (`HostRewriteFunction` (c)), which
 *  middleware.ts `SESSION_COOKIE_BASES` mirrors. Copied, so a change there must change this. */
const SESSION_COOKIE_BASES = ["next-auth.session-token", "__secure-next-auth.session-token"];

/**
 * CloudFront's view of a viewer request: what the renderer Lambda receives.
 *
 * Emulates the viewer-request Function `HostRewriteFunction` jobs (a)–(c) — `x-forwarded-host`
 * from the viewer's Host, `x-origin-verify` = the secret, `x-has-session` derived from the cookie
 * jar and always overwritten — then drops every header not in `EDGE_FORWARDED_HEADERS`.
 *
 * Also emulated: CloudFront's replacement of an unforwarded `User-Agent` (see below).
 *
 * NOT emulated (phase 2 of spec § 8.1 item 5, only if a row needs it): job (d), the STATIC-EP
 * origin guard that 403s a cross-site POST to /api/{consent,contact,leads} at the edge; the edge
 * cache; the headers CloudFront and the Function URL add on their own (`via`, `x-amz-cf-id`,
 * `x-forwarded-for`, `x-forwarded-proto`, `x-amzn-trace-id`) — spec § 8.1 item 3 lists none.
 *
 * @param {Record<string,string|string[]|undefined>} viewer  incoming headers (node:http, lowercased)
 * @param {{ originVerifySecret: string }} edge
 * @returns {{ headers: Record<string,string>, cookies: string[] }}
 */
function edgeRequestHeaders(viewer, { originVerifySecret }) {
    const cookieHeader = [].concat(viewer.cookie ?? []).join("; ");
    const cookies = cookieHeader ? cookieHeader.split("; ") : [];
    const headers = {};
    for (const name of EDGE_FORWARDED_HEADERS) {
        const v = viewer[name];
        if (v !== undefined) headers[name] = [].concat(v).join(",");
    }
    headers["x-forwarded-host"] = String(viewer.host ?? "");
    headers["x-origin-verify"] = originVerifySecret;
    const hasSession = cookies.some((c) => {
        const lower = c.split("=")[0].toLowerCase();
        return SESSION_COOKIE_BASES.some((base) => lower === base || lower.indexOf(base + ".") === 0);
    });
    headers["x-has-session"] = hasSession ? "1" : "0";
    // CloudFront replaces a User-Agent it does not forward with this literal (AWS CloudFront
    // developer guide, "How CloudFront processes HTTP and HTTPS requests" → User-Agent). The ORP
    // does not forward it, so this is what the origin sees. Next reads User-Agent (bot detection
    // for streamed metadata), so leaving it absent would be a different request.
    headers["user-agent"] = "Amazon CloudFront";
    return { headers, cookies };
}

/**
 * A Function URL payload v2.0 event, field by field as spec § 8.1 item 3 lists it.
 *
 * @param {object} req
 * @param {string} req.method
 * @param {string} req.url        path + query exactly as received (still percent-encoded)
 * @param {Record<string,string>} req.headers  already edge-filtered (or hand-built for a direct call)
 * @param {string[]} [req.cookies]
 * @param {Buffer} [req.body]
 */
export function toFunctionUrlEvent({ method, url, headers, cookies = [], body }) {
    const q = url.indexOf("?");
    const rawPath = q === -1 ? url : url.slice(0, q);
    const rawQueryString = q === -1 ? "" : url.slice(q + 1);
    const lower = {};
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = [].concat(v).join(",");
    delete lower.cookie; // a Function URL moves the jar to `cookies[]`
    lower.host = FUNCTION_URL_HOST;
    const hasBody = body !== undefined && body.length > 0;
    if (hasBody) lower["content-length"] = String(body.length);
    return {
        version: "2.0",
        routeKey: "$default",
        rawPath,
        rawQueryString,
        ...(cookies.length > 0 ? { cookies } : {}),
        headers: lower,
        requestContext: {
            http: {
                method,
                path: rawPath,
                protocol: "HTTP/1.1",
                sourceIp: "127.0.0.1",
                userAgent: lower["user-agent"] ?? "",
            },
            domainName: FUNCTION_URL_HOST,
            requestId: randomUUID(),
            timeEpoch: Date.now(),
        },
        isBase64Encoded: hasBody,
        ...(hasBody ? { body: body.toString("base64") } : {}),
    };
}

/** The handler's result as an HTTP response: each `cookies[i]` its own `Set-Cookie`, a base64
 *  body decoded. */
function toHttpResponse(result) {
    const headers = { ...(result.headers ?? {}) };
    if (Array.isArray(result.cookies) && result.cookies.length > 0) headers["set-cookie"] = result.cookies;
    const raw = result.body ?? "";
    const body = Buffer.from(raw, result.isBase64Encoded ? "base64" : "utf8");
    return { status: result.statusCode ?? 200, headers, body };
}

// ── Parent side ─────────────────────────────────────────────────────────────────────────

/**
 * Spawns the child and waits for `LAMBDA_HOST_READY`.
 *
 * @param {object} options
 * @param {string} options.functionDir    `.open-next/server-functions/default`
 * @param {Record<string,string>} options.env  the COMPLETE child environment (constructed by
 *        harness.mjs `bundleEnv`; nothing is inherited)
 * @param {string} options.originVerifySecret  what the emulated edge sets as `x-origin-verify`
 * @param {(entry: object) => void} [options.onResponse]  called with `{ via, method, url, host,
 *        status, headers }` for EVERY handler result — `via: "edge"` (HTTP) and `via: "invoke"` (IPC)
 *        — plus `via: "edge-host-502"` when the handler threw (B-NO30D reads them all)
 */
export async function startLambdaHost({ functionDir, env, originVerifySecret, onResponse }) {
    let child;
    let log = "";
    let ready;
    const pending = new Map();

    async function spawnChild() {
        log = "";
        child = spawn(process.execPath, [SELF, "--child"], {
            cwd: functionDir,
            env: { ...env, LAMBDA_HOST_ORIGIN_VERIFY: originVerifySecret },
            stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        child.stderr.on("data", (d) => (log += d));
        child.on("message", (m) => {
            if (m.type === "response") onResponse?.(m.entry);
            if (m.type === "result" || m.type === "error") {
                const p = pending.get(m.id);
                pending.delete(m.id);
                if (m.type === "result") p?.resolve(m.result);
                else p?.reject(new Error(m.message));
            }
        });
        ready = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`lambda host did not become ready\n${log}`)), 60_000);
            let buf = "";
            child.stdout.on("data", (d) => {
                log += d;
                buf += d;
                const m = buf.match(/^LAMBDA_HOST_READY (.+)$/m);
                if (m) {
                    clearTimeout(timer);
                    resolve(JSON.parse(m[1]));
                }
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                reject(new Error(`lambda host exited ${code} before ready\n${log}`));
            });
        });
    }

    function stopChild() {
        if (!child || child.exitCode !== null) return Promise.resolve();
        return new Promise((resolve) => {
            child.once("exit", resolve);
            child.kill("SIGTERM");
        });
    }

    await spawnChild();

    return {
        get port() {
            return ready.port;
        },
        get pid() {
            return child.pid;
        },
        /** `globalThis.openNextVersion` as the loaded bundle set it. */
        get openNextVersion() {
            return ready.openNextVersion;
        },
        /** The environment the child was spawned with (iso1 asserts its shape). */
        env,
        /** stdout + stderr of the current child, for failure messages. */
        log: () => log,
        /** Raw invocation over IPC, no edge: resolves with the handler's own return value. */
        invoke: (event) =>
            new Promise((resolve, reject) => {
                const id = randomUUID();
                pending.set(id, { resolve, reject });
                child.send({ type: "invoke", id, event });
            }),
        /** Cold container: kill the child, spawn a new one on a new port. */
        restart: async () => {
            await stopChild();
            await spawnChild();
        },
        close: stopChild,
    };
}

// ── Child side ──────────────────────────────────────────────────────────────────────────

async function runChild() {
    // The edge's secret travels to the child in this variable, which is not part of the
    // Lambda's environment: taken out BEFORE the bundle loads, so the bundle never sees it.
    const originVerifySecret = process.env.LAMBDA_HOST_ORIGIN_VERIFY;
    delete process.env.LAMBDA_HOST_ORIGIN_VERIFY;
    // As Lambda: resolve the handler from the function root (cwd), `index.handler`.
    const { handler } = await import(pathToFileURL(path.join(process.cwd(), "index.mjs")).href);

    /**
     * THE ONLY CALL SITE OF `handler` (review-0 rule): every path that obtains a handler result —
     * the edge HTTP path and the raw IPC `invoke` path, and any path added later — goes through
     * here, so every result reaches the parent's response record (`onResponse`), which B-NO30D
     * checks. Recorded headers are the result's own `headers` plus its `cookies[]` as
     * `set-cookie`; a result without headers (the warmer's `{ serverId, type }`) records `{}`.
     */
    async function callHandler(event, via) {
        const result = await handler(event);
        const headers = { ...(result?.headers ?? {}) };
        if (Array.isArray(result?.cookies) && result.cookies.length > 0) headers["set-cookie"] = result.cookies;
        const http = event.requestContext?.http;
        process.send({
            type: "response",
            entry: {
                via,
                method: http?.method,
                url: http ? event.rawPath + (event.rawQueryString ? `?${event.rawQueryString}` : "") : `(event type=${event.type})`,
                host: event.headers?.["x-forwarded-host"],
                status: result?.statusCode,
                headers,
            },
        });
        return result;
    }

    process.on("message", async (m) => {
        if (m.type !== "invoke") return;
        try {
            process.send({ type: "result", id: m.id, result: await callHandler(m.event, "invoke") });
        } catch (e) {
            process.send({ type: "error", id: m.id, message: e?.stack ?? String(e) });
        }
    });

    const server = createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", async () => {
            const { headers, cookies } = edgeRequestHeaders(req.headers, { originVerifySecret });
            const event = toFunctionUrlEvent({ method: req.method, url: req.url, headers, cookies, body: Buffer.concat(chunks) });
            let out;
            try {
                out = toHttpResponse(await callHandler(event, "edge"));
            } catch (e) {
                // What a Function URL answers when the handler throws. No handler result exists, so
                // the synthetic response is recorded here — every HTTP response is still recorded.
                process.stderr.write(`[lambda-host] handler threw: ${e?.stack ?? e}\n`);
                out = { status: 502, headers: { "content-type": "text/plain" }, body: Buffer.from("Internal Server Error") };
                process.send({ type: "response", entry: { via: "edge-host-502", method: req.method, url: req.url, host: req.headers.host, status: out.status, headers: out.headers } });
            }
            res.writeHead(out.status, { ...out.headers, "content-length": out.body.length });
            res.end(out.body);
        });
    });
    server.listen(0, "127.0.0.1", () => {
        const ready = { port: server.address().port, openNextVersion: globalThis.openNextVersion ?? null };
        process.stdout.write(`\nLAMBDA_HOST_READY ${JSON.stringify(ready)}\n`);
    });
    process.on("disconnect", () => process.exit(0));
}

if (process.argv[1] === SELF && process.argv[2] === "--child") {
    await runChild();
}
