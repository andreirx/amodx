import { readFileSync } from "fs";
import * as path from "path";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { LangTable } from "./lang-1a-table";

// The importer parses WXR comment dates (`2024-03-07 08:00:00`, no zone) in the process time zone; pinned so a golden
// does not depend on the machine. Node applies a runtime change of TZ to later Date calls.
process.env.TZ = "UTC";

/**
 * IMPORT-PATHS-1 — the test harness of the WordPress import (users: import-paths-1-golden.capture.test.ts,
 * import-paths-1.test.ts). The handler runs for real on an inline WXR body against an in-memory table; each test
 * file mocks `db.js`, the media map, the image upload, the CDN wrapper and the purge itself (vi.mock is per file).
 *
 * `ImportTable` is `LangTable` (lang-1a-table.ts) plus the one query the product lookup sends:
 * `IndexName: "GSI_Slug", KeyConditionExpression: "TenantSlug = :ts"` (product-slug.ts `findProductBySlug`). Like the
 * real index, it returns every item whose `TenantSlug` matches, whatever its partition (a foreign row can match).
 */
export class ImportTable extends LangTable {
    async send(cmd: any): Promise<any> {
        if (cmd instanceof QueryCommand && cmd.input.IndexName === "GSI_Slug") {
            // The one-shot hook of LangTable (`beforeCommand`), for this query too.
            if (this.beforeCommand?.match(cmd)) {
                const hook = this.beforeCommand;
                this.beforeCommand = null;
                await hook.run();
            }
            this.commands.push(cmd);
            const ts = cmd.input.ExpressionAttributeValues[":ts"];
            return { Items: [...this.items.values()].filter((i) => i.TenantSlug === ts).map((i) => structuredClone(i)) };
        }
        return super.send(cmd);
    }
}

export const TENANT = "t1";
export const T = `TENANT#${TENANT}`;
export const GOLDEN_TIME = "2026-11-27T08:00:00.000Z";
export const FIXTURE_WXR = readFileSync(path.join(__dirname, "fixtures/wordpress/import-paths-1.wxr.xml"), "utf-8");
export const GOLDEN_FILE = path.join(__dirname, "fixtures/wordpress/import-paths-1-golden.json");
/** The media map of the golden run: the attachment of the fixture was imported by the media step. */
export const MEDIA_MAP: [string, string][] = [
    ["https://atelier.example.test/wp-content/uploads/2024/03/ceara-hero.jpg", "https://cdn.example.test/t1/ceara-hero.jpg"],
];

/** Deterministic ids for `crypto.randomUUID()` (the importer uses the global one): 1, 2, 3, … in call order. */
export function uuidCounter(): () => string {
    let n = 0;
    return () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`;
}

export async function runImport(handler: any, body: Record<string, unknown>): Promise<{ statusCode: number; raw: string; body: any }> {
    const res = await handler({
        headers: { "x-tenant-id": TENANT },
        body: JSON.stringify(body),
        requestContext: { authorizer: { lambda: { sub: "u1", email: "editor@t1.example.test", role: "TENANT_ADMIN", tenantId: TENANT } } },
    }, {}, () => {});
    return { statusCode: res.statusCode, raw: res.body, body: JSON.parse(res.body) };
}

/** What a golden compares: the raw response body, every command in order (name + input), every item sorted by key. */
export function snapshot(table: ImportTable, raw: string) {
    return {
        response: raw,
        commands: table.commands.map((c) => ({ command: c.constructor.name, input: JSON.parse(JSON.stringify(c.input)) })),
        items: [...table.items.values()].sort((a, b) => `${a.PK}\u0000${a.SK}`.localeCompare(`${b.PK}\u0000${b.SK}`)),
    };
}
