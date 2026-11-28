import { describe, expect, it } from "vitest";
import { canonicalize, canonicalJson, differingPaths, pathText, sha256Hex, type HashedItem } from "../../../scripts/commerce-private-table/canonical-item.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md § "Canonical form and hash") — the ONE definition of item equality that the manifest,
 * `verify --strict`, `verify --post-cutover`, purge and discard use. Items are in DynamoDB wire form.
 */

const bytes = (...values: number[]) => new Uint8Array(values);

/** An item that uses every DynamoDB type, with nesting three deep. */
const full = () => ({
    PK: { S: "TENANT#t1" },
    SK: { S: "ORDER#o1" },
    status: { S: "placed" },
    empty: { S: "" },
    total: { N: "12.50" },
    paid: { BOOL: false },
    phone: { NULL: true },
    items: { L: [{ M: { name: { S: "Ring" }, quantity: { N: "1" }, options: { L: [{ S: "gold" }, { M: { size: { N: "52" } } }] } } }] },
    address: { M: { city: { S: "Cluj" }, geo: { M: { lat: { N: "46.77" } } } } },
    tags: { SS: ["b", "a"] },
    sizes: { NS: ["52", "7"] },
    blob: { B: bytes(1, 2, 3) },
    blobs: { BS: [bytes(9), bytes(1, 2)] },
});

const hashed = (item: unknown): HashedItem => {
    const result = canonicalize(item);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    return result.value;
};
const refusal = (item: unknown) => {
    const result = canonicalize(item);
    if (result.ok) throw new Error("accepted");
    return result.error;
};

/** A deep copy with one change applied. */
const changed = (change: (item: any) => void) => {
    const item = structuredClone(full()) as any;
    change(item);
    return item;
};

