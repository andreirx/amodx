import { describe, expect, it } from "vitest";
import { COMMERCE_PRIVATE_PREFIXES, customerOrderRef, customerRef, orderCounterRef, orderRef } from "../../src/lib/commerce-db.js";
import { canonicalize, sha256Hex } from "../../../scripts/commerce-private-table/canonical-item.js";
import { AUTHORIZATION_RECORD } from "../../../scripts/commerce-private-table/decisions.js";
import { EMAIL_KEY_FORMS, failureText } from "../../../scripts/commerce-private-table/run.js";
import { emailOfSortKey } from "../../../scripts/commerce-private-table/decisions.js";
import { DESTINATION, RUN_TIME, SOURCE, TABLE_ARGS, harness, type RawItem, type Sent } from "./cmrc-2a-raw-tables.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md § "Safety table") — the commerce-private table tool, every mode, from its argument
 * list to its exit status, against named in-memory tables and in-memory files. No AWS. All data is synthetic.
 *
 * The double refuses every command that is not one of the tool's four forms, so each test also proves row S19 (no
 * Scan, no unconditional Put). A value an attribute holds starts with `VALUE-`; no report line may contain it (S18).
 */

type Harness = ReturnType<typeof harness>;

const pk = (tenant: string) => `TENANT#${tenant}`;
const EMAIL = "ana@example.com";

const order = (tenant: string, id: string, extra: RawItem = {}): RawItem => ({
    PK: { S: pk(tenant) }, SK: { S: orderRef(tenant, id).Key.SK },
    id: { S: id }, status: { S: "placed" }, customerName: { S: "VALUE-name" }, customerPhone: { NULL: true },
    total: { N: "12.50" }, paid: { BOOL: false },
    items: { L: [{ M: { name: { S: "VALUE-ring" }, quantity: { N: "1" } } }] },
    statusHistory: { L: [{ M: { status: { S: "placed" }, note: { S: "VALUE-note" } } }] },
    Type: { S: "Order" },
    ...extra,
});
const customer = (tenant: string, email: string, extra: RawItem = {}): RawItem => ({
    PK: { S: pk(tenant) }, SK: { S: customerRef(tenant, email).Key.SK }, name: { S: "VALUE-name" }, orderCount: { N: "1" }, ...extra,
});
const customerOrder = (tenant: string, email: string, id: string): RawItem => ({
    PK: { S: pk(tenant) }, SK: { S: customerOrderRef(tenant, email, id).Key.SK }, orderNumber: { S: "VALUE-PPB-0001" }, total: { N: "12.50" },
});
const counter = (tenant: string, value = "1"): RawItem => ({ PK: { S: pk(tenant) }, SK: { S: orderCounterRef(tenant).Key.SK }, currentValue: { N: value } });

/** Tenant t1: two orders, a customer, an index row, the counter (5 items). Tenant t2: one order. Tenant `other`: one order. */
function seed(h: Harness): void {
    for (const item of [order("t1", "o1"), order("t1", "o2"), customer("t1", EMAIL), customerOrder("t1", EMAIL, "o1"), counter("t1"), order("t2", "o1"), order("other", "o1")]) {
        h.tables.put(SOURCE, item);
    }
}
const T1 = ["--tenants", "t1"];
const T1_KEYS = [orderCounterRef("t1").Key.SK, customerRef("t1", EMAIL).Key.SK, customerOrderRef("t1", EMAIL, "o1").Key.SK, orderRef("t1", "o1").Key.SK, orderRef("t1", "o2").Key.SK].sort();
/** The same five keys in the order the tool works: kind by kind as the shared list names them, sorted inside a kind. */
const T1_KEYS_BY_KIND = COMMERCE_PRIVATE_PREFIXES.flatMap((prefix) => T1_KEYS.filter((sk) => sk.startsWith(prefix)));
const O1 = orderRef("t1", "o1").Key.SK;
const O2 = orderRef("t1", "o2").Key.SK;

const MANIFEST = "/out/manifest.json";
const EXPORT = "/out/export.ndjson";
const AUTHORIZATION = "/out/authorization.json";

const hashOf = (item: RawItem | undefined): string => {
    const result = canonicalize(item);
    if (!result.ok) throw new Error("refused");
    return result.value.sha256;
};
const last = (lines: string[]): string => lines[lines.length - 1];
const writes = (h: Harness, table: string) => h.tables.sent.filter((sent) => sent.table === table && (sent.name === "PutItem" || sent.name === "DeleteItem"));

/** Seeds, copies t1, verifies it and returns the flags that name the manifest. */
async function copiedAndVerified(h: Harness, tenants = T1): Promise<string[]> {
    seed(h);
    expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...tenants, "--execute"])).toBe(0);
    expect(await h.run(["--mode", "verify", "--strict", ...TABLE_ARGS, ...tenants, "--manifest-out", MANIFEST])).toBe(0);
    h.report();
    h.tables.sent.length = 0;
    h.log.length = 0;
    return ["--manifest", MANIFEST, "--manifest-sha256", sha256Hex(h.files.read(MANIFEST))];
}
const purgeArgs = (manifest: string[]) => ["--mode", "purge", ...TABLE_ARGS, ...T1, ...manifest, "--backup-ref", "arn:aws:dynamodb:synthetic:backup/1", "--export-path", EXPORT, "--execute"];

/** Writes an authorization record for the keys the source holds now (as the human would, from an inventory). */
function authorize(h: Harness, selector: object, sourcePk: string, skPrefixes: readonly string[], change: (record: any) => void = () => {}): void {
    const authorizedKeys = h.tables.sortKeys(SOURCE, sourcePk)
        .filter((sk) => skPrefixes.some((prefix) => sk.startsWith(prefix)))
        .map((sk) => ({ pk: sourcePk, sk, sha256: hashOf(h.tables.get(SOURCE, sourcePk, sk)) }));
    const record = { record: AUTHORIZATION_RECORD, authorizedBy: "the owner (synthetic)", authorizedOn: "2026-11-28", sourceTable: SOURCE, selector: structuredClone(selector), authorizedKeys };
    change(record);
    h.files.files.set(AUTHORIZATION, JSON.stringify(record));
}
const MOVED = { predicate: "movedKinds", tenants: ["t1"], kinds: [...COMMERCE_PRIVATE_PREFIXES] };
const discardArgs = ["--mode", "discard", ...TABLE_ARGS, ...T1, "--authorization", AUTHORIZATION, "--backup-ref", "PITR 2026-11-28T09:59:00Z", "--export-path", EXPORT, "--execute"];

