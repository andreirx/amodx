import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    BatchWriteCommand,
    DynamoDBDocumentClient,
    QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const MOVED_PREFIXES = ["ORDER#", "CUSTORDER#", "CUSTOMER#", "COUNTER#ORDER"] as const;
type MovedPrefix = (typeof MOVED_PREFIXES)[number];
type Mode = "plan" | "migrate" | "verify";

type ScriptArgs = {
    mode: Mode;
    sourceTable: string;
    destinationTable: string;
    tenants: string[];
    region: string;
    pageSize: number;
    allowExistingDestination: boolean;
};

type DynamoItem = Record<string, unknown> & {
    PK: string;
    SK: string;
};

type PrefixResult = {
    prefix: MovedPrefix;
    sourceItems: DynamoItem[];
    destinationItems: DynamoItem[];
};

type TenantResult = {
    tenantId: string;
    prefixResults: PrefixResult[];
};

function printHelp() {
    console.log(`
AMODX commerce-private table migration

Usage:
  npm run migrate-commerce-private-table -- \\
    --mode <plan|migrate|verify> \\
    --source-table <mainTableName> \\
    --destination-table <commerceTableName> \\
    --tenants <tenantA,tenantB> \\
    [--region eu-central-1] \\
    [--page-size 50] \\
    [--allow-existing-destination]

Notes:
  - Uses QueryCommand only. No scans.
  - Copies only ORDER#, CUSTORDER#, CUSTOMER#, COUNTER#ORDER.
  - Does not delete source records.
  - Destination must be empty for the moved prefixes unless --allow-existing-destination is supplied.
`.trim());
}

function fail(message: string): never {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

function parseArgs(argv: string[]): ScriptArgs {
    const args = new Map<string, string | boolean>();

    for (let i = 0; i < argv.length; i += 1) {
        const raw = argv[i];
        if (!raw.startsWith("--")) {
            continue;
        }

        const key = raw.slice(2);
        const next = argv[i + 1];

        if (!next || next.startsWith("--")) {
            args.set(key, true);
            continue;
        }

        args.set(key, next);
        i += 1;
    }

    if (args.has("help")) {
        printHelp();
        process.exit(0);
    }

    const mode = String(args.get("mode") || "");
    if (mode !== "plan" && mode !== "migrate" && mode !== "verify") {
        fail("Missing or invalid --mode. Use plan, migrate, or verify.");
    }

    const sourceTable = String(args.get("source-table") || "");
    const destinationTable = String(args.get("destination-table") || "");
    const tenantsCsv = String(args.get("tenants") || "");
    const region = String(args.get("region") || process.env.AWS_REGION || "eu-central-1");
    const pageSize = Number(args.get("page-size") || 50);

    if (!sourceTable) {
        fail("Missing --source-table.");
    }

    if (!destinationTable) {
        fail("Missing --destination-table.");
    }

    if (!tenantsCsv) {
        fail("Missing --tenants. Use an explicit allowlist, e.g. tenant-a,tenant-b.");
    }

    const tenants = tenantsCsv
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);

    if (!tenants.length) {
        fail("No valid tenant IDs provided in --tenants.");
    }

    if (!Number.isFinite(pageSize) || pageSize <= 0) {
        fail("Invalid --page-size. Use a positive number.");
    }

    return {
        mode,
        sourceTable,
        destinationTable,
        tenants,
        region,
        pageSize,
        allowExistingDestination: Boolean(args.get("allow-existing-destination")),
    };
}

function tenantPk(tenantId: string): string {
    return `TENANT#${tenantId}`;
}

function itemKey(item: DynamoItem): string {
    return `${item.PK}||${item.SK}`;
}

async function queryPrefixItems(
    db: DynamoDBDocumentClient,
    tableName: string,
    tenantId: string,
    prefix: MovedPrefix,
    pageSize: number,
): Promise<DynamoItem[]> {
    const items: DynamoItem[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
        const result = await db.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
            ExpressionAttributeValues: {
                ":pk": tenantPk(tenantId),
                ":prefix": prefix,
            },
            ExclusiveStartKey: lastEvaluatedKey,
            Limit: pageSize,
        }));

        if (result.Items?.length) {
            items.push(...(result.Items as DynamoItem[]));
        }

        lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return items;
}

async function loadTenantState(
    db: DynamoDBDocumentClient,
    sourceTable: string,
    destinationTable: string,
    tenantId: string,
    pageSize: number,
): Promise<TenantResult> {
    const prefixResults: PrefixResult[] = [];

    for (const prefix of MOVED_PREFIXES) {
        const [sourceItems, destinationItems] = await Promise.all([
            queryPrefixItems(db, sourceTable, tenantId, prefix, pageSize),
            queryPrefixItems(db, destinationTable, tenantId, prefix, pageSize),
        ]);

        prefixResults.push({
            prefix,
            sourceItems,
            destinationItems,
        });
    }

    return { tenantId, prefixResults };
}

