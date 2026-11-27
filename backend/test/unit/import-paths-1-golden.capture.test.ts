import { describe, it, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "fs";
import { ImportTable, FIXTURE_WXR, GOLDEN_TIME, runImport, snapshot, uuidCounter } from "./import-paths-1-harness";

/**
 * IMPORT-PATHS-1 ruling 3 — the golden CAPTURE of today's WordPress import (base main 30421e3). Skipped unless
 * `CAPTURE_GOLDEN_TO` names the output file. It was run on the unchanged source BEFORE any change of the slice, and
 * re-run from a separate worktree of the base commit to show the file is the base behaviour:
 *
 *   git worktree add /tmp/IMPORT-PATHS-1-baseline 30421e3
 *   (copy this file, import-paths-1-harness.ts and fixtures/wordpress/import-paths-1.wxr.xml into the worktree;
 *    link node_modules)
 *   cd /tmp/IMPORT-PATHS-1-baseline/backend && CAPTURE_GOLDEN_TO=/tmp/IMPORT-PATHS-1-baseline.json \
 *     npx vitest run --config vitest.unit.config.ts test/unit/import-paths-1-golden.capture.test.ts
 *   git worktree remove --force /tmp/IMPORT-PATHS-1-baseline
 *
 * The comparison against the changed code is in import-paths-1.test.ts (IP1-GOLDEN-OPTION-OFF). Running this file on
 * changed code captures the changed behaviour: that is never a preservation proof.
 *
 * The request is today's request shape (`{ wxrContent }`, the first batch, default size): today's importer has no
 * option. The tenant holds no page; the media map holds the fixture's attachment.
 */

const h = vi.hoisted(() => ({ table: null as any }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: (cmd: any) => h.table.send(cmd) }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/media-map.js", async () => {
    const { MEDIA_MAP: entries } = await import("./import-paths-1-harness");
    return { loadMediaMap: vi.fn(async () => new Map(entries)) };
});
vi.mock("../../src/lib/image-upload.js", () => ({ downloadAndUploadImage: vi.fn(async () => { throw new Error("no upload in tests"); }) }));
vi.mock("../../src/lib/invalidate-cdn.js", () => ({ withInvalidation: (handler: any) => handler }));
vi.mock("../../src/lib/revalidate.js", () => ({ purgeStoredPagesOfRequestTenant: vi.fn() }));

import { handler } from "../../src/import/wordpress.js";

const target = process.env.CAPTURE_GOLDEN_TO;

describe.skipIf(!target)("IMPORT-PATHS-1 golden capture (today's import)", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(GOLDEN_TIME));
        vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(uuidCounter() as any);
        h.table = new ImportTable();
    });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it("captures today's output of the fixture", async () => {
        const res = await runImport(handler, { wxrContent: FIXTURE_WXR });
        writeFileSync(target!, JSON.stringify(snapshot(h.table, res.raw), null, 2) + "\n");
    });
});