describe("plan", () => {
    it("reports counts per tenant and kind, writes nothing to a table, and writes the inventory with one hash per item", async () => {
        const h = harness();
        seed(h);
        h.tables.put(DESTINATION, order("t1", "o1"));
        expect(await h.run(["--mode", "plan", ...TABLE_ARGS, "--tenants", "t1,t2", "--inventory-out", "/out/inventory.json"])).toBe(0);
        const lines = h.report();
        expect(lines).toContain(`  PK=TENANT#t1 kind ${orderRef("t1", "").Key.SK}: source=2 destination=1 only-in-source=1 only-in-destination=0`);
        expect(lines).toContain(`  PK=TENANT#t2 kind ${orderRef("t2", "").Key.SK}: source=1 destination=0 only-in-source=1 only-in-destination=0`);
        expect(last(lines)).toMatch(/^RESULT: GREEN — plan: 6 source items, nothing written to a table, 0 notices/);
        expect(writes(h, SOURCE).length + writes(h, DESTINATION).length).toBe(0);
        const inventory = JSON.parse(h.files.read("/out/inventory.json"));
        expect(inventory).toMatchObject({ record: "amodx-commerce-private/inventory/1", createdAt: RUN_TIME, sourceTable: SOURCE });
        expect(inventory.entries).toHaveLength(6);
        for (const entry of inventory.entries) expect(entry.sha256).toBe(hashOf(h.tables.get(SOURCE, entry.pk, entry.sk)));
    });

    it("reports a GSI key attribute and a key that is not in normalized form, by key; the exit status stays 0", async () => {
        const h = harness();
        h.tables.put(SOURCE, order("t1", "o1", { Status: { S: "VALUE-status" }, TenantSlug: { S: "VALUE-slug" } }));
        h.tables.put(SOURCE, customer("t1", "Ana@Example.com"));
        h.tables.put(SOURCE, customer("t1", EMAIL));
        expect(await h.run(["--mode", "plan", ...TABLE_ARGS, ...T1])).toBe(0);
        const lines = h.report();
        expect(lines).toContain(`  NOTICE GSI key attribute on an item: PK=TENANT#t1 SK=${O1} attributes: Status, TenantSlug`);
        expect(lines).toContain(`  NOTICE the email in the key is not in normalizeEmail() form: PK=TENANT#t1 SK=${customerRef("t1", "Ana@Example.com").Key.SK}`);
        expect(lines.filter((line) => line.includes("NOTICE"))).toHaveLength(2);
        expect(last(lines)).toMatch(/2 notices/);
    });

    it("the email forms of the tool are the key grammar of commerce-db.ts: the complete address comes back, `#` included", () => {
        for (const email of ["ana@example.invalid", "UPPER#synthetic@example.invalid", "a#b#c@example.invalid", "x@example.invalid#"]) {
            expect(emailOfSortKey(customerRef("t1", email).Key.SK, EMAIL_KEY_FORMS), email).toBe(email);
            expect(emailOfSortKey(customerOrderRef("t1", email, "order-1").Key.SK, EMAIL_KEY_FORMS), email).toBe(email);
            expect(emailOfSortKey(`EMAILLIMIT#${email}`, EMAIL_KEY_FORMS), email).toBe(email);
        }
        expect(emailOfSortKey(orderRef("t1", "o1").Key.SK, EMAIL_KEY_FORMS)).toBeUndefined();
        expect(emailOfSortKey(orderCounterRef("t1").Key.SK, EMAIL_KEY_FORMS)).toBeUndefined();
    });

    it("a normalization change before or after a `#` inside the address is reported, for both key families and the mail counters (F04)", async () => {
        const h = harness();
        const notNormalized = ["UPPER#synthetic@example.invalid", "upper#Synthetic@example.invalid"];
        const normalized = "upper#synthetic@example.invalid";
        for (const email of [...notNormalized, normalized]) {
            h.tables.put(SOURCE, customer("t1", email));
            h.tables.put(SOURCE, customerOrder("t1", email, "ORDER-UPPER-1"));
            h.tables.put(SOURCE, { PK: { S: "SYSTEM" }, SK: { S: `EMAILLIMIT#${email}` }, count: { N: "1" } });
        }
        expect(await h.run(["--mode", "plan", ...TABLE_ARGS, ...T1])).toBe(0);
        const lines = h.report();
        const noticed = lines.filter((line) => line.includes("NOTICE the email in the key is not in normalizeEmail() form")).map((line) => line.split(" SK=")[1]).sort();
        expect(noticed).toEqual(notNormalized.flatMap((email) => [customerRef("t1", email).Key.SK, customerOrderRef("t1", email, "ORDER-UPPER-1").Key.SK]).sort());
        expect(await h.run(["--mode", "plan", ...TABLE_ARGS, "--selector", "old-mail-counters"])).toBe(0);
        expect(h.report().filter((line) => line.includes("NOTICE")).map((line) => line.split(" SK=")[1]).sort()).toEqual(notNormalized.map((email) => `EMAILLIMIT#${email}`).sort());
    });
});

describe("migrate", () => {
    it("migrate without --execute prints the plan and writes nothing", async () => {
        const h = harness();
        seed(h);
        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1])).toBe(0);
        const lines = h.report();
        for (const sk of T1_KEYS) expect(lines).toContain(`  WOULD COPY PK=TENANT#t1 SK=${sk}`);
        expect(last(lines)).toBe("RESULT: GREEN — migrate (plan only, nothing written): 5 would be copied, 0 already present and equal, 0 refused");
        expect(h.tables.sent.filter((sent) => sent.name === "PutItem" || sent.name === "DeleteItem")).toEqual([]);
        expect(h.tables.count(DESTINATION)).toBe(0);
    });

    it("migrate --execute copies every item exactly — big numbers, sets and binary too — and a second run is idempotent", async () => {
        const h = harness();
        seed(h);
        const exact = order("t1", "o3", {
            big: { N: "12345678901234567890.123456789" }, tags: { SS: ["b", "a"] }, sizes: { NS: ["52", "7"] }, blob: { B: new Uint8Array([0, 255, 16]) }, empty: { S: "" },
        });
        h.tables.put(SOURCE, exact);
        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"])).toBe(0);
        expect(last(h.report())).toBe("RESULT: GREEN — migrate: 6 copied, 0 already present and equal, 0 refused");
        expect(h.tables.get(DESTINATION, pk("t1"), orderRef("t1", "o3").Key.SK)).toEqual(exact);
        for (const sk of h.tables.sortKeys(SOURCE, pk("t1"))) expect(h.tables.get(DESTINATION, pk("t1"), sk)).toEqual(h.tables.get(SOURCE, pk("t1"), sk));
        expect(h.tables.count(SOURCE)).toBe(8);

        h.tables.sent.length = 0;
        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"])).toBe(0);
        const lines = h.report();
        expect(lines).toContain(`  EQUAL already present and equal, not written: PK=TENANT#t1 SK=${O1}`);
        expect(last(lines)).toBe("RESULT: GREEN — migrate: 0 copied, 6 already present and equal, 0 refused");
        expect(writes(h, DESTINATION)).toEqual([]);
    });

    it("a second migrate run after a destination item changed refuses that key and changes nothing", async () => {
        const h = harness();
        seed(h);
        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"])).toBe(0);
        const newer = order("t1", "o1", { status: { S: "VALUE-shipped" }, statusHistory: { L: [{ M: { status: { S: "placed" }, note: { S: "VALUE-note" } } }, { M: { status: { S: "VALUE-shipped" } } }] } });
        h.tables.put(DESTINATION, newer);
        h.report();
        h.tables.sent.length = 0;

        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"])).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  REFUSED destination differs, not overwritten: PK=TENANT#t1 SK=${O1} attributes: ["status"] ["statusHistory",1]`);
        expect(last(lines)).toBe("RESULT: NOT GREEN — migrate: 0 copied, 4 already present and equal, 1 refused; exit status 1");
        expect(writes(h, DESTINATION)).toEqual([]);
        expect(h.tables.get(DESTINATION, pk("t1"), O1)).toEqual(newer);
    });

    it("a destination item that appears between the read and the Put is not overwritten", async () => {
        const h = harness();
        h.tables.put(SOURCE, order("t1", "o1"));
        h.tables.put(SOURCE, order("t1", "o2"));
        const appeared = order("t1", "o1", { status: { S: "VALUE-confirmed" } });
        h.tables.before = (sent) => {
            if (sent.name !== "PutItem") return;
            // Another writer puts the item just before the tool's own Put arrives: o1 different, o2 equal.
            h.tables.put(DESTINATION, sent.sk === O1 ? appeared : order("t1", "o2"));
        };
        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"])).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  REFUSED destination differs, not overwritten: PK=TENANT#t1 SK=${O1} attributes: ["status"]`);
        expect(lines).toContain(`  EQUAL already present and equal, not written: PK=TENANT#t1 SK=${O2}`);
        expect(last(lines)).toBe("RESULT: NOT GREEN — migrate: 0 copied, 1 already present and equal, 1 refused; exit status 1");
        expect(h.tables.get(DESTINATION, pk("t1"), O1)).toEqual(appeared);
    });
});

describe("verify --strict", () => {
    it("is green on equal tables and writes the manifest: per key the partition, the sort key and the hash; the run time", async () => {
        const h = harness();
        seed(h);
        await h.run(["--mode", "migrate", ...TABLE_ARGS, "--tenants", "t1,t2", "--execute"]);
        h.report();
        expect(await h.run(["--mode", "verify", "--strict", ...TABLE_ARGS, "--tenants", "t1,t2", "--manifest-out", MANIFEST])).toBe(0);
        const lines = h.report();
        const text = h.files.read(MANIFEST);
        expect(lines).toContain(`Manifest SHA-256:  ${sha256Hex(text)}`);
        expect(lines).toContain("Manifest entries:  6");
        expect(last(lines)).toBe("RESULT: GREEN — verify --strict: 6 keys equal in both tables (every attribute, every depth), 0 differences; manifest written");
        const manifest = JSON.parse(text);
        expect(manifest).toMatchObject({
            record: "amodx-commerce-private/verification-manifest/1", createdAt: RUN_TIME, sourceTable: SOURCE, destinationTable: DESTINATION,
            tenants: ["t1", "t2"], prefixes: [...COMMERCE_PRIVATE_PREFIXES],
        });
        expect(manifest.entries.map((entry: any) => `${entry.pk} ${entry.sk}`).sort()).toEqual([...T1_KEYS.map((sk) => `TENANT#t1 ${sk}`), `TENANT#t2 ${orderRef("t2", "o1").Key.SK}`].sort());
        for (const entry of manifest.entries) expect(entry.sha256).toBe(hashOf(h.tables.get(DESTINATION, entry.pk, entry.sk)));
    });

    it("verify --strict names the key and the attribute path of each difference and writes no manifest", async () => {
        const h = harness();
        seed(h);
        await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"]);
        h.report();
        // Same keys, same counts — one nested attribute differs. The old tool printed "Verification OK" here.
        h.tables.put(DESTINATION, order("t1", "o1", { items: { L: [{ M: { name: { S: "VALUE-ring" }, quantity: { N: "2" } } }] } }));
        h.tables.remove(DESTINATION, pk("t1"), O2);
        h.tables.put(DESTINATION, order("t1", "o9"));
        expect(await h.run(["--mode", "verify", "--strict", ...TABLE_ARGS, ...T1, "--manifest-out", MANIFEST])).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  DIFFERENCE attribute differs: PK=TENANT#t1 SK=${O1} attributes: ["items",0,"quantity"]`);
        expect(lines).toContain(`  DIFFERENCE missing in destination: PK=TENANT#t1 SK=${O2}`);
        expect(lines).toContain(`  DIFFERENCE missing in source: PK=TENANT#t1 SK=${orderRef("t1", "o9").Key.SK}`);
        expect(last(lines)).toBe("RESULT: NOT GREEN — verify --strict: 3 differences in 5 source and 5 destination items; no manifest written; exit status 1");
        expect(h.files.exists(MANIFEST)).toBe(false);
    });

    it("a manifest file that exists is never replaced", async () => {
        const h = harness();
        seed(h);
        h.files.files.set(MANIFEST, "the manifest of an earlier run");
        expect(await h.run(["--mode", "verify", "--strict", ...TABLE_ARGS, ...T1, "--manifest-out", MANIFEST])).toBe(1);
        expect(h.report().join("\n")).toMatch(/REFUSED REQUEST: the file of --manifest-out \(\/out\/manifest\.json\) cannot be created: the file exists already/);
        expect(h.tables.sent).toEqual([]);
        expect(h.files.read(MANIFEST)).toBe("the manifest of an earlier run");
    });
});