describe("canonicalize: the canonical form", () => {
    it("gives the key, a canonical tree with sorted attribute names, and the SHA-256 of its JSON", () => {
        const item = hashed({ SK: { S: "ORDER#o1" }, b: { N: "2" }, PK: { S: "TENANT#t1" }, a: { M: { z: { S: "x" }, y: { BOOL: true } } } });
        expect(item.key).toEqual({ pk: "TENANT#t1", sk: "ORDER#o1" });
        expect(canonicalJson(item.canonical)).toBe('{"PK":{"S":"TENANT#t1"},"SK":{"S":"ORDER#o1"},"a":{"M":{"y":{"BOOL":true},"z":{"S":"x"}}},"b":{"N":"2"}}');
        expect(item.sha256).toBe(sha256Hex(canonicalJson(item.canonical)));
        expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("attribute order does not matter, at any depth", () => {
        const reordered = {
            blobs: { BS: [bytes(9), bytes(1, 2)] }, blob: { B: bytes(1, 2, 3) }, sizes: { NS: ["52", "7"] }, tags: { SS: ["b", "a"] },
            address: { M: { geo: { M: { lat: { N: "46.77" } } }, city: { S: "Cluj" } } },
            items: { L: [{ M: { options: { L: [{ S: "gold" }, { M: { size: { N: "52" } } }] }, quantity: { N: "1" }, name: { S: "Ring" } } }] },
            phone: { NULL: true }, paid: { BOOL: false }, total: { N: "12.50" }, empty: { S: "" }, status: { S: "placed" },
            SK: { S: "ORDER#o1" }, PK: { S: "TENANT#t1" },
        };
        expect(hashed(reordered).sha256).toBe(hashed(full()).sha256);
    });

    it("set members have no order; list members have one", () => {
        expect(hashed(changed((i) => { i.tags.SS = ["a", "b"]; })).sha256).toBe(hashed(full()).sha256);
        expect(hashed(changed((i) => { i.sizes.NS = ["7", "52"]; })).sha256).toBe(hashed(full()).sha256);
        expect(hashed(changed((i) => { i.blobs.BS = [bytes(1, 2), bytes(9)]; })).sha256).toBe(hashed(full()).sha256);
        expect(hashed(changed((i) => { i.items.L[0].M.options.L.reverse(); })).sha256).not.toBe(hashed(full()).sha256);
    });

    it("two items that differ at any depth hash differently, and the differing attribute path is named", () => {
        const base = hashed(full());
        const cases: [string, (item: any) => void, string][] = [
            ["a top-level string", (i) => { i.status.S = "shipped"; }, '["status"]'],
            ["one more attribute", (i) => { i.note = { S: "x" }; }, '["note"]'],
            ["one attribute less", (i) => { delete i.paid; }, '["paid"]'],
            ["a number", (i) => { i.total.N = "12.51"; }, '["total"]'],
            ["a map member, two deep", (i) => { i.address.M.geo.M.lat.N = "46.78"; }, '["address","geo","lat"]'],
            ["a new map member", (i) => { i.address.M.zip = { S: "400000" }; }, '["address","zip"]'],
            ["a list member's attribute", (i) => { i.items.L[0].M.quantity.N = "2"; }, '["items",0,"quantity"]'],
            ["a list inside a map inside a list", (i) => { i.items.L[0].M.options.L[1].M.size.N = "53"; }, '["items",0,"options",1,"size"]'],
            ["a longer list", (i) => { i.items.L.push({ M: {} }); }, '["items",1]'],
            ["a string set member", (i) => { i.tags.SS = ["a", "c"]; }, '["tags"]'],
            ["a number set member", (i) => { i.sizes.NS = ["52", "8"]; }, '["sizes"]'],
            ["one binary byte", (i) => { i.blob.B = bytes(1, 2, 4); }, '["blob"]'],
            ["a binary set member", (i) => { i.blobs.BS = [bytes(9), bytes(1, 3)]; }, '["blobs"]'],
            ["a boolean", (i) => { i.paid.BOOL = true; }, '["paid"]'],
            ["null replaced by a string", (i) => { i.phone = { S: "" }; }, '["phone"]'],
            ["the sort key", (i) => { i.SK.S = "ORDER#o2"; }, '["SK"]'],
        ];
        const hashes = new Set([base.sha256]);
        for (const [name, change, path] of cases) {
            const other = hashed(changed(change));
            expect(other.sha256, name).not.toBe(base.sha256);
            expect(differingPaths(base.canonical, other.canonical).map(pathText), name).toEqual([path]);
            hashes.add(other.sha256);
        }
        expect(hashes.size).toBe(cases.length + 1);
    });

    it("differingPaths returns no path exactly when the canonical JSON texts are equal", () => {
        const variants = [full(), changed((i) => { i.tags.SS = ["a", "b"]; }), changed((i) => { i.total.N = "12.5"; }), changed((i) => { i.items.L = []; })].map(hashed);
        for (const a of variants) {
            for (const b of variants) {
                expect(differingPaths(a.canonical, b.canonical).length === 0).toBe(canonicalJson(a.canonical) === canonicalJson(b.canonical));
            }
        }
    });

    it("a number is compared as the text DynamoDB returned: digits a JavaScript number cannot hold are kept", () => {
        const item = (n: string) => hashed({ PK: { S: "p" }, SK: { S: "s" }, n: { N: n } });
        // As JavaScript numbers these two are the same value (both are 12345678901234567000).
        expect(Number("12345678901234567890")).toBe(Number("12345678901234567891"));
        expect(item("12345678901234567890").sha256).not.toBe(item("12345678901234567891").sha256);
        expect(item("0.12345678901234567890123456789012345678").sha256).not.toBe(item("0.12345678901234567890123456789012345679").sha256);
        expect(canonicalJson(item("1E+100").canonical)).toContain('"n":{"N":"1E+100"}');
        expect(item("-0.5").sha256).toBe(item("-0.5").sha256);
    });

    it("the type is part of the value: string, number, boolean, null, empty string and absent all differ", () => {
        const item = (extra: object) => hashed({ PK: { S: "p" }, SK: { S: "s" }, ...extra }).sha256;
        const all = [item({}), item({ a: { S: "1" } }), item({ a: { N: "1" } }), item({ a: { BOOL: true } }), item({ a: { BOOL: false } }), item({ a: { NULL: true } }), item({ a: { S: "" } }), item({ a: { SS: ["1"] } }), item({ a: { NS: ["1"] } }), item({ a: { L: [] } }), item({ a: { M: {} } })];
        expect(new Set(all).size).toBe(all.length);
    });

    it("binary values are compared byte by byte (base64 in the canonical form)", () => {
        expect(canonicalJson(hashed({ PK: { S: "p" }, SK: { S: "s" }, b: { B: bytes(0, 255, 16) } }).canonical)).toContain('"b":{"B":"AP8Q"}');
    });

    it("an attribute named __proto__ or constructor is an attribute like every other", () => {
        const withProto = JSON.parse('{"PK":{"S":"p"},"SK":{"S":"s"},"__proto__":{"S":"x"},"constructor":{"S":"y"}}');
        const plain = hashed({ PK: { S: "p" }, SK: { S: "s" } });
        expect(hashed(withProto).sha256).not.toBe(plain.sha256);
        expect(differingPaths(plain.canonical, hashed(withProto).canonical).map(pathText)).toEqual(['["__proto__"]', '["constructor"]']);
    });
});

describe("canonicalize: refused, never guessed", () => {
    const key = { PK: { S: "p" }, SK: { S: "s" } };
    it.each([
        ["an item that is not a map", "text", [], "notAnAttributeMap"],
        ["a value with no type tag", { ...key, a: {} }, ["a"], "notOneTypeTag"],
        ["a value with two type tags", { ...key, a: { S: "1", N: "1" } }, ["a"], "notOneTypeTag"],
        ["a plain JavaScript value (document-client form)", { ...key, a: "text" }, ["a"], "notOneTypeTag"],
        ["a type the SDK does not know", { ...key, a: { $unknown: ["X", 1] } }, ["a"], "unknownTypeTag"],
        ["a number that is a JavaScript number", { ...key, a: { N: 1 } }, ["a"], "malformedPayload"],
        ["a number text that is not a number", { ...key, a: { N: "NaN" } }, ["a"], "malformedPayload"],
        ["NULL that is not true", { ...key, a: { NULL: false } }, ["a"], "malformedPayload"],
        ["binary that is not bytes", { ...key, a: { B: "AP8Q" } }, ["a"], "malformedPayload"],
        ["a number set with a non-number member", { ...key, a: { NS: ["1", "x"] } }, ["a"], "malformedPayload"],
        ["a string set with a non-string member", { ...key, a: { SS: ["1", 2] } }, ["a"], "malformedPayload"],
        ["a list that is not a list", { ...key, a: { L: {} } }, ["a"], "malformedPayload"],
        ["a malformed value deep inside", { ...key, a: { L: [{ M: { b: { N: 5 } } }] } }, ["a", 0, "b"], "malformedPayload"],
        ["an item without PK", { SK: { S: "s" } }, ["PK"], "keyNotAString"],
        ["an item whose SK is a number", { PK: { S: "p" }, SK: { N: "1" } }, ["SK"], "keyNotAString"],
    ])("%s", (_name, item, path, reason) => {
        expect(refusal(item)).toEqual({ path, reason });
    });
});
