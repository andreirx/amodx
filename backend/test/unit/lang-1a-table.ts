import { isDeepStrictEqual } from "node:util";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * LANG-1A — an IN-MEMORY table for the translation-set writer tests (users: lang-1a-content.test.ts,
 * lang-1a-import.test.ts). Why not `memory-table.ts`: it has no TransactWriteCommand, and the concurrency rows
 * (L1A-SET-CONCURRENT, L1A-RESTORE-VS-RENAME, L1A-SET-TARGET-CHANGED) need two requests interleaved against ONE evaluated
 * state, which scripted mock replies cannot show.
 *
 * It implements what these writers send, and refuses anything else:
 *  - Get (with `ProjectionExpression` of plain names or `#names`), Put, Delete, Update, and TransactWrite of
 *    Put / Update / Delete / ConditionCheck — the transaction is ATOMIC (every condition first, then every write) and
 *    refuses two actions on one item (DynamoDB's ValidationException);
 *  - conditions: clauses joined by ` AND `, each `attribute_not_exists(x)`, `attribute_exists(x)` or `x = :v`
 *    (`x` a name or a `#name`), deep equality as DynamoDB compares values;
 *  - update expressions `SET a = :x, #b = :y[, …] [REMOVE c[, d]]`;
 *  - Query `PK = :pk AND begins_with(SK, :sk)` in SK order, with `pageSize`, `Limit` and `LastEvaluatedKey`; and
 *    `PK = :pk AND SK = :sk` (the WordPress importer's route lookup).
 * A failed condition throws `ConditionalCheckFailedException` (single command) or `TransactionCanceledException` with
 * `CancellationReasons` (one per action). `beforeCommand` runs ONCE before the next command it matches (then clears
 * itself), to interleave a second request or a direct table edit between a writer's read and its write.
 */

export type Item = Record<string, any>;

export class LangTable {
    items = new Map<string, Item>();
    commands: any[] = [];
    pageSize = Infinity;
    beforeCommand: { match: (cmd: any) => boolean; run: () => Promise<void> } | null = null;

    private k = (pk: string, sk: string) => `${pk}\u0000${sk}`;
    put(item: Item) { this.items.set(this.k(item.PK, item.SK), structuredClone(item)); }
    get(pk: string, sk: string): Item | undefined { const i = this.items.get(this.k(pk, sk)); return i && structuredClone(i); }
    keysWithPrefix(pk: string, prefix: string): string[] {
        return [...this.items.values()].filter((i) => i.PK === pk && String(i.SK).startsWith(prefix)).map((i) => i.SK).sort();
    }

    private name(raw: string, names?: Record<string, string>) {
        return raw.startsWith("#") ? names![raw] : raw;
    }

    private holds(item: Item | undefined, expr: string | undefined, names?: Record<string, string>, values?: Record<string, unknown>): boolean {
        if (!expr) return true;
        return expr.split(" AND ").every((clause) => {
            const c = clause.trim();
            let m = /^attribute_not_exists\(([#\w]+)\)$/.exec(c);
            if (m) return item === undefined || item[this.name(m[1], names)] === undefined;
            m = /^attribute_exists\(([#\w]+)\)$/.exec(c);
            if (m) return item !== undefined && item[this.name(m[1], names)] !== undefined;
            m = /^([#\w]+) = (:\w+)$/.exec(c);
            if (m) {
                if (!values || !(m[2] in values)) throw new Error(`no value for ${m[2]}`);
                return item !== undefined && item[this.name(m[1], names)] !== undefined && isDeepStrictEqual(item[this.name(m[1], names)], values[m[2]]);
            }
            throw new Error(`unsupported condition clause "${c}"`);
        });
    }

    private applyUpdate(existing: Item | undefined, key: { PK: string; SK: string }, input: any): Item {
        const out: Item = existing ? structuredClone(existing) : { ...key };
        const [setPart, removePart] = String(input.UpdateExpression).split(" REMOVE ");
        if (!setPart.startsWith("SET ")) throw new Error(`unsupported update ${input.UpdateExpression}`);
        for (const assign of setPart.slice(4).split(", ")) {
            const m = /^([#\w]+) = (:\w+)$/.exec(assign.trim());
            if (!m) throw new Error(`unsupported assignment "${assign}"`);
            if (!(m[2] in input.ExpressionAttributeValues)) throw new Error(`no value for ${m[2]}`);
            out[this.name(m[1], input.ExpressionAttributeNames)] = structuredClone(input.ExpressionAttributeValues[m[2]]);
        }
        for (const attr of removePart ? removePart.split(",").map((s: string) => s.trim()) : []) delete out[this.name(attr, input.ExpressionAttributeNames)];
        return out;
    }

    private project(item: Item, expr?: string, names?: Record<string, string>): Item {
        if (!expr) return structuredClone(item);
        const out: Item = {};
        for (const raw of expr.split(",").map((s) => s.trim())) {
            const n = this.name(raw, names);
            if (item[n] !== undefined) out[n] = structuredClone(item[n]);
        }
        return out;
    }

    async send(cmd: any): Promise<any> {
        if (this.beforeCommand?.match(cmd)) {
            const hook = this.beforeCommand;
            this.beforeCommand = null;
            await hook.run();
        }
        this.commands.push(cmd);
        const input = cmd.input;
        if (cmd instanceof GetCommand) {
            const item = this.get(input.Key.PK, input.Key.SK);
            return { Item: item ? this.project(item, input.ProjectionExpression, input.ExpressionAttributeNames) : undefined };
        }
        if (cmd instanceof QueryCommand) {
            const pk = input.ExpressionAttributeValues[":pk"], sk = input.ExpressionAttributeValues[":sk"];
            let keys: string[];
            if (!input.IndexName && input.KeyConditionExpression === "PK = :pk AND begins_with(SK, :sk)") keys = this.keysWithPrefix(pk, sk);
            else if (!input.IndexName && input.KeyConditionExpression === "PK = :pk AND SK = :sk") keys = this.get(pk, sk) ? [sk] : [];
            else throw new Error(`unsupported query ${input.KeyConditionExpression}`);
            if (input.ExclusiveStartKey) keys = keys.filter((k) => k > input.ExclusiveStartKey.SK);
            const page = keys.slice(0, Math.min(this.pageSize, input.Limit ?? Infinity));
            const more = keys.length > page.length;
            return {
                Items: page.map((sk) => this.project(this.get(input.ExpressionAttributeValues[":pk"], sk)!, input.ProjectionExpression, input.ExpressionAttributeNames)),
                LastEvaluatedKey: more ? { PK: input.ExpressionAttributeValues[":pk"], SK: page[page.length - 1] } : undefined,
            };
        }
        if (cmd instanceof PutCommand || cmd instanceof DeleteCommand || cmd instanceof UpdateCommand) {
            const kind = cmd instanceof PutCommand ? "Put" : cmd instanceof DeleteCommand ? "Delete" : "Update";
            const reasons = this.check([{ [kind]: input }]);
            if (reasons[0].Code !== "None") throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
            this.apply([{ [kind]: input }]);
            return {};
        }
        if (cmd instanceof TransactWriteCommand) {
            const actions = input.TransactItems as any[];
            const seen = new Set<string>();
            for (const a of actions) {
                const body = a.Put ?? a.Update ?? a.Delete ?? a.ConditionCheck;
                const key = a.Put ? { PK: body.Item.PK, SK: body.Item.SK } : body.Key;
                const id = this.k(key.PK, key.SK);
                if (seen.has(id)) throw Object.assign(new Error("Transaction request cannot include multiple operations on one item"), { name: "ValidationException" });
                seen.add(id);
            }
            const reasons = this.check(actions);
            if (reasons.some((r) => r.Code !== "None")) {
                throw Object.assign(new Error("Transaction cancelled"), { name: "TransactionCanceledException", CancellationReasons: reasons });
            }
            this.apply(actions);
            return {};
        }
        throw new Error(`unsupported command ${cmd.constructor.name}`);
    }

    private check(actions: any[]): { Code: string }[] {
        return actions.map((a) => {
            const [kind] = Object.keys(a);
            const body = a[kind];
            const key = kind === "Put" ? { PK: body.Item.PK, SK: body.Item.SK } : body.Key;
            const ok = this.holds(this.get(key.PK, key.SK), body.ConditionExpression, body.ExpressionAttributeNames, body.ExpressionAttributeValues);
            return { Code: ok ? "None" : "ConditionalCheckFailed" };
        });
    }

    private apply(actions: any[]) {
        for (const a of actions) {
            if (a.Put) this.put(JSON.parse(JSON.stringify(a.Put.Item)));   // the document client drops undefined values
            else if (a.Delete) this.items.delete(this.k(a.Delete.Key.PK, a.Delete.Key.SK));
            else if (a.Update) this.items.set(this.k(a.Update.Key.PK, a.Update.Key.SK), this.applyUpdate(this.get(a.Update.Key.PK, a.Update.Key.SK), a.Update.Key, a.Update));
        }
    }
}
