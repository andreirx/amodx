import * as path from "node:path";
import { differingPaths, pathText, sha256Hex, type HashedItem, type ItemKey, type Result } from "./canonical-item.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md § "Verdict sums"; docs/slices/cmrc-1.md § 6 and Appendix R.2; PROTOTYPE) — the pure
 * decision core of the commerce-private table tool. Every function takes plain values (hashes, key sets, parsed
 * records, the argument list) and returns a verdict. No SDK import, no clock, no file access: the shell (`run.ts`)
 * reads and writes, this file decides.
 *
 * The verdicts are sums with one variant per outcome that § 6 names. Every `switch` over one of them has no `default`
 * arm, so a new variant breaks the type check of every reader (`npm run typecheck`, the tool's strict step).
 */

/** One key with the hash of its item: an entry of an inventory, of a manifest and of an authorization record. */
export type KeyHash = { pk: string; sk: string; sha256: string };

const keyId = (key: ItemKey): string => `${key.pk}\u0000${key.sk}`;
const tenantPk = (tenantId: string): string => `TENANT#${tenantId}`;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/* ------------------------------------------------------------------ the selector ------------------------------ */

/** § 6, discard predicate 2: the old mail counters. Not a commerce-private prefix: these items are deleted, not moved. */
export const OLD_MAIL_COUNTER_PARTITION = "SYSTEM";
export const OLD_MAIL_COUNTER_PREFIX = "EMAILLIMIT#";

/** Predicate 1 of § 6: the moved kinds of the allowlisted tenants. `prefixes` is `COMMERCE_PRIVATE_PREFIXES`. */
export type MovedKinds = { kind: "movedKinds"; tenants: string[]; prefixes: string[] };
/** Predicate 2 of § 6: `PK = SYSTEM` and `begins_with(SK, "EMAILLIMIT#")`. */
export type OldMailCounters = { kind: "oldMailCounters" };
/** What a run may read or delete: one of the two predicates of § 6. No other selector exists. */
export type Selector = MovedKinds | OldMailCounters;

export type SelectorRefusal =
    | { reason: "unknownSelector"; name: string }
    | { reason: "tenantsRequired" }
    | { reason: "tenantsNotApplicable" }
    | { reason: "emptyKindPrefix" };

export const SELECTOR_NAMES = { movedKinds: "moved-kinds", oldMailCounters: "old-mail-counters" } as const;

/**
 * The selector of a request, or a refusal. `name` is the `--selector` value (absent = the moved kinds); `tenants` is
 * the `--tenants` allowlist. The moved kinds need the allowlist; the old mail counters are `PK = SYSTEM` items of no
 * tenant and refuse one. An empty kind prefix is refused: it would select a whole partition.
 */
export function parseSelector(name: string | undefined, tenants: string[] | undefined, privatePrefixes: readonly string[]): Result<Selector, SelectorRefusal> {
    if (name === undefined || name === SELECTOR_NAMES.movedKinds) {
        if (tenants === undefined || tenants.length === 0) return { ok: false, error: { reason: "tenantsRequired" } };
        if (privatePrefixes.length === 0 || privatePrefixes.some((prefix) => prefix.length === 0)) return { ok: false, error: { reason: "emptyKindPrefix" } };
        return { ok: true, value: { kind: "movedKinds", tenants, prefixes: [...privatePrefixes] } };
    }
    if (name === SELECTOR_NAMES.oldMailCounters) {
        if (tenants !== undefined) return { ok: false, error: { reason: "tenantsNotApplicable" } };
        return { ok: true, value: { kind: "oldMailCounters" } };
    }
    return { ok: false, error: { reason: "unknownSelector", name } };
}

export function selectorRefusalText(refusal: SelectorRefusal): string {
    switch (refusal.reason) {
        case "unknownSelector":
            return `unknown --selector '${refusal.name}'. The two selectors are '${SELECTOR_NAMES.movedKinds}' and '${SELECTOR_NAMES.oldMailCounters}'; no other selection exists (no whole-partition selection)`;
        case "tenantsRequired":
            return "missing --tenants: an explicit tenant allowlist is required (for example --tenants tenant-a,tenant-b)";
        case "tenantsNotApplicable":
            return `--tenants does not apply to --selector ${SELECTOR_NAMES.oldMailCounters}: the old mail counters are items of the partition ${OLD_MAIL_COUNTER_PARTITION}, not of a tenant`;
        case "emptyKindPrefix":
            return "the list of commerce-private prefixes is empty or holds an empty prefix: that would select a whole partition";
    }
}

/** One Query of the tool: `PK = :pk AND begins_with(SK, :sk)`. `skPrefix` is never empty (see `parseSelector`). */
export type KeyCondition = { pk: string; skPrefix: string };

/** Every Query a selector stands for. This is the only place where a selector becomes a key condition. */
export function keyConditions(selector: Selector): KeyCondition[] {
    switch (selector.kind) {
        case "movedKinds":
            return selector.tenants.flatMap((tenantId) => selector.prefixes.map((skPrefix) => ({ pk: tenantPk(tenantId), skPrefix })));
        case "oldMailCounters":
            return [{ pk: OLD_MAIL_COUNTER_PARTITION, skPrefix: OLD_MAIL_COUNTER_PREFIX }];
    }
}

export function selectorText(selector: Selector): string {
    switch (selector.kind) {
        case "movedKinds":
            return `tenants ${selector.tenants.join(", ")}; kinds ${selector.prefixes.join(", ")}`;
        case "oldMailCounters":
            return `partition ${OLD_MAIL_COUNTER_PARTITION}; old mail counters (${OLD_MAIL_COUNTER_PREFIX})`;
    }
}

/* ------------------------------------------------------------------ copy -------------------------------------- */

/** What `migrate` does with one source key. A destination item that differs is never overwritten. */
export type CopyVerdict =
    | { verdict: "copy" }
    | { verdict: "alreadyPresentEqual" }
    | { verdict: "refusedDestinationDiffers"; paths: string[] };

export function copyVerdict(source: HashedItem, destination: HashedItem | undefined): CopyVerdict {
    if (destination === undefined) return { verdict: "copy" };
    if (destination.sha256 === source.sha256) return { verdict: "alreadyPresentEqual" };
    return { verdict: "refusedDestinationDiffers", paths: differingPaths(source.canonical, destination.canonical).map(pathText) };
}

/* ------------------------------------------------------------------ verify --strict --------------------------- */

/** One difference between the two tables. `paths` names attributes (JSON arrays of names and indexes), never a value. */
export type ContentDifference =
    | { kind: "missingInDestination"; key: ItemKey }
    | { kind: "missingInSource"; key: ItemKey }
    | { kind: "attributeDiffers"; key: ItemKey; paths: string[] };

/** Content equality of two item sets: every key in both, every attribute at every depth equal (by hash). */
export function contentDifferences(source: HashedItem[], destination: HashedItem[]): ContentDifference[] {
    const destinationById = new Map(destination.map((item) => [keyId(item.key), item]));
    const sourceIds = new Set(source.map((item) => keyId(item.key)));
    const differences: ContentDifference[] = [];
    for (const item of source) {
        const other = destinationById.get(keyId(item.key));
        if (other === undefined) differences.push({ kind: "missingInDestination", key: item.key });
        else if (other.sha256 !== item.sha256) {
            differences.push({ kind: "attributeDiffers", key: item.key, paths: differingPaths(item.canonical, other.canonical).map(pathText) });
        }
    }
    for (const item of destination) {
        if (!sourceIds.has(keyId(item.key))) differences.push({ kind: "missingInSource", key: item.key });
    }
    return differences;
}

/* ------------------------------------------------------------------ inventory and manifest -------------------- */

export const INVENTORY_RECORD = "amodx-commerce-private/inventory/1";
export const MANIFEST_RECORD = "amodx-commerce-private/verification-manifest/1";
export const AUTHORIZATION_RECORD = "amodx-commerce-private/discard-authorization/1";

const keyHashOf = (item: HashedItem): KeyHash => ({ pk: item.key.pk, sk: item.key.sk, sha256: item.sha256 });

/** The inventory file of `plan --inventory-out`: the key set of the SOURCE with one hash per item. Proves no copy. */
export function inventoryText(createdAt: string, sourceTable: string, selector: Selector, source: HashedItem[]): string {
    return `${JSON.stringify({ record: INVENTORY_RECORD, createdAt, sourceTable, selector: selectorText(selector), entries: source.map(keyHashOf) }, null, 1)}\n`;
}

/**
 * The verification manifest of `verify --strict`: every key that was deep-equal in both tables at `createdAt`, with
 * the hash of its item. The shell writes it only when `contentDifferences` is empty.
 */
export type Manifest = {
    record: typeof MANIFEST_RECORD;
    createdAt: string;
    sourceTable: string;
    destinationTable: string;
    tenants: string[];
    prefixes: string[];
    entries: KeyHash[];
};

export function buildManifest(createdAt: string, tables: Tables, selector: MovedKinds, verified: HashedItem[]): Manifest {
    return {
        record: MANIFEST_RECORD,
        createdAt,
        sourceTable: tables.source,
        destinationTable: tables.destination,
        tenants: selector.tenants,
        prefixes: selector.prefixes,
        entries: verified.map(keyHashOf),
    };
}

export const manifestText = (manifest: Manifest): string => `${JSON.stringify(manifest, null, 1)}\n`;

export type ManifestRefusal =
    | { reason: "sha256Differs"; expected: string; actual: string }
    | { reason: "notJson" }
    | { reason: "notAVerificationManifest"; record: string }
    | { reason: "malformed"; what: string }
    | { reason: "doesNotCoverRequest"; what: string };

export function manifestRefusalText(refusal: ManifestRefusal): string {
    switch (refusal.reason) {
        case "sha256Differs":
            return `the manifest file does not have the SHA-256 given with --manifest-sha256 (given ${refusal.expected}, file ${refusal.actual})`;
        case "notJson":
            return "the manifest file is not JSON";
        case "notAVerificationManifest":
            return `the file is not a verification manifest (its record is '${refusal.record}', needed '${MANIFEST_RECORD}'); an inventory proves no copy`;
        case "malformed":
            return `the manifest file is malformed: ${refusal.what}`;
        case "doesNotCoverRequest":
            return `the manifest does not cover the request: ${refusal.what}`;
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((member) => typeof member === "string");

/** A list of `{pk, sk, sha256}` with no key twice, or the text of what is wrong. */
function parseKeyHashes(value: unknown, field: string): Result<KeyHash[], string> {
    if (!Array.isArray(value)) return { ok: false, error: `${field} is not a list` };
    const seen = new Set<string>();
    const entries: KeyHash[] = [];
    for (const [index, member] of value.entries()) {
        if (!isRecord(member) || typeof member.pk !== "string" || typeof member.sk !== "string" || typeof member.sha256 !== "string" || !SHA256_HEX.test(member.sha256)) {
            return { ok: false, error: `${field}[${index}] is not { pk, sk, sha256 (64 lower-case hex) }` };
        }
        const id = keyId({ pk: member.pk, sk: member.sk });
        if (seen.has(id)) return { ok: false, error: `${field}[${index}] repeats a key` };
        seen.add(id);
        entries.push({ pk: member.pk, sk: member.sk, sha256: member.sha256 });
    }
    return { ok: true, value: entries };
}

/** What a mode asks of a manifest: the same two tables, every requested tenant, the kinds the tool handles now. */
export type ManifestUse = { tables: Tables; selector: MovedKinds };

/**
 * The manifest of a file text, accepted only if (1) the text has the SHA-256 the operator gave, (2) it is a
 * verification manifest, (3) it covers the request: the same two table names, every requested tenant, and the same
 * list of kinds. A manifest of other tables (staging against production) is refused here, before any read of a table.
 */
export function parseManifest(text: string, expectedSha256: string, use: ManifestUse): Result<Manifest, ManifestRefusal> {
    const actual = sha256Hex(text);
    if (actual !== expectedSha256) return { ok: false, error: { reason: "sha256Differs", expected: expectedSha256, actual } };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: { reason: "notJson" } };
    }
    if (!isRecord(parsed)) return { ok: false, error: { reason: "malformed", what: "not an object" } };
    if (parsed.record !== MANIFEST_RECORD) return { ok: false, error: { reason: "notAVerificationManifest", record: String(parsed.record) } };
    const { createdAt, sourceTable, destinationTable, tenants, prefixes } = parsed;
    if (typeof createdAt !== "string" || typeof sourceTable !== "string" || typeof destinationTable !== "string" || !isStringList(tenants) || !isStringList(prefixes)) {
        return { ok: false, error: { reason: "malformed", what: "createdAt, sourceTable, destinationTable, tenants or prefixes is missing or of the wrong type" } };
    }
    const entries = parseKeyHashes(parsed.entries, "entries");
    if (!entries.ok) return { ok: false, error: { reason: "malformed", what: entries.error } };

    const doesNotCover = (what: string): Result<Manifest, ManifestRefusal> => ({ ok: false, error: { reason: "doesNotCoverRequest", what } });
    if (sourceTable !== use.tables.source) return doesNotCover(`its source table is '${sourceTable}', the request names '${use.tables.source}'`);
    if (destinationTable !== use.tables.destination) return doesNotCover(`its destination table is '${destinationTable}', the request names '${use.tables.destination}'`);
    const uncovered = use.selector.tenants.filter((tenantId) => !tenants.includes(tenantId));
    if (uncovered.length > 0) return doesNotCover(`it was not written for tenant ${uncovered.join(", ")}`);
    if (JSON.stringify([...prefixes].sort()) !== JSON.stringify([...use.selector.prefixes].sort())) {
        return doesNotCover(`it was written for the kinds ${prefixes.join(", ")}; the tool now handles ${use.selector.prefixes.join(", ")}`);
    }
    return { ok: true, value: { record: MANIFEST_RECORD, createdAt, sourceTable, destinationTable, tenants, prefixes, entries: entries.value } };
}

/** The manifest entries of the requested tenants (a manifest may cover more tenants than one run names). */
export function entriesOfTenants(manifest: Manifest, tenants: string[]): KeyHash[] {
    const partitions = new Set(tenants.map(tenantPk));
    return manifest.entries.filter((entry) => partitions.has(entry.pk));
}

/* ------------------------------------------------------------------ verify --post-cutover --------------------- */

/**
 * Q6 of § 6, as amended by operator ruling CMRC2A-Q6-RELEASE-EVIDENCE = B. The tool establishes EXACTLY three
 * statements, and this sum has exactly one variant for each:
 *  (1) every manifest key exists in the destination            → `manifestKeyMissingInDestination` when not;
 *  (2) the source holds no key of a moved kind outside the manifest → `sourceKeyNotInManifest`;
 *  (3) every source item still hashes to its manifest value    → `sourceChangedSinceManifest`.
 * (2) and (3) are statements about the items the SOURCE holds. A manifest key that has no source item breaks none of
 * the three, so it is not a difference (review-1 F06; slice decision D5). No fourth condition may be added here.
 */
export type PostCutoverDifference =
    | { kind: "manifestKeyMissingInDestination"; key: ItemKey }
    | { kind: "sourceKeyNotInManifest"; key: ItemKey }
    | { kind: "sourceChangedSinceManifest"; key: ItemKey };

export type PostCutoverFindings = {
    differences: PostCutoverDifference[];
    /**
     * Destination keys that are not in the manifest. NOT a difference and NOT a statement about time: the tool cannot
     * establish when such an item was created. The operator establishes it from the freeze record.
     */
    destinationKeysNotInManifest: ItemKey[];
};

export function postCutoverFindings(manifestEntries: KeyHash[], source: HashedItem[], destination: HashedItem[]): PostCutoverFindings {
    const manifestById = new Map(manifestEntries.map((entry) => [keyId(entry), entry]));
    const destinationIds = new Set(destination.map((item) => keyId(item.key)));
    const differences: PostCutoverDifference[] = [];
    // Statement (1): one check per manifest key, against the destination.
    for (const entry of manifestEntries) {
        if (!destinationIds.has(keyId(entry))) differences.push({ kind: "manifestKeyMissingInDestination", key: { pk: entry.pk, sk: entry.sk } });
    }
    // Statements (2) and (3): one check per item the source HOLDS.
    for (const item of source) {
        const entry = manifestById.get(keyId(item.key));
        if (entry === undefined) differences.push({ kind: "sourceKeyNotInManifest", key: item.key });
        else if (entry.sha256 !== item.sha256) differences.push({ kind: "sourceChangedSinceManifest", key: item.key });
    }
    return { differences, destinationKeysNotInManifest: destination.filter((item) => !manifestById.has(keyId(item.key))).map((item) => item.key) };
}

/* ------------------------------------------------------------------ purge ------------------------------------- */

/** The four rows of § 6 (bullet `cmrc-6`, Purge), and nothing else. */
export type PurgeVerdict =
    | { verdict: "delete" }
    | { verdict: "refusedNotInManifest" }
    | { verdict: "refusedSourceChanged" }
    | { verdict: "refusedDestinationAbsent" };

/**
 * May this main-table item be deleted? Only when its key is in the manifest, its content is unchanged since the
 * verification, and the destination still holds an item of that key (of ANY content: released writers change the
 * destination legitimately). The checks run in this order; a key gets one reason.
 */
export function purgeVerdict(sourceSha256: string, manifestSha256: string | undefined, destinationPresent: boolean): PurgeVerdict {
    if (manifestSha256 === undefined) return { verdict: "refusedNotInManifest" };
    if (sourceSha256 !== manifestSha256) return { verdict: "refusedSourceChanged" };
    if (!destinationPresent) return { verdict: "refusedDestinationAbsent" };
    return { verdict: "delete" };
}

/** `purge-verify`: what is not as the postcondition of § 6 says. */
export type PurgePostconditionDifference =
    | { kind: "remainsInSource"; key: ItemKey }
    | { kind: "absentInSourceAndDestination"; key: ItemKey };

/**
 * Postcondition of a purge, from the manifest: every manifest key is absent in the source and present in the
 * destination; no key of a moved kind remains in the source (a remaining key was refused, or was never purged).
 */
export function purgePostcondition(manifestEntries: KeyHash[], sourceKeys: ItemKey[], destinationKeys: ItemKey[]): PurgePostconditionDifference[] {
    const sourceIds = new Set(sourceKeys.map(keyId));
    const destinationIds = new Set(destinationKeys.map(keyId));
    const differences: PurgePostconditionDifference[] = sourceKeys.map((key) => ({ kind: "remainsInSource", key }));
    for (const entry of manifestEntries) {
        if (!sourceIds.has(keyId(entry)) && !destinationIds.has(keyId(entry))) {
            differences.push({ kind: "absentInSourceAndDestination", key: { pk: entry.pk, sk: entry.sk } });
        }
    }
    return differences;
}

/* ------------------------------------------------------------------ discard ----------------------------------- */

/** Appendix R.2 condition 4: only a key of the authorized set, and only with the hash the human saw. */
export type DiscardVerdict =
    | { verdict: "delete" }
    | { verdict: "refusedNotAuthorized" }
    | { verdict: "refusedChangedSinceAuthorization" };

export function discardVerdict(sourceSha256: string, authorizedSha256: string | undefined): DiscardVerdict {
    if (authorizedSha256 === undefined) return { verdict: "refusedNotAuthorized" };
    if (sourceSha256 !== authorizedSha256) return { verdict: "refusedChangedSinceAuthorization" };
    return { verdict: "delete" };
}

/**
 * The human's authorization of a loss (§ 6 "Discard"; Appendix R.2 condition 2): who, when, which table, which of the
 * two predicates with its tenants and its kinds named one by one, and the exact key set with the hash of each item.
 */
export type DiscardAuthorization = {
    record: typeof AUTHORIZATION_RECORD;
    authorizedBy: string;
    authorizedOn: string;
    sourceTable: string;
    selector: { predicate: "movedKinds"; tenants: string[]; kinds: string[] } | { predicate: "oldMailCounters"; partition: typeof OLD_MAIL_COUNTER_PARTITION };
    authorizedKeys: KeyHash[];
};

export type AuthorizationRefusal =
    | { reason: "notJson" }
    | { reason: "notAnAuthorizationRecord"; record: string }
    | { reason: "fieldMissingOrMalformed"; field: string }
    | { reason: "doesNotCoverRequest"; what: string };

export function authorizationRefusalText(refusal: AuthorizationRefusal): string {
    switch (refusal.reason) {
        case "notJson":
            return "the authorization record is not JSON";
        case "notAnAuthorizationRecord":
            return `the file is not a discard authorization record (its record is '${refusal.record}', needed '${AUTHORIZATION_RECORD}')`;
        case "fieldMissingOrMalformed":
            return `the authorization record has no valid field: ${refusal.field}`;
        case "doesNotCoverRequest":
            return `the authorization record does not cover the request: ${refusal.what}`;
    }
}

/**
 * The authorization record of a file text, accepted only if every field is present and it covers the request: the
 * same source table, the same predicate, every requested tenant and every kind the tool would select.
 */
export function parseAuthorization(text: string, use: { sourceTable: string; selector: Selector }): Result<DiscardAuthorization, AuthorizationRefusal> {
    const bad = (field: string): Result<DiscardAuthorization, AuthorizationRefusal> => ({ ok: false, error: { reason: "fieldMissingOrMalformed", field } });
    const doesNotCover = (what: string): Result<DiscardAuthorization, AuthorizationRefusal> => ({ ok: false, error: { reason: "doesNotCoverRequest", what } });
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: { reason: "notJson" } };
    }
    if (!isRecord(parsed)) return bad("the record is not an object");
    if (parsed.record !== AUTHORIZATION_RECORD) return { ok: false, error: { reason: "notAnAuthorizationRecord", record: String(parsed.record) } };
    const { authorizedBy, authorizedOn, sourceTable, selector } = parsed;
    if (typeof authorizedBy !== "string" || authorizedBy.trim() === "") return bad("authorizedBy (who)");
    if (typeof authorizedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(authorizedOn)) return bad("authorizedOn (date, YYYY-MM-DD)");
    if (typeof sourceTable !== "string" || sourceTable === "") return bad("sourceTable");
    if (!isRecord(selector)) return bad("selector");
    const keys = parseKeyHashes(parsed.authorizedKeys, "authorizedKeys");
    if (!keys.ok) return bad(keys.error);

    let recorded: DiscardAuthorization["selector"];
    if (selector.predicate === "movedKinds") {
        if (!isStringList(selector.tenants) || selector.tenants.length === 0) return bad("selector.tenants (the tenant allowlist)");
        if (!isStringList(selector.kinds) || selector.kinds.length === 0) return bad("selector.kinds (each kind, named one by one)");
        recorded = { predicate: "movedKinds", tenants: selector.tenants, kinds: selector.kinds };
    } else if (selector.predicate === "oldMailCounters") {
        if (selector.partition !== OLD_MAIL_COUNTER_PARTITION) return bad(`selector.partition (must be '${OLD_MAIL_COUNTER_PARTITION}')`);
        recorded = { predicate: "oldMailCounters", partition: OLD_MAIL_COUNTER_PARTITION };
    } else {
        return bad("selector.predicate (must be 'movedKinds' or 'oldMailCounters')");
    }

    if (sourceTable !== use.sourceTable) return doesNotCover(`it authorizes table '${sourceTable}', the request names '${use.sourceTable}'`);
    switch (use.selector.kind) {
        case "movedKinds": {
            if (recorded.predicate !== "movedKinds") return doesNotCover("it authorizes the old mail counters, the request selects the moved kinds");
            const tenants = recorded.tenants;
            const kinds = recorded.kinds;
            const uncoveredTenants = use.selector.tenants.filter((tenantId) => !tenants.includes(tenantId));
            if (uncoveredTenants.length > 0) return doesNotCover(`it does not name tenant ${uncoveredTenants.join(", ")}`);
            const uncoveredKinds = use.selector.prefixes.filter((prefix) => !kinds.includes(prefix));
            if (uncoveredKinds.length > 0) return doesNotCover(`it does not name kind ${uncoveredKinds.join(", ")}`);
            break;
        }
        case "oldMailCounters":
            if (recorded.predicate !== "oldMailCounters") return doesNotCover("it authorizes the moved kinds, the request selects the old mail counters");
            break;
    }
    return { ok: true, value: { record: AUTHORIZATION_RECORD, authorizedBy, authorizedOn, sourceTable, selector: recorded, authorizedKeys: keys.value } };
}