describe("verify --post-cutover (Q6)", () => {
    it("is green when the three statements hold; it LISTS the destination keys that are not in the manifest and says it cannot date them", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        h.tables.put(DESTINATION, order("t1", "o1", { status: { S: "VALUE-shipped" } }));
        // Two destination keys outside the manifest. One claims a creation time long before the manifest: the tool
        // has no evidence of the release time, so it lists both the same way and judges neither (ruling Q6 = B).
        h.tables.put(DESTINATION, order("t1", "o9"));
        h.tables.put(DESTINATION, order("t1", "o8", { createdAt: { S: "2020-01-01T00:00:00.000Z" } }));
        expect(await h.run(["--mode", "verify", "--post-cutover", ...TABLE_ARGS, ...T1, ...manifest])).toBe(0);
        const lines = h.report();
        expect(lines).toContain(`  DESTINATION KEY NOT IN THE MANIFEST: PK=TENANT#t1 SK=${orderRef("t1", "o9").Key.SK}`);
        expect(lines).toContain(`  DESTINATION KEY NOT IN THE MANIFEST: PK=TENANT#t1 SK=${orderRef("t1", "o8").Key.SK}`);
        expect(lines.slice(-4)).toEqual([
            "Destination keys not in the manifest: 2",
            "  The tool cannot establish when these items were created. The operator establishes it from the freeze record:",
            "  the write freeze was on from before the manifest run (P1) until the release deploy, and P2 showed every frozen writer refusing.",
            "RESULT: GREEN — verify --post-cutover: (1) each of the 5 manifest keys exists in the destination; (2) the source holds no key of a moved kind outside the manifest; (3) each of the 5 source items of the moved kinds hashes to its manifest value. 2 destination keys are not in the manifest; the tool cannot establish when they were created (the freeze record must)",
        ]);
        // No line claims a time for those keys.
        expect(lines.join("\n")).not.toMatch(/written after|created after|after the release|after release/i);
    });

    it("names each difference with its statement: (1) a manifest key missing in the destination, (2) a main-table key outside the manifest, (3) a changed main-table item", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        h.tables.put(SOURCE, order("t1", "o7"));
        h.tables.put(SOURCE, order("t1", "o1", { status: { S: "VALUE-late" } }));
        h.tables.remove(DESTINATION, pk("t1"), O2);
        expect(await h.run(["--mode", "verify", "--post-cutover", ...TABLE_ARGS, ...T1, ...manifest])).toBe(1);
        const lines = h.report();
        expect(lines.filter((line) => line.startsWith("  DIFFERENCE")).sort()).toEqual([
            `  DIFFERENCE (1) manifest key missing in destination: PK=TENANT#t1 SK=${O2}`,
            `  DIFFERENCE (2) source key of a moved kind that is not in the manifest: PK=TENANT#t1 SK=${orderRef("t1", "o7").Key.SK}`,
            `  DIFFERENCE (3) source item does not hash to its manifest value: PK=TENANT#t1 SK=${O1}`,
        ]);
        expect(lines).toContain("Destination keys not in the manifest: 0");
        expect(last(lines)).toMatch(/^RESULT: NOT GREEN — verify --post-cutover: 3 differences against 5 manifest keys .*; 0 destination keys are not in the manifest; the tool cannot establish when they were created \(the freeze record must\); exit status 1$/);
    });

    it("a manifest key whose main-table item is absent is NOT a difference: the three statements hold and the run is green; each statement alone still fails (review-1 F06)", async () => {
        const postCutover = (h: Harness, manifest: string[]) => h.run(["--mode", "verify", "--post-cutover", ...TABLE_ARGS, ...T1, ...manifest]);
        /** The reviewer's case: every manifest key in the destination; one main-table item absent, the others unchanged. */
        const oneSourceItemAbsent = async () => {
            const h = harness();
            const manifest = await copiedAndVerified(h);
            h.tables.remove(SOURCE, pk("t1"), customerRef("t1", EMAIL).Key.SK);
            return { h, manifest };
        };

        const green = await oneSourceItemAbsent();
        expect(await postCutover(green.h, green.manifest)).toBe(0);
        const lines = green.h.report();
        expect(lines.filter((line) => line.startsWith("  DIFFERENCE"))).toEqual([]);
        // The last line gives both counts (5 manifest keys, 4 source items): the absence is visible, and not judged.
        expect(last(lines)).toBe(
            "RESULT: GREEN — verify --post-cutover: (1) each of the 5 manifest keys exists in the destination; (2) the source holds no key of a moved kind outside the manifest; (3) each of the 4 source items of the moved kinds hashes to its manifest value. 0 destination keys are not in the manifest; the tool cannot establish when they were created (the freeze record must)",
        );

        const noDestination = await oneSourceItemAbsent(); // (1) fails
        noDestination.h.tables.remove(DESTINATION, pk("t1"), O2);
        expect(await postCutover(noDestination.h, noDestination.manifest)).toBe(1);
        expect(noDestination.h.report().filter((line) => line.startsWith("  DIFFERENCE"))).toEqual([`  DIFFERENCE (1) manifest key missing in destination: PK=TENANT#t1 SK=${O2}`]);

        const sourceExtra = await oneSourceItemAbsent(); // (2) fails
        sourceExtra.h.tables.put(SOURCE, order("t1", "o7"));
        expect(await postCutover(sourceExtra.h, sourceExtra.manifest)).toBe(1);
        expect(sourceExtra.h.report().filter((line) => line.startsWith("  DIFFERENCE"))).toEqual([`  DIFFERENCE (2) source key of a moved kind that is not in the manifest: PK=TENANT#t1 SK=${orderRef("t1", "o7").Key.SK}`]);

        const sourceChanged = await oneSourceItemAbsent(); // (3) fails
        sourceChanged.h.tables.put(SOURCE, order("t1", "o1", { status: { S: "VALUE-late" } }));
        expect(await postCutover(sourceChanged.h, sourceChanged.manifest)).toBe(1);
        expect(sourceChanged.h.report().filter((line) => line.startsWith("  DIFFERENCE"))).toEqual([`  DIFFERENCE (3) source item does not hash to its manifest value: PK=TENANT#t1 SK=${O1}`]);
    });
});

