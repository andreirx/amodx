import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { connect as netConnect, isIP, type Socket } from "node:net";
import { checkServerIdentity, connect as tlsConnect, type PeerCertificate, type TLSSocket } from "node:tls";
import { db, TABLE_NAME } from "./db.js";

const s3 = new S3Client({});

export function getExtensionFromContentType(contentType: string): string {
    const map: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
    };
    return map[contentType.toLowerCase()] || ".jpg";
}

// ── The destination policy (CAT-IMAGES-1; spec docs/slices/catalog-mode-1.md § 4 CM-D2, slice § 2.3 and § 7) ─────────
//
// Every copy of a remote image goes through `fetchImage`. Per hop, BEFORE any byte is sent: the scheme is http or
// https; the host name is resolved to ALL its addresses and the hop is refused when ANY of them is in a prohibited
// range; the connection goes to the checked address (the host name is kept for SNI, the certificate check and the
// Host header). Redirects are followed by hand, at most MAX_REDIRECT_HOPS, each hop checked again. One deadline covers
// all hops and the body; the body is capped; the stored content type comes from the magic bytes, never the header.

/** Redirects followed at most (the first request is not a hop): 3 redirects → a 4th request; a 4th redirect is refused. */
export const MAX_REDIRECT_HOPS = 3;
/** One deadline for a whole source: DNS, connect, TLS, every hop and the body. Evidence: real images take 0.12–0.28 s. */
export const SOURCE_DEADLINE_MS = 8_000;
/** The body cap. Evidence: real images are 30–275 KB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The one certificate exception (CIM-A1-2, human ruling 2026-10-30). BOEN's image host presents a certificate that
 * expired 2021-02-20; only that certificate, for that host, with that error and a passing hostname check is accepted.
 */
const EXPIRED_CERTIFICATE_PIN = {
    host: "coreapi.boen.com",
    authorizationError: "CERT_HAS_EXPIRED",
    fingerprint256: "4C:5E:21:C9:A9:2D:A3:1F:11:5C:15:38:EA:42:AB:49:9F:E0:1C:E2:0C:81:6C:D1:33:BE:88:39:66:42:6F:27",
} as const;

/** What the TLS layer reported for a finished handshake. */
export type TlsVerification =
    /** Node verified the chain and the host name: the normal path. */
    | { readonly kind: "verified" }
    | {
        readonly kind: "failed";
        readonly host: string;
        readonly authorizationError: string;
        readonly fingerprint256: string;
        readonly hostnameCheckPassed: boolean;
    };

/**
 * Whether a TLS connection may carry the request. A verified certificate: yes. A failed verification: only the
 * CIM-A1-2 pin — all four conditions true. Pure.
 */
export function acceptsTlsConnection(verification: TlsVerification): boolean {
    switch (verification.kind) {
        case "verified":
            return true;
        case "failed":
            return verification.host === EXPIRED_CERTIFICATE_PIN.host
                && verification.authorizationError === EXPIRED_CERTIFICATE_PIN.authorizationError
                && verification.hostnameCheckPassed
                && verification.fingerprint256 === EXPIRED_CERTIFICATE_PIN.fingerprint256;
    }
}

/** The prohibited IPv4 ranges: [first address as a 32-bit number, prefix length, name for the report]. */
const BLOCKED_IPV4: readonly (readonly [number, number, string])[] = [
    [ipv4ToNumber("0.0.0.0"), 8, "unspecified 0.0.0.0/8"],
    [ipv4ToNumber("127.0.0.0"), 8, "loopback 127.0.0.0/8"],
    [ipv4ToNumber("10.0.0.0"), 8, "private 10.0.0.0/8 (RFC 1918)"],
    [ipv4ToNumber("172.16.0.0"), 12, "private 172.16.0.0/12 (RFC 1918)"],
    [ipv4ToNumber("192.168.0.0"), 16, "private 192.168.0.0/16 (RFC 1918)"],
    [ipv4ToNumber("169.254.0.0"), 16, "link-local 169.254.0.0/16"],
    [ipv4ToNumber("100.64.0.0"), 10, "CGNAT 100.64.0.0/10"],
];

function ipv4ToNumber(address: string): number {
    return address.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);
}

function blockedIpv4Range(value: number): string | null {
    for (const [base, prefix, name] of BLOCKED_IPV4) {
        const size = 2 ** (32 - prefix);
        if (value >= base && value < base + size) return name;
    }
    return null;
}