function summarizeTenant(result: TenantResult) {
    console.log(`\nTenant: ${result.tenantId}`);
    for (const prefixResult of result.prefixResults) {
        console.log(
            `  ${prefixResult.prefix.padEnd(14)} source=${String(prefixResult.sourceItems.length).padStart(4)} destination=${String(prefixResult.destinationItems.length).padStart(4)}`,
        );
    }
}

function assertDestinationEmpty(result: TenantResult) {
    const occupied = result.prefixResults.filter(r => r.destinationItems.length > 0);
    if (!occupied.length) {
        return;
    }

    const details = occupied
        .map(r => `${r.prefix}:${r.destinationItems.length}`)
        .join(", ");

    fail(`Destination already contains moved records for tenant '${result.tenantId}' (${details}). Re-run with --allow-existing-destination only if this is intentional.`);
}

async function writeItems(
    db: DynamoDBDocumentClient,
    tableName: string,
    items: DynamoItem[],
) {
    for (let i = 0; i < items.length; i += 25) {
        const batch = items.slice(i, i + 25);
        let unprocessed = batch.map(item => ({ PutRequest: { Item: item } }));

        while (unprocessed.length > 0) {
            const response = await db.send(new BatchWriteCommand({
                RequestItems: {
                    [tableName]: unprocessed,
                },
            }));

            unprocessed = response.UnprocessedItems?.[tableName] ?? [];

            if (unprocessed.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
    }
}

function compareKeys(prefixResult: PrefixResult) {
    const sourceKeys = new Set(prefixResult.sourceItems.map(itemKey));
    const destinationKeys = new Set(prefixResult.destinationItems.map(itemKey));

    const missingInDestination = [...sourceKeys].filter(key => !destinationKeys.has(key));
    const unexpectedInDestination = [...destinationKeys].filter(key => !sourceKeys.has(key));

    return {
        missingInDestination,
        unexpectedInDestination,
    };
}

function verifyTenant(result: TenantResult) {
    let hasMismatch = false;

    for (const prefixResult of result.prefixResults) {
        const { missingInDestination, unexpectedInDestination } = compareKeys(prefixResult);

        if (missingInDestination.length || unexpectedInDestination.length) {
            hasMismatch = true;
            console.error(`  Verification mismatch for ${prefixResult.prefix}`);
            if (missingInDestination.length) {
                console.error(`    Missing in destination (${missingInDestination.length}):`);
                for (const key of missingInDestination.slice(0, 10)) {
                    console.error(`      ${key}`);
                }
            }
            if (unexpectedInDestination.length) {
                console.error(`    Unexpected in destination (${unexpectedInDestination.length}):`);
                for (const key of unexpectedInDestination.slice(0, 10)) {
                    console.error(`      ${key}`);
                }
            }
        }
    }

    if (!hasMismatch) {
        console.log("  Verification OK");
    }

    return !hasMismatch;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    console.log(`Mode: ${args.mode}`);
    console.log(`Region: ${args.region}`);
    console.log(`Source table: ${args.sourceTable}`);
    console.log(`Destination table: ${args.destinationTable}`);
    console.log(`Tenants: ${args.tenants.join(", ")}`);

    const client = new DynamoDBClient({ region: args.region });
    const db = DynamoDBDocumentClient.from(client, {
        marshallOptions: {
            removeUndefinedValues: true,
        },
    });

    const initialResults: TenantResult[] = [];

    for (const tenantId of args.tenants) {
        const result = await loadTenantState(
            db,
            args.sourceTable,
            args.destinationTable,
            tenantId,
            args.pageSize,
        );

        summarizeTenant(result);
        if (!args.allowExistingDestination && args.mode === "migrate") {
            assertDestinationEmpty(result);
        }
        initialResults.push(result);
    }

    if (args.mode === "plan") {
        console.log("\nPlan mode completed. No writes performed.");
        return;
    }

    if (args.mode === "migrate") {
        console.log("\nWriting source items to destination table...");

        for (const result of initialResults) {
            const itemsToWrite = result.prefixResults.flatMap(prefixResult => prefixResult.sourceItems);
            console.log(`  ${result.tenantId}: writing ${itemsToWrite.length} items`);
            await writeItems(db, args.destinationTable, itemsToWrite);
        }
    }

    console.log("\nReloading destination state for verification...");

    let allVerified = true;
    for (const tenantId of args.tenants) {
        const result = await loadTenantState(
            db,
            args.sourceTable,
            args.destinationTable,
            tenantId,
            args.pageSize,
        );
        summarizeTenant(result);
        const ok = verifyTenant(result);
        allVerified = allVerified && ok;
    }

    if (!allVerified) {
        fail("Verification failed.");
    }

    console.log(`\n${args.mode === "migrate" ? "Migration" : "Verification"} completed successfully.`);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exit(1);
});
