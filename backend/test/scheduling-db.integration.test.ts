/**
 * SCHED-1C integration rows (docs/slices/sched-1.md § 17.3 table `sched-1c`) against the REAL staging scheduling
 * table, with injected clocks. OPERATOR-RUN; never part of `npm run test:unit` (that config includes only
 * `test/unit/**`).
 *
 * Run (from `backend/`, with staging AWS credentials and the `.env.test` that `test/setup.ts` requires):
 *   SCHEDULING_TABLE_NAME=AmodxSchedulingTable-staging npx vitest run test/scheduling-db.integration.test.ts
 *
 * Safety rules of the packet:
 * - unset `SCHEDULING_TABLE_NAME` → every test is skipped (visible as skipped, never as passed);
 *   set to a name that does not end with `-staging` → the file throws at load: it refuses to run;
 * - every test uses a fresh random tenant id (`sched1c-it-<uuid>`), so no real tenant's partition is touched;
 * - every test deletes every item of its tenant partition in a `finally` (Query on `PK = TENANT#<id>`, then
 *   Delete per key), whether it passed or failed.
 *
 * Clocks: every decision uses an injected `now` derived from the real time at load (so TTL values stay in the
 * future while the test runs); bookings are placed on local dates 8-14 days ahead (inside the 8-week horizon).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { instantToLocal, localToInstant, type Person } from "@amodx/shared";
import * as sdb from "../src/lib/scheduling-db";

const TABLE = process.env.SCHEDULING_TABLE_NAME;
if (TABLE !== undefined && !TABLE.endsWith("-staging")) {
    throw new Error(`scheduling-db.integration refuses to run: SCHEDULING_TABLE_NAME must end with -staging (got a non-staging name)`);
}
const ENABLED = TABLE !== undefined;

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" }), {
    marshallOptions: { removeUndefinedValues: true },
});

const TZ = "Europe/Bucharest";
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Math.floor(Date.now() / MIN) * MIN;
const settings = { timezone: TZ, holdMinutes: 30, bookingHorizonWeeks: 8, changeCutoffHours: 24 };

/** The local Monday 8-14 days after NOW, as a LocalDate. */
function mondayAhead(): string {
    for (let d = 8; d < 15; d++) {
        const date = instantToLocal(NOW + d * DAY, TZ).date;
        const [y, m, dd] = date.split("-").map(Number);
        if (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() === 1) return date;
    }
    throw new Error("no Monday found");
}
const MONDAY = mondayAhead();
const at = (date: string, time: string) => {
    const r = localToInstant(date, time, TZ);
    if (!r.ok) throw new Error("nonexistent local time in a fixture");
    return r.value;
};
const MON_0900 = at(MONDAY, "09:00");
const RUN_DATE = instantToLocal(MON_0900 + 5 * DAY, TZ).date; // the Saturday after

type Hook = { op: string; phase: "before" | "after"; run: () => unknown; when?: (input: any) => boolean };

/** A store on the staging table whose client can run a hook before or after one chosen command (interleavings). */
function hookedStore() {
    const hooks: Hook[] = [];
    const store: sdb.SchedulingStore = {
        table: TABLE as string,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        db: {
            send: (async (cmd: any) => {
                const op = cmd.constructor.name;
                const take = async (phase: "before" | "after") => {
                    const i = hooks.findIndex((h) => h.op === op && h.phase === phase && (h.when?.(cmd.input) ?? true));
                    if (i >= 0) await hooks.splice(i, 1)[0].run();
                };
                await take("before");
                const out = await doc.send(cmd);
                await take("after");
                return out;
            }) as any,
        },
    };
    const on = (op: string, phase: "before" | "after", run: () => unknown, when?: (input: any) => boolean) => hooks.push({ op, phase, run, when });
    return { store, on };
}

async function purge(tenantId: string): Promise<void> {
    const pk = sdb.schedulingKeys.pk(tenantId);
    let start: Record<string, unknown> | undefined;
    do {
        const page = await doc.send(new QueryCommand({
            TableName: TABLE, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": pk },
            ProjectionExpression: "PK, SK", ExclusiveStartKey: start, ConsistentRead: true,
        }));
        for (const item of page.Items ?? []) await doc.send(new DeleteCommand({ TableName: TABLE, Key: { PK: item.PK, SK: item.SK } }));
        start = page.LastEvaluatedKey;
    } while (start !== undefined);
}

/**
 * One fresh tenant per test; every item of its partition is deleted in `finally`, then the partition is read
 * back and must be empty. Cleanup rule (review SCHED1C-R6): no test body returns or throws while an operation it
 * started is still running — concurrent groups go through `settleAll` (never `Promise.all`), and hooked
 * operations run inside the awaited command that triggers them — so the purge cannot race a writer.
 */