/** The eight 16-bit groups of an IPv6 address (`::` expanded, a trailing dotted IPv4 part converted); `null` if invalid. */
function ipv6Groups(address: string): number[] | null {
    let text = address.split("%")[0]; // a zone id (`fe80::1%eth0`) is not part of the address
    const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
        if (isIP(dotted[2]) !== 4) return null;
        const v4 = ipv4ToNumber(dotted[2]);
        text = `${dotted[1]}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
    }
    const halves = text.split("::");
    if (halves.length > 2) return null;
    const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN)));
    const head = parse(halves[0]);
    const tail = halves.length === 2 ? parse(halves[1]) : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
    const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill(0), ...tail];
    return groups.some(Number.isNaN) ? null : groups;
}

/**
 * The range an address belongs to when the policy prohibits it, or `null` when the address is allowed. An address
 * that is not an IP address is refused (the resolver only returns IP addresses; this is the fail-closed default).
 */
export function blockedRangeOf(address: string): string | null {
    if (isIP(address) === 4) return blockedIpv4Range(ipv4ToNumber(address));
    const g = ipv6Groups(address);
    if (!g) return "not an IP address";
    if (g.every((x) => x === 0)) return "unspecified ::/128";
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return "loopback ::1/128";
    if ((g[0] & 0xfe00) === 0xfc00) return "unique-local fc00::/7";
    if ((g[0] & 0xffc0) === 0xfe80) return "link-local fe80::/10";
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
        const mapped = blockedIpv4Range(g[6] * 65536 + g[7]);
        return mapped === null ? null : `IPv4-mapped ::ffff:0:0/96 → ${mapped}`;
    }
    return null;
}

/** Resolves a host name to ALL its addresses (`dns.lookup` with `all: true` in production). */
export type Resolver = (host: string) => Promise<readonly { address: string; family: number }[]>;

/** The checked destination of one hop. `address` passed the policy; `host` is the name from the URL. */
export interface ConnectTarget {
    readonly protocol: "http:" | "https:";
    readonly host: string;
    readonly address: string;
    readonly family: number;
    readonly port: number;
}

/**
 * Opens a connection to `target.address` (never to a fresh resolution of the host name) and answers once it is ready
 * to carry the request — for https, after the TLS handshake and the certificate decision. Destroys it on `signal`.
 */
export type Connector = (target: ConnectTarget, signal: AbortSignal) => Promise<Socket>;

export interface FetchDeps {
    readonly resolve: Resolver;
    readonly connect: Connector;
    readonly deadlineMs: number;
}

/** Why a source that answered (or failed to) is not an accepted image. */
export type ImageFailure =
    /** An HTTP answer arrived but is not an accepted image. `bytes` = body bytes received (stopped at the cap). */
    | {
        readonly kind: "http";
        readonly reason: "status" | "not-image" | "too-large";
        readonly status: number;
        readonly contentType: string | null;
        readonly bytes: number;
    }
    /** No complete HTTP answer (DNS, connect, TLS, deadline) — CIM-A1-3: the error code, e.g. `CERT_HAS_EXPIRED`. */
    | { readonly kind: "error"; readonly code: string };

/** The accepted content types, decided by the magic bytes. */
export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";

export type FetchImageResult =
    | { readonly kind: "fetched"; readonly body: Buffer; readonly contentType: ImageContentType }
    /** The destination policy refused a hop; `rule` names the range or rule that matched. */
    | { readonly kind: "refused"; readonly rule: string }
    | { readonly kind: "failed"; readonly failure: ImageFailure };

/** The content type the magic bytes prove, or `null` (JPEG `FF D8 FF`; PNG signature; WebP `RIFF....WEBP`). */
export function imageTypeOf(body: Buffer): ImageContentType | null {
    if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
    if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (body.length >= 12 && body.toString("latin1", 0, 4) === "RIFF" && body.toString("latin1", 8, 12) === "WEBP") return "image/webp";
    return null;
}

const timeoutError = () => Object.assign(new Error("The source deadline passed"), { code: "ETIMEDOUT" });

/** Rejects with ETIMEDOUT when `signal` aborts first (a DNS lookup cannot be cancelled; its late answer is ignored). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(timeoutError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(timeoutError());
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
            (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
        );
    });
}

type DestinationCheck =
    | { readonly kind: "allowed"; readonly target: ConnectTarget }
    | { readonly kind: "refused"; readonly rule: string };

/** The policy for one hop: scheme, then every resolved address. Resolution errors propagate (→ `failed`, code). */
async function checkDestination(url: URL, resolve: Resolver, signal: AbortSignal): Promise<DestinationCheck> {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { kind: "refused", rule: `scheme ${url.protocol} (only http and https)` };
    }
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    const addresses = await untilAborted(resolve(host), signal);
    if (addresses.length === 0) return { kind: "refused", rule: `${host} resolves to no address` };
    for (const { address } of addresses) {
        const range = blockedRangeOf(address);
        if (range !== null) return { kind: "refused", rule: `${host} resolves to ${address}: ${range}` };
    }
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    return { kind: "allowed", target: { protocol: url.protocol, host, address: addresses[0].address, family: addresses[0].family, port } };
}

/** Production resolver: `dns.lookup` with `all: true` (the system resolver, as `fetch` used it). */
const resolveAll: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/** Production connector: plain TCP for http, TLS with SNI + hostname check for https, the BOEN pin as the only exception. */
const connectToCheckedAddress: Connector = (target, signal) => new Promise<Socket>((resolve, reject) => {
    if (signal.aborted) { reject(timeoutError()); return; }
    const pinnable = target.host === EXPIRED_CERTIFICATE_PIN.host;
    const socket: Socket = target.protocol === "http:"
        ? netConnect({ host: target.address, port: target.port })
        : tlsConnect({
            host: target.address,
            port: target.port,
            servername: isIP(target.host) ? undefined : target.host, // SNI + Node's hostname check use the name
            // Only the pinned host gets past a failed verification to the decision below; for it Node still runs the
            // hostname check when the chain verifies, so a valid certificate takes the normal path.
            rejectUnauthorized: !pinnable,
            ALPNProtocols: ["http/1.1"],
        });
    const onAbort = () => socket.destroy(timeoutError());
    signal.addEventListener("abort", onAbort, { once: true });
    socket.on("error", (e) => { signal.removeEventListener("abort", onAbort); reject(e); });
    const ready = () => { signal.removeEventListener("abort", onAbort); resolve(socket); };
    if (target.protocol === "http:") { socket.once("connect", ready); return; }
    socket.once("secureConnect", () => {
        const tls = socket as TLSSocket;
        let verification: TlsVerification = { kind: "verified" };
        if (!tls.authorized) {
            const cert: PeerCertificate = tls.getPeerCertificate();
            verification = {
                kind: "failed",
                host: target.host,
                authorizationError: String(tls.authorizationError),
                fingerprint256: cert?.fingerprint256 ?? "",
                hostnameCheckPassed: cert ? checkServerIdentity(target.host, cert) === undefined : false,
            };
        }
        if (acceptsTlsConnection(verification)) { ready(); return; }
        const code = verification.kind === "failed" ? verification.authorizationError : "TLS_REFUSED";
        socket.destroy(Object.assign(new Error(`TLS verification failed: ${code}`), { code }));
    });
});

const DEFAULT_FETCH_DEPS: FetchDeps = { resolve: resolveAll, connect: connectToCheckedAddress, deadlineMs: SOURCE_DEADLINE_MS };

/** One GET over an already-checked connection. The request carries no credentials and no cookies. */
function getOver(socket: Socket, url: URL, signal: AbortSignal): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
        const req = httpRequest({
            createConnection: () => socket,
            method: "GET",
            path: `${url.pathname}${url.search}`,
            // `user-agent: node` and `accept: */*` are what `fetch` sent when the operator measured the producer hosts.
            headers: { host: url.host, accept: "*/*", "user-agent": "node" },
            signal,
        });
        req.once("response", resolve);
        req.on("error", reject);
        req.end();
    });
}

