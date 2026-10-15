// Outbound-call interceptor for the built-bundle serving harness (slice opennext-1a, increment 2).
//
// WHAT IT IS. A `--require` preload, loaded by the two child processes that run built Lambda
// code: the Lambda host child (lambda-host.mjs `spawnChild`) and the revalidation-function child
// (lambda-host.mjs `runRevalidationFunction`). It patches the four ways that code can open an
// outbound HTTP connection — `https.request`, `https.get`, `http.request` / `http.get` to a
// non-loopback host, and `globalThis.fetch` to a non-loopback host — BEFORE the bundle loads.
//
// WHAT IT DOES WITH A CALL.
//   1. Journals it: `{ api, method, url, headers }` sent to the parent over the child's IPC
//      channel (`process.send({ type: "outbound", entry })`). Rows read the journal
//      (`server.outbound()`, B-CASE; the revalidation result's `outbound`, B-REVAL).
//   2. Redirects it to `SERVING_BUNDLE_OUTBOUND_REDIRECT` (an `http://127.0.0.1:<port>` origin),
//      path and query kept, the original host sent as `Host`. Two uses:
//        Lambda host child      → `http://127.0.0.1:1` (nothing listens): an outbound call
//                                 is REFUSED locally (ECONNREFUSED). Hermetic, and
//                                 deterministic — a `.test` DNS lookup depends on the
//                                 operator's resolver, and a real `*.cloudfront.net` name
//                                 would leave the machine.
//        revalidation child     → the running Lambda host's HTTP port: the function's
//                                 `HEAD https://<host><url>` reaches the bundle through the
//                                 emulated edge, as it reaches CloudFront in production.
//      Unset (negative control (c) only) → journal only; the call proceeds as written.
//
// Loopback HTTP (`127.0.0.1`, `localhost`, `::1`) is neither journaled nor redirected: that is
// the AWS SDK talking to the stubs, which keep their own journals. HTTPS is journaled whatever
// the host — no stub speaks TLS, so every HTTPS call is outbound by definition.
//
// LIMITS. A call made with `net.connect` / `tls.connect` directly, or through an HTTP/2 session,
// is not seen. Neither the open-next 3.1.3 server bundle (`proxyRequest`: `node:https` request)
// nor its revalidation function (`node:https` default import, `.request`) uses those —
// VERIFIED by grep of the built `index.mjs` files (docs/slices/opennext-1a.md § Increment 1A-2).
//
// The redirect target travels in an environment variable that is DELETED here, before the
// bundle loads, so the bundle's `process.env` never contains it.
"use strict";
const http = require("node:http");
const https = require("node:https");
const { syncBuiltinESMExports } = require("node:module");

const REDIRECT = process.env.SERVING_BUNDLE_OUTBOUND_REDIRECT || "";
delete process.env.SERVING_BUNDLE_OUTBOUND_REDIRECT;
const redirect = REDIRECT ? new URL(REDIRECT) : null;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function journal(entry) {
    if (typeof process.send === "function") process.send({ type: "outbound", entry });
}

/** `(url?, options?, callback?)` as node:http accepts it → `{ url: URL, options, callback }`. */
function normalize(defaultProtocol, args) {
    let url;
    let options = {};
    let callback;
    for (const a of args) {
        if (typeof a === "string") url = new URL(a);
        else if (a instanceof URL) url = new URL(a.href);
        else if (typeof a === "function") callback = a;
        else if (a && typeof a === "object") options = a;
    }
    if (!url) {
        const host = options.hostname ?? options.host ?? "localhost";
        const port = options.port ? `:${options.port}` : "";
        url = new URL(`${options.protocol ?? defaultProtocol}//${host}${port}${options.path ?? "/"}`);
    }
    return { url, options, callback };
}

function headerObject(h) {
    if (!h) return {};
    if (typeof h.entries === "function") return Object.fromEntries(h.entries());
    return { ...h };
}

function wrap(mod, name, protocol, originalRequest) {
    const original = mod[name];
    mod[name] = function interceptedRequest(...args) {
        const { url, options, callback } = normalize(protocol, args);
        const isLoopbackHttp = protocol === "http:" && LOOPBACK.has(url.hostname);
        if (isLoopbackHttp) return original.apply(this, args);
        const headers = headerObject(options.headers);
        journal({ api: `${protocol.slice(0, -1)}.${name}`, method: options.method ?? "GET", url: url.href, headers });
        if (!redirect) return original.apply(this, args);
        // Redirected: plain HTTP to the target, the original host as `Host`.
        const req = originalRequest(
            {
                protocol: redirect.protocol,
                hostname: redirect.hostname,
                port: redirect.port,
                path: url.pathname + url.search,
                method: options.method ?? "GET",
                headers: { ...headers, host: url.host },
            },
            callback,
        );
        if (name === "get") req.end();
        return req;
    };
}

const httpRequest = http.request;
wrap(https, "request", "https:", httpRequest);
wrap(https, "get", "https:", httpRequest);
wrap(http, "request", "http:", httpRequest);
wrap(http, "get", "http:", httpRequest);

if (typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function interceptedFetch(input, init = {}) {
        const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(href);
        if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return originalFetch(input, init);
        journal({ api: "fetch", method: init.method ?? input.method ?? "GET", url: url.href, headers: headerObject(init.headers) });
        if (!redirect) return originalFetch(input, init);
        return originalFetch(new URL(url.pathname + url.search, redirect).href, init);
    };
}

// ESM named imports of builtins (`import("node:https").then((m) => m.request)` — open-next's
// `proxyRequest`) read the ESM facade, which is a snapshot of module.exports; refresh it.
syncBuiltinESMExports();
