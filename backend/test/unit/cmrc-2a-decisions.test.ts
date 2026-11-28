import { describe, expect, it } from "vitest";
import { canonicalize, sha256Hex, type HashedItem } from "../../../scripts/commerce-private-table/canonical-item.js";
import {
    AUTHORIZATION_RECORD, INVENTORY_RECORD, buildManifest, contentDifferences, copyVerdict, discardVerdict, emailOfSortKey, entriesOfTenants, isInsideDirectory,
    keyConditions, manifestText, noticesOf, outputFilesOf, parseAuthorization, parseManifest, parseRequest, parseSelector, postCutoverFindings, purgePostcondition, purgeVerdict,
    type EmailKeyForm, type MovedKinds, type Request, type RequestContext,
} from "../../../scripts/commerce-private-table/decisions.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md § "Verdict sums", § "Safety table") — the pure decision core: every verdict variant,
 * the selector, the manifest and authorization records, and the argument rules. No table, no file.
 */

const PREFIXES = ["KINDA#", "KINDB#"];
const CONTEXT: RequestContext = { privatePrefixes: PREFIXES, defaultRegion: "eu-test-1", cwd: "/work", repositoryRoot: "/repo" };
const TABLES = ["--source-table", "main", "--destination-table", "commerce"];

const item = (sk: string, extra: object = {}, pk = "TENANT#t1"): HashedItem => {
    const result = canonicalize({ PK: { S: pk }, SK: { S: sk }, ...extra });
    if (!result.ok) throw new Error("refused");
    return result.value;
};
const key = (sk: string, pk = "TENANT#t1") => ({ pk, sk });
const accepted = (argv: string[]): Request => {
    const result = parseRequest(argv, CONTEXT);
    if (!result.ok) throw new Error(`refused: ${result.error.join(" | ")}`);
    return result.value;
};
const refused = (argv: string[]): string => {
    const result = parseRequest(argv, CONTEXT);
    if (result.ok) throw new Error("accepted");
    return result.error.join(" | ");
};

describe("copyVerdict", () => {
    it("destination absent → copy; equal → alreadyPresentEqual; different → refused with the attribute paths", () => {
        const source = item("KINDA#1", { status: { S: "placed" }, lines: { L: [{ M: { n: { N: "1" } } }] } });
        expect(copyVerdict(source, undefined)).toEqual({ verdict: "copy" });
        expect(copyVerdict(source, item("KINDA#1", { lines: { L: [{ M: { n: { N: "1" } } }] }, status: { S: "placed" } }))).toEqual({ verdict: "alreadyPresentEqual" });
        expect(copyVerdict(source, item("KINDA#1", { status: { S: "shipped" }, lines: { L: [{ M: { n: { N: "2" } } }] } }))).toEqual({
            verdict: "refusedDestinationDiffers",
            paths: ['["lines",0,"n"]', '["status"]'],
        });
    });
});

describe("contentDifferences (verify --strict)", () => {
    it("names a key missing on either side and the paths of a differing attribute; equal sets give no difference", () => {
        const source = [item("KINDA#1", { a: { S: "x" } }), item("KINDA#2"), item("KINDA#3", { deep: { M: { v: { N: "1" } } } })];
        const destination = [item("KINDA#1", { a: { S: "x" } }), item("KINDA#3", { deep: { M: { v: { N: "2" } } } }), item("KINDA#9")];
        expect(contentDifferences(source, destination)).toEqual([
            { kind: "missingInDestination", key: key("KINDA#2") },
            { kind: "attributeDiffers", key: key("KINDA#3"), paths: ['["deep","v"]'] },
            { kind: "missingInSource", key: key("KINDA#9") },
        ]);
        expect(contentDifferences(source, [...source].reverse())).toEqual([]);
        expect(contentDifferences([], [])).toEqual([]);
    });

    it("the same sort key in two partitions is two keys", () => {
        expect(contentDifferences([item("KINDA#1", {}, "TENANT#t1")], [item("KINDA#1", {}, "TENANT#t2")]).map((d) => d.kind)).toEqual(["missingInDestination", "missingInSource"]);
    });
});

describe("purgeVerdict: the four rows", () => {
    it("in the manifest, source unchanged, destination present → delete", () => {
        expect(purgeVerdict("h1", "h1", true)).toEqual({ verdict: "delete" });
    });
    it("source hash differs from the manifest → refusedSourceChanged", () => {
        expect(purgeVerdict("h2", "h1", true)).toEqual({ verdict: "refusedSourceChanged" });
    });
    it("destination absent → refusedDestinationAbsent", () => {
        expect(purgeVerdict("h1", "h1", false)).toEqual({ verdict: "refusedDestinationAbsent" });
    });
    it("key not in the manifest → refusedNotInManifest, whatever else holds", () => {
        expect(purgeVerdict("h1", undefined, true)).toEqual({ verdict: "refusedNotInManifest" });
        expect(purgeVerdict("h1", undefined, false)).toEqual({ verdict: "refusedNotInManifest" });
    });
    it("the destination content is never an input: the function takes only its presence", () => {
        expect(purgeVerdict.length).toBe(3);
    });
});

