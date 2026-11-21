import { describe, it, expect } from "vitest";
import { isIP } from "node:net";
import { viewerAddress, addressKey } from "../src/index.js";

/**
 * SCHED-1D1 — row D11, the unit part (docs/slices/sched-1.md § 9.2, § 17.3): every example and every invalid form of
 * § 9.2, with `k = 1` and `k = 2`; `addressKey` of IPv4, IPv6 and a mapped IPv4. The hold-route part of D11
 * (`x-viewer-address` from a RENDERER call, from another role, absent) waits for `sched-1d2`, which builds the route.
 *
 * The module is pure (no `node:net`: `@amodx/shared` is bundled into the browser). The last block compares its
 * address check with `node:net` `isIP` on every address these tests use, so "valid" means what § 9.2 says it means.
 */

const ok = (value: string) => ({ ok: true, value });
const invalid = { ok: false, error: "invalid" };

describe("D11 viewerAddress — X-Forwarded-For, the § 9.2 example table (k = 1, then k = 2)", () => {
    it("D11 `198.51.100.4` → e[0] (no client header: a single entry is valid)", () => {
        expect(viewerAddress("198.51.100.4", "xff", 1)).toEqual(ok("198.51.100.4"));
    });
    it("D11 `203.0.113.7, 198.51.100.4` → e[1]", () => {
        expect(viewerAddress("203.0.113.7, 198.51.100.4", "xff", 1)).toEqual(ok("198.51.100.4"));
    });
    it("D11 `1.1.1.1, garbage, 198.51.100.4` → e[2]; the client entries are ignored whatever they contain", () => {
        expect(viewerAddress("1.1.1.1, garbage, 198.51.100.4", "xff", 1)).toEqual(ok("198.51.100.4"));
    });
    it("D11 `203.0.113.7, 2001:db8::5` → e[1] = 2001:db8::5", () => {
        expect(viewerAddress("203.0.113.7, 2001:db8::5", "xff", 1)).toEqual(ok("2001:db8::5"));
    });
    it("D11 (k = 2) `203.0.113.7, 198.51.100.4, 130.176.0.1` → e[1] = 198.51.100.4", () => {
        expect(viewerAddress("203.0.113.7, 198.51.100.4, 130.176.0.1", "xff", 2)).toEqual(ok("198.51.100.4"));
    });
    it("D11 (k = 2) one entry only → invalid (n < k); (k = 2) two entries → e[0]", () => {
        expect(viewerAddress("198.51.100.4", "xff", 2)).toEqual(invalid);
        expect(viewerAddress("198.51.100.4, 130.176.0.1", "xff", 2)).toEqual(ok("198.51.100.4"));
    });
    it("D11 (k = 2) a forged client entry is never chosen", () => {
        expect(viewerAddress("6.6.6.6, 198.51.100.4, 130.176.0.1", "xff", 2)).toEqual(ok("198.51.100.4"));
        expect(viewerAddress("6.6.6.6, 7.7.7.7, 198.51.100.4, 130.176.0.1", "xff", 2)).toEqual(ok("198.51.100.4"));
    });
    it("D11 absent header → missing (no address limit for the request)", () => {
        expect(viewerAddress(undefined, "xff", 1)).toEqual({ ok: false, error: "missing" });
        expect(viewerAddress(undefined, "cva", 1)).toEqual({ ok: false, error: "missing" });
    });
});

describe("D11 viewerAddress — accepted forms of the chosen entry (§ 9.2), both k", () => {
    for (const k of [1, 2]) {
        const tail = k === 2 ? ", 130.176.0.1" : "";
        it(`D11 (k = ${k}) IPv4 as is; IPv4 with port → before the ':'`, () => {
            expect(viewerAddress(`198.51.100.4${tail}`, "xff", k)).toEqual(ok("198.51.100.4"));
            expect(viewerAddress(`198.51.100.4:4431${tail}`, "xff", k)).toEqual(ok("198.51.100.4"));
        });
        it(`D11 (k = ${k}) bracketed IPv6, with and without port → inside the brackets`, () => {
            expect(viewerAddress(`[2001:db8::5]${tail}`, "xff", k)).toEqual(ok("2001:db8::5"));
            expect(viewerAddress(`[2001:db8::5]:4431${tail}`, "xff", k)).toEqual(ok("2001:db8::5"));
        });
        it(`D11 (k = ${k}) bare IPv6 → the whole entry, never a port`, () => {
            // In X-Forwarded-For `2001:db8::5:4431` is an address with eight groups, not an address and a port.
            expect(viewerAddress(`2001:db8::5:4431${tail}`, "xff", k)).toEqual(ok("2001:db8::5:4431"));
        });
        it(`D11 (k = ${k}) every invalid form of § 9.2 → invalid`, () => {
            for (const bad of ["", "999.1.1.1", "[2001:db8::5", "fe80::1%eth0", "1.2.3.4:abc"]) {
                expect({ bad, r: viewerAddress(`${bad}${tail}`, "xff", k) }).toEqual({ bad, r: invalid });
            }
        });
        it(`D11 (k = ${k}) more invalid forms: a port of 6 digits, an IPv4 in brackets, a leading zero, text`, () => {
            for (const bad of ["1.2.3.4:123456", "[198.51.100.4]", "01.2.3.4", "garbage", "[2001:db8::5]x", "1.2.3.4:"]) {
                expect({ bad, r: viewerAddress(`${bad}${tail}`, "xff", k) }).toEqual({ bad, r: invalid });
            }
        });
    }
});