/** Reads the body, stopping once more than `max` bytes arrived. */
async function readCapped(res: IncomingMessage, max: number): Promise<{ body: Buffer; bytes: number; tooLarge: boolean }> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of res) {
        bytes += (chunk as Buffer).length;
        if (bytes > max) {
            res.destroy();
            return { body: Buffer.alloc(0), bytes, tooLarge: true };
        }
        chunks.push(chunk as Buffer);
    }
    return { body: Buffer.concat(chunks), bytes, tooLarge: false };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch one image under the destination policy. Never throws: every outcome is a `FetchImageResult`. `deps` is the
 * test seam (a fake resolver; a connector that reaches a local server); production uses `DEFAULT_FETCH_DEPS`.
 */
export async function fetchImage(sourceUrl: string, deps: FetchDeps = DEFAULT_FETCH_DEPS): Promise<FetchImageResult> {
    let url: URL;
    try {
        url = new URL(sourceUrl);
    } catch {
        return { kind: "refused", rule: "not a URL" };
    }
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), deps.deadlineMs);
    let socket: Socket | null = null;
    try {
        for (let hop = 0; ; hop++) {
            const destination = await checkDestination(url, deps.resolve, deadline.signal);
            if (destination.kind === "refused") {
                return { kind: "refused", rule: hop === 0 ? destination.rule : `redirect ${hop} to ${url.href}: ${destination.rule}` };
            }
            socket = await deps.connect(destination.target, deadline.signal);
            const res = await getOver(socket, url, deadline.signal);
            const status = res.statusCode ?? 0;
            const contentType = res.headers["content-type"] ?? null;
            if (REDIRECT_STATUSES.has(status) && res.headers.location) {
                res.destroy();
                socket.destroy();
                socket = null;
                if (hop + 1 > MAX_REDIRECT_HOPS) return { kind: "refused", rule: `more than ${MAX_REDIRECT_HOPS} redirects` };
                url = new URL(res.headers.location, url);
                continue;
            }
            const { body, bytes, tooLarge } = await readCapped(res, MAX_IMAGE_BYTES);
            if (status < 200 || status >= 300) return { kind: "failed", failure: { kind: "http", reason: "status", status, contentType, bytes } };
            if (tooLarge) return { kind: "failed", failure: { kind: "http", reason: "too-large", status, contentType, bytes } };
            const type = imageTypeOf(body);
            if (type === null) return { kind: "failed", failure: { kind: "http", reason: "not-image", status, contentType, bytes } };
            return { kind: "fetched", body, contentType: type };
        }
    } catch (e: unknown) {
        const code = deadline.signal.aborted ? "ETIMEDOUT" : String((e as { code?: unknown })?.code ?? (e as Error)?.name ?? "UNKNOWN");
        return { kind: "failed", failure: { kind: "error", code } };
    } finally {
        clearTimeout(timer);
        socket?.destroy();
    }
}