describe("purge (verified copy)", () => {
    it("purge without --execute deletes nothing and writes no export", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        for (const mode of ["purge", "purge-plan"]) {
            expect(await h.run(["--mode", mode, ...TABLE_ARGS, ...T1, ...manifest])).toBe(0);
            const lines = h.report();
            for (const sk of T1_KEYS) expect(lines).toContain(`  WOULD DELETE PK=TENANT#t1 SK=${sk}`);
            expect(last(lines)).toBe("RESULT: GREEN — purge (plan only, nothing deleted): 5 would be deleted, 0 refused");
        }
        expect(h.tables.sent.filter((sent) => sent.name === "PutItem" || sent.name === "DeleteItem")).toEqual([]);
        expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual(T1_KEYS);
        expect(h.files.exists(EXPORT)).toBe(false);
    });

    it("purge-plan refuses --execute", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        expect(await h.run(["--mode", "purge-plan", ...TABLE_ARGS, ...T1, ...manifest, "--execute"])).toBe(1);
        expect(h.report()).toContain("REFUSED REQUEST: --execute does not belong to --mode purge-plan");
        expect(h.tables.sent).toEqual([]);
    });

    it("purge: destination updated after release → deleted; destination unchanged → deleted", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        const updated = order("t1", "o1", { status: { S: "VALUE-shipped" }, paid: { BOOL: true } });
        h.tables.put(DESTINATION, updated);
        expect(await h.run(purgeArgs(manifest))).toBe(0);
        const lines = h.report();
        for (const sk of T1_KEYS) expect(lines).toContain(`  DELETED PK=TENANT#t1 SK=${sk}`);
        expect(lines).toContain("Backup reference:  arn:aws:dynamodb:synthetic:backup/1");
        expect(lines).toContain("Export lines:      5");
        expect(lines).toContain(`Export SHA-256:    ${sha256Hex(h.files.read(EXPORT))}`);
        expect(lines).toContain("  EXPORTED 5 candidates, written and flushed before the first delete");
        expect(last(lines)).toBe(`RESULT: GREEN — purge: exported 5 of 5 candidates before the first delete, deleted 5 from ${SOURCE}, 0 refused`);
        expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual([]);
        // The other tenants of the source, and the whole destination, are as they were.
        expect(h.tables.count(SOURCE)).toBe(2);
        expect(h.tables.get(DESTINATION, pk("t1"), O1)).toEqual(updated);
        expect(h.tables.sortKeys(DESTINATION, pk("t1"))).toEqual(T1_KEYS);
    });

    it("purge: source changed → refused", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        const changed = order("t1", "o1", { status: { S: "VALUE-late-write" } });
        h.tables.put(SOURCE, changed);
        expect(await h.run(purgeArgs(manifest))).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  REFUSED source changed after verification: PK=TENANT#t1 SK=${O1}`);
        // The export holds every candidate, the refused one too (in the form the candidate read found): exported 5, deleted 4, refused 1.
        expect(lines).toContain("Export lines:      5");
        expect(last(lines)).toBe(`RESULT: NOT GREEN — purge: exported 5 of 5 candidates before the first delete, deleted 4 from ${SOURCE}, 1 refused (source changed after verification: 1); exit status 1`);
        expect(h.files.read(EXPORT).trimEnd().split("\n").map((line) => JSON.parse(line)).find((line) => line.sk === O1).item.status).toEqual({ S: "VALUE-late-write" });
        expect(h.tables.get(SOURCE, pk("t1"), O1)).toEqual(changed);
        expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual([O1]);
    });

    it("purge: destination missing → refused", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        h.tables.remove(DESTINATION, pk("t1"), O2);
        expect(await h.run(purgeArgs(manifest))).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  REFUSED destination item absent: PK=TENANT#t1 SK=${O2}`);
        expect(last(lines)).toMatch(/exported 5 of 5 candidates before the first delete, deleted 4 .* 1 refused \(destination item absent: 1\); exit status 1$/);
        expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual([O2]);
    });

    it("purge: key outside the manifest → refused", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        const late = orderRef("t1", "o7").Key.SK;
        h.tables.put(SOURCE, order("t1", "o7"));
        h.tables.put(DESTINATION, order("t1", "o7"));
        expect(await h.run(purgeArgs(manifest))).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  REFUSED not in the manifest (created after verification): PK=TENANT#t1 SK=${late}`);
        expect(last(lines)).toMatch(/exported 6 of 6 candidates before the first delete, deleted 5 .* 1 refused \(not in the manifest \(created after verification\): 1\); exit status 1$/);
        expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual([late]);
    });

    it("purge --execute sends only reads to the destination table", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        h.tables.readOnly.add(DESTINATION);
        expect(await h.run(purgeArgs(manifest))).toBe(0);
        const toDestination = h.tables.sent.filter((sent) => sent.table === DESTINATION);
        expect(toDestination.length).toBe(5);
        expect(new Set(toDestination.map((sent) => sent.name))).toEqual(new Set(["GetItem"]));
        expect(new Set(h.tables.sent.filter((sent) => sent.name === "DeleteItem").map((sent) => sent.table))).toEqual(new Set([SOURCE]));
    });

    it("purge writes and flushes the export of EVERY candidate before its first delete", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        // One candidate will be refused (not in the manifest): it is exported too, before any delete.
        const late = orderRef("t1", "o7").Key.SK;
        h.tables.put(SOURCE, order("t1", "o7"));
        h.tables.put(DESTINATION, order("t1", "o7"));
        const candidates = COMMERCE_PRIVATE_PREFIXES.flatMap((prefix) => [...T1_KEYS, late].sort().filter((sk) => sk.startsWith(prefix)));
        expect(await h.run(purgeArgs(manifest))).toBe(1);
        expect(h.log).toEqual([...candidates.map((sk) => `export ${sk}`), ...T1_KEYS_BY_KIND.map((sk) => `DeleteItem ${SOURCE} ${sk}`)]);
        const exported = h.files.read(EXPORT).trimEnd().split("\n").map((line) => JSON.parse(line));
        expect(exported.map((line) => line.sk)).toEqual(candidates);
        // A line is the whole item in canonical form, with its hash: the backup of last resort.
        const first = exported.find((line) => line.sk === O1);
        expect(first.item.customerName).toEqual({ S: "VALUE-name" });
        expect(first.sha256).toBe(sha256Hex(JSON.stringify(first.item)));
        // Still one consistent read of the source and one of the destination per key, each just before that key's delete.
        const afterExport = h.tables.sent.filter((sent) => sent.name !== "Query");
        expect(afterExport.slice(0, 3).map((sent) => `${sent.name} ${sent.table} ${sent.sk}`)).toEqual([
            `GetItem ${SOURCE} ${candidates[0]}`, `GetItem ${DESTINATION} ${candidates[0]}`, `DeleteItem ${SOURCE} ${candidates[0]}`,
        ]);
    });

    it("purge does not delete an item whose form at the read before the delete is not the form in the export", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        const verified = h.tables.get(SOURCE, pk("t1"), O1)!;
        // The candidate read (and so the export) sees a changed item; it is changed back before the read that precedes
        // the delete. The verdict of § 6 would be "delete" (source = manifest), but the export holds another form.
        h.tables.put(SOURCE, order("t1", "o1", { status: { S: "VALUE-in-between" } }));
        h.tables.before = (sent) => {
            if (sent.name === "GetItem" && sent.table === SOURCE && sent.sk === O1) h.tables.put(SOURCE, verified);
        };
        expect(await h.run(purgeArgs(manifest))).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  NOT DELETED the item changed after it was exported (the export does not hold this form of it): PK=TENANT#t1 SK=${O1}`);
        expect(last(lines)).toMatch(/deleted 4 from main-table, 0 refused, 1 not deleted because they changed after the export; exit status 1$/);
        expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual([O1]);
    });

    it("an existing export file is never overwritten", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        h.files.files.set(EXPORT, "the export of an earlier run\n");
        expect(await h.run(purgeArgs(manifest))).toBe(1);
        expect(h.report().join("\n")).toMatch(/REFUSED REQUEST: the file of --export-path \(\/out\/export\.ndjson\) cannot be created: the file exists already/);
        expect(h.tables.sent).toEqual([]);
        expect(h.files.read(EXPORT)).toBe("the export of an earlier run\n");
        expect(h.tables.sent.filter((sent) => sent.name === "DeleteItem")).toEqual([]);
    });

    it("purge refuses a manifest whose SHA-256 differs", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        expect(await h.run(purgeArgs(["--manifest", MANIFEST, "--manifest-sha256", "0".repeat(64)]))).toBe(1);
        expect(h.report().join("\n")).toMatch(/REFUSED REQUEST: the manifest file does not have the SHA-256 given/);
        // The same refusal when the file was edited after the SHA-256 was recorded.
        h.files.files.set(MANIFEST, h.files.read(MANIFEST).replace(O1, orderRef("t1", "o7").Key.SK));
        expect(await h.run(purgeArgs(manifest))).toBe(1);
        expect(h.report().join("\n")).toMatch(/REFUSED REQUEST: the manifest file does not have the SHA-256 given/);
        expect(h.tables.sent).toEqual([]);
        expect(h.files.exists(EXPORT)).toBe(false);
    });

    it("purge refuses an inventory in place of a manifest", async () => {
        const h = harness();
        await copiedAndVerified(h);
        await h.run(["--mode", "plan", ...TABLE_ARGS, ...T1, "--inventory-out", "/out/inventory.json"]);
        h.report();
        h.tables.sent.length = 0;
        const inventory = ["--manifest", "/out/inventory.json", "--manifest-sha256", sha256Hex(h.files.read("/out/inventory.json"))];
        expect(await h.run(purgeArgs(inventory))).toBe(1);
        expect(h.report().join("\n")).toMatch(/REFUSED REQUEST: the file is not a verification manifest/);
        expect(h.tables.sent).toEqual([]);
    });

    it("purge refuses a manifest of other tables or tenants", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        const otherTables = ["--mode", "purge", "--source-table", SOURCE, "--destination-table", "another-table", ...T1, ...manifest];
        expect(await h.run(otherTables)).toBe(1);
        expect(h.report().join("\n")).toMatch(/REFUSED REQUEST: the manifest does not cover the request: its destination table is/);
        expect(await h.run(["--mode", "purge", ...TABLE_ARGS, "--tenants", "t1,t2", ...manifest])).toBe(1);
        expect(h.report().join("\n")).toMatch(/REFUSED REQUEST: the manifest does not cover the request: it was not written for tenant t2/);
        expect(h.tables.sent).toEqual([]);
    });

    it("a key that is gone at the read before its delete is reported and the run is not green", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        h.tables.before = (sent) => {
            if (sent.name === "GetItem" && sent.table === SOURCE && sent.sk === O1) h.tables.remove(SOURCE, pk("t1"), O1);
        };
        expect(await h.run(purgeArgs(manifest))).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  VANISHED no longer in the source at the read before its delete: PK=TENANT#t1 SK=${O1}`);
        expect(last(lines)).toMatch(/exported 5 of 5 candidates before the first delete, deleted 4 .* 0 refused, 1 vanished before the delete; exit status 1$/);
    });

    it("purge-verify is green after a full purge; it names a key that remains and a manifest key that is in neither table", async () => {
        const h = harness();
        const manifest = await copiedAndVerified(h);
        const verify = ["--mode", "purge-verify", ...TABLE_ARGS, ...T1, ...manifest];
        expect(await h.run(verify)).toBe(1);
        expect(last(h.report())).toBe("RESULT: NOT GREEN — purge-verify: 5 manifest keys, 5 keys remain in the source, 5 differences; exit status 1");

        expect(await h.run(purgeArgs(manifest))).toBe(0);
        h.report();
        expect(await h.run(verify)).toBe(0);
        expect(last(h.report())).toBe("RESULT: GREEN — purge-verify: 5 manifest keys, 0 keys remain in the source, 0 differences");

        h.tables.put(SOURCE, order("t1", "o7"));
        h.tables.remove(DESTINATION, pk("t1"), O2);
        expect(await h.run(verify)).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  DIFFERENCE remains in the source: PK=TENANT#t1 SK=${orderRef("t1", "o7").Key.SK}`);
        expect(lines).toContain(`  DIFFERENCE manifest key absent in the source AND in the destination: PK=TENANT#t1 SK=${O2}`);
    });
});