describe("discardVerdict", () => {
    it("authorized with the same hash → delete; not in the set → refusedNotAuthorized; another hash → refusedChangedSinceAuthorization", () => {
        expect(discardVerdict("h1", "h1")).toEqual({ verdict: "delete" });
        expect(discardVerdict("h1", undefined)).toEqual({ verdict: "refusedNotAuthorized" });
        expect(discardVerdict("h2", "h1")).toEqual({ verdict: "refusedChangedSinceAuthorization" });
    });
});

describe("postCutoverFindings (Q6)", () => {
    const a = item("KINDA#a", { v: { N: "1" } });
    const b = item("KINDA#b");
    const entries = [a, b].map((i) => ({ ...i.key, sha256: i.sha256 }));
    it("no difference when the source is exactly the manifest and the destination holds every manifest key, changed or not; a destination key outside the manifest is LISTED, whatever creation time it carries", () => {
        // An item that claims an old creation time: the function has no opinion on time, it only lists the key.
        const fresh = item("KINDA#new", { createdAt: { S: "2020-01-01T00:00:00.000Z" } });
        expect(postCutoverFindings(entries, [a, b], [item("KINDA#a", { v: { N: "2" } }), b, fresh])).toEqual({ differences: [], destinationKeysNotInManifest: [fresh.key] });
    });
    it("names exactly three kinds of difference, one per statement", () => {
        const extra = item("KINDA#extra");
        const findings = postCutoverFindings(entries, [item("KINDA#a", { v: { N: "9" } }), extra], [a]);
        expect(findings.differences).toEqual([
            { kind: "manifestKeyMissingInDestination", key: b.key }, // (1)
            { kind: "sourceChangedSinceManifest", key: a.key }, // (3)
            { kind: "sourceKeyNotInManifest", key: extra.key }, // (2)
        ]);
    });
    it("a manifest key whose source item is absent breaks none of the three statements: no difference (review-1 F06)", () => {
        // Both manifest keys are in the destination; the source holds only `b`, unchanged; no source key is outside the manifest.
        expect(postCutoverFindings(entries, [b], [a, b])).toEqual({ differences: [], destinationKeysNotInManifest: [] });
        expect(postCutoverFindings(entries, [], [a, b])).toEqual({ differences: [], destinationKeysNotInManifest: [] });
        // From that same state, each statement alone still fails.
        const kindsOf = (source: HashedItem[], destination: HashedItem[]) => postCutoverFindings(entries, source, destination).differences.map((d) => d.kind);
        expect(kindsOf([b], [b])).toEqual(["manifestKeyMissingInDestination"]); // (1)
        expect(kindsOf([b, item("KINDA#extra")], [a, b])).toEqual(["sourceKeyNotInManifest"]); // (2)
        expect(kindsOf([item("KINDA#b", { late: { S: "x" } })], [a, b])).toEqual(["sourceChangedSinceManifest"]); // (3)
    });
});

describe("purgePostcondition (purge-verify)", () => {
    const entries = [{ ...key("KINDA#a"), sha256: "x" }, { ...key("KINDA#b"), sha256: "y" }];
    it("green when the source is empty and the destination holds every manifest key", () => {
        expect(purgePostcondition(entries, [], [key("KINDA#a"), key("KINDA#b"), key("KINDA#later")])).toEqual([]);
    });
    it("names a key that remains in the source and a manifest key that is in neither table", () => {
        expect(purgePostcondition(entries, [key("KINDA#a"), key("KINDA#unverified")], [key("KINDA#a")])).toEqual([
            { kind: "remainsInSource", key: key("KINDA#a") },
            { kind: "remainsInSource", key: key("KINDA#unverified") },
            { kind: "absentInSourceAndDestination", key: key("KINDA#b") },
        ]);
    });
});

