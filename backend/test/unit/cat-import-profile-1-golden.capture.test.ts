import { describe, it, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { MemoryTable } from "./memory-table.js";
import { GOLDEN_TIME, captureCase, goldenInputs, mask } from "./cat-import-profile-1-golden.js";

/**
 * CAT-IMPORT-PROFILE-1A — the golden CAPTURE (docs/slices/cat-import-profile-1.md § 7.3). Skipped unless
 * `CAPTURE_GOLDEN_TO` names the output file. It is run ONCE, on the base commit, from a separate worktree:
 *
 *   git -C <repo> worktree add /tmp/CAT-IMPORT-PROFILE-1A-baseline <base commit>
 *   (copy this file and cat-import-profile-1-golden.ts into its backend/test/unit/; link node_modules)
 *   cd /tmp/CAT-IMPORT-PROFILE-1A-baseline/backend && CAPTURE_GOLDEN_TO=<abs path>/cat-import-profile-1-baseline.json \
 *     npx vitest run --config vitest.unit.config.ts test/unit/cat-import-profile-1-golden.capture.test.ts
 *   git -C <repo> worktree remove /tmp/CAT-IMPORT-PROFILE-1A-baseline
 *
 * The comparison against the current code is `glam-profile-golden.test.ts`. Running this file on changed code
 * would capture the changed behaviour — that is never a preservation proof (§ 7.3 rule).
 */

const { holder, mockAudit, nextUuid } = vi.hoisted(() => {
    let n = 0;
    return {
        holder: { table: null as any },
        mockAudit: vi.fn(),
        nextUuid: () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`,
    };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => holder.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
// Deterministic ids: the reconciliation's write order follows the sort order of product ids (`CATPROD#<c>#<id>`), so
// random ids make the write history differ between two runs. A counter keeps creation order = sort order.
vi.mock("crypto", async (original) => ({ ...(await original<typeof import("crypto")>()), randomUUID: nextUuid }));

import { handler } from "../../src/import/glam-pricelist.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const event = (body: unknown, dryRun: boolean) => ({
    headers: { "x-tenant-id": "t1" },
    queryStringParameters: dryRun ? { dryRun: "1" } : undefined,
    routeKey: "POST /import/glam-pricelist",
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}) as any;
const call = async (body: unknown, dryRun: boolean) => {
    const res = (await handler(event(body, dryRun), {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(GOLDEN_TIME));
    vi.spyOn(Math, "random").mockReturnValue(0);
    mockAudit.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe.skipIf(!process.env.CAPTURE_GOLDEN_TO)("CAT-IMPORT-PROFILE-1A golden capture (base commit only)", () => {
    it("captures the plan and the write history of every golden input", async () => {
        const cases: Record<string, unknown> = {};
        for (const input of goldenInputs()) {
            const table = new MemoryTable();
            holder.table = table;
            table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Glam", catalogMode: true });
            cases[input.name] = mask(await captureCase(input, table, call, mockAudit));
        }
        writeFileSync(process.env.CAPTURE_GOLDEN_TO!, JSON.stringify({ goldenTime: GOLDEN_TIME, cases }) + "\n");
    }, 120_000);
});