describe("discard (authorized loss)", () => {
    it("discard without --execute deletes nothing", async () => {
        const h = harness();
        seed(h);
        authorize(h, MOVED, pk("t1"), COMMERCE_PRIVATE_PREFIXES);
        for (const args of [["--mode", "discard-plan", ...TABLE_ARGS, ...T1, "--authorization", AUTHORIZATION], discardArgs.filter((arg) => arg !== "--execute")]) {
            expect(await h.run(args)).toBe(0);
            const lines = h.report();
            for (const sk of T1_KEYS) expect(lines).toContain(`  WOULD DELETE PK=TENANT#t1 SK=${sk}`);
            expect(last(lines)).toBe("RESULT: GREEN — discard (plan only, nothing deleted): 5 would be deleted, 0 refused");
        }
        expect(h.tables.sent.filter((sent) => sent.name === "PutItem" || sent.name === "DeleteItem")).toEqual([]);
        expect(h.tables.count(SOURCE)).toBe(7);
        expect(h.files.exists(EXPORT)).toBe(false);
    });

    it("discard sends no command to the destination table; it writes the export line of each authorized item just before the delete of that item", async () => {
        const h = harness();
        seed(h);
        authorize(h, MOVED, pk("t1"), COMMERCE_PRIVATE_PREFIXES);
        h.tables.untouchable.add(DESTINATION);
        expect(await h.run(discardArgs)).toBe(0);
        const lines = h.report();
        expect(last(lines)).toBe(`RESULT: GREEN — discard: 5 deleted from ${SOURCE}, 5 export lines, 0 refused`);
        expect(lines).toContain(`Authorization:     ${AUTHORIZATION} (SHA-256 ${sha256Hex(h.files.read(AUTHORIZATION))}, 5 authorized keys)`);
        expect(lines).toContain("Backup reference:  PITR 2026-11-28T09:59:00Z");
        expect(h.tables.sent.filter((sent) => sent.table === DESTINATION)).toEqual([]);
        expect(h.log).toEqual(T1_KEYS_BY_KIND.flatMap((sk) => [`export ${sk}`, `DeleteItem ${SOURCE} ${sk}`]));
        expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual([]);
        expect(h.tables.count(SOURCE)).toBe(2);
    });

    it("discard refuses a key that is not authorized and a key that changed", async () => {
        const h = harness();
        seed(h);
        authorize(h, MOVED, pk("t1"), COMMERCE_PRIVATE_PREFIXES);
        // After the authorization: a new order arrives, and an admin changes an existing one.
        const changed = order("t1", "o1", { status: { S: "VALUE-confirmed" } });
        h.tables.put(SOURCE, changed);
        h.tables.put(SOURCE, order("t1", "o7"));
        expect(await h.run(discardArgs)).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  REFUSED changed since the authorization (the hash differs): PK=TENANT#t1 SK=${O1}`);
        expect(lines).toContain(`  REFUSED not authorized (the key is not in the authorized set): PK=TENANT#t1 SK=${orderRef("t1", "o7").Key.SK}`);
        expect(last(lines)).toMatch(/^RESULT: NOT GREEN — discard: 4 deleted from main-table, 4 export lines, 2 refused \(.*\); exit status 1$/);
        expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual([O1, orderRef("t1", "o7").Key.SK]);
        expect(h.tables.get(SOURCE, pk("t1"), O1)).toEqual(changed);
    });

    it("discard refuses a record that does not cover the request", async () => {
        const h = harness();
        seed(h);
        const refusedWith = async (change: (record: any) => void, args = discardArgs) => {
            authorize(h, MOVED, pk("t1"), COMMERCE_PRIVATE_PREFIXES, change);
            expect(await h.run(args)).toBe(1);
            return h.report().join("\n");
        };
        expect(await refusedWith((r) => { r.sourceTable = "another-table"; })).toMatch(/REFUSED REQUEST: the authorization record does not cover the request: it authorizes table 'another-table'/);
        expect(await refusedWith((r) => { r.selector = { predicate: "oldMailCounters", partition: "SYSTEM" }; })).toMatch(/it authorizes the old mail counters, the request selects the moved kinds/);
        expect(await refusedWith((r) => { r.selector.tenants = ["t2"]; })).toMatch(/it does not name tenant t1/);
        expect(await refusedWith((r) => { r.selector.kinds = r.selector.kinds.slice(1); })).toMatch(new RegExp(`it does not name kind ${COMMERCE_PRIVATE_PREFIXES[0]}`));
        expect(await refusedWith((r) => { delete r.authorizedBy; })).toMatch(/REFUSED REQUEST: the authorization record has no valid field: authorizedBy/);
        expect(await refusedWith(() => {}, discardArgs.map((arg) => (arg === AUTHORIZATION ? "/out/missing.json" : arg)))).toMatch(/REFUSED REQUEST: cannot read the file of --authorization/);
        expect(h.tables.sent).toEqual([]);
        expect(h.tables.count(SOURCE)).toBe(7);
        expect(h.files.exists(EXPORT)).toBe(false);
    });

    it("SYSTEM partition: discard removes only the old mail counter", async () => {
        const h = harness();
        const mailRate = `MAILRATE#${"a1".repeat(32)}`;
        h.tables.put(SOURCE, { PK: { S: "SYSTEM" }, SK: { S: `EMAILLIMIT#${EMAIL}` }, hour: { N: "490000" }, count: { N: "2" }, ttl: { N: "1764324000" } });
        h.tables.put(SOURCE, { PK: { S: "SYSTEM" }, SK: { S: mailRate }, hour: { N: "490000" }, count: { N: "1" } });
        h.tables.put(SOURCE, { PK: { S: "SYSTEM" }, SK: { S: "TENANT#t1" }, name: { S: "VALUE-tenant-config" } });
        seed(h);
        h.tables.untouchable.add(DESTINATION);
        const selector = ["--selector", "old-mail-counters"];

        // The inventory the human classifies: one key, with its hash.
        expect(await h.run(["--mode", "plan", ...TABLE_ARGS, ...selector, "--inventory-out", "/out/mail-inventory.json"])).toBe(0);
        expect(h.report()).toContain("  PK=SYSTEM kind EMAILLIMIT#: source=1 (the destination is not read: these items are never copied)");
        const inventory = JSON.parse(h.files.read("/out/mail-inventory.json"));
        expect(inventory.entries.map((entry: any) => entry.sk)).toEqual([`EMAILLIMIT#${EMAIL}`]);
        h.files.files.set(AUTHORIZATION, JSON.stringify({
            record: AUTHORIZATION_RECORD, authorizedBy: "the owner (synthetic)", authorizedOn: "2026-11-28", sourceTable: SOURCE,
            selector: { predicate: "oldMailCounters", partition: "SYSTEM" }, authorizedKeys: inventory.entries,
        }));

        expect(await h.run(["--mode", "discard", ...TABLE_ARGS, ...selector, "--authorization", AUTHORIZATION, "--backup-ref", "arn:synthetic", "--export-path", EXPORT, "--execute"])).toBe(0);
        expect(last(h.report())).toBe(`RESULT: GREEN — discard: 1 deleted from ${SOURCE}, 1 export lines, 0 refused`);
        expect(h.tables.sortKeys(SOURCE, "SYSTEM")).toEqual([mailRate, "TENANT#t1"]);
        expect(h.tables.count(SOURCE)).toBe(9);
        // Every command of the three runs named PK = SYSTEM with the one fixed prefix, or the one key under it.
        expect(new Set(h.tables.sent.map((sent) => `${sent.table} ${sent.pk}`))).toEqual(new Set([`${SOURCE} SYSTEM`]));
        expect(h.tables.sent.filter((sent) => sent.name === "Query").every((sent) => sent.sk === "EMAILLIMIT#")).toBe(true);

        expect(await h.run(["--mode", "discard-verify", ...TABLE_ARGS, ...selector, "--export-path", EXPORT])).toBe(0);
        const lines = h.report();
        expect(lines).toContain("Export lines:      1");
        expect(lines).toContain(`Export SHA-256:    ${sha256Hex(h.files.read(EXPORT))}`);
        expect(last(lines)).toMatch(/^RESULT: GREEN — discard-verify: 0 items of the predicate remain in main-table/);
        expect(h.tables.sortKeys(SOURCE, "SYSTEM")).toEqual([mailRate, "TENANT#t1"]);
    });

    it("discard-verify names an item of the predicate that remains", async () => {
        const h = harness();
        seed(h);
        h.files.files.set(EXPORT, "");
        expect(await h.run(["--mode", "discard-verify", ...TABLE_ARGS, "--tenants", "t2", "--export-path", EXPORT])).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`  DIFFERENCE remains in the source: PK=TENANT#t2 SK=${orderRef("t2", "o1").Key.SK}`);
        expect(lines).toContain("Export lines:      0");
        expect(last(lines)).toMatch(/^RESULT: NOT GREEN — discard-verify: 1 items of the predicate remain .*exit status 1$/);
    });
});

