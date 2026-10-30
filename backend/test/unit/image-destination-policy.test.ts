import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { connect as netConnect, isIP, type AddressInfo, type Socket } from "node:net";

/**
 * CAT-IMAGES-1 — the destination policy of `lib/image-upload.ts` (slice docs/slices/cat-images-1.md § 2.3, § 5, § 7
 * CIM-A1-2/3; spec catalog-mode-1 § 4 CM-D2). No external network: the resolver is a fake table, and the connector —
 * called only with an address that passed the policy — opens a TCP connection to a local server instead, so every
 * hop's HTTP behaviour is real while the address the policy checked is the one the test chose. The production
 * connector's TLS branch (SNI, hostname check, the BOEN pin wiring) is not reached here; the pin itself is a pure
 * decision tested below. `db.js` is mocked only because the module imports it.
 */

vi.mock("../../src/lib/db.js", () => ({ db: { send: vi.fn() }, TABLE_NAME: "test-table" }));

import {
    acceptsTlsConnection, blockedRangeOf, fetchImage, imageTypeOf, MAX_IMAGE_BYTES, MAX_REDIRECT_HOPS,
    type ConnectTarget, type FetchDeps, type TlsVerification,
} from "../../src/lib/image-upload.js";

const PUBLIC = "93.184.216.34";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(50)]);

// ── the prohibited ranges (one row per range; IPv4-mapped private refused, IPv4-mapped public allowed) ───────────────

describe("blockedRangeOf — one row per prohibited range", () => {
    it.each([
        ["127.0.0.1", "loopback 127.0.0.0/8"],
        ["10.1.2.3", "private 10.0.0.0/8 (RFC 1918)"],
        ["172.16.0.1", "private 172.16.0.0/12 (RFC 1918)"],
        ["172.31.255.255", "private 172.16.0.0/12 (RFC 1918)"],
        ["192.168.1.1", "private 192.168.0.0/16 (RFC 1918)"],
        ["169.254.169.254", "link-local 169.254.0.0/16"],
        ["100.64.0.1", "CGNAT 100.64.0.0/10"],
        ["100.127.255.255", "CGNAT 100.64.0.0/10"],
        ["0.0.0.0", "unspecified 0.0.0.0/8"],
        ["::", "unspecified ::/128"],
        ["::1", "loopback ::1/128"],
        ["fc00::1", "unique-local fc00::/7"],
        ["fd00:ec2::254", "unique-local fc00::/7"],
        ["fe80::1", "link-local fe80::/10"],
        ["febf::1", "link-local fe80::/10"],
        ["fe80::1%eth0", "link-local fe80::/10"],
        ["::ffff:127.0.0.1", "IPv4-mapped ::ffff:0:0/96 → loopback 127.0.0.0/8"],
        ["::ffff:10.0.0.1", "IPv4-mapped ::ffff:0:0/96 → private 10.0.0.0/8 (RFC 1918)"],
        ["::ffff:a9fe:a9fe", "IPv4-mapped ::ffff:0:0/96 → link-local 169.254.0.0/16"],
        ["::ffff:100.64.0.1", "IPv4-mapped ::ffff:0:0/96 → CGNAT 100.64.0.0/10"],
        ["0:0:0:0:0:ffff:192.168.0.1", "IPv4-mapped ::ffff:0:0/96 → private 192.168.0.0/16 (RFC 1918)"],
    ])("%s → refused (%s)", (address, range) => {
        expect(blockedRangeOf(address)).toBe(range);
    });

    it.each([
        ["93.184.216.34"], ["8.8.8.8"], ["172.32.0.1"], ["172.15.255.255"], ["100.128.0.1"], ["169.253.255.255"],
        ["2606:4700:4700::1111"], ["fec0::1"], ["::ffff:93.184.216.34"], ["::ffff:5db8:d822"],
    ])("%s → allowed (public; an IPv4-mapped public address is allowed)", (address) => {
        expect(blockedRangeOf(address)).toBeNull();
    });

    it("a value that is not an IP address is refused (fail closed)", () => {
        expect(blockedRangeOf("example.com")).toBe("not an IP address");
        expect(blockedRangeOf("1::2::3")).toBe("not an IP address");
    });
});

