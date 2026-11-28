import { createHash } from "node:crypto";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md § "Canonical form and hash"; PROTOTYPE) — the ONE definition of "these two DynamoDB
 * items are equal" for the commerce-private table tool. Users: the inventory, the verification manifest, `migrate`,
 * `verify --strict`, `verify --post-cutover`, `purge`, `discard` and the export lines.
 *
 * Input: an item in DynamoDB wire form, as the low-level client returns it — a map of attribute name to a value that
 * holds exactly one type tag: S, N, BOOL, NULL, M, L, SS, NS, BS, B.
 *
 * Canonical form (the table of the slice document):
 *  - a map (the item itself, and M): attribute names sorted by UTF-16 code unit — attribute order never matters;
 *  - N and the members of NS: the TEXT DynamoDB returned, never converted to a JavaScript number, so a number of any
 *    size or precision is compared digit by digit;
 *  - L: stored order kept; SS, NS, BS: members sorted (a set has no order); B and BS members: base64;
 *  - the type tag stays in the form: the string "1" and the number 1 differ; false, null and "absent" all differ.
 * Canonical JSON = JSON.stringify of that tree. Hash = SHA-256 of its UTF-8 bytes, lower-case hex.
 *
 * Refused, never guessed: a value without exactly one type tag, an unknown tag, a payload of the wrong JavaScript type
 * under its tag, an item without string PK and SK. The caller stops the run; it decides nothing about that item.
 *
 * Pure: no SDK import, no clock, no file. (`node:crypto` computes the hash; it reads nothing.)
 */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** One attribute value in canonical form. `CanonicalMap` keys are in sorted order. */
export type CanonicalValue =
    | { S: string }
    | { N: string }
    | { BOOL: boolean }
    | { NULL: true }
    | { B: string }
    | { SS: string[] }
    | { NS: string[] }
    | { BS: string[] }
    | { L: CanonicalValue[] }
    | { M: CanonicalMap };

export type CanonicalMap = { [attributeName: string]: CanonicalValue };

/** A step into an item: an attribute name, or an index of a list. A path never holds an attribute value. */
export type PathSegment = string | number;

export type CanonicalRefusalReason = "notAnAttributeMap" | "notOneTypeTag" | "unknownTypeTag" | "malformedPayload" | "keyNotAString";

/** Where `canonicalize` stopped and why. `path` is empty when the item itself is not a map. */
export type CanonicalRefusal = { path: PathSegment[]; reason: CanonicalRefusalReason };

export type ItemKey = { pk: string; sk: string };

/** One item, reduced to what the decisions need: its key, its canonical form and the hash of that form. */
export type HashedItem = { key: ItemKey; canonical: CanonicalMap; sha256: string };

const NUMBER_TEXT = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);

const refuse = <T>(path: PathSegment[], reason: CanonicalRefusalReason): Result<T, CanonicalRefusal> => ({ ok: false, error: { path, reason } });

function canonicalMap(raw: unknown, path: PathSegment[]): Result<CanonicalMap, CanonicalRefusal> {
    if (!isPlainObject(raw)) return refuse(path, "notAnAttributeMap");
    // No prototype: an attribute named `__proto__` or `constructor` is then a plain entry like every other name.
    const out: CanonicalMap = Object.create(null);
    for (const name of Object.keys(raw).sort(byCodeUnit)) {
        const value = canonicalValue(raw[name], [...path, name]);
        if (!value.ok) return value;
        out[name] = value.value;
    }
    return { ok: true, value: out };
}

function stringMembers(payload: unknown, path: PathSegment[], accept: (member: string) => boolean): Result<string[], CanonicalRefusal> {
    if (!Array.isArray(payload)) return refuse(path, "malformedPayload");
    const members: string[] = [];
    for (const member of payload) {
        if (typeof member !== "string" || !accept(member)) return refuse(path, "malformedPayload");
        members.push(member);
    }
    return { ok: true, value: members.sort(byCodeUnit) };
}

