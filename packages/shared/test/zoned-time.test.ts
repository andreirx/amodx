import { describe, it, expect } from "vitest";
import { localToInstant, instantToLocal, localDaySpan } from "../src/index.js";
import { localToInstantOrGapEnd, isLocalDate, isLocalTime, isTimeZone, addDays, daysBetween, isoWeekday } from "../src/zoned-time.js";

/**
 * SCHED-1A (docs/slices/sched-1.md § 5.1, § 17.3 row A2) — wall time ↔ instant on the platform `Intl` zone data.
 * Pure: the zone is a parameter; no clock is read. Worked zone: Europe/Bucharest (UTC+2 winter, UTC+3 summer;
 * 2026-10-25 04:00 summer → 03:00; 2027-03-28 03:00 winter → 04:00).
 */

const TZ = "Europe/Bucharest";
const iso = (ms: number) => new Date(ms).toISOString();
const at = (s: string) => Date.parse(s);

describe("localToInstant (§ 5.1)", () => {
    it("A2 2027-03-29 09:00 Bucharest (summer) → 06:00Z", () => {
        const r = localToInstant("2027-03-29", "09:00", TZ);
        expect(r).toEqual({ ok: true, value: at("2027-03-29T06:00:00.000Z") });
    });

    it("A2 2027-03-28 03:30 Bucharest (spring gap) → nonexistentLocalTime", () => {
        expect(localToInstant("2027-03-28", "03:30", TZ)).toEqual({ ok: false, error: { kind: "nonexistentLocalTime" } });
    });

    it("A2 2026-10-25 03:30 Bucharest (ambiguous, autumn) → the earlier instant 00:30Z, not 01:30Z", () => {
        expect(localToInstant("2026-10-25", "03:30", TZ)).toEqual({ ok: true, value: at("2026-10-25T00:30:00.000Z") });
    });

    it("A2 (§ 5.1 first example) 2026-12-07 09:00 Bucharest (winter) → 07:00Z", () => {
        expect(localToInstant("2026-12-07", "09:00", TZ)).toEqual({ ok: true, value: at("2026-12-07T07:00:00.000Z") });
    });
});

describe("instantToLocal and the local day (§ 5.1, § 5.5)", () => {
    it("reads the wall clock of the zone, seconds dropped", () => {
        expect(instantToLocal(at("2026-12-06T21:59:30.000Z"), TZ)).toEqual({ date: "2026-12-06", time: "23:59" });
        expect(instantToLocal(at("2026-10-25T00:30:00.000Z"), TZ)).toEqual({ date: "2026-10-25", time: "03:30" });
        expect(instantToLocal(at("2026-10-25T01:30:00.000Z"), TZ)).toEqual({ date: "2026-10-25", time: "03:30" });
    });

    it("a time in a spring gap moves to the end of the gap (§ 5.5 window bound rule)", () => {
        expect(iso(localToInstantOrGapEnd("2027-03-28", "03:30", TZ))).toBe("2027-03-28T01:00:00.000Z");
        expect(iso(localToInstantOrGapEnd("2027-03-28", "03:00", TZ))).toBe("2027-03-28T01:00:00.000Z");
        expect(iso(localToInstantOrGapEnd("2027-03-28", "04:00", TZ))).toBe("2027-03-28T01:00:00.000Z");
        // A whole skipped local day (Samoa, 2011-12-30): its midnight moves to the next local midnight.
        expect(iso(localToInstantOrGapEnd("2011-12-30", "00:00", "Pacific/Apia"))).toBe("2011-12-30T10:00:00.000Z");
    });

    it("localDaySpan is [local midnight, next local midnight); 23 h on the spring day, 25 h on the autumn day", () => {
        expect(localDaySpan("2026-12-07", TZ)).toEqual({ start: at("2026-12-06T22:00:00.000Z"), end: at("2026-12-07T22:00:00.000Z") });
        const spring = localDaySpan("2027-03-28", TZ);
        expect((spring.end - spring.start) / 3_600_000).toBe(23);
        const autumn = localDaySpan("2026-10-25", TZ);
        expect((autumn.end - autumn.start) / 3_600_000).toBe(25);
    });
});

describe("calendar helpers", () => {
    it("validates dates, times and zones", () => {
        expect(["2026-12-07", "2028-02-29"].every(isLocalDate)).toBe(true);
        expect(["2026-13-01", "2026-12-7", "2026-02-30", "2027-02-29", "tomorrow", ""].some(isLocalDate)).toBe(false);
        expect(["00:00", "09:05", "23:59"].every(isLocalTime)).toBe(true);
        expect(["24:00", "9:00", "09:60", "09:00:00"].some(isLocalTime)).toBe(false);
        expect(isTimeZone(TZ)).toBe(true);
        expect(isTimeZone("Mars/Olympus")).toBe(false);
    });

    it("adds days across months and years; ISO weekday Monday 1 … Sunday 7", () => {
        expect(addDays("2026-12-01", 56)).toBe("2027-01-26");
        expect(addDays("2026-12-01", -7)).toBe("2026-11-24");
        expect(daysBetween("2026-12-24", "2026-12-27")).toBe(3);
        expect(isoWeekday("2026-12-07")).toBe(1);
        expect(isoWeekday("2026-12-13")).toBe(7);
    });
});