describe("the selector", () => {
    it("parseSelector: the two predicates and nothing else", () => {
        expect(parseSelector(undefined, ["t1"], PREFIXES)).toEqual({ ok: true, value: { kind: "movedKinds", tenants: ["t1"], prefixes: PREFIXES } });
        expect(parseSelector("moved-kinds", ["t1"], PREFIXES).ok).toBe(true);
        expect(parseSelector("old-mail-counters", undefined, PREFIXES)).toEqual({ ok: true, value: { kind: "oldMailCounters" } });
        for (const name of ["all", "partition", "*", "", "tenant", "MOVED-KINDS"]) {
            expect(parseSelector(name, ["t1"], PREFIXES)).toEqual({ ok: false, error: { reason: "unknownSelector", name } });
        }
        expect(parseSelector(undefined, undefined, PREFIXES)).toEqual({ ok: false, error: { reason: "tenantsRequired" } });
        expect(parseSelector(undefined, [], PREFIXES)).toEqual({ ok: false, error: { reason: "tenantsRequired" } });
        expect(parseSelector("old-mail-counters", ["t1"], PREFIXES)).toEqual({ ok: false, error: { reason: "tenantsNotApplicable" } });
    });

    it("a kind list that would select a whole partition is refused", () => {
        expect(parseSelector(undefined, ["t1"], ["KINDA#", ""])).toEqual({ ok: false, error: { reason: "emptyKindPrefix" } });
        expect(parseSelector(undefined, ["t1"], [])).toEqual({ ok: false, error: { reason: "emptyKindPrefix" } });
    });

    it("keyConditions: one tenant partition per allowlisted tenant and kind; the mail counters are one fixed condition", () => {
        expect(keyConditions({ kind: "movedKinds", tenants: ["t1", "t2"], prefixes: PREFIXES })).toEqual([
            { pk: "TENANT#t1", skPrefix: "KINDA#" }, { pk: "TENANT#t1", skPrefix: "KINDB#" },
            { pk: "TENANT#t2", skPrefix: "KINDA#" }, { pk: "TENANT#t2", skPrefix: "KINDB#" },
        ]);
        expect(keyConditions({ kind: "oldMailCounters" })).toEqual([{ pk: "SYSTEM", skPrefix: "EMAILLIMIT#" }]);
    });
});

describe("the manifest", () => {
    const selector: MovedKinds = { kind: "movedKinds", tenants: ["t1", "t2"], prefixes: PREFIXES };
    const tables = { source: "main", destination: "commerce" };
    const items = [item("KINDA#1", { v: { N: "1" } }), item("KINDB#1", {}, "TENANT#t2")];
    const text = manifestText(buildManifest("2026-11-28T10:00:00.000Z", tables, selector, items));
    const use = { tables, selector: { ...selector, tenants: ["t1"] } };

    it("round trip: per key the tenant partition, the sort key and the item's hash; the run time; both tables", () => {
        const parsed = parseManifest(text, sha256Hex(text), use);
        expect(parsed).toEqual({
            ok: true,
            value: {
                record: "amodx-commerce-private/verification-manifest/1", createdAt: "2026-11-28T10:00:00.000Z", sourceTable: "main", destinationTable: "commerce",
                tenants: ["t1", "t2"], prefixes: PREFIXES,
                entries: [{ pk: "TENANT#t1", sk: "KINDA#1", sha256: items[0].sha256 }, { pk: "TENANT#t2", sk: "KINDB#1", sha256: items[1].sha256 }],
            },
        });
        if (parsed.ok) expect(entriesOfTenants(parsed.value, ["t1"]).map((e) => e.sk)).toEqual(["KINDA#1"]);
    });

    const reasonOf = (manifestFileText: string, sha256: string, manifestUse = use) => {
        const parsed = parseManifest(manifestFileText, sha256, manifestUse);
        return parsed.ok ? "accepted" : parsed.error.reason;
    };
    it("refuses a file whose SHA-256 is not the one given", () => {
        expect(reasonOf(text, sha256Hex(`${text} `))).toBe("sha256Differs");
        expect(reasonOf(text.replace("KINDA#1", "KINDA#2"), sha256Hex(text))).toBe("sha256Differs");
    });
    it("refuses a file that is not a verification manifest (an inventory proves no copy)", () => {
        const inventory = text.replace("amodx-commerce-private/verification-manifest/1", INVENTORY_RECORD);
        expect(reasonOf(inventory, sha256Hex(inventory))).toBe("notAVerificationManifest");
        expect(reasonOf("not json", sha256Hex("not json"))).toBe("notJson");
    });
    it("refuses a malformed manifest: a missing field, a bad hash, a repeated key", () => {
        for (const broken of [text.replace('"createdAt"', '"created"'), text.replace(items[0].sha256, "abc"), text.replace("KINDB#1", "KINDA#1").replace("TENANT#t2", "TENANT#t1")]) {
            expect(reasonOf(broken, sha256Hex(broken))).toBe("malformed");
        }
    });
    it("refuses a manifest that does not cover the request: other tables, a tenant it does not name, another list of kinds", () => {
        expect(reasonOf(text, sha256Hex(text), { ...use, tables: { source: "main-production", destination: "commerce" } })).toBe("doesNotCoverRequest");
        expect(reasonOf(text, sha256Hex(text), { ...use, tables: { source: "main", destination: "commerce-production" } })).toBe("doesNotCoverRequest");
        expect(reasonOf(text, sha256Hex(text), { tables, selector: { ...selector, tenants: ["t1", "t3"] } })).toBe("doesNotCoverRequest");
        expect(reasonOf(text, sha256Hex(text), { tables, selector: { ...selector, prefixes: [...PREFIXES, "KINDC#"] } })).toBe("doesNotCoverRequest");
    });
});