function canonicalValue(raw: unknown, path: PathSegment[]): Result<CanonicalValue, CanonicalRefusal> {
    if (!isPlainObject(raw)) return refuse(path, "notOneTypeTag");
    const tags = Object.keys(raw).filter((tag) => raw[tag] !== undefined);
    if (tags.length !== 1) return refuse(path, "notOneTypeTag");
    const tag = tags[0];
    const payload = raw[tag];
    switch (tag) {
        case "S":
            return typeof payload === "string" ? { ok: true, value: { S: payload } } : refuse(path, "malformedPayload");
        case "N":
            return typeof payload === "string" && NUMBER_TEXT.test(payload) ? { ok: true, value: { N: payload } } : refuse(path, "malformedPayload");
        case "BOOL":
            return typeof payload === "boolean" ? { ok: true, value: { BOOL: payload } } : refuse(path, "malformedPayload");
        case "NULL":
            return payload === true ? { ok: true, value: { NULL: true } } : refuse(path, "malformedPayload");
        case "B":
            return payload instanceof Uint8Array
                ? { ok: true, value: { B: Buffer.from(payload).toString("base64") } }
                : refuse(path, "malformedPayload");
        case "SS": {
            const members = stringMembers(payload, path, () => true);
            return members.ok ? { ok: true, value: { SS: members.value } } : members;
        }
        case "NS": {
            const members = stringMembers(payload, path, (member) => NUMBER_TEXT.test(member));
            return members.ok ? { ok: true, value: { NS: members.value } } : members;
        }
        case "BS": {
            if (!Array.isArray(payload) || !payload.every((member) => member instanceof Uint8Array)) return refuse(path, "malformedPayload");
            return { ok: true, value: { BS: payload.map((member: Uint8Array) => Buffer.from(member).toString("base64")).sort(byCodeUnit) } };
        }
        case "L": {
            if (!Array.isArray(payload)) return refuse(path, "malformedPayload");
            const members: CanonicalValue[] = [];
            for (let index = 0; index < payload.length; index += 1) {
                const member = canonicalValue(payload[index], [...path, index]);
                if (!member.ok) return member;
                members.push(member.value);
            }
            return { ok: true, value: { L: members } };
        }
        case "M": {
            const map = canonicalMap(payload, path);
            return map.ok ? { ok: true, value: { M: map.value } } : map;
        }
        default:
            // Not a variant of a domain sum: the tag is text from outside (the SDK reports a type it does not know as
            // `$unknown`). Every tag DynamoDB defines has its own case above.
            return refuse(path, "unknownTypeTag");
    }
}

/** The canonical JSON text of a canonical map: the text that is hashed and that an export line stores. */
export const canonicalJson = (canonical: CanonicalMap): string => JSON.stringify(canonical);

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The canonical form and the hash of one item in wire form, with its key. The only function of the tool that decides
 * what an item's content is; every comparison in the tool is a comparison of `sha256` values made here.
 */
export function canonicalize(rawItem: unknown): Result<HashedItem, CanonicalRefusal> {
    const canonical = canonicalMap(rawItem, []);
    if (!canonical.ok) return canonical;
    const pk = canonical.value.PK;
    const sk = canonical.value.SK;
    if (pk === undefined || !("S" in pk)) return refuse(["PK"], "keyNotAString");
    if (sk === undefined || !("S" in sk)) return refuse(["SK"], "keyNotAString");
    return { ok: true, value: { key: { pk: pk.S, sk: sk.S }, canonical: canonical.value, sha256: sha256Hex(canonicalJson(canonical.value)) } };
}

/** A path as report text: a JSON array of attribute names and list indexes, e.g. `["items",2,"price"]`. */
export const pathText = (path: PathSegment[]): string => JSON.stringify(path);

function valuePaths(a: CanonicalValue, b: CanonicalValue, path: PathSegment[], out: PathSegment[][]): void {
    if ("M" in a && "M" in b) {
        mapPaths(a.M, b.M, path, out);
        return;
    }
    if ("L" in a && "L" in b) {
        const shared = Math.min(a.L.length, b.L.length);
        for (let index = 0; index < shared; index += 1) valuePaths(a.L[index], b.L[index], [...path, index], out);
        for (let index = shared; index < Math.max(a.L.length, b.L.length); index += 1) out.push([...path, index]);
        return;
    }
    // Two scalars, two sets, or two values of different types: equal exactly when their canonical texts are equal.
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path);
}

function mapPaths(a: CanonicalMap, b: CanonicalMap, path: PathSegment[], out: PathSegment[][]): void {
    const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(byCodeUnit);
    for (const name of names) {
        const left = a[name];
        const right = b[name];
        if (left === undefined || right === undefined) out.push([...path, name]);
        else valuePaths(left, right, [...path, name], out);
    }
}

/**
 * The path of every attribute that differs between two canonical items: present in one only, of another type, or of
 * another value. Inside maps and lists it goes down to the differing member. Returns no path if and only if the two
 * canonical JSON texts are equal. A path names attributes; it never holds a value.
 */
export function differingPaths(a: CanonicalMap, b: CanonicalMap): PathSegment[][] {
    const out: PathSegment[][] = [];
    mapPaths(a, b, [], out);
    return out;
}