function rowTest(name: string, body: (t: string, h: ReturnType<typeof hookedStore>) => Promise<void>) {
    it(name, async () => {
        const tenantId = `sched1c-it-${randomUUID()}`;
        try {
            await body(tenantId, hookedStore());
        } finally {
            await purge(tenantId);
            const left = await partition(tenantId);
            if (left.length > 0) throw new Error(`cleanup left ${left.length} items in the test partition`);
        }
    }, 180_000);
}

/** Waits until EVERY operation has settled; then rethrows the first rejection, else returns the values. */
async function settleAll<T>(operations: Promise<T>[]): Promise<T[]> {
    const settled = await Promise.allSettled(operations);
    const failed = settled.find((x): x is PromiseRejectedResult => x.status === "rejected");
    if (failed) throw failed.reason;
    return settled.map((x) => (x as PromiseFulfilledResult<T>).value);
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
    return r.value;
}
const person = (email: string, language?: string): Person => ({ email, name: "Test Person", ...(language ? { language } : {}) });
const admin = { kind: "admin" as const, email: "owner@studio.example" };
const customer = { kind: "customer" as const };

async function seedSlots(store: sdb.SchedulingStore, t: string, services = [{ id: "svc60", durationMin: 60 }]) {
    const r = await sdb.createResource(store, t, "Practitioner");
    await sdb.putAvailability(store, t, r.id, [{ weekday: 1, start: "09:00", end: "12:00" }]);
    for (const s of services) await sdb.putService(store, t, { id: s.id, name: `Consult ${s.durationMin}`, durationMin: s.durationMin, eligibility: { kind: "all" } });
    return r.id;
}
const holdSlot = (store: sdb.SchedulingStore, t: string, start: number, who: Person, extra: Partial<sdb.SlotHoldInput> = {}) =>
    sdb.holdSlot(store, { tenantId: t, serviceId: "svc60", start, who, intentId: randomUUID(), fingerprint: "fp", settings, now: NOW, ...extra });

async function seedRun(store: sdb.SchedulingStore, t: string, capacity: number, trainerId?: string, meetings?: any[], now = NOW) {
    await sdb.putCourse(store, t, { id: "c1", name: "Course", defaultCapacity: 8, languages: ["ro", "en"] });
    const trainer = trainerId ?? (await sdb.createResource(store, t, "Trainer")).id;
    const run = must(await sdb.createRun(store, {
        tenantId: t, courseId: "c1", timezone: TZ, capacity, trainerIds: [trainer], language: { kind: "notSet" },
        meetings: meetings ?? [{ date: RUN_DATE, start: "10:00", end: "13:00" }], now,
    }));
    return { run, trainerId: trainer };
}
const holdSeat = (store: sdb.SchedulingStore, t: string, runId: string, who: Person, extra: Partial<sdb.SeatHoldInput> = {}) =>
    sdb.holdSeat(store, { tenantId: t, courseId: "c1", runId, who, intentId: randomUUID(), fingerprint: "fp", settings, now: NOW, ...extra });

async function partition(t: string): Promise<Record<string, any>[]> {
    const out: Record<string, any>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
        const page = await doc.send(new QueryCommand({
            TableName: TABLE, KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": sdb.schedulingKeys.pk(t) },
            ExclusiveStartKey: start, ConsistentRead: true,
        }));
        out.push(...(page.Items ?? []));
        start = page.LastEvaluatedKey;
    } while (start !== undefined);
    return out;
}

const isResDayQuery = (q: any) => String(q.ExpressionAttributeValues?.[":lo"] ?? "").startsWith("RESDAY#");
const isRelease = (u: any) => u.UpdateExpression === "REMOVE #r";
const tokensOf = async (t: string, bookingId: string) => (await partition(t)).filter((i) => i.SK.startsWith("TOKEN#") && i.bookingId === bookingId);