describe("the discard authorization record", () => {
    const record = (change: (r: any) => void = () => {}) => {
        const r: any = {
            record: AUTHORIZATION_RECORD, authorizedBy: "the owner (synthetic)", authorizedOn: "2026-11-28", sourceTable: "main",
            selector: { predicate: "movedKinds", tenants: ["t1"], kinds: ["KINDA#", "KINDB#"] },
            authorizedKeys: [{ pk: "TENANT#t1", sk: "KINDA#1", sha256: "a".repeat(64) }],
        };
        change(r);
        return JSON.stringify(r);
    };
    const use = { sourceTable: "main", selector: { kind: "movedKinds" as const, tenants: ["t1"], prefixes: PREFIXES } };
    const verdict = (text: string, u: Parameters<typeof parseAuthorization>[1] = use) => {
        const parsed = parseAuthorization(text, u);
        return parsed.ok ? "accepted" : `${parsed.error.reason}${"field" in parsed.error ? `: ${parsed.error.field}` : ""}`;
    };

    it("accepts a complete record that covers the request", () => {
        expect(verdict(record())).toBe("accepted");
        expect(verdict(record((r) => { r.selector = { predicate: "oldMailCounters", partition: "SYSTEM" }; }), { sourceTable: "main", selector: { kind: "oldMailCounters" } })).toBe("accepted");
    });
    it("authorization record: every field is required", () => {
        expect(verdict("{")).toBe("notJson");
        expect(verdict(record((r) => { r.record = INVENTORY_RECORD; }))).toBe("notAnAuthorizationRecord");
        expect(verdict(record((r) => { delete r.authorizedBy; }))).toMatch(/^fieldMissingOrMalformed: authorizedBy/);
        expect(verdict(record((r) => { r.authorizedBy = "  "; }))).toMatch(/^fieldMissingOrMalformed: authorizedBy/);
        expect(verdict(record((r) => { r.authorizedOn = "28.11.2026"; }))).toMatch(/^fieldMissingOrMalformed: authorizedOn/);
        expect(verdict(record((r) => { delete r.sourceTable; }))).toMatch(/^fieldMissingOrMalformed: sourceTable/);
        expect(verdict(record((r) => { delete r.selector; }))).toMatch(/^fieldMissingOrMalformed: selector/);
        expect(verdict(record((r) => { r.selector.predicate = "wholePartition"; }))).toMatch(/^fieldMissingOrMalformed: selector.predicate/);
        expect(verdict(record((r) => { r.selector.tenants = []; }))).toMatch(/^fieldMissingOrMalformed: selector.tenants/);
        expect(verdict(record((r) => { delete r.selector.kinds; }))).toMatch(/^fieldMissingOrMalformed: selector.kinds/);
        expect(verdict(record((r) => { r.selector = { predicate: "oldMailCounters", partition: "TENANT#t1" }; }))).toMatch(/^fieldMissingOrMalformed: selector.partition/);
        expect(verdict(record((r) => { delete r.authorizedKeys; }))).toMatch(/^fieldMissingOrMalformed: authorizedKeys/);
        expect(verdict(record((r) => { r.authorizedKeys[0].sha256 = "short"; }))).toMatch(/^fieldMissingOrMalformed: authorizedKeys\[0\]/);
    });
    it("refuses a record that does not cover the request: table, predicate, tenant, kind", () => {
        expect(verdict(record((r) => { r.sourceTable = "main-staging"; }))).toBe("doesNotCoverRequest");
        expect(verdict(record((r) => { r.selector = { predicate: "oldMailCounters", partition: "SYSTEM" }; }))).toBe("doesNotCoverRequest");
        expect(verdict(record(), { sourceTable: "main", selector: { kind: "oldMailCounters" } })).toBe("doesNotCoverRequest");
        expect(verdict(record(), { ...use, selector: { ...use.selector, tenants: ["t1", "t2"] } })).toBe("doesNotCoverRequest");
        expect(verdict(record((r) => { r.selector.kinds = ["KINDA#"]; }))).toBe("doesNotCoverRequest");
    });
});

