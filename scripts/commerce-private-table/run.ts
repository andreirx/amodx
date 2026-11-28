import { DeleteItemCommand, GetItemCommand, PutItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { normalizeEmail } from "@amodx/shared";
import { COMMERCE_PRIVATE_PREFIXES, customerOrderRef, customerRef } from "../../backend/src/lib/commerce-db.js";
import { canonicalize, pathText, sha256Hex, type HashedItem, type ItemKey } from "./canonical-item.js";
import {
    authorizationRefusalText, buildManifest, contentDifferences, copyVerdict, discardVerdict, entriesOfTenants, inventoryText,
    keyConditions, manifestRefusalText, manifestText, MODE_NAMES, noticesOf, OLD_MAIL_COUNTER_PARTITION, OLD_MAIL_COUNTER_PREFIX,
    outputFilesOf, parseAuthorization, parseManifest, parseRequest, postCutoverFindings, purgePostcondition, purgeVerdict, SELECTOR_NAMES, selectorText,
    type ContentDifference, type CopyVerdict, type Deletion, type EmailKeyForm, type KeyCondition, type Manifest, type ManifestRef, type MovedKinds,
    type Notice, type PostCutoverDifference, type PurgePostconditionDifference, type Request, type RequestContext, type Selector, type Tables,
} from "./decisions.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md; docs/slices/cmrc-1.md § 6; PROTOTYPE) — the I/O shell of the commerce-private table
 * tool. It reads and writes; every decision about a key is made by the pure core (`decisions.ts`, `canonical-item.ts`).
 *
 * The four command forms this file sends, and no other (no Scan, no BatchWrite, no Update):
 *   Query      `PK = :pk AND begins_with(SK, :sk)`, ConsistentRead      — both tables
 *   GetItem    ConsistentRead                                            — both tables
 *   PutItem    `attribute_not_exists(SK)`                                — the DESTINATION only (`migrate --execute`)
 *   DeleteItem                                                           — the SOURCE only (`purge`, `discard`, `--execute`)
 * Items travel in DynamoDB wire form (`AttributeValue` maps): the copy puts back exactly the map it read.
 *
 * Everything from outside comes through `Ports`: the database, the clock, the files, the report lines. The entry file
 * `scripts/migrate-commerce-private-table.ts` gives the real ones; the unit tests give in-memory ones.
 *
 * Three rules of the report (review-0, F03):
 *  1. A line may hold table names, tenant ids, PK, SK, hashes, attribute NAMES, file paths and counts. No line holds an
 *     attribute value. Of a failure that came from outside (AWS, the file system) the report prints the error's class
 *     name and short code only (`failureText`) — never its message or its stack, which can quote data.
 *  2. The report states the state of a table only as the tool OBSERVED it. When a Put or a Delete call fails, its
 *     outcome is taken from a consistent read after it; if that read fails too, the report says UNKNOWN.
 *  3. Once an export file is open, its path, line count and SHA-256 are reported at the end of every run that the
 *     tool still controls — also after a failure — or the report says why one of them is not available.
 */

type RawItem = Record<string, AttributeValue>;
/** One item as read: its wire form (for the copy), and its key, canonical form and hash (for every decision). */
type Loaded = HashedItem & { raw: RawItem };

export type ToolCommand = QueryCommand | GetItemCommand | PutItemCommand | DeleteItemCommand;
/** The fields of a command answer that the tool reads. */
type CommandAnswer = { Items?: RawItem[]; LastEvaluatedKey?: RawItem; Item?: RawItem };
export type Database = { send(command: ToolCommand): Promise<CommandAnswer> };

export type Ports = {
    /** The database client of one region. Called once per run, after the request was accepted. */
    connect(region: string): Database;
    /** The time of the run, ISO 8601. */
    now(): string;
    files: {
        /** Why no file may be CREATED at this path (inside the repository, no directory, a file is there), or `undefined`. */
        outputRefusal(path: string): string | undefined;
        read(path: string): string;
        /** Creates the file with this text, whole and flushed. Must fail if the path exists. */
        createNew(path: string, text: string): void;
        /** Creates an empty file (must fail if the path exists). `appendLine` returns only when the WHOLE line is on disk. */
        openNewForAppend(path: string): { appendLine(line: string): void; close(): void };
    };
    /** One line of the report. */
    out(line: string): void;
};

/** What the entry file knows and the tests fix: the default region and the two directories of the output-path rule. */
export type Environment = Omit<RequestContext, "privatePrefixes">;

type Outcome = { green: boolean; summary: string };

/** The request cannot be served as given. Thrown only BEFORE the first read of a table. The message is tool text. */
class RequestRefused extends Error {}
/** The run must not decide anything more. The message is tool text: keys, attribute paths, error names; no value. */
class RunAborted extends Error {}

const keyText = (key: ItemKey): string => `PK=${key.pk} SK=${key.sk}`;
const keyId = (key: ItemKey): string => `${key.pk}\u0000${key.sk}`;
const lineCount = (text: string): number => (text === "" ? 0 : text.replace(/\n$/, "").split("\n").length);

const PRINTABLE_ERROR_WORD = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/;

/**
 * All the report may say about a failure from outside the tool: the error's class name and its short code
 * (`ConditionalCheckFailedException`, `Error ENOENT`), each only if it is one plain word. Never the message, never the
 * stack: an AWS or file-system message can quote an attribute value or a file's content.
 */
export function failureText(error: unknown): string {
    if (typeof error !== "object" || error === null) return "a failure with no name";
    const { name, code } = error as { name?: unknown; code?: unknown };
    const words = [name, code].filter((word): word is string => typeof word === "string" && PRINTABLE_ERROR_WORD.test(word));
    return words.length === 0 ? "a failure with no printable name" : [...new Set(words)].join(" ");
}

const isConditionalCheckFailed = (error: unknown): boolean =>
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === "ConditionalCheckFailedException";

/**
 * How a sort key holds an email, for every kind that holds one — built from the key functions of `commerce-db.ts`, the
 * owner of the key grammar (`<prefix><email>` and `<prefix><email>#<orderId>`), and from the old mail-counter prefix.
 * `cmrc-2a-tool.test.ts` proves the forms against keys those functions build, with `#` inside the address.
 */
export const EMAIL_KEY_FORMS: readonly EmailKeyForm[] = [
    { prefix: customerRef("", "").Key.SK, form: "emailToEnd" },
    { prefix: customerOrderRef("", "", "").Key.SK.slice(0, -1), form: "emailThenLastHash" },
    { prefix: OLD_MAIL_COUNTER_PREFIX, form: "emailToEnd" },
];

/* ------------------------------------------------------------------ reads ------------------------------------- */

function load(raw: RawItem, table: string): Loaded {
    const hashed = canonicalize(raw);
    if (!hashed.ok) {
        const pk = raw.PK?.S;
        const sk = raw.SK?.S;
        const where = pk !== undefined && sk !== undefined ? keyText({ pk, sk }) : "an item whose key cannot be read";
        throw new RunAborted(
            `table ${table}, ${where}: a value at attribute path ${pathText(hashed.error.path)} is not a DynamoDB value this tool defines (${hashed.error.reason}). The tool decides nothing about an item it cannot compare exactly.`,
        );
    }
    return { ...hashed.value, raw };
}

/** Every item of one key condition: a paginated, consistent Query (`PK` + sort-key prefix). */
async function queryAll(db: Database, table: string, condition: KeyCondition, pageSize: number): Promise<Loaded[]> {
    const items: Loaded[] = [];
    let startKey: RawItem | undefined;
    do {
        const answer = await db.send(new QueryCommand({
            TableName: table,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": { S: condition.pk }, ":sk": { S: condition.skPrefix } },
            ConsistentRead: true,
            Limit: pageSize,
            ExclusiveStartKey: startKey,
        }));
        for (const raw of answer.Items ?? []) items.push(load(raw, table));
        startKey = answer.LastEvaluatedKey;
    } while (startKey !== undefined);
    return items;
}

async function loadSelection(db: Database, table: string, selector: Selector, pageSize: number): Promise<Loaded[]> {
    const items: Loaded[] = [];
    for (const condition of keyConditions(selector)) items.push(...await queryAll(db, table, condition, pageSize));
    return items;
}

/** One item by key, with a consistent read; `undefined` when the table holds no such item. */
async function getItem(db: Database, table: string, key: ItemKey): Promise<Loaded | undefined> {
    const answer = await db.send(new GetItemCommand({ TableName: table, Key: { PK: { S: key.pk }, SK: { S: key.sk } }, ConsistentRead: true }));
    return answer.Item === undefined ? undefined : load(answer.Item, table);
}

function readFile(ports: Ports, flag: string, path: string): string {
    try {
        return ports.files.read(path);
    } catch (error) {
        throw new RequestRefused(`cannot read the file of --${flag} (${path}): ${failureText(error)}`);
    }
}

function readManifest(ports: Ports, ref: ManifestRef, tables: Tables, selector: MovedKinds): Manifest {
    const manifest = parseManifest(readFile(ports, "manifest", ref.path), ref.sha256, { tables, selector });
    if (!manifest.ok) throw new RequestRefused(manifestRefusalText(manifest.error));
    ports.out(`Manifest:          ${ref.path} (SHA-256 ${ref.sha256}, written ${manifest.value.createdAt}, ${manifest.value.entries.length} entries)`);
    return manifest.value;
}

/* ------------------------------------------------------------------ plan -------------------------------------- */

function noticeText(notice: Notice): string {
    switch (notice.kind) {
        case "gsiAttributes":
            return `  NOTICE GSI key attribute on an item: ${keyText(notice.key)} attributes: ${notice.attributes.join(", ")}`;
        case "keyNotNormalized":
            return `  NOTICE the email in the key is not in normalizeEmail() form: ${keyText(notice.key)}`;
        case "emailKeyOfUnknownForm":
            return `  NOTICE the key contains '@' but the tool knows no email form for its kind; its form was NOT checked: ${keyText(notice.key)}`;
    }
}

async function plan(request: Extract<Request, { mode: "plan" }>, db: Database, ports: Ports): Promise<Outcome> {
    const sourceItems: Loaded[] = [];
    let notices = 0;
    for (const condition of keyConditions(request.selector)) {
        const source = await queryAll(db, request.tables.source, condition, request.pageSize);
        sourceItems.push(...source);
        switch (request.selector.kind) {
            case "movedKinds": {
                const destination = await queryAll(db, request.tables.destination, condition, request.pageSize);
                const sourceIds = new Set(source.map((item) => keyId(item.key)));
                const destinationIds = new Set(destination.map((item) => keyId(item.key)));
                const onlySource = source.filter((item) => !destinationIds.has(keyId(item.key))).length;
                const onlyDestination = destination.filter((item) => !sourceIds.has(keyId(item.key))).length;
                ports.out(`  PK=${condition.pk} kind ${condition.skPrefix}: source=${source.length} destination=${destination.length} only-in-source=${onlySource} only-in-destination=${onlyDestination}`);
                break;
            }
            case "oldMailCounters":
                ports.out(`  PK=${condition.pk} kind ${condition.skPrefix}: source=${source.length} (the destination is not read: these items are never copied)`);
                break;
        }
        for (const item of source) {
            for (const notice of noticesOf(item, EMAIL_KEY_FORMS, normalizeEmail)) {
                ports.out(noticeText(notice));
                notices += 1;
            }
        }
    }
    if (request.inventoryOut !== undefined) {
        const text = inventoryText(ports.now(), request.tables.source, request.selector, sourceItems);
        ports.files.createNew(request.inventoryOut, text);
        ports.out(`Inventory:         ${request.inventoryOut} (${sourceItems.length} entries, SHA-256 ${sha256Hex(text)})`);
    }
    return { green: true, summary: `plan: ${sourceItems.length} source items, nothing written to a table, ${notices} notices (a notice does not change the exit status)` };
}

/* ------------------------------------------------------------------ migrate ----------------------------------- */

async function migrate(request: Extract<Request, { mode: "migrate" }>, db: Database, ports: Ports): Promise<Outcome> {
    const source = await loadSelection(db, request.tables.source, request.selector, request.pageSize);
    const destination = await loadSelection(db, request.tables.destination, request.selector, request.pageSize);
    const destinationById = new Map(destination.map((item) => [keyId(item.key), item]));
    const sourceIds = new Set(source.map((item) => keyId(item.key)));
    let copied = 0;
    let wouldCopy = 0;
    let equal = 0;
    let refused = 0;
    const report = (key: ItemKey, verdict: CopyVerdict): void => {
        switch (verdict.verdict) {
            case "copy":
                wouldCopy += 1;
                ports.out(`  WOULD COPY ${keyText(key)}`);
                break;
            case "alreadyPresentEqual":
                equal += 1;
                ports.out(`  EQUAL already present and equal, not written: ${keyText(key)}`);
                break;
            case "refusedDestinationDiffers":
                refused += 1;
                ports.out(`  REFUSED destination differs, not overwritten: ${keyText(key)} attributes: ${verdict.paths.join(" ")}`);
                break;
        }
    };
    for (const item of source) {
        const verdict = copyVerdict(item, destinationById.get(keyId(item.key)));
        if (verdict.verdict !== "copy" || !request.execute) {
            report(item.key, verdict);
            continue;
        }
        try {
            await db.send(new PutItemCommand({ TableName: request.tables.destination, Item: item.raw, ConditionExpression: "attribute_not_exists(SK)" }));
            copied += 1;
            ports.out(`  COPIED ${keyText(item.key)}`);
        } catch (error) {
            // Whatever the failed answer was, the state of the destination is taken from a consistent read after it.
            let after: Loaded | undefined;
            try {
                after = await getItem(db, request.tables.destination, item.key);
            } catch (readError) {
                if (readError instanceof RunAborted) throw readError;
                throw new RunAborted(`${keyText(item.key)}: the Put call failed (${failureText(error)}) and the read after it failed too (${failureText(readError)}): whether the item was written is UNKNOWN`);
            }
            if (isConditionalCheckFailed(error) && after !== undefined) {
                // An item of this key appeared in the destination after the first read. It is not overwritten: it is
                // judged like every other present item.
                report(item.key, copyVerdict(item, after));
                continue;
            }
            const state = after === undefined
                ? "the item is NOT in the destination"
                : after.sha256 === item.sha256
                    ? "the item IS in the destination and equal to the source (the write was applied)"
                    : "the destination holds a DIFFERENT item of this key";
            throw new RunAborted(`${keyText(item.key)}: the Put call failed (${failureText(error)}); a consistent read after it shows: ${state}`);
        }
    }
    const onlyDestination = destination.filter((item) => !sourceIds.has(keyId(item.key))).length;
    if (onlyDestination > 0) ports.out(`  Keys in the destination that are not in the source: ${onlyDestination} ('verify --strict' names each one)`);
    const summary = request.execute
        ? `migrate: ${copied} copied, ${equal} already present and equal, ${refused} refused`
        : `migrate (plan only, nothing written): ${wouldCopy} would be copied, ${equal} already present and equal, ${refused} refused`;
    return { green: refused === 0, summary };
}

/* ------------------------------------------------------------------ verify ------------------------------------ */

function contentDifferenceText(difference: ContentDifference): string {
    switch (difference.kind) {
        case "missingInDestination":
            return `  DIFFERENCE missing in destination: ${keyText(difference.key)}`;
        case "missingInSource":
            return `  DIFFERENCE missing in source: ${keyText(difference.key)}`;
        case "attributeDiffers":
            return `  DIFFERENCE attribute differs: ${keyText(difference.key)} attributes: ${difference.paths.join(" ")}`;
    }
}

async function verifyStrict(request: Extract<Request, { mode: "verifyStrict" }>, db: Database, ports: Ports): Promise<Outcome> {
    const source = await loadSelection(db, request.tables.source, request.selector, request.pageSize);
    const destination = await loadSelection(db, request.tables.destination, request.selector, request.pageSize);
    const differences = contentDifferences(source, destination);
    for (const difference of differences) ports.out(contentDifferenceText(difference));
    if (differences.length > 0) {
        return { green: false, summary: `verify --strict: ${differences.length} differences in ${source.length} source and ${destination.length} destination items; no manifest written` };
    }
    const text = manifestText(buildManifest(ports.now(), request.tables, request.selector, source));
    ports.files.createNew(request.manifestOut, text);
    ports.out(`Manifest:          ${request.manifestOut}`);
    ports.out(`Manifest entries:  ${source.length}`);
    ports.out(`Manifest SHA-256:  ${sha256Hex(text)}`);
    return { green: true, summary: `verify --strict: ${source.length} keys equal in both tables (every attribute, every depth), 0 differences; manifest written` };
}

function postCutoverDifferenceText(difference: PostCutoverDifference): string {
    switch (difference.kind) {
        case "manifestKeyMissingInDestination":
            return `  DIFFERENCE (1) manifest key missing in destination: ${keyText(difference.key)}`;
        case "sourceKeyNotInManifest":
            return `  DIFFERENCE (2) source key of a moved kind that is not in the manifest: ${keyText(difference.key)}`;
        case "sourceChangedSinceManifest":
            return `  DIFFERENCE (3) source item does not hash to its manifest value: ${keyText(difference.key)}`;
    }
}

/**
 * Q6 of cmrc-1.md § 6 under operator ruling CMRC2A-Q6-RELEASE-EVIDENCE = B. This mode establishes (1) every manifest
 * key exists in the destination, (2) the source holds no key of a moved kind outside the manifest, (3) every source
 * item still hashes to its manifest value. It LISTS the destination keys that are not in the manifest, under that
 * name. It does not know, and does not say, when such an item was created: the freeze record is the evidence for that.
 * It checks nothing else: (2) and (3) speak of the items the source holds, so a manifest key without a source item is
 * not a difference; the last line gives the two counts (manifest keys, source items) so that the operator can see it.
 */
async function verifyPostCutover(request: Extract<Request, { mode: "verifyPostCutover" }>, db: Database, ports: Ports): Promise<Outcome> {
    const manifest = readManifest(ports, request.manifest, request.tables, request.selector);
    const entries = entriesOfTenants(manifest, request.selector.tenants);
    const source = await loadSelection(db, request.tables.source, request.selector, request.pageSize);
    const destination = await loadSelection(db, request.tables.destination, request.selector, request.pageSize);
    const findings = postCutoverFindings(entries, source, destination);
    for (const difference of findings.differences) ports.out(postCutoverDifferenceText(difference));
    for (const key of findings.destinationKeysNotInManifest) ports.out(`  DESTINATION KEY NOT IN THE MANIFEST: ${keyText(key)}`);
    const outside = findings.destinationKeysNotInManifest.length;
    ports.out(`Destination keys not in the manifest: ${outside}`);
    ports.out("  The tool cannot establish when these items were created. The operator establishes it from the freeze record:");
    ports.out("  the write freeze was on from before the manifest run (P1) until the release deploy, and P2 showed every frozen writer refusing.");
    const unknown = `${outside} destination keys are not in the manifest; the tool cannot establish when they were created (the freeze record must)`;
    if (findings.differences.length > 0) {
        return { green: false, summary: `verify --post-cutover: ${findings.differences.length} differences against ${entries.length} manifest keys (the DIFFERENCE lines name each one and its statement); ${unknown}` };
    }
    return {
        green: true,
        summary: `verify --post-cutover: (1) each of the ${entries.length} manifest keys exists in the destination; (2) the source holds no key of a moved kind outside the manifest; (3) each of the ${source.length} source items of the moved kinds hashes to its manifest value. ${unknown}`,
    };
}

/* ------------------------------------------------------------------ deletion (purge and discard) -------------- */

/**
 * When the export is written (operator ruling on review-0 F05):
 *  - `everyCandidateBeforeFirstDelete` (purge, cmrc-1.md § 6): the export of EVERY candidate is written and flushed
 *    before the first delete. It can hold keys that are then refused. Green only when nothing was refused: then
 *    deleted = exported.
 *  - `eachItemBeforeItsDelete` (discard): the line of an item is written and flushed just before the delete of that
 *    item, and only for an item that will be deleted. Green only when export lines = deleted items.
 */
type ExportRule = "everyCandidateBeforeFirstDelete" | "eachItemBeforeItsDelete";

type DeletionRun = {
    name: "purge" | "discard";
    sourceTable: string;
    deletion: Deletion;
    exportRule: ExportRule;
    /** Every key the run considers, as the candidate Query read it. */
    candidates: Loaded[];
    /** Judges the item as the consistent read just before its delete found it; `undefined` = delete. */
    refusalOf: (current: Loaded) => Promise<string | undefined>;
};

const exportLineOf = (item: Loaded): string => JSON.stringify({ pk: item.key.pk, sk: item.key.sk, sha256: item.sha256, item: item.canonical });

/**
 * The deletion loop of `purge` and `discard`. Per candidate: a consistent read of the source just before the delete,
 * the verdict on THAT reading, then the delete. An item is deleted only if the export holds it in exactly the form
 * that is deleted. The loop stops at the first call that fails; nothing is deleted after a failed export write.
 * Whatever happens after the export file is open, its path, line count and SHA-256 are reported, or why not.
 */
async function runDeletion(run: DeletionRun, db: Database, ports: Ports): Promise<Outcome> {
    const { name, sourceTable, deletion, candidates } = run;
    let exportFile: { appendLine(line: string): void; close(): void } | undefined;
    switch (deletion.kind) {
        case "planOnly":
            exportFile = undefined;
            break;
        case "execute":
            ports.out(`Backup reference:  ${deletion.backupReference}`);
            try {
                exportFile = ports.files.openNewForAppend(deletion.exportPath);
            } catch (error) {
                throw new RunAborted(`the export file could not be created (${deletion.exportPath}: ${failureText(error)}); nothing was deleted`);
            }
            break;
    }
    const exportedHashes = new Map<string, string>();
    let appended = 0;
    const appendToExport = (file: { appendLine(line: string): void }, item: Loaded): void => {
        try {
            file.appendLine(exportLineOf(item));
        } catch (error) {
            throw new RunAborted(`the export line of ${keyText(item.key)} could not be written whole and flushed (${failureText(error)}); no item is deleted after this`);
        }
        appended += 1;
        exportedHashes.set(keyId(item.key), item.sha256);
    };

    let deleted = 0;
    let wouldDelete = 0;
    let vanished = 0;
    let changedAfterExport = 0;
    let stopped: string | undefined;
    const refusals = new Map<string, number>();
    try {
        if (exportFile !== undefined && run.exportRule === "everyCandidateBeforeFirstDelete") {
            for (const candidate of candidates) appendToExport(exportFile, candidate);
            ports.out(`  EXPORTED ${appended} candidates, written and flushed before the first delete`);
        }
        for (const candidate of candidates) {
            const key = candidate.key;
            const current = await getItem(db, sourceTable, key);
            if (current === undefined) {
                vanished += 1;
                ports.out(`  VANISHED no longer in the source at the read before its delete: ${keyText(key)}`);
                continue;
            }
            const refusal = await run.refusalOf(current);
            if (refusal !== undefined) {
                refusals.set(refusal, (refusals.get(refusal) ?? 0) + 1);
                ports.out(`  REFUSED ${refusal}: ${keyText(key)}`);
                continue;
            }
            if (exportFile === undefined) {
                wouldDelete += 1;
                ports.out(`  WOULD DELETE ${keyText(key)}`);
                continue;
            }
            switch (run.exportRule) {
                case "everyCandidateBeforeFirstDelete":
                    break;
                case "eachItemBeforeItsDelete":
                    appendToExport(exportFile, current);
                    break;
            }
            if (exportedHashes.get(keyId(key)) !== current.sha256) {
                changedAfterExport += 1;
                ports.out(`  NOT DELETED the item changed after it was exported (the export does not hold this form of it): ${keyText(key)}`);
                continue;
            }
            try {
                await db.send(new DeleteItemCommand({ TableName: sourceTable, Key: { PK: { S: key.pk }, SK: { S: key.sk } } }));
            } catch (error) {
                // The failed answer says nothing about the table (the delete can have been applied). Read it.
                let after: "absent" | "present" | "unknown";
                try {
                    after = (await getItem(db, sourceTable, key)) === undefined ? "absent" : "present";
                } catch {
                    after = "unknown";
                }
                switch (after) {
                    case "absent":
                        deleted += 1;
                        stopped = `the delete call of ${keyText(key)} failed (${failureText(error)}); a consistent read after it finds the item ABSENT: it was deleted`;
                        break;
                    case "present":
                        stopped = `the delete call of ${keyText(key)} failed (${failureText(error)}); a consistent read after it finds the item STILL IN THE SOURCE: it was not deleted`;
                        break;
                    case "unknown":
                        stopped = `the delete call of ${keyText(key)} failed (${failureText(error)}) and the read after it failed too: whether the item was deleted is UNKNOWN`;
                        break;
                }
                ports.out(`  DELETE CALL FAILED ${stopped}`);
                break;
            }
            deleted += 1;
            ports.out(`  DELETED ${keyText(key)}`);
        }
    } catch (error) {
        stopped = error instanceof RunAborted ? error.message : `a call failed (${failureText(error)})`;
        ports.out(`  STOPPED ${stopped}`);
    }

    const refused = [...refusals.values()].reduce((sum, count) => sum + count, 0);
    const refusedText = refused === 0 ? "0 refused" : `${refused} refused (${[...refusals].map(([reason, count]) => `${reason}: ${count}`).join("; ")})`;
    const vanishedText = vanished === 0 ? "" : `, ${vanished} vanished before the delete`;
    const changedText = changedAfterExport === 0 ? "" : `, ${changedAfterExport} not deleted because they changed after the export`;
    const stoppedText = stopped === undefined ? "" : `; the run STOPPED early: ${stopped}`;
    const clean = refused === 0 && vanished === 0 && changedAfterExport === 0 && stopped === undefined;
    switch (deletion.kind) {
        case "planOnly":
            return { green: clean, summary: `${name} (plan only, nothing deleted): ${wouldDelete} would be deleted, ${refusedText}${vanishedText}${stoppedText}` };
        case "execute": {
            // Finalization of the export: attempted on every path that reaches this line, each step on its own.
            let closed = true;
            try {
                exportFile?.close();
            } catch (error) {
                closed = false;
                ports.out(`Export close:      FAILED (${failureText(error)}); the lines below are what could be read back`);
            }
            ports.out(`Export:            ${deletion.exportPath}`);
            let exportLines: number | undefined;
            try {
                const exportText = ports.files.read(deletion.exportPath);
                exportLines = lineCount(exportText);
                ports.out(`Export lines:      ${exportLines}`);
                ports.out(`Export SHA-256:    ${sha256Hex(exportText)}`);
            } catch (error) {
                ports.out(`Export lines:      NOT AVAILABLE: the export file could not be read back (${failureText(error)}); the tool wrote ${appended} lines`);
                ports.out(`Export SHA-256:    NOT AVAILABLE: the export file could not be read back (${failureText(error)})`);
            }
            const fileText = exportLines === undefined
                ? "; the export file could not be read back"
                : exportLines === appended ? "" : `; the export file holds ${exportLines} lines but the tool wrote ${appended}`;
            const closeText = closed ? "" : "; the export file could not be closed";
            const exportIntact = closed && exportLines === appended;
            switch (run.exportRule) {
                case "everyCandidateBeforeFirstDelete":
                    return {
                        green: clean && exportIntact && appended === candidates.length && deleted === appended,
                        summary: `${name}: exported ${appended} of ${candidates.length} candidates before the first delete, deleted ${deleted} from ${sourceTable}, ${refusedText}${vanishedText}${changedText}${fileText}${closeText}${stoppedText}`,
                    };
                case "eachItemBeforeItsDelete": {
                    const countText = deleted === appended ? "" : `; export lines (${appended}) and deletes (${deleted}) are not equal`;
                    return {
                        green: clean && exportIntact && deleted === appended,
                        summary: `${name}: ${deleted} deleted from ${sourceTable}, ${appended} export lines, ${refusedText}${vanishedText}${changedText}${countText}${fileText}${closeText}${stoppedText}`,
                    };
                }
            }
        }
    }
}

async function purge(request: Extract<Request, { mode: "purge" }>, db: Database, ports: Ports): Promise<Outcome> {
    const manifest = readManifest(ports, request.manifest, request.tables, request.selector);
    const manifestHashes = new Map(entriesOfTenants(manifest, request.selector.tenants).map((entry) => [keyId(entry), entry.sha256]));
    const candidates = await loadSelection(db, request.tables.source, request.selector, request.pageSize);
    const refusalOf = async (current: Loaded): Promise<string | undefined> => {
        // The destination is only READ, and only for presence: released writers change its content legitimately.
        const answer = await db.send(new GetItemCommand({
            TableName: request.tables.destination,
            Key: { PK: { S: current.key.pk }, SK: { S: current.key.sk } },
            ConsistentRead: true,
            ProjectionExpression: "PK",
        }));
        const verdict = purgeVerdict(current.sha256, manifestHashes.get(keyId(current.key)), answer.Item !== undefined);
        switch (verdict.verdict) {
            case "delete":
                return undefined;
            case "refusedNotInManifest":
                return "not in the manifest (created after verification)";
            case "refusedSourceChanged":
                return "source changed after verification";
            case "refusedDestinationAbsent":
                return "destination item absent";
        }
    };
    return runDeletion({ name: "purge", sourceTable: request.tables.source, deletion: request.deletion, exportRule: "everyCandidateBeforeFirstDelete", candidates, refusalOf }, db, ports);
}

function purgePostconditionText(difference: PurgePostconditionDifference): string {
    switch (difference.kind) {
        case "remainsInSource":
            return `  DIFFERENCE remains in the source: ${keyText(difference.key)}`;
        case "absentInSourceAndDestination":
            return `  DIFFERENCE manifest key absent in the source AND in the destination: ${keyText(difference.key)}`;
    }
}

async function purgeVerify(request: Extract<Request, { mode: "purgeVerify" }>, db: Database, ports: Ports): Promise<Outcome> {
    const manifest = readManifest(ports, request.manifest, request.tables, request.selector);
    const entries = entriesOfTenants(manifest, request.selector.tenants);
    const source = await loadSelection(db, request.tables.source, request.selector, request.pageSize);
    const destination = await loadSelection(db, request.tables.destination, request.selector, request.pageSize);
    const differences = purgePostcondition(entries, source.map((item) => item.key), destination.map((item) => item.key));
    for (const difference of differences) ports.out(purgePostconditionText(difference));
    return {
        green: differences.length === 0,
        summary: `purge-verify: ${entries.length} manifest keys, ${source.length} keys remain in the source, ${differences.length} differences`,
    };
}

async function discard(request: Extract<Request, { mode: "discard" }>, db: Database, ports: Ports): Promise<Outcome> {
    const recordText = readFile(ports, "authorization", request.authorizationPath);
    const authorization = parseAuthorization(recordText, { sourceTable: request.tables.source, selector: request.selector });
    if (!authorization.ok) throw new RequestRefused(authorizationRefusalText(authorization.error));
    const authorized = new Map(authorization.value.authorizedKeys.map((entry) => [keyId(entry), entry.sha256]));
    ports.out(`Authorization:     ${request.authorizationPath} (SHA-256 ${sha256Hex(recordText)}, ${authorized.size} authorized keys)`);
    // No command of this mode names the destination table: there is no copy, by design.
    const candidates = await loadSelection(db, request.tables.source, request.selector, request.pageSize);
    const candidateIds = new Set(candidates.map((item) => keyId(item.key)));
    const absent = [...authorized.keys()].filter((id) => !candidateIds.has(id)).length;
    if (absent > 0) ports.out(`  Authorized keys that the source no longer holds: ${absent}`);
    const refusalOf = async (current: Loaded): Promise<string | undefined> => {
        const verdict = discardVerdict(current.sha256, authorized.get(keyId(current.key)));
        switch (verdict.verdict) {
            case "delete":
                return undefined;
            case "refusedNotAuthorized":
                return "not authorized (the key is not in the authorized set)";
            case "refusedChangedSinceAuthorization":
                return "changed since the authorization (the hash differs)";
        }
    };
    return runDeletion({ name: "discard", sourceTable: request.tables.source, deletion: request.deletion, exportRule: "eachItemBeforeItsDelete", candidates, refusalOf }, db, ports);
}

async function discardVerify(request: Extract<Request, { mode: "discardVerify" }>, db: Database, ports: Ports): Promise<Outcome> {
    const exportText = readFile(ports, "export-path", request.exportPath);
    const remaining = await loadSelection(db, request.tables.source, request.selector, request.pageSize);
    for (const item of remaining) ports.out(`  DIFFERENCE remains in the source: ${keyText(item.key)}`);
    ports.out(`Export:            ${request.exportPath}`);
    ports.out(`Export lines:      ${lineCount(exportText)}`);
    ports.out(`Export SHA-256:    ${sha256Hex(exportText)}`);
    return {
        green: remaining.length === 0,
        summary: `discard-verify: ${remaining.length} items of the predicate remain in ${request.tables.source}; write the export's line count and SHA-256 into the authorization record`,
    };
}

/* ------------------------------------------------------------------ the run ----------------------------------- */

function modeText(request: Request): string {
    const planOnly = (deletion: Deletion): string => {
        switch (deletion.kind) {
            case "planOnly":
                return " (plan only: no --execute, nothing is deleted)";
            case "execute":
                return " --execute (DELETES from the source table)";
        }
    };
    switch (request.mode) {
        case "plan":
            return "plan (reads only)";
        case "migrate":
            return request.execute ? "migrate --execute (WRITES to the destination table)" : "migrate (plan only: no --execute, nothing is written)";
        case "verifyStrict":
            return "verify --strict (reads only)";
        case "verifyPostCutover":
            return "verify --post-cutover (reads only)";
        case "purge":
            return `purge${planOnly(request.deletion)}`;
        case "purgeVerify":
            return "purge-verify (reads only)";
        case "discard":
            return `discard${planOnly(request.deletion)}`;
        case "discardVerify":
            return "discard-verify (reads only)";
    }
}

function dispatch(request: Request, db: Database, ports: Ports): Promise<Outcome> {
    switch (request.mode) {
        case "plan":
            return plan(request, db, ports);
        case "migrate":
            return migrate(request, db, ports);
        case "verifyStrict":
            return verifyStrict(request, db, ports);
        case "verifyPostCutover":
            return verifyPostCutover(request, db, ports);
        case "purge":
            return purge(request, db, ports);
        case "purgeVerify":
            return purgeVerify(request, db, ports);
        case "discard":
            return discard(request, db, ports);
        case "discardVerify":
            return discardVerify(request, db, ports);
    }
}

/** One accepted request, run to its end. Exit status 0 only when the last line says GREEN. Never throws. */
export async function run(request: Request, ports: Ports): Promise<0 | 1> {
    ports.out(`AMODX commerce-private table tool — mode ${modeText(request)}`);
    ports.out(`Time:              ${ports.now()}`);
    ports.out(`Region:            ${request.region}`);
    ports.out(`Source table:      ${request.tables.source}`);
    ports.out(`Destination table: ${request.tables.destination}`);
    ports.out(`Selection:         ${selectorText(request.selector)}`);
    try {
        // Every file the run would create is checked before the first read of a table: its REAL directory is outside
        // the repository, and nothing is at its path yet.
        for (const output of outputFilesOf(request)) {
            const refusal = ports.files.outputRefusal(output.path);
            if (refusal !== undefined) throw new RequestRefused(`the file of --${output.flag} (${output.path}) cannot be created: ${refusal}`);
        }
        const outcome = await dispatch(request, ports.connect(request.region), ports);
        ports.out(outcome.green ? `RESULT: GREEN — ${outcome.summary}` : `RESULT: NOT GREEN — ${outcome.summary}; exit status 1`);
        return outcome.green ? 0 : 1;
    } catch (error) {
        if (error instanceof RequestRefused) {
            ports.out(`REFUSED REQUEST: ${error.message}`);
            ports.out("RESULT: NOT GREEN — the request was refused; no table was read, nothing was written or deleted; exit status 1");
            return 1;
        }
        ports.out(`ABORTED: ${error instanceof RunAborted ? error.message : `a call failed (${failureText(error)})`}`);
        ports.out("RESULT: NOT GREEN — the run stopped before its end; the lines above say what was done until then; exit status 1");
        return 1;
    }
}

export function helpText(): string[] {
    const emailKeyExample = customerRef("<tenant>", "<email>").Key.SK;
    return [
        "AMODX commerce-private table tool (docs/slices/cmrc-2a.md, with the operator runbook)",
        "",
        "Usage: npm run migrate-commerce-private-table -- --mode <mode> --source-table <main table> --destination-table <commerce table> <flags>",
        "",
        `Modes: ${MODE_NAMES.join(", ")}`,
        "  plan            counts per tenant and kind, notices (GSI attributes, keys not in normalized form). Reads only.",
        "                  [--inventory-out <file>] writes the key set of the source with one SHA-256 per item.",
        "  migrate         copies source items into the destination with conditional Puts; never overwrites.",
        "                  Without --execute it prints the plan and writes nothing.",
        "  verify          --strict --manifest-out <file>: every attribute of every item equal in both tables; writes the",
        "                  verification manifest only when nothing differs.",
        "                  --post-cutover --manifest <file> --manifest-sha256 <hex>: establishes (1) every manifest key",
        "                  exists in the destination, (2) the source holds no key of a moved kind outside the manifest,",
        "                  (3) every source item still hashes to its manifest value. It LISTS the destination keys that",
        "                  are not in the manifest. It cannot establish when those were created: the operator does,",
        "                  from the freeze record.",
        "  purge-plan      --manifest <file> --manifest-sha256 <hex>: what purge would delete from the SOURCE. Reads only.",
        "  purge           as purge-plan; deletes only with --execute --backup-ref <text> --export-path <file>. It writes",
        "                  the export of EVERY candidate before the first delete; green only when no key was refused.",
        "  purge-verify    --manifest <file> --manifest-sha256 <hex>: the postcondition of a purge. Reads only.",
        "  discard-plan    --authorization <file>: what discard would delete from the SOURCE. Reads only.",
        "  discard         as discard-plan; deletes only with --execute --backup-ref <text> --export-path <file>. It writes",
        "                  the export line of an item just before the delete of that item.",
        "  discard-verify  --export-path <file>: no item of the predicate remains; prints the export's line count and SHA-256.",
        "",
        "Selection:",
        `  --tenants <a,b>                 the tenant allowlist, REQUIRED for every mode and selector that addresses tenant`,
        `                                  partitions; the kinds are ${COMMERCE_PRIVATE_PREFIXES.join(", ")}`,
        "                                  (the list of backend/src/lib/commerce-db.ts; the tool has no list of its own).",
        `  --selector ${SELECTOR_NAMES.oldMailCounters}    plan and discard modes only: PK = ${OLD_MAIL_COUNTER_PARTITION}, sort key begins with ${OLD_MAIL_COUNTER_PREFIX}.`,
        "                                  THE ONE EXCEPTION to the tenant allowlist: these items belong to no tenant, so",
        "                                  this selector takes NO --tenants and refuses one (an unused list would suggest a",
        "                                  protection that does not exist). Its protections: the fixed predicate; the",
        `                                  authorization record that names the partition ${OLD_MAIL_COUNTER_PARTITION} and the predicate; the`,
        "                                  authorized key set with hashes; the backup reference; the export.",
        "  No other selection exists. A whole partition cannot be selected.",
        "",
        "Other flags: --region <region> (default: AWS_REGION, else eu-central-1), --page-size <n> (default 50).",
        "",
        "Rules:",
        "  - Both table names are required and must differ. purge and discard delete from the SOURCE table only.",
        "  - Query (PK + sort-key prefix), GetItem, conditional PutItem and DeleteItem only. No Scan.",
        "  - A file the tool writes must be outside the repository (its real directory, links resolved) and must not exist yet.",
        "  - The last line is 'RESULT: GREEN' (exit status 0) or 'RESULT: NOT GREEN' (exit status 1).",
        "  - Of a failed AWS or file call the report prints the error's name only, and the state of a table only as a read showed it.",
        "",
        "PERSONAL DATA: the report names keys, never attribute values. But a key can contain an email address",
        `(for example ${emailKeyExample}, and every ${OLD_MAIL_COUNTER_PREFIX}<email> key), so the report, the inventory and`,
        "the manifest hold email addresses, and an export holds whole items. Keep these files outside the repository.",
    ];
}

/** The tool, from its argument list to its exit status. The kinds are always `COMMERCE_PRIVATE_PREFIXES`. Never throws. */
export async function runFromArgv(argv: string[], environment: Environment, ports: Ports): Promise<0 | 1> {
    try {
        if (argv.length === 0 || argv.includes("--help")) {
            for (const line of helpText()) ports.out(line);
            return 0;
        }
        const request = parseRequest(argv, { ...environment, privatePrefixes: COMMERCE_PRIVATE_PREFIXES });
        if (!request.ok) {
            for (const reason of request.error) ports.out(`REFUSED REQUEST: ${reason}`);
            ports.out("RESULT: NOT GREEN — the request was refused; no table was read, nothing was written or deleted; exit status 1");
            return 1;
        }
        return await run(request.value, ports);
    } catch (error) {
        ports.out(`ABORTED: a call failed (${failureText(error)})`);
        ports.out("RESULT: NOT GREEN — the run stopped before its end; the lines above say what was done until then; exit status 1");
        return 1;
    }
}
