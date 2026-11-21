/**
 * SCHED-1D1 (docs/slices/sched-1.md § 9.2, SCHED-ADDR-LIMIT = A) — the client address of a booking request, as one
 * pure rule for its two callers: the renderer booking proxy (`viewerAddress`, `sched-1g`) and the backend hold route
 * (`addressKey`, `sched-1d2`). One module, so the key cannot differ between them. PROTOTYPE.
 *
 * Pure: no `node:net`. `@amodx/shared` is also bundled into the admin browser app, so the address check is written
 * here; its contract is `net.isIP(address) !== 0` minus zone ids (§ 9.2 table), and the unit tests compare it with
 * `node:net` on every example.
 *
 * Abstraction line (§ 9.2): users — the renderer proxy and the backend hold route; axis — none (one rule for two
 * callers); rejected — one copy in each workspace.
 */
import type { Result } from "./zoned-time.js";

/**
 * The viewer address chosen from one header value, normalized (§ 9.2).
 *
 * - `source: "xff"` (`X-Forwarded-For`): entries split on `,` and trimmed, `e[0] … e[n−1]`; the last `k` were
 *   appended by CloudFront and the hops after it, so the viewer is `e[n − k]`; the entries before it came from the
 *   client and are ignored whatever they contain. `n < k` → `invalid`.
 * - `source: "cva"` (`CloudFront-Viewer-Address`): one value `address:port`; `k` is not read.
 *
 * `undefined` → `missing`. The chosen entry must have one of the accepted forms of § 9.2, else `invalid`. The
 * result is the normalized address: IPv4 as is; an IPv4-mapped IPv6 address as its IPv4 address; other IPv6 in
 * lower-case canonical compressed form (RFC 5952). The header value is never part of a result or an error.
 *
 * The backend reads the address the renderer sent with `viewerAddress(value, "xff", 1)`: one entry, so the same
 * forms and the same normalization apply, and an invalid value is treated as missing.
 */
export function viewerAddress(header: string | undefined, source: "xff" | "cva", k: number): Result<string, "missing" | "invalid"> {
    if (header === undefined) return { ok: false, error: "missing" };
    let chosen: string | null;
    switch (source) {
        case "xff": {
            if (!Number.isInteger(k) || k < 1) throw new Error("viewerAddress: k must be an integer >= 1");
            const entries = header.split(",").map((e) => e.trim());
            if (entries.length < k) return { ok: false, error: "invalid" };
            chosen = addressOfForwardedEntry(entries[entries.length - k]);
            break;
        }
        case "cva":
            chosen = addressOfViewerAddress(header.trim());
            break;
        default:
            return assertNever(source);
    }
    const normalized = chosen === null ? null : normalizeIp(chosen);
    return normalized === null ? { ok: false, error: "invalid" } : { ok: true, value: normalized };
}

/**
 * The key one counter of the address limit uses (§ 9.2): IPv4 → the address; IPv6 → its `/64` prefix in canonical
 * form, e.g. `2001:db8:1:2::/64` (one subscriber usually holds a /64). Input: a normalized address from
 * `viewerAddress`. Anything else is a caller error and throws (the caller treats an invalid value as missing first).
 */
export function addressKey(ip: string): string {
    const v4 = parseIpv4(ip);
    if (v4 !== null) return v4.join(".");
    const v6 = parseIpv6(ip);
    if (v6 === null) throw new Error("addressKey: not a normalized IP address");
    const mapped = mappedIpv4(v6);
    if (mapped !== null) return mapped;
    return `${formatIpv6([...v6.slice(0, 4), 0, 0, 0, 0])}/64`;
}

// ---------------------------------------------------------------------------------------------------------------
// Accepted forms of the chosen entry (§ 9.2 table). Each returns the address text, or null when the form is not one
// of the table's rows.
// ---------------------------------------------------------------------------------------------------------------

const PORT = /^[0-9]{1,5}$/;

/** `X-Forwarded-For` entry: IPv4; IPv4 with port (exactly one `:`); bracketed IPv6 with or without port; bare IPv6. */
function addressOfForwardedEntry(entry: string): string | null {
    if (entry.startsWith("[")) return bracketed(entry);
    const colons = entry.split(":").length - 1;
    if (colons === 0) return entry;
    if (colons === 1) return ipv4WithPort(entry);
    return entry; // bare IPv6 (two or more `:`): the whole entry, never a port
}

