import { describe, it, vi } from "vitest";
import { writeFileSync } from "fs";
import { runTrace, serialize } from "./cmrc-1-command-trace.js";

/**
 * CMRC-1A, test T1b — the golden CAPTURE (docs/slices/cmrc-1a.md § Proofs). Skipped unless `CAPTURE_GOLDEN_TO` names
 * the output file. The golden is the behaviour of the BASELINE commit `a78c006` (HEAD at the start of CMRC-1A). It was
 * captured on the untouched handlers before the first handler edit, and captured again from a separate worktree of
 * that commit to show the file is the baseline behaviour:
 *
 *   git worktree add /tmp/CMRC-1A-baseline a78c00607380f9d3741a8d0e8d580376afd63261
 *   cp backend/test/unit/cmrc-1-command-trace.ts backend/test/unit/cmrc-1-command-trace.capture.test.ts \
 *      /tmp/CMRC-1A-baseline/backend/test/unit/
 *   ln -s "$PWD/node_modules" /tmp/CMRC-1A-baseline/node_modules
 *   ln -s "$PWD/backend/node_modules" /tmp/CMRC-1A-baseline/backend/node_modules     (when the directory exists)
 *   (cd /tmp/CMRC-1A-baseline/backend && CAPTURE_GOLDEN_TO=/tmp/CMRC-1A-baseline.json \
 *      npx vitest run --config vitest.unit.config.ts test/unit/cmrc-1-command-trace.capture.test.ts)
 *   cmp /tmp/CMRC-1A-baseline.json backend/test/unit/fixtures/cmrc-1-command-trace.baseline.json
 *   git worktree remove --force /tmp/CMRC-1A-baseline
 *
 * The comparison against the current code is `cmrc-1-command-trace.test.ts`. Running this file on changed code
 * captures the changed behaviour: that is never a preservation proof.
 *
 * The six `vi.mock` lines are the same in the comparison file; the replacement modules live in the trace module.
 */

vi.mock("../../src/lib/db.js", async () => (await import("./cmrc-1-command-trace.js")).dbModule);
vi.mock("../../src/lib/events.js", async () => (await import("./cmrc-1-command-trace.js")).eventsModule);
vi.mock("../../src/lib/tenant-verify.js", async () => (await import("./cmrc-1-command-trace.js")).tenantVerifyModule);
vi.mock("../../src/lib/recaptcha.js", async () => (await import("./cmrc-1-command-trace.js")).recaptchaModule);
vi.mock("@aws-sdk/client-ses", async () => (await import("./cmrc-1-command-trace.js")).sesModule);
vi.mock("@aws-sdk/s3-request-presigner", async () => (await import("./cmrc-1-command-trace.js")).presignerModule);

const target = process.env.CAPTURE_GOLDEN_TO;

describe.skipIf(!target)("CMRC-1A T1b golden capture (baseline commit only)", () => {
    it("captures the effects and the answer of every scenario", async () => {
        writeFileSync(target!, serialize(await runTrace()));
    }, 120_000);
});