describe.skipIf(!ENABLED)("sched-1c on the staging table (operator-run; skipped without SCHEDULING_TABLE_NAME)", () => {
    // ---- capacity, overlap, expiry, language, moves -------------------------------------------------------------

    rowTest("C1 — 20 parallel seat holds, 1 free seat: exactly 1 success, 19 runFull; active count = capacity", async (t, { store }) => {
        const { run } = await seedRun(store, t, 1);
        const results = await settleAll(Array.from({ length: 20 }, (_, i) => holdSeat(store, t, run.id, person(`v${i}@example.com`))));
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(results.filter((r) => !r.ok).map((r) => (r as any).error)).toEqual(Array(19).fill({ kind: "runFull", capacity: 1 }));
        expect(Object.keys((await sdb.getRun(store, t, "c1", run.id, true))!.seats)).toHaveLength(1);
        expect((await partition(t)).filter((i) => i.SK.startsWith("BOOKING#"))).toHaveLength(1);
    });

    rowTest("C2 — parallel slot holds 60 min at 09:00 and 30 min at 09:30, one resource: exactly 1 success, the other slotTaken", async (t, { store }) => {
        await seedSlots(store, t, [{ id: "svc60", durationMin: 60 }, { id: "svc30", durationMin: 30 }]);
        const [a, b] = await settleAll([
            holdSlot(store, t, MON_0900, person("a@example.com")),
            holdSlot(store, t, MON_0900 + 30 * MIN, person("b@example.com"), { serviceId: "svc30" }),
        ]);
        expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
        expect(a.ok ? b : a).toEqual({ ok: false, error: { kind: "slotTaken" } });
    });

    rowTest("C3 seat (a) — A's confirm (clock X − 2 s) commits first; B's hold (clock X + 2 s) → runFull", async (t, { store, on }) => {
        const { run } = await seedRun(store, t, 1);
        const A = must(await holdSeat(store, t, run.id, person("a@example.com"))).booking;
        const X = A.heldUntil!;
        on("TransactWriteCommand", "before", async () => { must(await sdb.confirmBooking(store, t, A.id, X - 2000)); });
        expect(await holdSeat(store, t, run.id, person("b@example.com"), { now: X + 2000 })).toEqual({ ok: false, error: { kind: "runFull", capacity: 1 } });
        expect(Object.keys((await sdb.getRun(store, t, "c1", run.id, true))!.seats)).toEqual([A.id]);
    });

    rowTest("C3 seat (b) — B's hold (clock X + 2 s) commits first, removing A; A's confirm (clock X − 2 s) → expired", async (t, { store, on }) => {
        const { run } = await seedRun(store, t, 1);
        const A = must(await holdSeat(store, t, run.id, person("a@example.com"))).booking;
        const X = A.heldUntil!;
        on("TransactWriteCommand", "before", async () => { must(await holdSeat(store, t, run.id, person("b@example.com"), { now: X + 2000 })); });
        expect(await sdb.confirmBooking(store, t, A.id, X - 2000)).toEqual({ ok: false, error: { kind: "expired", at: X } });
        expect(Object.keys((await sdb.getRun(store, t, "c1", run.id, true))!.seats)).toHaveLength(1);
    });

    rowTest("C3 slot (a) — A's confirm (clock X − 2 s) commits first; B's overlapping hold (clock X + 2 s) → slotTaken", async (t, { store, on }) => {
        const r = await seedSlots(store, t);
        const A = must(await holdSlot(store, t, MON_0900, person("a@example.com"))).booking;
        const X = A.heldUntil!;
        on("TransactWriteCommand", "before", async () => { must(await sdb.confirmBooking(store, t, A.id, X - 2000)); });
        expect(await holdSlot(store, t, MON_0900, person("b@example.com"), { now: X + 2000 })).toEqual({ ok: false, error: { kind: "slotTaken" } });
        const day = (await partition(t)).find((i) => i.SK === sdb.schedulingKeys.resDay(r, sdb.utcDate(MON_0900)))!;
        expect(Object.keys(day.entries)).toEqual([A.id]);
    });

    rowTest("C3 slot (b) — B's hold (clock X + 2 s) commits first, removing A; A's confirm (clock X − 2 s) → expired; one entry", async (t, { store, on }) => {
        const r = await seedSlots(store, t);
        const A = must(await holdSlot(store, t, MON_0900, person("a@example.com"))).booking;
        const X = A.heldUntil!;
        on("TransactWriteCommand", "before", async () => { must(await holdSlot(store, t, MON_0900, person("b@example.com"), { now: X + 2000 })); });
        expect(await sdb.confirmBooking(store, t, A.id, X - 2000)).toEqual({ ok: false, error: { kind: "expired", at: X } });
        const day = (await partition(t)).find((i) => i.SK === sdb.schedulingKeys.resDay(r, sdb.utcDate(MON_0900)))!;
        expect(Object.keys(day.entries)).toHaveLength(1);
        expect(Object.keys(day.entries)).not.toContain(A.id);
    });

    rowTest("C9 — two first enrolments ro / en on a notSet run: one wins; the other languageMismatch", async (t, { store }) => {
        const { run } = await seedRun(store, t, 8);
        const [ro, en] = await settleAll([holdSeat(store, t, run.id, person("ro@example.com", "ro")), holdSeat(store, t, run.id, person("en@example.com", "en"))]);
        expect([ro.ok, en.ok].filter(Boolean)).toHaveLength(1);
        expect((ro.ok ? en : ro) as any).toMatchObject({ ok: false, error: { kind: "languageMismatch" } });
    });

    rowTest("C10 — two admin moves of one booking at once with the same rev: one commits, the other stale", async (t, { store }) => {
        const { run, trainerId } = await seedRun(store, t, 8);
        const { run: run2 } = await seedRun(store, t, 8, trainerId);
        const b = must(await sdb.createManualSeat(store, { tenantId: t, courseId: "c1", runId: run.id, who: person("p@example.com"), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        const [m1, m2] = await settleAll([
            sdb.moveSeat(store, { tenantId: t, bookingId: b.id, runId: run2.id, actor: admin, cutoffHours: 24, now: NOW, expectedRev: b.rev }),
            sdb.moveSeat(store, { tenantId: t, bookingId: b.id, runId: null, actor: admin, cutoffHours: 24, now: NOW, expectedRev: b.rev }),
        ]);
        expect([m1, m2].filter((r) => r.ok)).toHaveLength(1);
        expect([m1, m2].find((r) => !r.ok)).toEqual({ ok: false, error: { kind: "stale" } });
    });

    // ---- C11: resource removal against inventory writes (§ 13) --------------------------------------------------

    rowTest("C11 (a) hold first — the hold commits; the removal → resourceInUse; the fence is released", async (t, { store }) => {
        const r = await seedSlots(store, t);
        must(await holdSlot(store, t, MON_0900, person("a@example.com")));
        expect(await sdb.removeResource(store, t, r, NOW)).toEqual({ ok: false, error: { kind: "resourceInUse", activeBookings: 1, runs: 0 } });
        expect((await sdb.getResource(store, t, r, true))!.retiring).toBeUndefined();
    });

    rowTest("C11 (a) fence first — the hold runs after the fence commits → resourceUnavailable; the removal completes", async (t, { store, on }) => {
        const r = await seedSlots(store, t);
        let hold: unknown;
        on("QueryCommand", "before", async () => { hold = await holdSlot(store, t, MON_0900, person("a@example.com")); }, isResDayQuery);
        expect(await sdb.removeResource(store, t, r, NOW)).toEqual({ ok: true, value: undefined });
        expect(hold).toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
        expect((await partition(t)).filter((i) => i.SK.startsWith("BOOKING#"))).toEqual([]);
    });

    rowTest("C11 (b) — a hold that read the resource before a removal that completes → resourceUnavailable", async (t, { store, on }) => {
        const r = await seedSlots(store, t);
        on("TransactWriteCommand", "before", async () => { must(await sdb.removeResource(store, t, r, NOW)); });
        expect(await holdSlot(store, t, MON_0900, person("a@example.com"))).toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
        expect((await partition(t)).filter((i) => i.SK.startsWith("BOOKING#") || i.SK.startsWith("RESOURCE#"))).toEqual([]);
    });

    rowTest("C11 (b) — a manual appointment that read the resource before a removal that completes → resourceUnavailable", async (t, { store, on }) => {
        const r = await seedSlots(store, t);
        on("TransactWriteCommand", "before", async () => { must(await sdb.removeResource(store, t, r, NOW)); });
        expect(await sdb.createManualAppointment(store, { tenantId: t, serviceId: "svc60", resourceId: r, start: MON_0900, who: person("m@example.com"), channel: "phone", adminEmail: admin.email, now: NOW }))
            .toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
        expect((await partition(t)).filter((i) => i.SK.startsWith("BOOKING#"))).toEqual([]);
    });

    rowTest("C11 (c) trainer change first — commits; the removal of the new trainer → resourceInUse", async (t, { store }) => {
        const { run } = await seedRun(store, t, 8);
        const r2 = (await sdb.createResource(store, t, "R2")).id;
        must(await sdb.updateRun(store, t, "c1", run.id, { trainerIds: [r2] }, NOW));
        expect(await sdb.removeResource(store, t, r2, NOW)).toMatchObject({ ok: false, error: { kind: "resourceInUse", runs: 1 } });
    });

    rowTest("C11 (c) removal first — completes before the trainer change commits → resourceUnavailable; trainers unchanged", async (t, { store, on }) => {
        const { run, trainerId } = await seedRun(store, t, 8);
        const r3 = (await sdb.createResource(store, t, "R3")).id;
        on("TransactWriteCommand", "before", async () => { must(await sdb.removeResource(store, t, r3, NOW)); });
        expect(await sdb.updateRun(store, t, "c1", run.id, { trainerIds: [r3] }, NOW)).toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
        expect((await sdb.getRun(store, t, "c1", run.id, true))!.trainerIds).toEqual([trainerId]);
    });

    rowTest("C11 (d) — two removal requests at once: one 204, the other resourceRemovalInProgress", async (t, { store }) => {
        const r = (await sdb.createResource(store, t, "R")).id;
        const results = await settleAll([sdb.removeResource(store, t, r, NOW), sdb.removeResource(store, t, r, NOW)]);
        expect(results.filter((x) => x.ok)).toHaveLength(1);
        expect(results.find((x) => !x.ok)).toEqual({ ok: false, error: { kind: "resourceRemovalInProgress" } });
    });

    rowTest("C11 (e) — an attempt crashed after acquire: +5 min → in progress; +11 min → takes over and completes", async (t, { store }) => {
        const r = (await sdb.createResource(store, t, "R")).id;
        await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: sdb.schedulingKeys.pk(t), SK: sdb.schedulingKeys.resource(r), id: r, name: "R", retiring: { attemptId: "crashed", at: NOW } } }));
        expect(await sdb.removeResource(store, t, r, NOW + 5 * MIN)).toEqual({ ok: false, error: { kind: "resourceRemovalInProgress" } });
        expect(await sdb.removeResource(store, t, r, NOW + 11 * MIN)).toEqual({ ok: true, value: undefined });
    });

    rowTest("C11 (f) — attempt A's release racing B's takeover: A's conditional step fails, B's fence stays", async (t, { store, on }) => {
        const r = await seedSlots(store, t);
        must(await holdSlot(store, t, MON_0900, person("a@example.com"))); // in use: A releases its fence
        on("UpdateCommand", "before", async () => {
            await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: sdb.schedulingKeys.pk(t), SK: sdb.schedulingKeys.resource(r), id: r, name: "Practitioner", retiring: { attemptId: "B", at: NOW + 11 * MIN } } }));
        }, isRelease);
        expect(await sdb.removeResource(store, t, r, NOW)).toEqual({ ok: false, error: { kind: "resourceRemovalInProgress" } });
        expect((await sdb.getResource(store, t, r, true))!.retiring).toEqual({ attemptId: "B", at: NOW + 11 * MIN });
    });

    const pastMeetings = () => [{ date: instantToLocal(NOW - 10 * DAY, TZ).date, start: "10:00", end: "12:00" }];

    rowTest("C11 (g) move first — an ended run moved to future dates; the removal of its trainer → resourceInUse", async (t, { store }) => {
        const { run, trainerId } = await seedRun(store, t, 8, undefined, pastMeetings(), NOW - 30 * DAY);
        must(await sdb.moveRun(store, t, "c1", run.id, [{ date: RUN_DATE, start: "10:00", end: "12:00" }], NOW));
        expect(await sdb.removeResource(store, t, trainerId, NOW)).toMatchObject({ ok: false, error: { kind: "resourceInUse", runs: 1 } });
    });

    rowTest("C11 (g) removal first — completes before the move commits → resourceUnavailable; meetings unchanged", async (t, { store, on }) => {
        const { run, trainerId } = await seedRun(store, t, 8, undefined, pastMeetings(), NOW - 30 * DAY);
        on("TransactWriteCommand", "before", async () => { must(await sdb.removeResource(store, t, trainerId, NOW)); });
        expect(await sdb.moveRun(store, t, "c1", run.id, [{ date: RUN_DATE, start: "10:00", end: "12:00" }], NOW)).toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
        expect((await sdb.getRun(store, t, "c1", run.id, true))!.meetings).toEqual(pastMeetings());
    });

    // ---- erasure, tokens ----------------------------------------------------------------------------------------

    rowTest("C13 — erasure while a hold for the same email commits after step 1: remaining 1; a second run → 0", async (t, { store, on }) => {
        const { run } = await seedRun(store, t, 8);
        must(await holdSeat(store, t, run.id, person("ana@example.com")));
        on("GetCommand", "before", async () => { must(await holdSeat(store, t, run.id, person("ana@example.com"))); }, (g) => g.Key.SK.startsWith("BOOKING#"));
        expect(must(await sdb.eraseCustomer(store, t, "ana@example.com", NOW))).toEqual({ removedBookings: 1, remainingBookings: 1 });
        expect(must(await sdb.eraseCustomer(store, t, "ana@example.com", NOW))).toEqual({ removedBookings: 1, remainingBookings: 0 });
    });

    rowTest("C14 / C15 — 21 link mails: first → 404, 21st → 200, 20 listed; cancel: every token → 404", async (t, { store }) => {
        await seedSlots(store, t);
        const { booking: b, token: first } = must(await holdSlot(store, t, MON_0900, person("a@example.com")));
        let last = first;
        for (let i = 0; i < 20; i++) last = must(await sdb.mintToken(store, t, b.id, NOW, { countForEmail: false })).token;
        expect(await sdb.getBookingByToken(store, t, first, true)).toBeUndefined();
        expect((await sdb.getBookingByToken(store, t, last, true))?.tokenHashes).toHaveLength(20);
        must(await sdb.cancelBooking(store, { tenantId: t, bookingId: b.id, actor: customer, cutoffHours: 24, now: NOW }));
        expect(await sdb.getBookingByToken(store, t, last, true)).toBeUndefined();
        expect((await partition(t)).filter((i) => i.SK.startsWith("TOKEN#"))).toEqual([]);
    });

    const mintOnce = (store: sdb.SchedulingStore, t: string, id: string) => sdb.mintToken(store, t, id, NOW, { countForEmail: false });

    rowTest("C21 mint first — the mint commits between the confirm's read and write; confirmed; both tokens listed and open it", async (t, { store, on }) => {
        await seedSlots(store, t);
        const { booking: b, token: first } = must(await holdSlot(store, t, MON_0900, person("a@example.com")));
        let second = "";
        on("TransactWriteCommand", "before", async () => { second = must(await mintOnce(store, t, b.id)).token; });
        must(await sdb.confirmBooking(store, t, b.id, NOW));
        expect((await sdb.getBooking(store, t, b.id, true))!).toMatchObject({ state: { kind: "confirmed" } });
        expect((await sdb.getBookingByToken(store, t, first, true))?.tokenHashes).toHaveLength(2);
        expect((await sdb.getBookingByToken(store, t, second, true))?.id).toBe(b.id);
    });

    rowTest("C21 confirm first — the confirm commits between the mint's read and write; confirmed; both tokens listed and open it", async (t, { store, on }) => {
        await seedSlots(store, t);
        const { booking: b, token: first } = must(await holdSlot(store, t, MON_0900, person("a@example.com")));
        on("TransactWriteCommand", "before", async () => { must(await sdb.confirmBooking(store, t, b.id, NOW)); });
        const second = must(await mintOnce(store, t, b.id)).token;
        expect((await sdb.getBooking(store, t, b.id, true))!).toMatchObject({ state: { kind: "confirmed" } });
        expect((await sdb.getBookingByToken(store, t, first, true))?.tokenHashes).toHaveLength(2);
        expect((await sdb.getBookingByToken(store, t, second, true))?.id).toBe(b.id);
    });

    rowTest("C22 mint first — the mint commits inside the cancel's window; the cancel re-reads and deletes both tokens", async (t, { store, on }) => {
        await seedSlots(store, t);
        const { booking: b } = must(await holdSlot(store, t, MON_0900, person("a@example.com")));
        on("TransactWriteCommand", "before", async () => { must(await mintOnce(store, t, b.id)); });
        must(await sdb.cancelBooking(store, { tenantId: t, bookingId: b.id, actor: customer, cutoffHours: 24, now: NOW }));
        expect(await tokensOf(t, b.id)).toEqual([]);
        expect((await sdb.getBooking(store, t, b.id, true))!.tokenHashes).toEqual([]);
    });

    rowTest("C22 cancel first — the cancel commits inside the mint's window; the mint → linkNotIssued; no token", async (t, { store, on }) => {
        await seedSlots(store, t);
        const { booking: b } = must(await holdSlot(store, t, MON_0900, person("a@example.com")));
        on("TransactWriteCommand", "before", async () => { must(await sdb.cancelBooking(store, { tenantId: t, bookingId: b.id, actor: customer, cutoffHours: 24, now: NOW })); });
        expect(await mintOnce(store, t, b.id)).toEqual({ ok: false, error: { kind: "linkNotIssued" } });
        expect(await tokensOf(t, b.id)).toEqual([]);
        expect((await sdb.getBooking(store, t, b.id, true))!.tokenHashes).toEqual([]);
    });

    rowTest("C23 mint first — the mint commits inside the erasure's window; the erasure re-reads and removes every token", async (t, { store, on }) => {
        await seedSlots(store, t);
        const { booking: b } = must(await holdSlot(store, t, MON_0900, person("a@example.com")));
        on("TransactWriteCommand", "before", async () => { must(await mintOnce(store, t, b.id)); });
        expect(must(await sdb.eraseCustomer(store, t, "a@example.com", NOW))).toEqual({ removedBookings: 1, remainingBookings: 0 });
        expect(await tokensOf(t, b.id)).toEqual([]);
    });

    rowTest("C23 erase first — the erasure commits inside the mint's window; the mint → linkNotIssued; no token", async (t, { store, on }) => {
        await seedSlots(store, t);
        const { booking: b } = must(await holdSlot(store, t, MON_0900, person("a@example.com")));
        on("TransactWriteCommand", "before", async () => { must(await sdb.eraseCustomer(store, t, "a@example.com", NOW)); });
        expect(await mintOnce(store, t, b.id)).toEqual({ ok: false, error: { kind: "linkNotIssued" } });
        expect(await tokensOf(t, b.id)).toEqual([]);
    });

    rowTest("C27 — two erasures of one email at once: both 200; total removed = bookings that existed; read-back 0", async (t, { store }) => {
        const r = await seedSlots(store, t);
        must(await holdSlot(store, t, MON_0900, person("ana@example.com")));
        must(await sdb.createManualAppointment(store, { tenantId: t, serviceId: "svc60", resourceId: r, start: MON_0900 + HOUR, who: person("ana@example.com"), channel: "phone", adminEmail: admin.email, now: NOW }));
        const [a, b] = await settleAll([sdb.eraseCustomer(store, t, "ana@example.com", NOW), sdb.eraseCustomer(store, t, "ana@example.com", NOW)]);
        expect(must(a).removedBookings + must(b).removedBookings).toBe(2);
        expect([must(a).remainingBookings, must(b).remainingBookings]).toEqual([0, 0]);
    });

    rowTest("C29 — daily cleanup on the real table: the 8-day hold removed, the confirmed kept; a second run changes nothing", async (t, { store }) => {
        await seedSlots(store, t);
        const old = must(await holdSlot(store, t, MON_0900, person("o@example.com"))).booking;
        const conf = must(await holdSlot(store, t, MON_0900 + HOUR, person("c@example.com"))).booking;
        must(await sdb.confirmBooking(store, t, conf.id, NOW));
        const at8 = old.heldUntil! + 8 * DAY;
        expect(await sdb.cleanupExpiredHolds(store, t, at8)).toEqual({ removed: 1, skipped: 0, busy: 0 });
        expect(await sdb.getBooking(store, t, old.id, true)).toBeUndefined();
        expect(await sdb.getBooking(store, t, conf.id, true)).toBeDefined();
        expect(await sdb.cleanupExpiredHolds(store, t, at8 + MIN)).toEqual({ removed: 0, skipped: 0, busy: 0 });
    });

    // ---- § 23: DAYS#, WEEKMAIL# ---------------------------------------------------------------------------------

    const today = () => instantToLocal(NOW, TZ).date;
    const dateAhead = (days: number) => instantToLocal(NOW + days * DAY, TZ).date;
    const dayOff = (date: string) => ({ kind: "set" as const, from: date, to: date, value: { kind: "dayOff" as const } });
    const isDaysPut = (r: string) => (p: any) => p.Item?.SK === sdb.schedulingKeys.days(r);

    rowTest("C31 first edit — the item is created with attribute_not_exists(SK), v = 1", async (t, { store }) => {
        const r = await seedSlots(store, t);
        must(await sdb.editResourceDays(store, t, r, dayOff(dateAhead(20)), today()));
        expect((await partition(t)).find((i) => i.SK === sdb.schedulingKeys.days(r))).toMatchObject({ v: 1 });
    });

    rowTest("C31 different dates at once — both stored (the loser re-reads and re-applies)", async (t, { store }) => {
        const r = await seedSlots(store, t);
        const results = await settleAll([
            sdb.editResourceDays(store, t, r, dayOff(dateAhead(20)), today()),
            sdb.editResourceDays(store, t, r, dayOff(dateAhead(21)), today()),
        ]);
        expect(results.every((x) => x.ok)).toBe(true);
        expect(Object.keys(await sdb.getDays(store, t, r, true)).sort()).toEqual([dateAhead(20), dateAhead(21)].sort());
    });

    rowTest("C31 same date — the value of the write that commits last", async (t, { store, on }) => {
        const r = await seedSlots(store, t);
        const d = dateAhead(20);
        on("PutCommand", "before", async () => {
            must(await sdb.editResourceDays(store, t, r, { kind: "set", from: d, to: d, value: { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] } }, today()));
        }, isDaysPut(r));
        must(await sdb.editResourceDays(store, t, r, dayOff(d), today()));
        expect((await sdb.getDays(store, t, r, true))[d]).toEqual({ kind: "dayOff" });
    });

    rowTest("C31 three at once — the condition lost twice → busy; nothing of that edit stored", async (t, { store, on }) => {
        const r = await seedSlots(store, t);
        on("PutCommand", "before", async () => {
            must(await sdb.editResourceDays(store, t, r, dayOff(dateAhead(21)), today()));
            on("PutCommand", "before", async () => { must(await sdb.editResourceDays(store, t, r, dayOff(dateAhead(22)), today())); }, isDaysPut(r));
        }, isDaysPut(r));
        expect(await sdb.editResourceDays(store, t, r, dayOff(dateAhead(20)), today())).toEqual({ ok: false, error: { kind: "busy" } });
        expect(Object.keys(await sdb.getDays(store, t, r, true)).sort()).toEqual([dateAhead(21), dateAhead(22)].sort());
    });

    rowTest("C34 sequential — claim, second claim (claimedAt kept), after sentAt → stop; ttl = weekStart + 14 days", async (t, { store }) => {
        const W = MONDAY;
        expect(await sdb.claimWeekMail(store, t, W, NOW)).toEqual({ alreadySent: false });
        expect(await sdb.claimWeekMail(store, t, W, NOW + MIN)).toEqual({ alreadySent: false });
        await sdb.markWeekMailSent(store, t, W, NOW + 2 * MIN);
        expect(await sdb.claimWeekMail(store, t, W, NOW + 3 * MIN)).toEqual({ alreadySent: true });
        const item = (await partition(t)).find((i) => i.SK === `WEEKMAIL#${W}`)!;
        expect(item.claimedAt).toBe(NOW);
        expect(item.ttl).toBe(Math.floor((Date.parse(`${W}T00:00:00.000Z`) + 14 * DAY) / 1000));
    });

    rowTest("C34 two claims at once — both return without sentAt (the documented duplicate case); one claimedAt kept", async (t, { store }) => {
        const W = MONDAY;
        const results = await settleAll([sdb.claimWeekMail(store, t, W, NOW), sdb.claimWeekMail(store, t, W, NOW + 1)]);
        expect(results).toEqual([{ alreadySent: false }, { alreadySent: false }]);
        expect([NOW, NOW + 1]).toContain((await partition(t)).find((i) => i.SK === `WEEKMAIL#${W}`)!.claimedAt);
    });

    // ---- C35: entry rev in persistence ---------------------------------------------------------------------------

    rowTest("C35 (1) (2) (4) — entry rev = BOOKING#.rev after hold / confirm / moves (two copies across UTC midnight) / manual; unchanged by a mint and a reminder mark; malformed rev refused", async (t, { store }) => {
        const r = await seedSlots(store, t);
        const copies = async (id: string) => (await partition(t)).filter((i) => i.SK.startsWith("RESDAY#") && i.entries[id]).map((i) => i.entries[id]);
        const check = async (id: string, expectedCopies: number) => {
            const rev = (await sdb.getBooking(store, t, id, true))!.rev;
            const list = await copies(id);
            expect(list).toHaveLength(expectedCopies);
            for (const e of list) expect(e.rev).toBe(rev);
        };
        const { booking: b } = must(await holdSlot(store, t, MON_0900, person("a@example.com")));
        await check(b.id, 1);
        must(await sdb.confirmBooking(store, t, b.id, NOW));
        await check(b.id, 1);
        must(await sdb.moveSlot(store, { tenantId: t, bookingId: b.id, start: MON_0900 + HOUR, resourceIds: [r], actor: admin, settings, now: NOW }));
        await check(b.id, 1); // same day
        must(await sdb.moveSlot(store, { tenantId: t, bookingId: b.id, start: MON_0900 + DAY, resourceIds: [r], actor: admin, settings, now: NOW }));
        await check(b.id, 1); // another day
        const acrossUtcMidnight = Date.parse(`${instantToLocal(MON_0900 + DAY, TZ).date}T23:30:00.000Z`); // 23:30Z-00:30Z
        must(await sdb.moveSlot(store, { tenantId: t, bookingId: b.id, start: acrossUtcMidnight, resourceIds: [r], actor: admin, settings, now: NOW }));
        await check(b.id, 2); // both UTC-day copies, both at BOOKING#.rev
        const before = JSON.stringify(await copies(b.id));
        must(await sdb.mintToken(store, t, b.id, NOW, { countForEmail: false }));
        expect(await sdb.markReminder(store, t, b.id, { kind: "slot", start: acrossUtcMidnight })).toEqual({ kind: "marked" });
        expect(JSON.stringify(await copies(b.id))).toBe(before);
        expect((await copies(b.id))[0].rev).toBeLessThan((await sdb.getBooking(store, t, b.id, true))!.rev);
        const m = must(await sdb.createManualAppointment(store, { tenantId: t, serviceId: "svc60", resourceId: r, start: MON_0900, who: person("m@example.com"), channel: "phone", adminEmail: admin.email, now: NOW })).booking;
        await check(m.id, 1);

        const span = { start: MON_0900 - HOUR, end: MON_0900 + 2 * HOUR };
        for (const rev of [undefined, 0, 1.5]) {
            await doc.send(new PutCommand({ TableName: TABLE, Item: { PK: sdb.schedulingKeys.pk(t), SK: sdb.schedulingKeys.resDay("rX", sdb.utcDate(MON_0900)), v: 1,
                entries: { b1: { s: MON_0900, e: MON_0900 + HOUR, ...(rev !== undefined ? { rev } : {}) } } } }));
            await expect(sdb.readIntervals(store, t, "rX", span, NOW)).rejects.toBeInstanceOf(sdb.StoredDataInvalidError);
        }
    });
});