/* ------------------------------------------------------------------ notices of `plan` ------------------------- */

/**
 * The key attributes of the main table's four indexes besides `Type` and `PK` (infra/lib/database.ts; cmrc-1.md § 2.4).
 * An item is in an index only if it has every key attribute of that index; the commerce writers set none of these.
 */
export const GSI_KEY_ATTRIBUTES = ["CreatedAt", "Domain", "ScheduledFor", "Status", "TenantSlug"] as const;

/**
 * How a sort key holds an email address, for the kinds that hold one. The shell builds it from the key functions of
 * `backend/src/lib/commerce-db.ts` (the owner of the key grammar) and from the old mail-counter prefix:
 *  - `emailToEnd`: `<prefix><email>` — the email is everything after the prefix, `#` included;
 *  - `emailThenLastHash`: `<prefix><email>#<id>` — the id is the text after the LAST `#` (the rule of
 *    `orderIdOfCustomerOrder`), the email is everything between the prefix and that `#`.
 */
export type EmailKeyForm = { prefix: string; form: "emailToEnd" | "emailThenLastHash" };

/** The complete email inside a sort key, by the first (longest-prefix) form that fits; `undefined` when none fits. */
export function emailOfSortKey(sk: string, forms: readonly EmailKeyForm[]): string | undefined {
    const fitting = forms.filter((candidate) => sk.startsWith(candidate.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (fitting === undefined) return undefined;
    const rest = sk.slice(fitting.prefix.length);
    switch (fitting.form) {
        case "emailToEnd":
            return rest;
        case "emailThenLastHash": {
            const lastHash = rest.lastIndexOf("#");
            return lastHash === -1 ? rest : rest.slice(0, lastHash);
        }
    }
}

export type Notice =
    | { kind: "gsiAttributes"; key: ItemKey; attributes: string[] }
    | { kind: "keyNotNormalized"; key: ItemKey }
    | { kind: "emailKeyOfUnknownForm"; key: ItemKey };

/**
 * What `plan` reports about one item besides its count:
 *  - a GSI key attribute (§ 2.4);
 *  - a sort key whose COMPLETE email, taken out by the key's form, is not equal to its `normalizeEmail()` output
 *    (F-FND2-1) — the whole address is normalized at once, so a change before or after an embedded `#` is found;
 *  - a sort key that contains `@` but fits no known form: the tool cannot check it, and says so instead of passing it.
 */
export function noticesOf(item: HashedItem, forms: readonly EmailKeyForm[], normalizeEmail: (raw: string) => string): Notice[] {
    const notices: Notice[] = [];
    const attributes = GSI_KEY_ATTRIBUTES.filter((name) => item.canonical[name] !== undefined);
    if (attributes.length > 0) notices.push({ kind: "gsiAttributes", key: item.key, attributes: [...attributes] });
    const email = emailOfSortKey(item.key.sk, forms);
    if (email !== undefined) {
        if (normalizeEmail(email) !== email) notices.push({ kind: "keyNotNormalized", key: item.key });
    } else if (item.key.sk.includes("@")) {
        notices.push({ kind: "emailKeyOfUnknownForm", key: item.key });
    }
    return notices;
}

/* ------------------------------------------------------------------ the request ------------------------------- */

/**
 * Is `target` the directory itself or a path under it? Both are absolute paths. Decided by path COMPONENT: the path
 * from the directory to the target leaves the directory only when its FIRST component is `..` (a child named
 * `..private` is inside). Lexical only: the caller gives real paths when links matter (`files.ts` does).
 */
export function isInsideDirectory(directory: string, target: string): boolean {
    const relative = path.relative(directory, target);
    if (path.isAbsolute(relative)) return false; // another root (a Windows drive)
    return relative.split(path.sep)[0] !== "..";
}

export type Tables = { source: string; destination: string };
export type ManifestRef = { path: string; sha256: string };

/** Whether a deleting mode only plans, or deletes. The backup reference and the export path exist only when it deletes. */
export type Deletion = { kind: "planOnly" } | { kind: "execute"; backupReference: string; exportPath: string };

/** One run of the tool: one variant per mode, each with only the data that mode needs. All paths are absolute. */
export type Request = { tables: Tables; region: string; pageSize: number } & (
    | { mode: "plan"; selector: Selector; inventoryOut: string | undefined }
    | { mode: "migrate"; selector: MovedKinds; execute: boolean }
    | { mode: "verifyStrict"; selector: MovedKinds; manifestOut: string }
    | { mode: "verifyPostCutover"; selector: MovedKinds; manifest: ManifestRef }
    | { mode: "purge"; selector: MovedKinds; manifest: ManifestRef; deletion: Deletion }
    | { mode: "purgeVerify"; selector: MovedKinds; manifest: ManifestRef }
    | { mode: "discard"; selector: Selector; authorizationPath: string; deletion: Deletion }
    | { mode: "discardVerify"; selector: Selector; exportPath: string }
);

/** What the argument parser needs from outside: the kinds, the default region, and the two directories of the path rule. */
export type RequestContext = { privatePrefixes: readonly string[]; defaultRegion: string; cwd: string; repositoryRoot: string };

const VALUE_FLAGS = [
    "mode", "source-table", "destination-table", "tenants", "selector", "region", "page-size",
    "inventory-out", "manifest-out", "manifest", "manifest-sha256", "authorization", "backup-ref", "export-path",
] as const;
const BOOLEAN_FLAGS = ["execute", "strict", "post-cutover"] as const;
const COMMON_FLAGS = ["mode", "source-table", "destination-table", "region", "page-size"];

/** The flags each `--mode` accepts besides the common ones. A flag outside its mode is refused, never ignored. */
const MODE_FLAGS = {
    "plan": ["tenants", "selector", "inventory-out"],
    "migrate": ["tenants", "execute"],
    "verify": ["tenants", "strict", "post-cutover", "manifest-out", "manifest", "manifest-sha256"],
    "purge-plan": ["tenants", "manifest", "manifest-sha256"],
    "purge": ["tenants", "manifest", "manifest-sha256", "execute", "backup-ref", "export-path"],
    "purge-verify": ["tenants", "manifest", "manifest-sha256"],
    "discard-plan": ["tenants", "selector", "authorization"],
    "discard": ["tenants", "selector", "authorization", "execute", "backup-ref", "export-path"],
    "discard-verify": ["tenants", "selector", "export-path"],
} as const;
type ModeName = keyof typeof MODE_FLAGS;
export const MODE_NAMES = Object.keys(MODE_FLAGS) as ModeName[];
const isModeName = (value: string): value is ModeName => (MODE_NAMES as string[]).includes(value);

/**
 * The request of an argument list, or every reason why it is refused. Nothing is defaulted that could widen a run: the
 * mode, both tables and the allowlist are required; an unknown flag, a flag of another mode, a repeated flag and a
 * value without a flag are refused; a file the tool would WRITE must be outside the repository tree.
 */
export function parseRequest(argv: string[], context: RequestContext): Result<Request, string[]> {
    const errors: string[] = [];
    const values = new Map<string, string>();
    const switches = new Set<string>();
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            errors.push(`'${token}' is not a flag (a value without its flag?)`);
            continue;
        }
        const name = token.slice(2);
        if (values.has(name) || switches.has(name)) {
            errors.push(`--${name} is given twice`);
        }
        if ((VALUE_FLAGS as readonly string[]).includes(name)) {
            const value = argv[index + 1];
            if (value === undefined || value.startsWith("--")) errors.push(`--${name} needs a value`);
            else {
                values.set(name, value);
                index += 1;
            }
        } else if ((BOOLEAN_FLAGS as readonly string[]).includes(name)) {
            switches.add(name);
        } else {
            errors.push(`unknown flag --${name}`);
        }
    }

    const modeText = values.get("mode");
    if (modeText === undefined || !isModeName(modeText)) {
        errors.push(`missing or invalid --mode. The modes are: ${MODE_NAMES.join(", ")}`);
        return { ok: false, error: errors };
    }
    const mode: ModeName = modeText;
    const allowed: readonly string[] = [...COMMON_FLAGS, ...MODE_FLAGS[mode]];
    for (const name of [...values.keys(), ...switches]) {
        if (!allowed.includes(name)) errors.push(`--${name} does not belong to --mode ${mode}`);
    }

    const source = values.get("source-table") ?? "";
    const destination = values.get("destination-table") ?? "";
    if (source === "") errors.push("missing --source-table");
    if (destination === "") errors.push("missing --destination-table");
    if (source !== "" && source === destination) errors.push(`--source-table and --destination-table are the same table ('${source}')`);

    const pageSize = Number(values.get("page-size") ?? "50");
    if (!Number.isInteger(pageSize) || pageSize <= 0) errors.push("invalid --page-size: use a positive whole number");

    const tenantsText = values.get("tenants");
    const tenants = tenantsText === undefined ? undefined : [...new Set(tenantsText.split(",").map((tenantId) => tenantId.trim()).filter((tenantId) => tenantId !== ""))];
    const selectorResult = parseSelector(values.get("selector"), tenants, context.privatePrefixes);
    if (!selectorResult.ok) errors.push(selectorRefusalText(selectorResult.error));
    // The checks above hold for every mode. The checks of one mode (below) run only on a request that passed them.
    if (!selectorResult.ok || errors.length > 0) return { ok: false, error: errors };
    const selector = selectorResult.value;

    const absolute = (flag: string): string | undefined => {
        const given = values.get(flag);
        return given === undefined ? undefined : path.resolve(context.cwd, given);
    };
    const required = (flag: string): string => {
        const value = absolute(flag);
        if (value === undefined) errors.push(`--mode ${mode} needs --${flag}`);
        return value ?? "";
    };
    /** A file the tool writes: never inside the repository tree (it holds keys with email addresses, or whole items). */
    const outside = (flag: string, value: string | undefined): void => {
        if (value === undefined || value === "") return;
        if (isInsideDirectory(context.repositoryRoot, value)) {
            errors.push(`--${flag} is inside the repository (${context.repositoryRoot}): give a path outside it; the file holds keys that contain email addresses`);
        }
    };
    const manifestRef = (): ManifestRef => {
        const sha256 = (values.get("manifest-sha256") ?? "").toLowerCase();
        const manifestPath = required("manifest");
        if (!SHA256_HEX.test(sha256)) errors.push(`--mode ${mode} needs --manifest-sha256 (64 hex digits: the SHA-256 that 'verify --strict' printed)`);
        return { path: manifestPath, sha256 };
    };
    const deletion = (mayExecute: boolean): Deletion => {
        if (!mayExecute || !switches.has("execute")) return { kind: "planOnly" };
        const backupReference = values.get("backup-ref") ?? "";
        if (backupReference.trim() === "") errors.push(`--mode ${mode} --execute needs --backup-ref (an on-demand backup ARN, or PITR with the exact UTC time recorded just before the run)`);
        const exportPath = required("export-path");
        outside("export-path", exportPath);
        return { kind: "execute", backupReference, exportPath };
    };

    const base = { tables: { source, destination }, region: values.get("region") ?? context.defaultRegion, pageSize };
    const moved = (): MovedKinds => {
        if (selector.kind === "movedKinds") return selector;
        // Not reachable: `--selector` is not a flag of a mode that calls this (MODE_FLAGS), and a flag outside its mode
        // was refused above; without `--selector` the selector is the moved kinds.
        throw new Error(`--mode ${mode} has no selector but the moved kinds`);
    };

    let request: Request;
    switch (mode) {
        case "plan": {
            const inventoryOut = absolute("inventory-out");
            outside("inventory-out", inventoryOut);
            request = { ...base, mode: "plan", selector, inventoryOut };
            break;
        }
        case "migrate":
            request = { ...base, mode: "migrate", selector: moved(), execute: switches.has("execute") };
            break;
        case "verify": {
            const strict = switches.has("strict");
            const postCutover = switches.has("post-cutover");
            if (strict === postCutover) {
                errors.push("--mode verify needs exactly one of --strict (content equality, writes the manifest) and --post-cutover. A comparison of key sets alone is not a verification; 'plan' prints the key counts");
                return { ok: false, error: errors };
            }
            if (strict) {
                for (const flag of ["manifest", "manifest-sha256"]) if (values.has(flag)) errors.push(`--${flag} does not belong to --mode verify --strict (it writes a manifest: --manifest-out)`);
                const manifestOut = required("manifest-out");
                outside("manifest-out", manifestOut);
                request = { ...base, mode: "verifyStrict", selector: moved(), manifestOut };
            } else {
                if (values.has("manifest-out")) errors.push("--manifest-out does not belong to --mode verify --post-cutover (it reads a manifest: --manifest)");
                request = { ...base, mode: "verifyPostCutover", selector: moved(), manifest: manifestRef() };
            }
            break;
        }
        case "purge-plan":
            request = { ...base, mode: "purge", selector: moved(), manifest: manifestRef(), deletion: deletion(false) };
            break;
        case "purge":
            request = { ...base, mode: "purge", selector: moved(), manifest: manifestRef(), deletion: deletion(true) };
            break;
        case "purge-verify":
            request = { ...base, mode: "purgeVerify", selector: moved(), manifest: manifestRef() };
            break;
        case "discard-plan":
            request = { ...base, mode: "discard", selector, authorizationPath: required("authorization"), deletion: deletion(false) };
            break;
        case "discard":
            request = { ...base, mode: "discard", selector, authorizationPath: required("authorization"), deletion: deletion(true) };
            break;
        case "discard-verify":
            request = { ...base, mode: "discardVerify", selector, exportPath: required("export-path") };
            break;
    }
    return errors.length > 0 ? { ok: false, error: errors } : { ok: true, value: request };
}

/**
 * Every file a request would CREATE, with the flag that names it. The shell checks each one before it reads a table
 * (real directory outside the repository, no file there yet). One place, so a mode cannot have an unchecked output.
 */
export function outputFilesOf(request: Request): { flag: string; path: string }[] {
    const ofDeletion = (deletion: Deletion): { flag: string; path: string }[] => {
        switch (deletion.kind) {
            case "planOnly":
                return [];
            case "execute":
                return [{ flag: "export-path", path: deletion.exportPath }];
        }
    };
    switch (request.mode) {
        case "plan":
            return request.inventoryOut === undefined ? [] : [{ flag: "inventory-out", path: request.inventoryOut }];
        case "verifyStrict":
            return [{ flag: "manifest-out", path: request.manifestOut }];
        case "purge":
        case "discard":
            return ofDeletion(request.deletion);
        case "migrate":
        case "verifyPostCutover":
        case "purgeVerify":
        case "discardVerify":
            return [];
    }
}