describe("rules of every mode", () => {
    /** One run of every mode, with differences and refusals in it. Returns each run's report. */
    async function everyMode(h: Harness): Promise<string[][]> {
        const reports: string[][] = [];
        const run = async (args: string[]) => {
            await h.run(args);
            reports.push(h.report());
        };
        seed(h);
        await run(["--mode", "plan", ...TABLE_ARGS, ...T1, "--inventory-out", "/out/inventory.json"]);
        await run(["--mode", "migrate", ...TABLE_ARGS, ...T1]);
        await run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"]);
        await run(["--mode", "verify", "--strict", ...TABLE_ARGS, ...T1, "--manifest-out", MANIFEST]);
        const manifest = ["--manifest", MANIFEST, "--manifest-sha256", sha256Hex(h.files.read(MANIFEST))];
        h.tables.put(DESTINATION, order("t1", "o1", { customerName: { S: "VALUE-other-name" }, items: { L: [] } }));
        h.tables.put(SOURCE, order("t1", "o2", { total: { N: "99999.01" } }));
        await run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"]);
        await run(["--mode", "verify", "--strict", ...TABLE_ARGS, ...T1, "--manifest-out", "/out/manifest-2.json"]);
        await run(["--mode", "verify", "--post-cutover", ...TABLE_ARGS, ...T1, ...manifest]);
        await run(["--mode", "purge-plan", ...TABLE_ARGS, ...T1, ...manifest]);
        await run(purgeArgs(manifest));
        await run(["--mode", "purge-verify", ...TABLE_ARGS, ...T1, ...manifest]);
        authorize(h, { predicate: "movedKinds", tenants: ["t2"], kinds: [...COMMERCE_PRIVATE_PREFIXES] }, pk("t2"), COMMERCE_PRIVATE_PREFIXES);
        const t2 = ["--tenants", "t2", "--authorization", AUTHORIZATION];
        await run(["--mode", "discard-plan", ...TABLE_ARGS, ...t2]);
        await run(["--mode", "discard", ...TABLE_ARGS, ...t2, "--backup-ref", "arn:synthetic", "--export-path", "/out/discard.ndjson", "--execute"]);
        await run(["--mode", "discard-verify", ...TABLE_ARGS, "--tenants", "t2", "--export-path", "/out/discard.ndjson"]);
        return reports;
    }

    it("every report names both tables", async () => {
        const reports = await everyMode(harness());
        expect(reports).toHaveLength(13);
        for (const lines of reports) {
            expect(lines).toContain(`Source table:      ${SOURCE}`);
            expect(lines).toContain(`Destination table: ${DESTINATION}`);
            expect(last(lines)).toMatch(/^RESULT: (GREEN|NOT GREEN) — /);
        }
    });

    it("no report line contains an attribute value", async () => {
        const reports = await everyMode(harness());
        const all = reports.flat().join("\n");
        expect(all).toMatch(/DIFFERENCE attribute differs/);
        expect(all).toMatch(/REFUSED source changed after verification/);
        expect(all).not.toMatch(/VALUE-/);
        expect(all).not.toMatch(/99999\.01|12\.50/);
    });

    it("the last line says NOT GREEN with exit status 1 exactly when the exit status is 1", async () => {
        const h = harness();
        seed(h);
        expect(await h.run(["--mode", "plan", ...TABLE_ARGS, ...T1])).toBe(0);
        expect(last(h.report())).toMatch(/^RESULT: GREEN — (?!.*exit status 1)/);
        h.tables.put(DESTINATION, order("t1", "o1", { status: { S: "VALUE-x" } }));
        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1])).toBe(1);
        expect(last(h.report())).toMatch(/^RESULT: NOT GREEN — .*1 refused; exit status 1$/);
    });

    it("a tenant that is not in the allowlist is never read", async () => {
        const h = harness();
        await everyMode(h);
        expect(new Set(h.tables.sent.map((sent) => sent.pk))).toEqual(new Set(["TENANT#t1", "TENANT#t2"]));
        expect(h.tables.get(SOURCE, pk("other"), orderRef("other", "o1").Key.SK)).toEqual(order("other", "o1"));
        expect(h.tables.sortKeys(DESTINATION, pk("other"))).toEqual([]);
        // And within one run: only the tenants that run names.
        const single = harness();
        seed(single);
        await single.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"]);
        expect(new Set(single.tables.sent.map((sent) => sent.pk))).toEqual(new Set(["TENANT#t1"]));
        expect(single.tables.sortKeys(DESTINATION, pk("t2"))).toEqual([]);
    });

    it("a tenant with zero items: every mode is green and changes nothing", async () => {
        const h = harness();
        seed(h);
        const none = ["--tenants", "empty-shop"];
        expect(await h.run(["--mode", "plan", ...TABLE_ARGS, ...none])).toBe(0);
        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...none, "--execute"])).toBe(0);
        expect(last(h.report())).toBe("RESULT: GREEN — migrate: 0 copied, 0 already present and equal, 0 refused");
        expect(await h.run(["--mode", "verify", "--strict", ...TABLE_ARGS, ...none, "--manifest-out", MANIFEST])).toBe(0);
        expect(JSON.parse(h.files.read(MANIFEST)).entries).toEqual([]);
        const manifest = ["--manifest", MANIFEST, "--manifest-sha256", sha256Hex(h.files.read(MANIFEST))];
        expect(await h.run(["--mode", "verify", "--post-cutover", ...TABLE_ARGS, ...none, ...manifest])).toBe(0);
        expect(await h.run(["--mode", "purge", ...TABLE_ARGS, ...none, ...manifest, "--backup-ref", "arn:synthetic", "--export-path", EXPORT, "--execute"])).toBe(0);
        expect(last(h.report())).toBe(`RESULT: GREEN — purge: exported 0 of 0 candidates before the first delete, deleted 0 from ${SOURCE}, 0 refused`);
        expect(await h.run(["--mode", "purge-verify", ...TABLE_ARGS, ...none, ...manifest])).toBe(0);
        expect(h.tables.count(SOURCE)).toBe(7);
        expect(h.tables.count(DESTINATION)).toBe(0);
    });

    it("pagination: more items than one page are all read, copied, verified and purged", async () => {
        const h = harness();
        const ids = Array.from({ length: 11 }, (_, index) => `o${String(index).padStart(2, "0")}`);
        for (const id of ids) h.tables.put(SOURCE, order("t1", id));
        h.tables.pageSize = 4;
        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute", "--page-size", "3"])).toBe(0);
        expect(last(h.report())).toBe("RESULT: GREEN — migrate: 11 copied, 0 already present and equal, 0 refused");
        // 11 items in pages of 3: four Queries of the order kind per table.
        expect(h.tables.sent.filter((sent) => sent.name === "Query" && sent.table === SOURCE && sent.sk === orderRef("t1", "").Key.SK)).toHaveLength(4);
        expect(await h.run(["--mode", "verify", "--strict", ...TABLE_ARGS, ...T1, "--manifest-out", MANIFEST])).toBe(0);
        expect(JSON.parse(h.files.read(MANIFEST)).entries).toHaveLength(11);
        expect(await h.run(purgeArgs(["--manifest", MANIFEST, "--manifest-sha256", sha256Hex(h.files.read(MANIFEST))]))).toBe(0);
        expect(h.tables.count(SOURCE)).toBe(0);
        expect(h.tables.count(DESTINATION)).toBe(11);
    });

    it("an item with a value the canonical form does not define stops the run before any write", async () => {
        const h = harness();
        seed(h);
        h.tables.put(SOURCE, { ...order("t1", "o5"), odd: { $unknown: ["FUTURE", "x"] } as never });
        expect(await h.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"])).toBe(1);
        const lines = h.report();
        expect(lines.join("\n")).toMatch(new RegExp(`ABORTED: table ${SOURCE}, PK=TENANT#t1 SK=${orderRef("t1", "o5").Key.SK}: a value at attribute path \\["odd"\\] is not a DynamoDB value this tool defines \\(unknownTypeTag\\)`));
        expect(last(lines)).toMatch(/^RESULT: NOT GREEN — the run stopped before its end/);
        expect(h.tables.count(DESTINATION)).toBe(0);
    });

    it("a failing AWS call stops the run with its name, not green", async () => {
        const h = harness();
        seed(h);
        h.tables.before = (sent) => {
            if (sent.name === "Query" && sent.table === DESTINATION) throw Object.assign(new Error("throttled VALUE-in-a-message"), { name: "ProvisionedThroughputExceededException" });
        };
        expect(await h.run(["--mode", "verify", "--strict", ...TABLE_ARGS, ...T1, "--manifest-out", MANIFEST])).toBe(1);
        const lines = h.report();
        expect(lines).toContain("ABORTED: a call failed (ProvisionedThroughputExceededException)");
        expect(lines.join("\n")).not.toMatch(/throttled|VALUE-/);
        expect(h.files.exists(MANIFEST)).toBe(false);
    });

    it("--help prints the modes, the kinds of the shared list and the personal-data warning, and reads nothing", async () => {
        const h = harness();
        expect(await h.run(["--help"])).toBe(0);
        const help = h.report().join("\n");
        expect(help).toContain("Modes: plan, migrate, verify, purge-plan, purge, purge-verify, discard-plan, discard, discard-verify");
        expect(help).toContain(COMMERCE_PRIVATE_PREFIXES.join(", "));
        expect(help).toMatch(/PERSONAL DATA: .*a key can contain an email address/);
        expect(help).toContain(customerRef("<tenant>", "<email>").Key.SK);
        expect(h.tables.sent).toEqual([]);
    });

    it("a refused request reads no table", async () => {
        const h = harness();
        seed(h);
        expect(await h.run(["--mode", "purge", "--source-table", SOURCE, "--destination-table", SOURCE, ...T1, "--execute"])).toBe(1);
        const lines = h.report();
        expect(lines).toContain(`REFUSED REQUEST: --source-table and --destination-table are the same table ('${SOURCE}')`);
        expect(last(lines)).toBe("RESULT: NOT GREEN — the request was refused; no table was read, nothing was written or deleted; exit status 1");
        expect(h.tables.sent).toEqual([]);
    });
});