// ── the BOEN pin (CIM-A1-2) as one pure decision ──────────────────────────────────────────────────────────────────

describe("acceptsTlsConnection — the BOEN expired-certificate pin table", () => {
    const PIN: TlsVerification = {
        kind: "failed",
        host: "coreapi.boen.com",
        authorizationError: "CERT_HAS_EXPIRED",
        fingerprint256: "4C:5E:21:C9:A9:2D:A3:1F:11:5C:15:38:EA:42:AB:49:9F:E0:1C:E2:0C:81:6C:D1:33:BE:88:39:66:42:6F:27",
        hostnameCheckPassed: true,
    };

    it("all four conditions true → accepted", () => {
        expect(acceptsTlsConnection(PIN)).toBe(true);
    });

    it.each([
        ["another host", { host: "boen.com" }],
        ["a host that only ends like it", { host: "evil-coreapi.boen.com" }],
        ["another verification error", { authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT" }],
        ["the hostname check failed", { hostnameCheckPassed: false }],
        ["another certificate", { fingerprint256: PIN.kind === "failed" ? PIN.fingerprint256.replace(/27$/, "28") : "" }],
    ])("%s alone → refused", (_label, change) => {
        expect(acceptsTlsConnection({ ...PIN, ...change } as TlsVerification)).toBe(false);
    });

    it("a valid certificate → the normal path (accepted, the pin is not consulted)", () => {
        expect(acceptsTlsConnection({ kind: "verified" })).toBe(true);
    });
});

describe("imageTypeOf — the magic bytes decide the stored type", () => {
    it("JPEG, PNG, WebP recognised; HTML, GIF, empty refused", () => {
        expect(imageTypeOf(JPEG)).toBe("image/jpeg");
        expect(imageTypeOf(PNG)).toBe("image/png");
        expect(imageTypeOf(WEBP)).toBe("image/webp");
        expect(imageTypeOf(Buffer.from("<!DOCTYPE html><html>"))).toBeNull();
        expect(imageTypeOf(Buffer.from("GIF89a......"))).toBeNull();
        expect(imageTypeOf(Buffer.alloc(0))).toBeNull();
    });
});

// ── fetchImage over a local server ────────────────────────────────────────────────────────────────────────────────

let server: Server;
let port: number;
const hangingSockets: Socket[] = [];

beforeAll(async () => {
    server = createServer((req, res) => {
        const path = req.url ?? "/";
        const chain = path.match(/^\/chain\/(\d+)$/);
        if (chain) {
            const n = Number(chain[1]);
            if (n === 0) { res.writeHead(200, { "content-type": "image/jpeg" }); res.end(JPEG); return; }
            res.writeHead(302, { location: `/chain/${n - 1}` }); res.end(); return;
        }
        switch (path) {
            case "/img.jpg": res.writeHead(200, { "content-type": "image/jpeg" }); res.end(JPEG); return;
            case "/no-type.png": res.writeHead(200); res.end(PNG); return;
            // The BNR shape: an HTML page served with an image content type.
            case "/html-as-jpeg": res.writeHead(200, { "content-type": "image/jpeg" }); res.end("<!DOCTYPE html><html><body>moved</body></html>"); return;
            case "/to-private": res.writeHead(302, { location: "http://internal.test/secret.jpg" }); res.end(); return;
            case "/to-ftp": res.writeHead(301, { location: "ftp://img.test/x.jpg" }); res.end(); return;
            case "/missing": res.writeHead(404, { "content-type": "text/html" }); res.end("<h1>not found</h1>"); return;
            case "/big": {
                res.writeHead(200, { "content-type": "image/jpeg" });
                res.end(Buffer.concat([JPEG, Buffer.alloc(MAX_IMAGE_BYTES)]));
                return;
            }
            case "/at-cap": {
                res.writeHead(200, { "content-type": "image/jpeg" });
                res.end(Buffer.concat([JPEG, Buffer.alloc(MAX_IMAGE_BYTES - JPEG.length)]));
                return;
            }
            case "/hang": hangingSockets.push(req.socket); return; // headers never sent
            default: res.writeHead(500); res.end();
        }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
    for (const s of hangingSockets) s.destroy();
    await new Promise((r) => server.close(r));
});

const DNS: Record<string, { address: string; family: number }[]> = {
    "img.test": [{ address: PUBLIC, family: 4 }],
    "internal.test": [{ address: "10.0.0.5", family: 4 }],
    "mixed.test": [{ address: PUBLIC, family: 4 }, { address: "192.168.0.10", family: 4 }],
    "mapped.test": [{ address: "::ffff:93.184.216.34", family: 6 }],
};

/** A fake resolver and a connector that reaches the local server; both record their calls. */
function deps(deadlineMs = 5_000) {
    const resolved: string[] = [];
    const targets: ConnectTarget[] = [];
    const d: FetchDeps = {
        resolve: async (host) => {
            resolved.push(host);
            if (isIP(host)) return [{ address: host, family: isIP(host) }]; // as dns.lookup answers a literal
            const answer = DNS[host];
            if (!answer) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
            return answer;
        },
        connect: (target, signal) => new Promise((resolve, reject) => {
            targets.push(target);
            const socket = netConnect({ host: "127.0.0.1", port });
            signal.addEventListener("abort", () => socket.destroy(), { once: true });
            socket.once("connect", () => resolve(socket));
            socket.once("error", reject);
        }),
        deadlineMs,
    };
    return { deps: d, resolved, targets };
}

const url = (host: string, path: string) => `http://${host}:${port}${path}`;

describe("fetchImage — the policy per hop", () => {
    it("an allowed host: one resolution, the connection goes to the CHECKED address; the type comes from the bytes", async () => {
        const d = deps();
        const result = await fetchImage(url("img.test", "/img.jpg"), d.deps);
        expect(result.kind).toBe("fetched");
        if (result.kind === "fetched") {
            expect(result.contentType).toBe("image/jpeg");
            expect(result.body.equals(JPEG)).toBe(true);
        }
        expect(d.resolved).toEqual(["img.test"]);
        expect(d.targets).toEqual([{ protocol: "http:", host: "img.test", address: PUBLIC, family: 4, port }]);
    });

    it("a PNG served without any content-type → stored as image/png (magic bytes, not the header)", async () => {
        const result = await fetchImage(url("img.test", "/no-type.png"), deps().deps);
        expect(result).toMatchObject({ kind: "fetched", contentType: "image/png" });
    });

    it("an IPv4-mapped public address → allowed", async () => {
        const result = await fetchImage(url("mapped.test", "/img.jpg"), deps().deps);
        expect(result.kind).toBe("fetched");
    });

    it("a private IP literal → refused before any connection", async () => {
        const d = deps();
        const result = await fetchImage("http://169.254.169.254/latest/meta-data", d.deps);
        expect(result).toEqual({ kind: "refused", rule: "169.254.169.254 resolves to 169.254.169.254: link-local 169.254.0.0/16" });
        expect(d.targets).toEqual([]);
    });

    it("a host resolving to one public and one private address → refused (ANY address), no connection", async () => {
        const d = deps();
        const result = await fetchImage(url("mixed.test", "/img.jpg"), d.deps);
        expect(result).toEqual({ kind: "refused", rule: "mixed.test resolves to 192.168.0.10: private 192.168.0.0/16 (RFC 1918)" });
        expect(d.targets).toEqual([]);
    });

    it.each([["ftp://img.test/x.jpg", "scheme ftp:"], ["file:///etc/passwd", "scheme file:"], ["data:image/png;base64,AAAA", "scheme data:"]])(
        "%s → refused (%s)", async (source, scheme) => {
            const d = deps();
            const result = await fetchImage(source, d.deps);
            expect(result).toEqual({ kind: "refused", rule: `${scheme} (only http and https)` });
            expect(d.resolved).toEqual([]);
        },
    );

    it("a 302 to a private address → refused AT THE HOP, the private address is never connected", async () => {
        const d = deps();
        const result = await fetchImage(url("img.test", "/to-private"), d.deps);
        expect(result).toEqual({
            kind: "refused",
            rule: "redirect 1 to http://internal.test/secret.jpg: internal.test resolves to 10.0.0.5: private 10.0.0.0/8 (RFC 1918)",
        });
        expect(d.resolved).toEqual(["img.test", "internal.test"]);
        expect(d.targets.map((t) => t.address)).toEqual([PUBLIC]);
    });

    it("a 301 to another scheme → refused at the hop", async () => {
        const result = await fetchImage(url("img.test", "/to-ftp"), deps().deps);
        expect(result).toEqual({ kind: "refused", rule: "redirect 1 to ftp://img.test/x.jpg: scheme ftp: (only http and https)" });
    });

    it(`a ${MAX_REDIRECT_HOPS}-hop chain → accepted; every hop resolved and checked again`, async () => {
        const d = deps();
        const result = await fetchImage(url("img.test", "/chain/3"), d.deps);
        expect(result.kind).toBe("fetched");
        expect(d.resolved).toHaveLength(4);
        expect(d.targets).toHaveLength(4);
    });

    it("a 4-hop chain → refused at the 4th redirect, which is not followed", async () => {
        const d = deps();
        const result = await fetchImage(url("img.test", "/chain/4"), d.deps);
        expect(result).toEqual({ kind: "refused", rule: "more than 3 redirects" });
        expect(d.targets).toHaveLength(4);
    });
});

describe("fetchImage — after the policy: content, size, deadline", () => {
    it("text/html served as image/jpeg (the BNR shape) → failed, not an image, with what was received", async () => {
        const result = await fetchImage(url("img.test", "/html-as-jpeg"), deps().deps);
        expect(result).toEqual({
            kind: "failed",
            failure: { kind: "http", reason: "not-image", status: 200, contentType: "image/jpeg", bytes: 46 },
        });
    });

    it("a 404 → failed with status, content-type and bytes", async () => {
        const result = await fetchImage(url("img.test", "/missing"), deps().deps);
        expect(result).toEqual({ kind: "failed", failure: { kind: "http", reason: "status", status: 404, contentType: "text/html", bytes: 18 } });
    });

    it(`a body over the cap (${MAX_IMAGE_BYTES} bytes) → failed too-large; a body of exactly the cap → accepted`, async () => {
        const over = await fetchImage(url("img.test", "/big"), deps().deps);
        expect(over.kind).toBe("failed");
        if (over.kind === "failed" && over.failure.kind === "http") {
            expect(over.failure.reason).toBe("too-large");
            expect(over.failure.bytes).toBeGreaterThan(MAX_IMAGE_BYTES);
        } else {
            throw new Error(`unexpected ${JSON.stringify(over)}`);
        }
        const at = await fetchImage(url("img.test", "/at-cap"), deps().deps);
        expect(at.kind).toBe("fetched");
    });

    it("a server that never answers → failed ETIMEDOUT at the deadline (CIM-A1-3: an error code, no HTTP fields)", async () => {
        const started = Date.now();
        const result = await fetchImage(url("img.test", "/hang"), deps(300).deps);
        expect(result).toEqual({ kind: "failed", failure: { kind: "error", code: "ETIMEDOUT" } });
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it("a DNS failure → failed with its code", async () => {
        const result = await fetchImage(url("unknown.test", "/img.jpg"), deps().deps);
        expect(result).toEqual({ kind: "failed", failure: { kind: "error", code: "ENOTFOUND" } });
    });

    it("a resolver that never answers → failed ETIMEDOUT at the deadline", async () => {
        const d = deps(200);
        const result = await fetchImage(url("img.test", "/img.jpg"), { ...d.deps, resolve: () => new Promise(() => {}) });
        expect(result).toEqual({ kind: "failed", failure: { kind: "error", code: "ETIMEDOUT" } });
    });
});
