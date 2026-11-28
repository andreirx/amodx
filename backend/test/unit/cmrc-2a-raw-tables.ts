import { DeleteItemCommand, GetItemCommand, PutItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { assertNoBareReservedWord } from "./dynamo-expression-guard.js";
import { runFromArgv, type Database, type Ports, type ToolCommand } from "../../../scripts/commerce-private-table/run.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md) — NAMED in-memory DynamoDB tables for the tests of the commerce-private table tool,
 * after the pattern of `memory-table.ts`. Differences, each needed by a proof of the slice:
 *  - several tables, chosen by `TableName` (the tool copies between two; "no write ever reaches the destination");
 *  - items in WIRE form (`{ S }`, `{ N }`, `{ SS }`, `{ B }` …), stored by `structuredClone`, so a number text, a set
 *    and a binary value come back exactly as they went in;
 *  - it accepts exactly the four command forms of `scripts/commerce-private-table/run.ts` and throws on every other
 *    command, expression or missing `ConsistentRead` — a Scan, a BatchWrite or a Put without its condition fails the
 *    test that sends it. A bare reserved word in an expression is refused as DynamoDB does (PROJECTION-RESERVED-1).
 */

export type RawItem = Record<string, AttributeValue>;
export type Sent = { name: "Query" | "GetItem" | "PutItem" | "DeleteItem"; table: string; pk: string; sk: string };

const KEY_CONDITION = "PK = :pk AND begins_with(SK, :sk)";
const text = (value: AttributeValue | undefined, what: string): string => {
    if (value?.S === undefined) throw new Error(`${what} is not a string value`);
    return value.S;
};

export class RawTables implements Database {
    private tables = new Map<string, Map<string, RawItem>>();
    /** Every command received, in order (also a command that then failed). */
    sent: Sent[] = [];
    /** Items per Query page, besides the command's own `Limit`. */
    pageSize = Infinity;
    /** A PutItem or DeleteItem on one of these tables throws. */
    readOnly = new Set<string>();
    /** ANY command on one of these tables throws. */
    untouchable = new Set<string>();
    /** Runs before a command is applied: may change the tables (another writer) or throw (a call that fails and does nothing). */
    before: (sent: Sent) => void = () => {};
    /** Runs after a PutItem or DeleteItem was APPLIED: a throw here is a call whose effect happened and whose answer was lost. */
    afterWrite: (sent: Sent) => void = () => {};

    /** `log` receives one line per applied write or delete (`PutItem <table> <sk>`), shared with `MemoryFiles`. */
    constructor(names: string[], private log: string[] = []) {
        for (const name of names) this.tables.set(name, new Map());
    }

    private table(name: string | undefined): Map<string, RawItem> {
        const table = this.tables.get(name ?? "");
        if (!table) throw Object.assign(new Error(`table ${name} does not exist`), { name: "ResourceNotFoundException" });
        return table;
    }
    private id = (pk: string, sk: string) => `${pk}\u0000${sk}`;

    put(table: string, item: RawItem): void {
        this.table(table).set(this.id(text(item.PK, "PK"), text(item.SK, "SK")), structuredClone(item));
    }
    get(table: string, pk: string, sk: string): RawItem | undefined {
        return this.table(table).get(this.id(pk, sk));
    }
    remove(table: string, pk: string, sk: string): void {
        this.table(table).delete(this.id(pk, sk));
    }
    /** The sort keys of one partition, sorted. */
    sortKeys(table: string, pk: string): string[] {
        return [...this.table(table).values()].filter((item) => item.PK?.S === pk).map((item) => text(item.SK, "SK")).sort();
    }
    count(table: string): number {
        return this.table(table).size;
    }

    private record(name: Sent["name"], table: string | undefined, pk: string, sk: string): Sent {
        // (returns the record so that a write can pass it to `afterWrite`)
        const sent: Sent = { name, table: table ?? "", pk, sk };
        this.sent.push(sent);
        if (this.untouchable.has(sent.table)) throw new Error(`a command (${name}) reached the table ${sent.table}, which no command may touch`);
        if (this.readOnly.has(sent.table) && (name === "PutItem" || name === "DeleteItem")) {
            throw new Error(`a write (${name}) reached the table ${sent.table}, which may only be read`);
        }
        this.before(sent);
        return sent;
    }

    async send(command: ToolCommand): Promise<{ Items?: RawItem[]; LastEvaluatedKey?: RawItem; Item?: RawItem }> {
        assertNoBareReservedWord(command.input);
        if (command instanceof QueryCommand) {
            const input = command.input;
            if (input.KeyConditionExpression !== KEY_CONDITION) throw new Error(`unsupported key condition ${input.KeyConditionExpression}`);
            if (input.ConsistentRead !== true) throw new Error("Query without ConsistentRead");
            if (input.FilterExpression !== undefined || input.IndexName !== undefined) throw new Error("Query with a filter or an index");
            const pk = text(input.ExpressionAttributeValues?.[":pk"], ":pk");
            const prefix = text(input.ExpressionAttributeValues?.[":sk"], ":sk");
            if (prefix === "") throw new Error("Query with an empty sort-key prefix (a whole partition)");
            this.record("Query", input.TableName, pk, prefix);
            const matches = [...this.table(input.TableName).values()]
                .filter((item) => item.PK?.S === pk && text(item.SK, "SK").startsWith(prefix))
                .sort((a, b) => (text(a.SK, "SK") < text(b.SK, "SK") ? -1 : 1));
            const startSk = input.ExclusiveStartKey?.SK?.S;
            const start = startSk === undefined ? 0 : matches.findIndex((item) => item.SK?.S === startSk) + 1;
            const size = Math.min(input.Limit ?? Infinity, this.pageSize);
            const page = matches.slice(start, start + size);
            const last = page[page.length - 1];
            return {
                Items: page.map((item) => structuredClone(item)),
                LastEvaluatedKey: start + size < matches.length && last ? { PK: last.PK, SK: last.SK } : undefined,
            };
        }
        if (command instanceof GetItemCommand) {
            const input = command.input;
            if (input.ConsistentRead !== true) throw new Error("GetItem without ConsistentRead");
            const pk = text(input.Key?.PK, "Key.PK");
            const sk = text(input.Key?.SK, "Key.SK");
            this.record("GetItem", input.TableName, pk, sk);
            const item = this.table(input.TableName).get(this.id(pk, sk));
            if (item === undefined) return {};
            if (input.ProjectionExpression === undefined) return { Item: structuredClone(item) };
            if (input.ProjectionExpression !== "PK") throw new Error(`unsupported projection ${input.ProjectionExpression}`);
            return { Item: { PK: item.PK } };
        }
        if (command instanceof PutItemCommand) {
            const input = command.input;
            if (input.ConditionExpression !== "attribute_not_exists(SK)") throw new Error(`PutItem without the condition attribute_not_exists(SK): ${input.ConditionExpression}`);
            const pk = text(input.Item?.PK, "Item.PK");
            const sk = text(input.Item?.SK, "Item.SK");
            const sent = this.record("PutItem", input.TableName, pk, sk);
            const table = this.table(input.TableName);
            if (table.has(this.id(pk, sk))) throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
            table.set(this.id(pk, sk), structuredClone(input.Item as RawItem));
            this.log.push(`PutItem ${input.TableName} ${sk}`);
            this.afterWrite(sent);
            return {};
        }
        if (command instanceof DeleteItemCommand) {
            const input = command.input;
            if (input.ConditionExpression !== undefined) throw new Error(`unsupported condition ${input.ConditionExpression}`);
            const pk = text(input.Key?.PK, "Key.PK");
            const sk = text(input.Key?.SK, "Key.SK");
            const sent = this.record("DeleteItem", input.TableName, pk, sk);
            this.table(input.TableName).delete(this.id(pk, sk));
            this.log.push(`DeleteItem ${input.TableName} ${sk}`);
            this.afterWrite(sent);
            return {};
        }
        throw new Error(`unexpected command ${(command as { constructor: { name: string } }).constructor.name}`);
    }
}

/**
 * In-memory files for the tool's `Ports.files`. An export line is logged as `export <sk>` when it is appended.
 * Failure knobs (each throws an error whose MESSAGE holds a synthetic attribute value, which no report may print):
 * `failAppend` (per line; a throw = the line is NOT in the file), `failClose`, `failRead` (paths that cannot be read).
 */
export class MemoryFiles {
    files = new Map<string, string>();
    failAppend: (line: string, appendedBefore: number) => boolean = () => false;
    failClose = false;
    failRead = new Set<string>();
    constructor(private log: string[] = []) {}
    /** For the tests' own assertions; not part of the tool's file port. */
    exists = (path: string): boolean => this.files.has(path);
    private failure = (name: string) => Object.assign(new Error("VALUE-synthetic-private-note in an error message"), { name });
    /** The in-memory rule: only "a file is there". The real rules (real directory, repository) are tested on `files.ts`. */
    outputRefusal = (path: string): string | undefined =>
        this.files.has(path) ? "the file exists already: the tool never overwrites a file; give a new path" : undefined;
    read = (path: string): string => {
        const content = this.files.get(path);
        if (content === undefined || this.failRead.has(path)) throw Object.assign(this.failure("Error"), { code: "ENOENT" });
        return content;
    };
    createNew = (path: string, content: string): void => {
        if (this.files.has(path)) throw this.failure("OutputRefused");
        this.files.set(path, content);
    };
    openNewForAppend = (path: string): { appendLine(line: string): void; close(): void } => {
        this.createNew(path, "");
        let appended = 0;
        return {
            appendLine: (line) => {
                if (this.failAppend(line, appended)) throw this.failure("IncompleteWrite");
                appended += 1;
                this.files.set(path, `${this.files.get(path)}${line}\n`);
                this.log.push(`export ${JSON.parse(line).sk}`);
            },
            close: () => {
                if (this.failClose) throw Object.assign(this.failure("Error"), { code: "EIO" });
            },
        };
    };
}

export const SOURCE = "main-table";
export const DESTINATION = "commerce-table";
export const TABLE_ARGS = ["--source-table", SOURCE, "--destination-table", DESTINATION];
export const RUN_TIME = "2026-11-28T10:00:00.000Z";

/**
 * One tool under test: two empty tables, in-memory files, and `run(args)` = the tool's `runFromArgv` on them.
 * `realFiles` replaces the in-memory files (the tests of `files.ts` pass the real file port and real directories).
 */
export function harness(realFiles?: { files: Ports["files"]; repositoryRoot: string }) {
    const log: string[] = [];
    const tables = new RawTables([SOURCE, DESTINATION], log);
    const files = new MemoryFiles(log);
    const lines: string[] = [];
    const run = (args: string[]): Promise<0 | 1> =>
        runFromArgv(args, { defaultRegion: "eu-test-1", cwd: "/work", repositoryRoot: realFiles?.repositoryRoot ?? "/repo" }, {
            connect: () => tables,
            now: () => RUN_TIME,
            files: realFiles?.files ?? files,
            out: (line) => lines.push(line),
        });
    /** The report lines since the last call. */
    const report = (): string[] => lines.splice(0, lines.length);
    return { log, tables, files, run, report };
}