describe("noticesOf (plan)", () => {
    const normalize = (raw: string) => raw.normalize("NFKC").trim().toLowerCase();
    // The two forms a commerce key holds an email in: to the end of the key, and before the last `#`.
    const FORMS: EmailKeyForm[] = [{ prefix: "KINDA#", form: "emailToEnd" }, { prefix: "KINDB#", form: "emailThenLastHash" }];
    const kinds = (sk: string) => noticesOf(item(sk), FORMS, normalize).map((notice) => notice.kind);

    it("names each GSI key attribute an item carries; `Type`, `status` and `createdAt` are not GSI key attributes", () => {
        expect(noticesOf(item("KINDC#1", { Type: { S: "Order" }, status: { S: "placed" }, createdAt: { S: "2026" } }), FORMS, normalize)).toEqual([]);
        expect(noticesOf(item("KINDC#1", { Status: { S: "x" }, TenantSlug: { S: "y" }, Domain: { S: "d" }, ScheduledFor: { S: "s" }, CreatedAt: { S: "c" } }), FORMS, normalize)).toEqual([
            { kind: "gsiAttributes", key: key("KINDC#1"), attributes: ["CreatedAt", "Domain", "ScheduledFor", "Status", "TenantSlug"] },
        ]);
    });

    it("emailOfSortKey takes the COMPLETE email out of a key by its form, `#` included", () => {
        expect(emailOfSortKey("KINDA#ana@example.invalid", FORMS)).toBe("ana@example.invalid");
        expect(emailOfSortKey("KINDA#UPPER#synthetic@example.invalid", FORMS)).toBe("UPPER#synthetic@example.invalid");
        expect(emailOfSortKey("KINDB#ana@example.invalid#order-1", FORMS)).toBe("ana@example.invalid");
        expect(emailOfSortKey("KINDB#UPPER#synthetic@example.invalid#order-1", FORMS)).toBe("UPPER#synthetic@example.invalid");
        expect(emailOfSortKey("KINDB#no-hash-after-the-prefix", FORMS)).toBe("no-hash-after-the-prefix");
        expect(emailOfSortKey("KINDC#x@example.invalid", FORMS)).toBeUndefined();
        // Of two prefixes that both fit, the longer one is the kind.
        const nested: EmailKeyForm[] = [{ prefix: "CUST#", form: "emailToEnd" }, { prefix: "CUST#ORDER#", form: "emailThenLastHash" }];
        expect(emailOfSortKey("CUST#ORDER#a@example.invalid#o1", nested)).toBe("a@example.invalid");
        expect(emailOfSortKey("CUST#a@example.invalid", nested)).toBe("a@example.invalid");
    });

    it("a key `<prefix><email>`: a normalization change before or after an embedded `#` is found", () => {
        expect(kinds("KINDA#ana@example.invalid")).toEqual([]);
        expect(kinds("KINDA#upper#synthetic@example.invalid")).toEqual([]);
        expect(kinds("KINDA#Ana@Example.invalid")).toEqual(["keyNotNormalized"]);
        expect(kinds("KINDA#UPPER#synthetic@example.invalid")).toEqual(["keyNotNormalized"]); // before the `#` (review-0 F04)
        expect(kinds("KINDA#upper#Synthetic@example.invalid")).toEqual(["keyNotNormalized"]); // after the `#`
        expect(kinds("KINDA#upper#synthetic@example.invalid ")).toEqual(["keyNotNormalized"]); // white space at the end
        expect(kinds("KINDA#ana＠example.invalid")).toEqual(["keyNotNormalized"]); // full-width @, changed by NFKC
    });

    it("a key `<prefix><email>#<id>`: the same, and the id after the last `#` is not part of the email", () => {
        expect(kinds("KINDB#ana@example.invalid#order-1")).toEqual([]);
        expect(kinds("KINDB#ana@example.invalid#ORDER-UPPER")).toEqual([]);
        expect(kinds("KINDB#upper#synthetic@example.invalid#order-1")).toEqual([]);
        expect(kinds("KINDB#Ana@example.invalid#order-1")).toEqual(["keyNotNormalized"]);
        expect(kinds("KINDB#UPPER#synthetic@example.invalid#order-1")).toEqual(["keyNotNormalized"]); // before the embedded `#`
        expect(kinds("KINDB#upper#Synthetic@example.invalid#order-1")).toEqual(["keyNotNormalized"]); // after it
    });

    it("a key with `@` whose kind has no known email form is reported as NOT CHECKED, never passed in silence", () => {
        expect(noticesOf(item("KINDC#Someone@example.invalid"), FORMS, normalize)).toEqual([{ kind: "emailKeyOfUnknownForm", key: key("KINDC#Someone@example.invalid") }]);
        expect(kinds("KINDC#order-1")).toEqual([]);
    });
});

