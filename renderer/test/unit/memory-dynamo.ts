// CAT-IMPORT-PROFILE-1B — an in-memory stand-in for the DynamoDB document client, for the catalog-listing read only.
//
// What it models, and nothing else: a `QueryCommand` whose key condition is exactly
// `PK = :pk AND begins_with(SK, :sk)` (the form `getCatalogListing` sends). It returns the matching items in SK order
// (DynamoDB's order for one partition; the fixture ids are ASCII, so code-unit order equals byte order), applies the
// `ProjectionExpression` (with `ExpressionAttributeNames`) as DynamoDB does — attributes the item lacks are absent —
// and pages the result `pageSize` items at a time, so the caller's `ExclusiveStartKey` loop is exercised. Any other
// command or key condition throws: an unmodelled read is a red test, never a silent empty result.
//
// Users: `catalog-listing.test.ts` (the 1b comparison and the projection row) and the 1b golden capture
// (`packages/shared/test/fixtures/cat-import-profile-1b-capture/`, run against the base commit). Every call's input is
// kept in `calls`, so a test can assert what was asked of the store (the projection).

type Item = Record<string, unknown>;

export type MemoryDocClient = {
    send(command: { input?: any; constructor: { name: string } }): Promise<{ Items: Item[]; LastEvaluatedKey?: Item }>;
    calls: any[];
};

const KEY_CONDITION = "PK = :pk AND begins_with(SK, :sk)";

function project(item: Item, expression: string | undefined, names: Record<string, string> | undefined): Item {
    if (!expression) return { ...item };
    const out: Item = {};
    for (const raw of expression.split(",").map((s) => s.trim())) {
        const name = raw.startsWith("#") ? names?.[raw] : raw;
        if (name === undefined) throw new Error(`memory-dynamo: projection name ${raw} has no ExpressionAttributeNames entry`);
        if (Object.prototype.hasOwnProperty.call(item, name)) out[name] = item[name];
    }
    return out;
}

export function memoryDocClient(items: Item[], pageSize = 7): MemoryDocClient {
    const calls: any[] = [];
    return {
        calls,
        async send(command) {
            const input = command.input;
            calls.push(input);
            if (command.constructor.name !== "QueryCommand" || input?.KeyConditionExpression !== KEY_CONDITION) {
                throw new Error(`memory-dynamo: unmodelled command ${command.constructor.name} ${JSON.stringify(input)}`);
            }
            const pk = input.ExpressionAttributeValues[":pk"];
            const sk = input.ExpressionAttributeValues[":sk"];
            const matching = items
                .filter((i) => i.PK === pk && typeof i.SK === "string" && i.SK.startsWith(sk))
                .sort((a, b) => ((a.SK as string) < (b.SK as string) ? -1 : (a.SK as string) > (b.SK as string) ? 1 : 0));
            const start = input.ExclusiveStartKey
                ? matching.findIndex((i) => i.SK === input.ExclusiveStartKey.SK) + 1
                : 0;
            const page = matching.slice(start, start + pageSize);
            const more = start + pageSize < matching.length;
            return {
                Items: page.map((i) => project(i, input.ProjectionExpression, input.ExpressionAttributeNames)),
                ...(more ? { LastEvaluatedKey: { PK: page[page.length - 1].PK, SK: page[page.length - 1].SK } } : {}),
            };
        },
    };
}