/** `CloudFront-Viewer-Address`: IPv4 (with or without port); bracketed IPv6; unbracketed IPv6 + `:port`. */
function addressOfViewerAddress(value: string): string | null {
    if (value.startsWith("[")) return bracketed(value);
    const colons = value.split(":").length - 1;
    if (colons === 0) return value;
    if (colons === 1) return ipv4WithPort(value);
    const last = value.lastIndexOf(":");
    return PORT.test(value.slice(last + 1)) ? value.slice(0, last) : null; // the value always carries a port
}

function ipv4WithPort(text: string): string | null {
    const [address, port] = text.split(":");
    return PORT.test(port) && parseIpv4(address) !== null ? address : null;
}

/** `[v6]` or `[v6]:port`; the inside must be IPv6 (the table lists bracketed IPv6 only). */
function bracketed(text: string): string | null {
    const close = text.indexOf("]");
    if (close < 0) return null;
    const inside = text.slice(1, close);
    const rest = text.slice(close + 1);
    if (rest !== "" && !(rest.startsWith(":") && PORT.test(rest.slice(1)))) return null;
    return inside.includes(":") ? inside : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------------------------------------------

/** A valid address → its normalized text (mapped IPv4 → IPv4; IPv6 canonical); else null. Zone ids are invalid. */
function normalizeIp(text: string): string | null {
    const v4 = parseIpv4(text);
    if (v4 !== null) return v4.join(".");
    const v6 = parseIpv6(text);
    if (v6 === null) return null;
    return mappedIpv4(v6) ?? formatIpv6(v6);
}

/** Dotted decimal, four parts 0-255, no leading zero (the forms `net.isIPv4` accepts). */
function parseIpv4(text: string): number[] | null {
    const parts = text.split(".");
    if (parts.length !== 4) return null;
    const out: number[] = [];
    for (const p of parts) {
        if (!/^(0|[1-9][0-9]{0,2})$/.test(p)) return null;
        const n = Number(p);
        if (n > 255) return null;
        out.push(n);
    }
    return out;
}

/** Eight 16-bit groups, or null. Accepts `::` once, 1-4 hex digits per group, an IPv4 tail; no zone id. */
function parseIpv6(text: string): number[] | null {
    if (text.length === 0 || !/^[0-9A-Fa-f:.]+$/.test(text)) return null;
    const halves = text.split("::");
    if (halves.length > 2) return null;
    const groupsOf = (half: string, last: boolean): number[] | null => {
        if (half === "") return [];
        const out: number[] = [];
        const parts = half.split(":");
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (last && i === parts.length - 1 && p.includes(".")) {
                const v4 = parseIpv4(p);
                if (v4 === null) return null;
                out.push(v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]);
            } else if (/^[0-9A-Fa-f]{1,4}$/.test(p)) {
                out.push(parseInt(p, 16));
            } else {
                return null;
            }
        }
        return out;
    };
    if (halves.length === 1) {
        const groups = groupsOf(halves[0], true);
        return groups !== null && groups.length === 8 ? groups : null;
    }
    const head = groupsOf(halves[0], false);
    const tail = groupsOf(halves[1], true);
    if (head === null || tail === null || head.length + tail.length > 7) return null;
    return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/** `::ffff:a.b.c.d` (in any spelling) → `a.b.c.d`; else null. */
function mappedIpv4(groups: number[]): string | null {
    if (!groups.slice(0, 5).every((g) => g === 0) || groups[5] !== 0xffff) return null;
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
}

/** RFC 5952: lower case, no leading zeros, the first longest run of two or more zero groups as `::`. */
function formatIpv6(groups: number[]): string {
    let bestStart = -1;
    let bestLen = 0;
    for (let i = 0; i < 8; ) {
        if (groups[i] !== 0) { i++; continue; }
        let j = i;
        while (j < 8 && groups[j] === 0) j++;
        if (j - i > bestLen) { bestStart = i; bestLen = j - i; }
        i = j;
    }
    const hex = groups.map((g) => g.toString(16));
    if (bestLen < 2) return hex.join(":");
    return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLen).join(":")}`;
}

function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