describe("isInsideDirectory: by path component, not by text", () => {
    it.each([
        ["/repo", true], ["/repo/docs/x.json", true], ["/repo/..private/items.json", true], ["/repo/...", true], ["/repo/..", false],
        ["/repo/../out/x.json", false], ["/out/x.json", false], ["/repo-other/x.json", false], ["/", false], ["/repo/a/../../out", false], ["/repo/a/../b", true],
    ])("%s inside /repo → %s", (target, inside) => {
        expect(isInsideDirectory("/repo", target)).toBe(inside);
    });
});

describe("outputFilesOf: every file a request would create", () => {
    const purge = ["--mode", "purge", ...TABLES, "--tenants", "t1", "--manifest", "/o/m", "--manifest-sha256", "ab".repeat(32)];
    it("names the inventory, the manifest and the export; a plan creates none", () => {
        expect(outputFilesOf(accepted(["--mode", "plan", ...TABLES, "--tenants", "t1"]))).toEqual([]);
        expect(outputFilesOf(accepted(["--mode", "plan", ...TABLES, "--tenants", "t1", "--inventory-out", "/o/i.json"]))).toEqual([{ flag: "inventory-out", path: "/o/i.json" }]);
        expect(outputFilesOf(accepted(["--mode", "verify", "--strict", ...TABLES, "--tenants", "t1", "--manifest-out", "/o/m.json"]))).toEqual([{ flag: "manifest-out", path: "/o/m.json" }]);
        expect(outputFilesOf(accepted(purge))).toEqual([]);
        expect(outputFilesOf(accepted([...purge, "--backup-ref", "arn", "--export-path", "/o/e.ndjson", "--execute"]))).toEqual([{ flag: "export-path", path: "/o/e.ndjson" }]);
        expect(outputFilesOf(accepted(["--mode", "discard", ...TABLES, "--tenants", "t1", "--authorization", "/o/a.json", "--backup-ref", "arn", "--export-path", "/o/d.ndjson", "--execute"]))).toEqual([{ flag: "export-path", path: "/o/d.ndjson" }]);
        expect(outputFilesOf(accepted(["--mode", "discard-verify", ...TABLES, "--tenants", "t1", "--export-path", "/o/d.ndjson"]))).toEqual([]);
    });
});

