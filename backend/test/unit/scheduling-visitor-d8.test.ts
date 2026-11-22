import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

/**
 * SCHED-1D2 row D8 (docs/slices/sched-1.md § 17.3): arbitrary starts submitted to the hold route are refused by the
 * write-time re-check (`slotDecision`, § 5.2), on configuration WRITTEN through `scheduling-db.ts` — including a
 * `dayOff` override written by `editResourceDays`.
 *
 * REAL: the hold handler, `scheduling-db.ts` (`holdSlot`, its reads, and the seeding writes `createResource`,
 * `putService`, `putAvailability`, `editResourceDays`), the kernel. The DynamoDB client is `MemoryTable` (the existing
 * in-memory table of the handler tests): every D8 refusal is decided on Get reads before any transaction, which is
 * all this table needs. REPLACED: `verifyRecaptcha` (the call to Google; it answers "human").
 * Positive control: before the `dayOff` edit, the same start passes every check and reaches the hold transaction
 * (`TransactWriteCommand`, which `MemoryTable` does not implement — the request then fails with 500, recorded below);
 * after the edit it is refused with `outsideAvailability`. So the refusal comes from the stored override, not from
 * the test.
 */

const h = vi.hoisted(() => {
    process.env.SCHEDULING_TABLE_NAME = "sched-table";
    process.env.RECAPTCHA_SECRET_KEY = "deployment-secret";
    return { table: undefined as any, verifyRecaptcha: vi.fn(async () => ({ success: true, score: 0.9 })) };
});

vi.mock("../../src/lib/db.js", async () => {
    const { MemoryTable } = await import("./memory-table.js");
    h.table = new MemoryTable();
    return { db: h.table, TABLE_NAME: "main-table" };
});
vi.mock("../../src/lib/recaptcha.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/lib/recaptcha.js")>()),
    verifyRecaptcha: h.verifyRecaptcha,
}));

import { handler as holdRoute } from "../../src/scheduling/visitor/holds.js";
import { createResource, editResourceDays, putAvailability, putService, schedulingStoreFromEnv } from "../../src/lib/scheduling-db.js";

const NOW = Date.parse("2026-12-01T10:00:00.000Z");   // Tuesday; lastBookableDate (8 weeks) = 2027-01-26
const RENDERER = { sub: "renderer", role: "RENDERER", tenantId: "ALL" };

let n = 0;
async function hold(start: string) {
    n++;
    const event = {
        headers: { "x-tenant-id": "t1" },
        requestContext: { authorizer: { lambda: RENDERER }, http: { sourceIp: "10.0.0.9" } },
        body: JSON.stringify({
            intentId: `6f1b2c3d-4e5f-4a6b-8c7d-${String(n).padStart(12, "0")}`, recaptchaToken: "captcha",
            what: { kind: "slot", serviceId: "svc1", start }, who: { email: "ana@example.test", name: "Ana" },
        }),
    };
    const res = (await holdRoute(event as any, {} as any, () => {})) as { statusCode: number; body: string };
    return { status: res.statusCode, code: JSON.parse(res.body).code as string };
}
const transactions = () => h.table.commands.filter((c: any) => c instanceof TransactWriteCommand).length;

let resourceId: string;
beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    h.table.put({ PK: "SYSTEM", SK: "TENANT#t1", id: "t1", schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" } });
    const store = schedulingStoreFromEnv();
    resourceId = (await createResource(store, "t1", "Dr. A")).id;
    await putService(store, "t1", { id: "svc1", name: "Consultation", durationMin: 60, eligibility: { kind: "only", resourceIds: [resourceId] } });
    await putAvailability(store, "t1", resourceId, [{ weekday: 1, start: "09:00", end: "12:00" }]);   // Mondays 09-12 local
});
afterAll(() => vi.useRealTimers());

describe("D8 arbitrary starts submitted to the hold (real scheduling-db.ts, configuration written through it)", () => {
    it("D8 positive control: Monday 2026-12-14 09:00 local passes every check and reaches the hold transaction", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const before = transactions();
        const res = await hold("2026-12-14T07:00:00.000Z");
        expect(transactions()).toBe(before + 1);
        expect(res.status).toBe(500);   // MemoryTable has no TransactWriteItems: the control stops here by design
        log.mockRestore();
    });

    it("D8 off grid (09:30 local, a 60-minute service from 09:00) → 409 notOnGrid", async () => {
        expect(await hold("2026-12-07T07:30:00.000Z")).toEqual({ status: 409, code: "notOnGrid" });
    });

    it("D8 outside the windows (Monday 14:00 local) → 409 outsideAvailability", async () => {
        expect(await hold("2026-12-07T12:00:00.000Z")).toEqual({ status: 409, code: "outsideAvailability" });
    });

    it("D8 in the past (Monday 2026-11-30 09:00 local) → 409 inPast", async () => {
        expect(await hold("2026-11-30T07:00:00.000Z")).toEqual({ status: 409, code: "inPast" });
    });

    it("D8 after lastBookableDate (Monday 2027-02-01 09:00 local, horizon 2027-01-26) → 409 beyondHorizon", async () => {
        expect(await hold("2027-02-01T07:00:00.000Z")).toEqual({ status: 409, code: "beyondHorizon" });
    });

    it("D8 on a date with a dayOff override written by editResourceDays → 409 outsideAvailability; no transaction", async () => {
        const edited = await editResourceDays(schedulingStoreFromEnv(), "t1", resourceId,
            { kind: "set", from: "2026-12-14", to: "2026-12-14", value: { kind: "dayOff" } }, "2026-12-01");
        expect(edited.ok).toBe(true);
        const before = transactions();
        expect(await hold("2026-12-14T07:00:00.000Z")).toEqual({ status: 409, code: "outsideAvailability" });
        expect(transactions()).toBe(before);
    });
});
