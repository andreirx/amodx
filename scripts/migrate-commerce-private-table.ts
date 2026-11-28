import * as fs from "node:fs";
import * as path from "node:path";
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { filesOn } from "./commerce-private-table/files.js";
import { failureText, runFromArgv } from "./commerce-private-table/run.js";

/**
 * CMRC-2A (docs/slices/cmrc-2a.md, with the operator runbook; PROTOTYPE) — the entry of the commerce-private table
 * tool: `npm run migrate-commerce-private-table -- --mode <mode> …` (`--help` prints the modes).
 *
 * This file only CONNECTS the real things: the DynamoDB client of the region, the clock, `node:fs`, standard output.
 * It holds no rule. Every decision is in `commerce-private-table/decisions.ts` and `canonical-item.ts` (pure); every
 * read, write and delete of a table is in `run.ts`; every rule about a file the tool writes (the whole line on disk
 * before a delete, never inside the repository, never over an existing file) is in `files.ts`. Those four files are
 * under unit tests (`backend/test/unit/cmrc-2a-*.test.ts`); this one is not, so it must stay without logic.
 */
const repositoryRoot = path.resolve(__dirname, "..");

runFromArgv(
    process.argv.slice(2),
    { defaultRegion: process.env.AWS_REGION || "eu-central-1", cwd: process.cwd(), repositoryRoot },
    {
        connect: (region) => {
            const client = new DynamoDBClient({ region });
            return {
                // One call per command class: the client's `send` is typed per command, not for a union of them.
                // The tool reads nothing from the answer of a Put or a Delete.
                send: async (command) => {
                    if (command instanceof QueryCommand) return client.send(command);
                    if (command instanceof GetItemCommand) return client.send(command);
                    if (command instanceof PutItemCommand) await client.send(command);
                    else await client.send(command);
                    return {};
                },
            };
        },
        now: () => new Date().toISOString(),
        files: filesOn(fs, repositoryRoot),
        out: (line) => console.log(line),
    },
).then(
    (exitStatus) => {
        process.exitCode = exitStatus;
    },
    // `runFromArgv` does not reject. If it ever does, print the error's name only (a message can quote data).
    (error: unknown) => {
        console.log(`ABORTED: the tool failed outside a run (${failureText(error)})`);
        console.log("RESULT: NOT GREEN — the tool stopped; exit status 1");
        process.exitCode = 1;
    },
);