/**
 * Review-0 F03, closed as a class by three rules of `run.ts`: (1) of a failure from outside, the report prints the
 * error's name and code only; (2) the state of a table is reported only as a read showed it — after a failed Put or
 * Delete call the tool reads, and says UNKNOWN when that read fails too; (3) once an export is open, its path, line
 * count and SHA-256 are reported on every path, or the report says why not. Every injected error carries a message
 * with `VALUE-`: no report may contain it.
 */
describe("failures: what the report says, and what it never says", () => {
    const failure = (name: string) => Object.assign(new Error("VALUE-synthetic-private-note in an AWS message"), { name });
    const second = T1_KEYS_BY_KIND[1];

    /** A run of `purge --execute` or `discard --execute` over the five items of tenant t1, ready to start. */
    async function deletion(mode: "purge" | "discard"): Promise<{ h: Harness; args: string[] }> {
        const h = harness();
        if (mode === "purge") return { h, args: purgeArgs(await copiedAndVerified(h)) };
        seed(h);
        authorize(h, MOVED, pk("t1"), COMMERCE_PRIVATE_PREFIXES);
        return { h, args: discardArgs };
    }
    /** The lines of the export finalization, which every run with an open export must print. */
    const finalization = (h: Harness, lines: string[], exportLines: number) => {
        expect(lines).toContain(`Export:            ${EXPORT}`);
        expect(lines).toContain(`Export lines:      ${exportLines}`);
        expect(lines).toContain(`Export SHA-256:    ${sha256Hex(h.files.read(EXPORT))}`);
    };
    const deletes = (h: Harness) => h.tables.sent.filter((sent) => sent.name === "DeleteItem").map((sent) => sent.sk);

    describe.each(["purge", "discard"] as const)("%s", (mode) => {
        // purge exports all five candidates first; discard has exported two lines when the second delete is sent.
        const exportedAtSecondDelete = mode === "purge" ? 5 : 2;

        it("a delete call that fails and was NOT applied: a read after it finds the item, and the report says so", async () => {
            const { h, args } = await deletion(mode);
            h.tables.before = (sent) => {
                if (sent.name === "DeleteItem" && sent.sk === second) throw failure("AccessDeniedException");
            };
            expect(await h.run(args)).toBe(1);
            const lines = h.report();
            expect(lines).toContain(`  DELETE CALL FAILED the delete call of PK=TENANT#t1 SK=${second} failed (AccessDeniedException); a consistent read after it finds the item STILL IN THE SOURCE: it was not deleted`);
            finalization(h, lines, exportedAtSecondDelete);
            expect(last(lines)).toMatch(new RegExp(`^RESULT: NOT GREEN — ${mode}: .*the run STOPPED early: the delete call of .* STILL IN THE SOURCE: it was not deleted; exit status 1$`));
            expect(last(lines)).toContain(mode === "purge" ? "deleted 1 from" : "1 deleted from");
            // The run stopped there: the failed key and every later key are still in the source.
            expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual(T1_KEYS_BY_KIND.slice(1).sort());
            expect(lines.join("\n")).not.toMatch(/VALUE-/);
        });

        it("a delete call that fails AFTER it was applied (the answer was lost): the report says the item is absent, not that it is still there", async () => {
            const { h, args } = await deletion(mode);
            h.tables.afterWrite = (sent) => {
                if (sent.name === "DeleteItem" && sent.sk === second) throw failure("TimeoutError");
            };
            expect(await h.run(args)).toBe(1);
            const lines = h.report();
            expect(lines).toContain(`  DELETE CALL FAILED the delete call of PK=TENANT#t1 SK=${second} failed (TimeoutError); a consistent read after it finds the item ABSENT: it was deleted`);
            expect(lines.join("\n")).not.toMatch(/still in the source/i);
            finalization(h, lines, exportedAtSecondDelete);
            expect(last(lines)).toContain(mode === "purge" ? "deleted 2 from" : "2 deleted from");
            expect(last(lines)).toMatch(/the run STOPPED early: .*; exit status 1$/);
            expect(h.tables.sortKeys(SOURCE, pk("t1"))).toEqual(T1_KEYS_BY_KIND.slice(2).sort());
            expect(lines.join("\n")).not.toMatch(/VALUE-/);
        });

        it("a delete call that fails, and the read after it fails too: the outcome is reported as UNKNOWN", async () => {
            const { h, args } = await deletion(mode);
            let deleteFailed = false;
            h.tables.afterWrite = (sent) => {
                if (sent.name === "DeleteItem" && sent.sk === second) {
                    deleteFailed = true;
                    throw failure("TimeoutError");
                }
            };
            h.tables.before = (sent) => {
                if (deleteFailed && sent.name === "GetItem") throw failure("ServiceUnavailable");
            };
            expect(await h.run(args)).toBe(1);
            const lines = h.report();
            expect(lines).toContain(`  DELETE CALL FAILED the delete call of PK=TENANT#t1 SK=${second} failed (TimeoutError) and the read after it failed too: whether the item was deleted is UNKNOWN`);
            expect(lines.join("\n")).not.toMatch(/still in the source|finds the item/i);
            finalization(h, lines, exportedAtSecondDelete);
            // One delete is established (the first). The second is neither counted as deleted nor as kept.
            expect(last(lines)).toContain(mode === "purge" ? "deleted 1 from" : "1 deleted from");
            expect(last(lines)).toMatch(/UNKNOWN; exit status 1$/);
            expect(lines.join("\n")).not.toMatch(/VALUE-/);
        });

        it("a read of the source that fails after one successful delete: the run stops and the export is still finalized", async () => {
            const { h, args } = await deletion(mode);
            h.tables.before = (sent) => {
                if (sent.name === "GetItem" && sent.table === SOURCE && sent.sk === second) throw failure("InternalServerError");
            };
            expect(await h.run(args)).toBe(1);
            const lines = h.report();
            expect(lines).toContain("  STOPPED a call failed (InternalServerError)");
            finalization(h, lines, mode === "purge" ? 5 : 1);
            expect(deletes(h)).toEqual([T1_KEYS_BY_KIND[0]]);
            expect(last(lines)).toMatch(/the run STOPPED early: a call failed \(InternalServerError\); exit status 1$/);
            expect(lines.join("\n")).not.toMatch(/VALUE-/);
        });

        it("an export line that cannot be written whole and flushed: no delete follows it", async () => {
            const { h, args } = await deletion(mode);
            h.files.failAppend = (_line, appendedBefore) => appendedBefore === 1; // the second line fails
            expect(await h.run(args)).toBe(1);
            const lines = h.report();
            expect(lines).toContain(`  STOPPED the export line of PK=TENANT#t1 SK=${second} could not be written whole and flushed (IncompleteWrite); no item is deleted after this`);
            // purge: the failure is in the export of the candidates, before the first delete. discard: one item was
            // exported and deleted; the item whose line failed, and every later one, is not deleted.
            expect(deletes(h)).toEqual(mode === "purge" ? [] : [T1_KEYS_BY_KIND[0]]);
            finalization(h, lines, 1);
            expect(last(lines)).toMatch(/the run STOPPED early: the export line of .*; exit status 1$/);
            expect(lines.join("\n")).not.toMatch(/VALUE-/);
        });

        it("an export file that cannot be closed, or cannot be read back, makes the run not green and the report says which", async () => {
            const closing = await deletion(mode);
            closing.h.files.failClose = true;
            expect(await closing.h.run(closing.args)).toBe(1);
            const closeLines = closing.h.report();
            expect(closeLines).toContain("Export close:      FAILED (Error EIO); the lines below are what could be read back");
            finalization(closing.h, closeLines, 5);
            expect(last(closeLines)).toMatch(/0 refused; the export file could not be closed; exit status 1$/);

            const reading = await deletion(mode);
            reading.h.files.failRead.add(EXPORT);
            expect(await reading.h.run(reading.args)).toBe(1);
            const readLines = reading.h.report();
            expect(readLines).toContain(`Export:            ${EXPORT}`);
            expect(readLines).toContain("Export lines:      NOT AVAILABLE: the export file could not be read back (Error ENOENT); the tool wrote 5 lines");
            expect(readLines).toContain("Export SHA-256:    NOT AVAILABLE: the export file could not be read back (Error ENOENT)");
            expect(last(readLines)).toMatch(/0 refused; the export file could not be read back; exit status 1$/);
            expect([...closeLines, ...readLines].join("\n")).not.toMatch(/VALUE-/);
        });

        it("an export file that cannot be created: nothing is deleted", async () => {
            const { h, args } = await deletion(mode);
            // Something appears at the path between the check before the run and the creation.
            h.files.outputRefusal = () => undefined;
            h.files.files.set(EXPORT, "appeared\n");
            expect(await h.run(args)).toBe(1);
            const lines = h.report();
            expect(lines).toContain(`ABORTED: the export file could not be created (${EXPORT}: OutputRefused); nothing was deleted`);
            expect(deletes(h)).toEqual([]);
            expect(h.files.read(EXPORT)).toBe("appeared\n");
            expect(lines.join("\n")).not.toMatch(/VALUE-/);
        });
    });

    it("a Put call that fails: its outcome is taken from a read after it — applied, not applied, or UNKNOWN", async () => {
        const applied = harness();
        seed(applied);
        applied.tables.afterWrite = (sent) => {
            if (sent.name === "PutItem" && sent.sk === second) throw failure("TimeoutError");
        };
        expect(await applied.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"])).toBe(1);
        const appliedLines = applied.report();
        expect(appliedLines).toContain(`ABORTED: PK=TENANT#t1 SK=${second}: the Put call failed (TimeoutError); a consistent read after it shows: the item IS in the destination and equal to the source (the write was applied)`);
        expect(applied.tables.sortKeys(DESTINATION, pk("t1"))).toEqual(T1_KEYS_BY_KIND.slice(0, 2).sort());

        const notApplied = harness();
        seed(notApplied);
        notApplied.tables.before = (sent) => {
            if (sent.name === "PutItem" && sent.sk === second) throw failure("AccessDeniedException");
        };
        expect(await notApplied.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"])).toBe(1);
        const notAppliedLines = notApplied.report();
        expect(notAppliedLines).toContain(`ABORTED: PK=TENANT#t1 SK=${second}: the Put call failed (AccessDeniedException); a consistent read after it shows: the item is NOT in the destination`);

        const unknown = harness();
        seed(unknown);
        let putFailed = false;
        unknown.tables.before = (sent) => {
            if (sent.name === "PutItem" && sent.sk === second) {
                putFailed = true;
                throw failure("TimeoutError");
            }
            if (putFailed && sent.name === "GetItem") throw failure("ServiceUnavailable");
        };
        expect(await unknown.run(["--mode", "migrate", ...TABLE_ARGS, ...T1, "--execute"])).toBe(1);
        const unknownLines = unknown.report();
        expect(unknownLines).toContain(`ABORTED: PK=TENANT#t1 SK=${second}: the Put call failed (TimeoutError) and the read after it failed too (ServiceUnavailable): whether the item was written is UNKNOWN`);
        for (const lines of [appliedLines, notAppliedLines, unknownLines]) {
            expect(last(lines)).toMatch(/^RESULT: NOT GREEN — the run stopped before its end/);
            expect(lines.join("\n")).not.toMatch(/VALUE-/);
        }
    });

    it("the text of an outside failure is never printed: its message, its stack, a name that is not one plain word", async () => {
        const cases: [unknown, string][] = [
            [failure("ThrottlingException"), "ABORTED: a call failed (ThrottlingException)"],
            [failure("VALUE-private note used as an error name"), "ABORTED: a call failed (a failure with no printable name)"],
            [Object.assign(new Error("VALUE-in-message"), { code: "ECONNRESET" }), "ABORTED: a call failed (Error ECONNRESET)"],
            ["VALUE-a thrown string", "ABORTED: a call failed (a failure with no name)"],
        ];
        for (const [thrown, expected] of cases) {
            const h = harness();
            seed(h);
            h.tables.before = (sent: Sent) => {
                if (sent.name === "Query") throw thrown;
            };
            expect(await h.run(["--mode", "plan", ...TABLE_ARGS, ...T1])).toBe(1);
            const lines = h.report();
            expect(lines).toContain(expected);
            expect(lines.join("\n")).not.toMatch(/VALUE-|at .*\.ts:\d+/);
        }
    });

    it("failureText: the class name and the short code, each only if it is one plain word; never the message", () => {
        expect(failureText(Object.assign(new Error("m"), { name: "ConditionalCheckFailedException" }))).toBe("ConditionalCheckFailedException");
        expect(failureText(Object.assign(new Error("m"), { code: "ENOENT" }))).toBe("Error ENOENT");
        expect(failureText(Object.assign(new Error("m"), { name: "Same", code: "Same" }))).toBe("Same");
        expect(failureText(Object.assign(new Error("m"), { name: "two words", code: "a=b" }))).toBe("a failure with no printable name");
        expect(failureText(Object.assign(new Error("m"), { name: "x".repeat(200) }))).toBe("a failure with no printable name");
        expect(failureText({ name: 5, code: { nested: "VALUE" } })).toBe("a failure with no printable name");
        expect(failureText(undefined)).toBe("a failure with no name");
        expect(failureText("VALUE-string")).toBe("a failure with no name");
    });
});
