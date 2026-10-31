import { expect } from "vitest";
import {
    BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

/**
 * An IN-MEMORY DynamoDB table for handler tests (users: glam-import-handler.test.ts, glam-images-handler.test.ts). It
 * implements exactly the behaviour those handlers use: Get / Put / Delete with the condition forms they send
 * (`attribute_not_exists(SK)`, `expiresAt = :observed`, `#revision = :observed` — the import-profile write of
 * CAT-IMPORT-PROFILE-1 —, `#owner = :me`), Update with `attribute_exists(PK)` — alone, or with
 * `AND #status = :read` / `AND attribute_not_exists(#status)` (the image copy's write rule, CAT-IMAGE-GATE-1) — and a
 * `SET … [REMOVE …]` expression (`ReturnValues: ALL_NEW`), Query on the base table (begins_with, page size,
 * `LastEvaluatedKey`) and on `GSI_Slug`, BatchWrite / BatchGet with injectable `Unprocessed*`, projections, and
 * removal of undefined attributes (the document client's `removeUndefinedValues`). Any other condition throws.
 */

export type Item = Record<string, any>;

class ConditionalCheckFailed extends Error {
    name = "ConditionalCheckFailedException";
}

/** The in-memory table. Knobs: `pageSize` (items per Query page) and two `Unprocessed*` injectors. */
export class MemoryTable {
    items = new Map<string, Item>();
    commands: any[] = [];
    /** Every item payload a command actually wrote (Put, and BatchWrite PutRequests not reported unprocessed), in order. */
    writes: Item[] = [];
    pageSize = Infinity;
    /** Called per BatchWrite request list; returns the requests to report back as unprocessed. */
    unprocessedWrites: (requests: any[]) => any[] = () => [];
    /** Called per BatchGet key list; returns the keys to report back as unprocessed. */
    unprocessedKeys: (keys: any[]) => any[] = () => [];
    /** Throw this error on the first command matching the predicate. */
    failOn: ((cmd: any) => boolean) | null = null;

    private k = (pk: string, sk: string) => `${pk}\u0000${sk}`;
    put(item: Item) { this.items.set(this.k(item.PK, item.SK), JSON.parse(JSON.stringify(item))); }
    get(pk: string, sk: string) { return this.items.get(this.k(pk, sk)); }
    all(prefix: string) { return [...this.items.values()].filter((i) => String(i.SK).startsWith(prefix)); }

    private project(item: Item, expr?: string, names?: Record<string, string>): Item {
        if (!expr) return structuredClone(item);
        const out: Item = {};
        for (const raw of expr.split(",").map((s) => s.trim())) {
            const name = raw.startsWith("#") ? names![raw] : raw;
            if (item[name] !== undefined) out[name] = structuredClone(item[name]);
        }
        return out;
    }

    async send(cmd: any): Promise<any> {
        this.commands.push(cmd);
        if (this.failOn?.(cmd)) { this.failOn = null; throw new Error("injected failure"); }
        const input = cmd.input;
        if (cmd instanceof GetCommand) {
            const item = this.get(input.Key.PK, input.Key.SK);
            return { Item: item ? this.project(item, input.ProjectionExpression, input.ExpressionAttributeNames) : undefined };
        }
        if (cmd instanceof PutCommand) {
            const existing = this.get(input.Item.PK, input.Item.SK);
            if (input.ConditionExpression === "attribute_not_exists(SK)" && existing) throw new ConditionalCheckFailed();
            if (input.ConditionExpression === "expiresAt = :observed" && existing?.expiresAt !== input.ExpressionAttributeValues[":observed"]) {
                throw new ConditionalCheckFailed();
            }
            if (input.ConditionExpression === "#revision = :observed" && existing?.revision !== input.ExpressionAttributeValues[":observed"]) {
                throw new ConditionalCheckFailed();
            }
            if (input.ConditionExpression && !["attribute_not_exists(SK)", "expiresAt = :observed", "#revision = :observed"].includes(input.ConditionExpression)) {
                throw new Error(`unsupported condition ${input.ConditionExpression}`);
            }
            this.put(input.Item);
            this.writes.push(JSON.parse(JSON.stringify(input.Item)));
            return {};
        }
        if (cmd instanceof DeleteCommand) {
            const existing = this.get(input.Key.PK, input.Key.SK);
            if (input.ConditionExpression === "#owner = :me" && existing?.owner !== input.ExpressionAttributeValues[":me"]) {
                throw new ConditionalCheckFailed();
            }
            this.items.delete(this.k(input.Key.PK, input.Key.SK));
            return {};
        }
        if (cmd instanceof UpdateCommand) {
            const existing = this.get(input.Key.PK, input.Key.SK);
            const productUpdate = [
                "attribute_exists(PK)", "attribute_exists(PK) AND #status = :read", "attribute_exists(PK) AND attribute_not_exists(#status)",
            ].includes(input.ConditionExpression);
            if (productUpdate) {
                if (!existing) throw new ConditionalCheckFailed();
                const statusName = input.ExpressionAttributeNames?.["#status"];
                if (input.ConditionExpression.endsWith("#status = :read") && existing[statusName] !== input.ExpressionAttributeValues[":read"]) {
                    throw new ConditionalCheckFailed();
                }
                if (input.ConditionExpression.endsWith("attribute_not_exists(#status)") && statusName in existing) throw new ConditionalCheckFailed();
                // The product image update (CAT-IMAGES-1): `SET #a = :x, …` and an optional `REMOVE #b`, applied.
                const names = input.ExpressionAttributeNames ?? {};
                const [setPart, removePart] = String(input.UpdateExpression).replace(/^SET /, "").split(" REMOVE ");
                const next = structuredClone(existing);
                for (const assignment of setPart.split(", ")) {
                    const [name, value] = assignment.split(" = ");
                    next[names[name] ?? name] = structuredClone(input.ExpressionAttributeValues[value]);
                }
                for (const name of removePart ? removePart.split(", ") : []) delete next[names[name] ?? name];
                this.put(next);
                this.writes.push(JSON.parse(JSON.stringify(next)));
                return { Attributes: input.ReturnValues === "ALL_NEW" ? structuredClone(this.get(input.Key.PK, input.Key.SK)) : undefined };
            }
            if (input.ConditionExpression) throw new Error(`unsupported condition ${input.ConditionExpression}`);
            // The CDN markers of `withInvalidation` (not asserted beyond their presence).
            this.put({ ...(existing ?? input.Key), updatedAt: Date.now() });
            return {};
        }
        if (cmd instanceof QueryCommand) {
            const v = input.ExpressionAttributeValues;
            let matches: Item[];
            if (input.IndexName === "GSI_Slug") {
                matches = [...this.items.values()].filter((i) => i.TenantSlug === v[":ts"]);
            } else {
                matches = [...this.items.values()]
                    .filter((i) => i.PK === v[":pk"] && String(i.SK).startsWith(v[":sk"]))
                    .sort((a, b) => (a.SK < b.SK ? -1 : 1));
            }
            const start = input.ExclusiveStartKey ? matches.findIndex((i) => i.SK === input.ExclusiveStartKey.SK) + 1 : 0;
            const page = matches.slice(start, start + this.pageSize);
            const more = start + this.pageSize < matches.length;
            return {
                Items: page.map((i) => this.project(i, input.ProjectionExpression, input.ExpressionAttributeNames)),
                LastEvaluatedKey: more ? { PK: page[page.length - 1].PK, SK: page[page.length - 1].SK } : undefined,
            };
        }
        if (cmd instanceof BatchWriteCommand) {
            const [table, requests] = Object.entries(input.RequestItems as Record<string, any[]>)[0];
            expect(requests.length).toBeLessThanOrEqual(25);
            const unprocessed = this.unprocessedWrites(requests);
            for (const r of requests) {
                if (unprocessed.includes(r)) continue;
                if (r.PutRequest) { this.put(r.PutRequest.Item); this.writes.push(JSON.parse(JSON.stringify(r.PutRequest.Item))); }
                else this.items.delete(this.k(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
            }
            return { UnprocessedItems: unprocessed.length ? { [table]: unprocessed } : {} };
        }
        if (cmd instanceof BatchGetCommand) {
            const [table, req] = Object.entries(input.RequestItems as Record<string, any>)[0];
            expect(req.Keys.length).toBeLessThanOrEqual(100);
            expect(req.ConsistentRead).toBe(true);
            const unprocessed = this.unprocessedKeys(req.Keys);
            const found = req.Keys
                .filter((key: any) => !unprocessed.includes(key))
                .map((key: any) => this.get(key.PK, key.SK))
                .filter(Boolean)
                .map((i: Item) => this.project(i, req.ProjectionExpression, req.ExpressionAttributeNames));
            return { Responses: { [table]: found }, UnprocessedKeys: unprocessed.length ? { [table]: { ...req, Keys: unprocessed } } : {} };
        }
        throw new Error(`unexpected command ${cmd.constructor.name}`);
    }
}