describe("D11 viewerAddress — CloudFront-Viewer-Address (candidate 2; one value, k not read)", () => {
    it("D11 IPv4:port → before the ':'; bracketed IPv6:port → inside", () => {
        expect(viewerAddress("198.51.100.4:4431", "cva", 1)).toEqual(ok("198.51.100.4"));
        expect(viewerAddress("[2001:db8::5]:4431", "cva", 1)).toEqual(ok("2001:db8::5"));
    });
    it("D11 unbracketed IPv6 → the text before the LAST ':' when the part after it is 1-5 digits", () => {
        expect(viewerAddress("2001:db8::5:4431", "cva", 1)).toEqual(ok("2001:db8::5"));
        expect(viewerAddress("2001:db8::5:443100", "cva", 1)).toEqual(invalid);
        expect(viewerAddress("2001:db8::5:abc", "cva", 1)).toEqual(invalid);
    });
    it("D11 the invalid forms of § 9.2 → invalid", () => {
        for (const bad of ["", "999.1.1.1:1", "[2001:db8::5", "fe80::1%eth0:443", "1.2.3.4:abc"]) {
            expect({ bad, r: viewerAddress(bad, "cva", 1) }).toEqual({ bad, r: invalid });
        }
    });
});

describe("D11 normalization (§ 9.2)", () => {
    it("D11 IPv4-mapped IPv6 → the IPv4 address (dotted and hex spellings, bracketed or bare)", () => {
        expect(viewerAddress("::ffff:198.51.100.4", "xff", 1)).toEqual(ok("198.51.100.4"));
        expect(viewerAddress("[::FFFF:198.51.100.4]:443", "xff", 1)).toEqual(ok("198.51.100.4"));
        expect(viewerAddress("::ffff:c633:6404", "xff", 1)).toEqual(ok("198.51.100.4"));
    });
    it("D11 IPv6 → lower case, canonical compressed form (RFC 5952)", () => {
        expect(viewerAddress("2001:0DB8:0000:0000:0000:0000:0000:0005", "xff", 1)).toEqual(ok("2001:db8::5"));
        expect(viewerAddress("2001:db8:0:0:1:0:0:1", "xff", 1)).toEqual(ok("2001:db8::1:0:0:1"));     // first longest run
        expect(viewerAddress("2001:db8:0:1:1:1:1:1", "xff", 1)).toEqual(ok("2001:db8:0:1:1:1:1:1")); // one zero group stays
        expect(viewerAddress("::", "xff", 1)).toEqual(ok("::"));
        expect(viewerAddress("::1", "xff", 1)).toEqual(ok("::1"));
    });
    it("D11 the backend's reading of the header the renderer sent (one entry, k = 1): a valid value normalizes, an invalid one is invalid", () => {
        expect(viewerAddress("2001:DB8::5", "xff", 1)).toEqual(ok("2001:db8::5"));
        expect(viewerAddress("not an address", "xff", 1)).toEqual(invalid);
    });
});

describe("D11 addressKey (§ 9.2)", () => {
    it("D11 IPv4 → the address", () => {
        expect(addressKey("198.51.100.4")).toBe("198.51.100.4");
    });
    it("D11 IPv6 → its /64 prefix (the § 9.2 example form)", () => {
        expect(addressKey("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
        expect(addressKey("2001:db8::5")).toBe("2001:db8::/64");
        // Two addresses of one /64 share one key: rotating inside the subscriber's /64 does not reset the count.
        expect(addressKey("2001:db8:1:2::a")).toBe(addressKey("2001:db8:1:2:ffff::1"));
    });
    it("D11 mapped IPv4 → the IPv4 address (the same key as the plain IPv4)", () => {
        expect(addressKey("::ffff:198.51.100.4")).toBe("198.51.100.4");
    });
    it("D11 a value that is not an address is a caller error (throws)", () => {
        expect(() => addressKey("garbage")).toThrow();
    });
});

describe("D11 the address check agrees with node:net isIP (the § 9.2 contract)", () => {
    const addresses = [
        "198.51.100.4", "203.0.113.7", "1.1.1.1", "130.176.0.1", "999.1.1.1", "01.2.3.4", "1.2.3", "255.255.255.255",
        "2001:db8::5", "2001:db8::5:4431", "::ffff:198.51.100.4", "::ffff:c633:6404", "::", "::1", "1::2:3:4:5:6:7",
        "1:2:3:4:5:6:1.2.3.4", "1:2:3:4:5:6:7:1.2.3.4", "00001::", "0001::", "2001:0DB8:0000:0000:0000:0000:0000:0005",
        "garbage", "", "1:2:3:4:5:6:7:8:9", ":::", "1::2::3",
    ];
    it("D11 valid here exactly when isIP(address) !== 0 (zone ids excepted, which § 9.2 refuses and isIP accepts)", () => {
        for (const a of addresses) {
            const here = viewerAddress(a, "xff", 1).ok;
            expect({ a, here }).toEqual({ a, here: isIP(a) !== 0 });
        }
        expect(isIP("fe80::1%eth0")).toBe(6);
        expect(viewerAddress("fe80::1%eth0", "xff", 1)).toEqual(invalid);
    });
});