describe("parseRequest: the argument rules", () => {
    const PLAN = ["--mode", "plan", ...TABLES, "--tenants", "t1"];

    it("a request per mode holds the data of that mode, with absolute paths", () => {
        expect(accepted(PLAN)).toEqual({
            mode: "plan", tables: { source: "main", destination: "commerce" }, region: "eu-test-1", pageSize: 50,
            selector: { kind: "movedKinds", tenants: ["t1"], prefixes: PREFIXES }, inventoryOut: undefined,
        });
        expect(accepted(["--mode", "migrate", ...TABLES, "--tenants", " t1, t2,,t1 ", "--region", "eu-x-9", "--page-size", "7"])).toMatchObject({
            mode: "migrate", execute: false, region: "eu-x-9", pageSize: 7, selector: { tenants: ["t1", "t2"] },
        });
        expect(accepted(["--mode", "verify", "--strict", ...TABLES, "--tenants", "t1", "--manifest-out", "out/m.json"])).toMatchObject({ mode: "verifyStrict", manifestOut: "/work/out/m.json" });
        expect(accepted(["--mode", "verify", "--post-cutover", ...TABLES, "--tenants", "t1", "--manifest", "/o/m.json", "--manifest-sha256", "AB".repeat(32)])).toMatchObject({
            mode: "verifyPostCutover", manifest: { path: "/o/m.json", sha256: "ab".repeat(32) },
        });
        expect(accepted(["--mode", "purge-plan", ...TABLES, "--tenants", "t1", "--manifest", "/o/m.json", "--manifest-sha256", "ab".repeat(32)])).toMatchObject({ mode: "purge", deletion: { kind: "planOnly" } });
        expect(accepted(["--mode", "purge", ...TABLES, "--tenants", "t1", "--manifest", "/o/m.json", "--manifest-sha256", "ab".repeat(32), "--backup-ref", "arn:backup", "--export-path", "/o/e.ndjson"])).toMatchObject({
            mode: "purge", deletion: { kind: "planOnly" },
        });
        expect(accepted(["--mode", "purge", ...TABLES, "--tenants", "t1", "--manifest", "/o/m.json", "--manifest-sha256", "ab".repeat(32), "--backup-ref", "arn:backup", "--export-path", "/o/e.ndjson", "--execute"])).toMatchObject({
            mode: "purge", deletion: { kind: "execute", backupReference: "arn:backup", exportPath: "/o/e.ndjson" },
        });
        expect(accepted(["--mode", "discard-plan", ...TABLES, "--selector", "old-mail-counters", "--authorization", "/o/a.json"])).toMatchObject({
            mode: "discard", selector: { kind: "oldMailCounters" }, authorizationPath: "/o/a.json", deletion: { kind: "planOnly" },
        });
        expect(accepted(["--mode", "discard-verify", ...TABLES, "--tenants", "t1", "--export-path", "/o/e.ndjson"])).toMatchObject({ mode: "discardVerify", exportPath: "/o/e.ndjson" });
    });

    it("refuses a missing or unknown mode", () => {
        expect(refused([...TABLES, "--tenants", "t1"])).toMatch(/missing or invalid --mode/);
        expect(refused(["--mode", "delete-all", ...TABLES, "--tenants", "t1"])).toMatch(/missing or invalid --mode/);
    });
    it("refuses a missing table name", () => {
        expect(refused(["--mode", "plan", "--destination-table", "commerce", "--tenants", "t1"])).toMatch(/missing --source-table/);
        expect(refused(["--mode", "discard-plan", "--source-table", "main", "--tenants", "t1", "--authorization", "/o/a.json"])).toMatch(/missing --destination-table/);
    });
    it("refuses equal source and destination", () => {
        expect(refused(["--mode", "migrate", "--source-table", "main", "--destination-table", "main", "--tenants", "t1"])).toMatch(/are the same table \('main'\)/);
    });
    it("refuses a missing --tenants for the moved kinds", () => {
        for (const mode of ["plan", "migrate", "purge-plan", "purge", "purge-verify", "discard-plan", "discard", "discard-verify"]) {
            expect(refused(["--mode", mode, ...TABLES]), mode).toMatch(/missing --tenants/);
        }
        expect(refused(["--mode", "verify", "--strict", ...TABLES, "--manifest-out", "/o/m.json"])).toMatch(/missing --tenants/);
        expect(refused(["--mode", "plan", ...TABLES, "--tenants", " , "])).toMatch(/missing --tenants/);
    });
    it("the old mail counters take no --tenants and exist only for plan and discard", () => {
        expect(refused(["--mode", "plan", ...TABLES, "--selector", "old-mail-counters", "--tenants", "t1"])).toMatch(/--tenants does not apply/);
        expect(refused(["--mode", "migrate", ...TABLES, "--selector", "old-mail-counters"])).toMatch(/--selector does not belong to --mode migrate/);
        expect(refused(["--mode", "purge", ...TABLES, "--selector", "old-mail-counters", "--manifest", "/o/m", "--manifest-sha256", "ab".repeat(32)])).toMatch(/--selector does not belong to --mode purge/);
        expect(refused(["--mode", "discard", ...TABLES, "--selector", "everything", "--authorization", "/o/a.json"])).toMatch(/unknown --selector 'everything'/);
    });
    it("refuses an unknown flag and a flag of another mode", () => {
        expect(refused([...PLAN, "--tenant", "t9"])).toMatch(/unknown flag --tenant/);
        expect(refused(["--mode", "migrate", ...TABLES, "--tenants", "t1", "--allow-existing-destination"])).toMatch(/unknown flag --allow-existing-destination/);
        expect(refused([...PLAN, "--execute"])).toMatch(/--execute does not belong to --mode plan/);
        expect(refused(["--mode", "migrate", ...TABLES, "--tenants", "t1", "--manifest-out", "/o/m.json"])).toMatch(/--manifest-out does not belong to --mode migrate/);
        expect(refused([...PLAN, "--tenants", "t2"])).toMatch(/--tenants is given twice/);
        expect(refused([...PLAN, "stray"])).toMatch(/'stray' is not a flag/);
        expect(refused(["--mode", "plan", ...TABLES, "--tenants"])).toMatch(/--tenants needs a value/);
        expect(refused([...PLAN, "--page-size", "0"])).toMatch(/invalid --page-size/);
    });
    it("purge-plan refuses --execute; discard-plan refuses --execute", () => {
        expect(refused(["--mode", "purge-plan", ...TABLES, "--tenants", "t1", "--manifest", "/o/m", "--manifest-sha256", "ab".repeat(32), "--execute"])).toMatch(/--execute does not belong to --mode purge-plan/);
        expect(refused(["--mode", "discard-plan", ...TABLES, "--tenants", "t1", "--authorization", "/o/a.json", "--execute"])).toMatch(/--execute does not belong to --mode discard-plan/);
    });
    it("verify needs exactly one of --strict and --post-cutover; a comparison of key sets alone is not offered", () => {
        expect(refused(["--mode", "verify", ...TABLES, "--tenants", "t1"])).toMatch(/needs exactly one of --strict/);
        expect(refused(["--mode", "verify", "--strict", "--post-cutover", ...TABLES, "--tenants", "t1"])).toMatch(/needs exactly one of --strict/);
        expect(refused(["--mode", "verify", "--strict", ...TABLES, "--tenants", "t1"])).toMatch(/--mode verify needs --manifest-out/);
        expect(refused(["--mode", "verify", "--strict", ...TABLES, "--tenants", "t1", "--manifest-out", "/o/m", "--manifest", "/o/old"])).toMatch(/--manifest does not belong to --mode verify --strict/);
        expect(refused(["--mode", "verify", "--post-cutover", ...TABLES, "--tenants", "t1", "--manifest", "/o/m", "--manifest-sha256", "ab".repeat(32), "--manifest-out", "/o/n"])).toMatch(/--manifest-out does not belong/);
    });
    it("purge needs the manifest and its SHA-256", () => {
        expect(refused(["--mode", "purge", ...TABLES, "--tenants", "t1"])).toMatch(/needs --manifest .*needs --manifest-sha256/);
        expect(refused(["--mode", "purge-verify", ...TABLES, "--tenants", "t1", "--manifest", "/o/m", "--manifest-sha256", "xyz"])).toMatch(/needs --manifest-sha256 \(64 hex digits/);
    });
    it("purge --execute needs a backup reference and an export path", () => {
        const purge = ["--mode", "purge", ...TABLES, "--tenants", "t1", "--manifest", "/o/m", "--manifest-sha256", "ab".repeat(32), "--execute"];
        expect(refused(purge)).toMatch(/--execute needs --backup-ref .*needs --export-path/);
        expect(refused([...purge, "--export-path", "/o/e.ndjson"])).toMatch(/--execute needs --backup-ref/);
        expect(refused([...purge, "--backup-ref", "arn:backup"])).toMatch(/needs --export-path/);
        const discard = ["--mode", "discard", ...TABLES, "--tenants", "t1", "--authorization", "/o/a.json", "--execute"];
        expect(refused(discard)).toMatch(/--execute needs --backup-ref .*needs --export-path/);
        expect(refused(["--mode", "discard", ...TABLES, "--tenants", "t1"])).toMatch(/needs --authorization/);
    });
    it("refuses an output path inside the repository", () => {
        expect(refused([...PLAN, "--inventory-out", "/repo/docs/inventory.json"])).toMatch(/--inventory-out is inside the repository/);
        expect(refused(["--mode", "verify", "--strict", ...TABLES, "--tenants", "t1", "--manifest-out", "/repo/m.json"])).toMatch(/--manifest-out is inside the repository/);
        expect(refused(["--mode", "purge", ...TABLES, "--tenants", "t1", "--manifest", "/o/m", "--manifest-sha256", "ab".repeat(32), "--execute", "--backup-ref", "arn", "--export-path", "/repo/scripts/e.ndjson"])).toMatch(/--export-path is inside the repository/);
        // A relative path is resolved against the working directory first.
        expect(parseRequest([...PLAN, "--inventory-out", "inventory.json"], { ...CONTEXT, cwd: "/repo/docs" }).ok).toBe(false);
        expect(parseRequest([...PLAN, "--inventory-out", "../../out/inventory.json"], { ...CONTEXT, cwd: "/repo/docs" }).ok).toBe(true);
        expect(accepted([...PLAN, "--inventory-out", "/repo-other/inventory.json"])).toMatchObject({ inventoryOut: "/repo-other/inventory.json" });
        // A child directory whose name starts with two dots is inside the repository (review-0 F02) — for each output.
        expect(refused([...PLAN, "--inventory-out", "/repo/..private/items.json"])).toMatch(/--inventory-out is inside the repository/);
        expect(refused(["--mode", "verify", "--strict", ...TABLES, "--tenants", "t1", "--manifest-out", "/repo/..private/items.json"])).toMatch(/--manifest-out is inside the repository/);
        const execute = ["--manifest", "/o/m", "--manifest-sha256", "ab".repeat(32), "--execute", "--backup-ref", "arn"];
        expect(refused(["--mode", "purge", ...TABLES, "--tenants", "t1", ...execute, "--export-path", "/repo/..private/items.ndjson"])).toMatch(/--export-path is inside the repository/);
        expect(refused(["--mode", "discard", ...TABLES, "--tenants", "t1", "--authorization", "/o/a.json", "--execute", "--backup-ref", "arn", "--export-path", "/repo/..private/items.ndjson"])).toMatch(/--export-path is inside the repository/);
    });
});
