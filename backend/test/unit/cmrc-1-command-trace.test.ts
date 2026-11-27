import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "fs";
import * as path from "path";
import { GOLDEN_FILE, SCENARIOS, canonical, runTrace, serialize } from "./cmrc-1-command-trace.js";

/**
 * CMRC-1A, test T1b — requirement C2 (docs/slices/cmrc-1a.md § Proofs; docs/slices/cmrc-1.md § 5.2, § 5.9): the twelve
 * handler files that read or write a commerce-private key send the same DynamoDB commands, cause the same audit
 * events and mails in the same order, and give the same HTTP answers as the baseline commit `a78c006`.
 *
 * The scenarios and the recorder are in `cmrc-1-command-trace.ts`. The golden was written by
 * `cmrc-1-command-trace.capture.test.ts` on the baseline (procedure in that file's header). A difference here means a
 * command or an answer changed: that is a stop condition of the slice, never a reason to capture the golden again.
 *
 * The six `vi.mock` lines are the same as in the capture file.
 */

vi.mock("../../src/lib/db.js", async () => (await import("./cmrc-1-command-trace.js")).dbModule);
vi.mock("../../src/lib/events.js", async () => (await import("./cmrc-1-command-trace.js")).eventsModule);
vi.mock("../../src/lib/tenant-verify.js", async () => (await import("./cmrc-1-command-trace.js")).tenantVerifyModule);
vi.mock("../../src/lib/recaptcha.js", async () => (await import("./cmrc-1-command-trace.js")).recaptchaModule);
vi.mock("@aws-sdk/client-ses", async () => (await import("./cmrc-1-command-trace.js")).sesModule);
vi.mock("@aws-sdk/s3-request-presigner", async () => (await import("./cmrc-1-command-trace.js")).presignerModule);

const goldenText = readFileSync(path.join(__dirname, GOLDEN_FILE), "utf8");
const golden = JSON.parse(goldenText) as { scenarios: Record<string, unknown> };

describe("CMRC-1A T1b — command trace equal to the baseline golden", () => {
    let trace: Awaited<ReturnType<typeof runTrace>>;
    beforeAll(async () => { trace = await runTrace(); }, 120_000);

    it("the golden holds exactly the scenarios of the trace module (the golden lists them sorted by name)", () => {
        expect(Object.keys(golden.scenarios)).toEqual([...SCENARIOS.map((s) => s.name)].sort());
    });

    // One row per scenario, so a failure names the handler path that changed.
    it.each(SCENARIOS.map((s) => s.name))("%s", (name) => {
        expect(canonical(trace.scenarios[name])).toEqual(golden.scenarios[name]);
    });

    it("the whole trace serializes to the golden file, byte for byte", () => {
        expect(serialize(trace)).toBe(goldenText);
    });
});