/** The outcome of copying one source into the tenant's media. S3/DynamoDB failures are not outcomes: they throw. */
export type CopyResult =
    | { readonly kind: "copied"; readonly cdnUrl: string }
    | { readonly kind: "refused"; readonly rule: string }
    | { readonly kind: "failed"; readonly failure: ImageFailure };

/** A one-line description of a refused or failed copy (the WordPress and media importers' error message). */
function describeCopyFailure(result: Exclude<CopyResult, { kind: "copied" }>): string {
    switch (result.kind) {
        case "refused":
            return `Refused by the image destination policy: ${result.rule}`;
        case "failed": {
            const f = result.failure;
            switch (f.kind) {
                case "error":
                    return `Failed to download image: ${f.code}`;
                case "http":
                    return `Failed to download image: HTTP ${f.status}, ${f.contentType ?? "no content-type"}, ${f.bytes} bytes (${f.reason})`;
            }
        }
    }
}

/**
 * Copy one remote image into the tenant's media: fetch under the destination policy, upload to S3 under
 * `<tenantId>/<assetId><ext>`, record an `ASSET#` item. `uploadedBy` names the caller (stored on the asset).
 */
export async function copyImageToTenantMedia(
    tenantId: string,
    imageUrl: string,
    bucket: string,
    cdnUrl: string,
    uploadedBy: string,
): Promise<CopyResult> {
    const fetched = await fetchImage(imageUrl);
    if (fetched.kind !== "fetched") return fetched;
    const contentType = fetched.contentType;

    const extension = getExtensionFromContentType(contentType);
    const assetId = crypto.randomUUID();
    const filename = `${assetId}${extension}`;
    const s3Key = `${tenantId}/${filename}`;

    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: fetched.body,
        ContentType: contentType,
    }));

    const publicUrl = `${cdnUrl}/${s3Key}`;
    await db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: `TENANT#${tenantId}`,
            SK: `ASSET#${assetId}`,
            id: assetId,
            tenantId,
            fileName: filename,
            filename, // keep for backward compat
            s3Key,
            publicUrl,
            url: publicUrl, // keep for backward compat
            fileType: contentType,
            contentType, // keep for backward compat
            uploadedBy,
            createdAt: new Date().toISOString(),
            Type: "Asset",
        },
    }));

    return { kind: "copied", cdnUrl: publicUrl };
}

/**
 * Download an image from a URL, upload to S3, record as ASSET# in DynamoDB. Returns the public CDN URL; throws when
 * the destination policy refuses the source or the source is not an accepted image (`describeCopyFailure`).
 */
export async function downloadAndUploadImage(
    tenantId: string,
    imageUrl: string,
    bucket: string,
    cdnUrl: string,
    uploadedBy: string,
): Promise<string> {
    const result = await copyImageToTenantMedia(tenantId, imageUrl, bucket, cdnUrl, uploadedBy);
    if (result.kind !== "copied") throw new Error(describeCopyFailure(result));
    return result.cdnUrl;
}
