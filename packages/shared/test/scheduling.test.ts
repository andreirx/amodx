import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    TenantConfigSchema, SchedulingSettingsSchema,
    PersonSchema, ServiceSchema, DayOverrideSchema, DayOverridesSchema, HistoryEntrySchema, BookingSchema,
    availableSlots, slotDecision, overlapCheck, pickResource,
    isActive, holdExpiry, confirmDecision, changeDecision, tokenView, appendHistory, bookingBase,
    dayWindows, lastBookableDate, activeEntries, planDay, editDays, weekMailDue, localDaySpan,
    type AvailabilityRule, type Booking, type ContainerEntry, type DayOverride, type DayOverrides, type HistoryEntry,
    type Resource, type Service,
} from "../src/index.js";

/**
 * SCHED-1A (docs/slices/sched-1.md § 4, § 5; evidence rows § 17.3 table `sched-1a`). Every test whose name starts
 * with a row id (`A1 `, `A3 ` …) binds that row. Pure: the clock and the zone are parameters. Row A2 is in
 * `zoned-time.test.ts`. Row A14 runs the TypeScript compiler on a temporary copy of the kernel (OS temp dir,
 * deleted after the test).
 *
 * Worked zone: Europe/Bucharest, UTC+2 in winter. 2026-12-07 is a Monday.
 */

const TZ = "Europe/Bucharest";
const at = (s: string) => Date.parse(s);
const iso = (ms: number) => new Date(ms).toISOString();

const svc60: Service = { id: "s60", name: "Consult", durationMin: 60, eligibility: { kind: "all" } };
const r1: Resource = { id: "r1", name: "Dr. One" };
const mon0912: AvailabilityRule = { weekday: 1, start: "09:00", end: "12:00" };
const mon0917: AvailabilityRule = { weekday: 1, start: "09:00", end: "17:00" };
const FAR = "2027-12-31";

function entry(bookingId: string, s: string, e: string, rev: number, x?: string): ContainerEntry {
    return { bookingId, s: at(s), e: at(e), rev, ...(x !== undefined ? { x: at(x) } : {}) };
}

const created: HistoryEntry = {
    action: "created", at: at("2026-12-01T10:00:00.000Z"), state: "held",
    placement: { kind: "slot", resourceId: "r1", start: at("2026-12-07T07:00:00.000Z"), end: at("2026-12-07T08:00:00.000Z") },
};

function booking(over: Partial<Booking> = {}): Booking {
    return {
        id: "1a2b3c4d-0000-4000-8000-000000000001", ref: "B-1A2B3C4D", rev: 2,
        what: { kind: "slot", serviceId: "s60", serviceName: "Consult", resourceId: "r1", start: at("2026-12-07T07:00:00.000Z"), end: at("2026-12-07T08:00:00.000Z") },
        state: { kind: "confirmed", at: at("2026-12-01T10:05:00.000Z") },
        source: { kind: "visitor" },
        who: { email: "ann@example.test", name: "Ann" },
        tokenHashes: ["a".repeat(64)],
        createdAt: at("2026-12-01T10:00:00.000Z"), updatedAt: at("2026-12-01T10:05:00.000Z"),
        history: [created, { action: "confirmed", at: at("2026-12-01T10:05:00.000Z") }],
        ...over,
    };
}

/** Field paths of every issue of a failed parse, joined with "." (e.g. "windows.0.end"). */
function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
    expect(result.success).toBe(false);
    return (result.error?.issues ?? []).map((i) => i.path.map(String).join("."));
}

// ---------------------------------------------------------------------------------------------------------------
// Tenant settings regression (packet rule: a tenant without the new fields parses exactly as at HEAD)
// ---------------------------------------------------------------------------------------------------------------

describe("TenantConfig scheduling fields (§ 4.1)", () => {
    const fixture = {
        id: "atelier", domain: "atelier.example", name: "Atelier", plan: "Pro", createdAt: "2026-01-01T00:00:00.000Z",
        commerceEnabled: true, currency: "RON", countryCode: "RO", locale: "ro-RO",
        integrations: { contactEmail: "office@atelier.example" }, status: "LIVE",
    };
    // `TenantConfigSchema.parse(fixture)` at HEAD 1ca757c (before SCHED-1A), captured from a separate worktree.
    const PARSED_AT_HEAD = JSON.parse('{"id":"atelier","domain":"atelier.example","name":"Atelier","header":{"showLogo":true,"showTitle":true,"navHeight":"h-16","navHeightScrolled":"h-12","logoHeight":"h-12","logoHeightScrolled":"h-8","titleSize":"text-xl","titleSizeScrolled":"text-lg","contentMaxWidth":"max-w-7xl","contentPageMaxWidth":"max-w-4xl"},"gdpr":{"position":"bottom","enabled":true},"hideSocialSharing":false,"schemaType":"Organization","navLinks":[],"footerLinks":[],"commerceEnabled":true,"catalogMode":false,"askBirthdayOnAccount":true,"askBirthdayOnCheckout":true,"urlPrefixes":{"product":"/product","category":"/category","cart":"/cart","checkout":"/checkout","shop":"/shop","account":"/account","search":"/search","interest":"/my-list","checkoutConfirmation":"/confirmation"},"topBar":{"show":false},"commerceBar":{"enabled":false,"socialLinks":[],"height":"h-10","fontSize":"text-sm","iconSize":"h-5 w-5"},"searchBar":{"enabled":false,"placeholder":"Search products..."},"pageEffect":{"type":"none","colors":[],"speed":0.5,"timeOffset":0,"intensity":0.1,"invertY":false,"overlayOpacity":0.85},"celebrationEnabled":false,"recaptcha":{"enabled":false,"threshold":0.5},"orderEmailConfig":{"templates":{}},"enabledPaymentMethods":["cash_on_delivery"],"currency":"RON","countryCode":"RO","locale":"ro-RO","commerceStrings":{},"companyDetails":{},"legalLinks":{},"status":"LIVE","plan":"Pro","theme":{"mode":"light","primaryColor":"#000000","primaryForeground":"#ffffff","secondaryColor":"#ffffff","secondaryForeground":"#000000","backgroundColor":"#ffffff","surfaceColor":"#f4f4f5","textColor":"#020817","fontHeading":"Prata","fontBody":"Lato","radius":"0.5rem"},"integrations":{"contactEmail":"office@atelier.example","paddle":{"environment":"sandbox"},"analytics":{"provider":"none"},"mailerlite":false,"perplexity":false},"createdAt":"2026-01-01T00:00:00.000Z"}');

    it("an existing tenant without scheduling fields parses deep-equal to its parse at HEAD (no key added)", () => {
        const parsed = TenantConfigSchema.parse(fixture);
        expect(parsed).toStrictEqual(PARSED_AT_HEAD);
        expect(Object.hasOwn(parsed, "schedulingEnabled") || Object.hasOwn(parsed, "scheduling") || Object.hasOwn(parsed, "schedulingEmailConfig")).toBe(false);
    });

    it("a tenant with scheduling fields keeps them; the scheduling object fills its own defaults", () => {
        const parsed = TenantConfigSchema.parse({
            ...fixture, schedulingEnabled: true, scheduling: { timezone: TZ },
            schedulingEmailConfig: { templates: { weekAhead: { subject: "Your week", body: "{{summary}}", sendToAdmin: false } } },
        });
        expect(parsed.schedulingEnabled).toBe(true);
        expect(parsed.scheduling).toEqual({ timezone: TZ, holdMinutes: 30, changeCutoffHours: 24, reminderHours: 24, bookingHorizonWeeks: 8 });
        expect(parsed.schedulingEmailConfig?.templates.weekAhead).toEqual({ subject: "Your week", body: "{{summary}}", sendToAdmin: false });
        expect(TenantConfigSchema.safeParse({ ...fixture, scheduling: { timezone: "Mars/Olympus" } }).success).toBe(false);
        expect(TenantConfigSchema.safeParse({ ...fixture, schedulingEmailConfig: { templates: { other: { subject: "s", body: "b" } } } }).success).toBe(false);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Appointment shape (§ 5.2)
// ---------------------------------------------------------------------------------------------------------------

describe("availableSlots (§ 5.2)", () => {
    it("A1 60 min, Monday 09:00-12:00, 2026-12-07, busy 08:00Z-09:00Z, now 2026-12-01 → 07:00Z, 09:00Z", () => {
        const r = availableSlots({
            service: svc60, resources: [r1], rules: { r1: [mon0912] }, days: {},
            busy: [{ resourceId: "r1", start: at("2026-12-07T08:00:00.000Z"), end: at("2026-12-07T09:00:00.000Z") }],
            from: "2026-12-07", to: "2026-12-07", lastBookableDate: FAR, tz: TZ, now: at("2026-12-01T00:00:00.000Z"),
        });
        expect(r).toEqual({ ok: true, value: [{ day: "2026-12-07", starts: [
            { start: at("2026-12-07T07:00:00.000Z"), freeResourceIds: ["r1"] },
            { start: at("2026-12-07T09:00:00.000Z"), freeResourceIds: ["r1"] },
        ] }] });
    });

    it("range errors: inverted; more than 62 days", () => {
        const base = { service: svc60, resources: [r1], rules: { r1: [mon0912] }, days: {}, busy: [], lastBookableDate: FAR, tz: TZ, now: 0 };
        expect(availableSlots({ ...base, from: "2026-12-08", to: "2026-12-07" })).toEqual({ ok: false, error: { kind: "rangeInverted" } });
        expect(availableSlots({ ...base, from: "2026-12-01", to: "2027-01-31" }).ok).toBe(true); // 62 days
        expect(availableSlots({ ...base, from: "2026-12-01", to: "2027-02-01" })).toEqual({ ok: false, error: { kind: "rangeTooLong", maxDays: 62 } });
    });

    it("lists free resources per start in string order; a fenced or ineligible resource offers nothing; starts not after now are dropped", () => {
        const r2: Resource = { id: "r2", name: "Dr. Two" };
        const r0: Resource = { id: "r0", name: "Dr. Zero", retiring: { attemptId: "a", at: 0 } };
        const only = { ...svc60, eligibility: { kind: "only" as const, resourceIds: ["r2", "r1"] as [string, ...string[]] } };
        const r3: Resource = { id: "r3", name: "Dr. Three" };
        const r = availableSlots({
            service: only, resources: [r3, r2, r1, r0], rules: { r0: [mon0912], r1: [mon0912], r2: [mon0912], r3: [mon0912] }, days: {},
            busy: [{ resourceId: "r1", start: at("2026-12-07T07:00:00.000Z"), end: at("2026-12-07T08:00:00.000Z") }],
            from: "2026-12-07", to: "2026-12-07", lastBookableDate: FAR, tz: TZ, now: at("2026-12-07T07:00:00.000Z"),
        });
        expect(r.ok && r.value[0].starts).toEqual([
            { start: at("2026-12-07T08:00:00.000Z"), freeResourceIds: ["r1", "r2"] },
            { start: at("2026-12-07T09:00:00.000Z"), freeResourceIds: ["r1", "r2"] },
        ]);
    });
});

describe("slotDecision (§ 5.2)", () => {
    const base = {
        service: svc60, resource: r1, rules: [mon0912], days: {} as DayOverrides,
        lastBookableDate: "2027-01-26", tz: TZ, now: at("2026-12-01T10:00:00.000Z"),
    };

    it("accepts a start the grid offers and returns its end", () => {
        expect(slotDecision({ ...base, start: at("2026-12-07T07:00:00.000Z") })).toEqual({ ok: true, value: { end: at("2026-12-07T08:00:00.000Z") } });
    });

    it("A3 past → inPast", () => {
        expect(slotDecision({ ...base, start: at("2026-11-30T07:00:00.000Z") })).toEqual({ ok: false, error: { kind: "inPast" } });
    });

    it("A3 beyond the horizon → beyondHorizon(lastBookableDate)", () => {
        expect(slotDecision({ ...base, start: at("2027-01-27T07:00:00.000Z") })).toEqual({ ok: false, error: { kind: "beyondHorizon", lastBookableDate: "2027-01-26" } });
    });

    it("A3 off grid → notOnGrid", () => {
        expect(slotDecision({ ...base, start: at("2026-12-07T07:30:00.000Z") })).toEqual({ ok: false, error: { kind: "notOnGrid" } });
    });

    it("A3 ineligible resource → notEligible", () => {
        const only = { ...svc60, eligibility: { kind: "only" as const, resourceIds: ["r2"] as [string, ...string[]] } };
        expect(slotDecision({ ...base, service: only, start: at("2026-12-07T07:00:00.000Z") })).toEqual({ ok: false, error: { kind: "notEligible" } });
    });

    it("A3 outside every window → outsideAvailability", () => {
        expect(slotDecision({ ...base, start: at("2026-12-07T13:00:00.000Z") })).toEqual({ ok: false, error: { kind: "outsideAvailability" } });
    });

    it("A3 on a dayOff date → outsideAvailability", () => {
        const days: DayOverrides = { "2026-12-07": { kind: "dayOff" } };
        expect(slotDecision({ ...base, days, start: at("2026-12-07T07:00:00.000Z") })).toEqual({ ok: false, error: { kind: "outsideAvailability" } });
    });

    it("A3 in the part a dayHours edit removed → outsideAvailability", () => {
        const days: DayOverrides = { "2026-12-07": { kind: "dayHours", windows: [{ start: "09:00", end: "10:00" }, { start: "11:00", end: "12:00" }] } };
        expect(slotDecision({ ...base, days, start: at("2026-12-07T08:00:00.000Z") })).toEqual({ ok: false, error: { kind: "outsideAvailability" } });
    });

    it("A3 resource fenced (retiring present) → resourceUnavailable", () => {
        const fenced: Resource = { ...r1, retiring: { attemptId: "A", at: at("2026-12-01T09:00:00.000Z") } };
        expect(slotDecision({ ...base, resource: fenced, start: at("2026-12-07T07:00:00.000Z") })).toEqual({ ok: false, error: { kind: "resourceUnavailable" } });
    });
});

describe("overlapCheck and pickResource (§ 5.2)", () => {
    const A = entry("A", "2026-12-07T07:00:00.000Z", "2026-12-07T08:00:00.000Z", 1, "2026-12-01T10:00:00.000Z");
    const candidate = { start: at("2026-12-07T07:30:00.000Z"), end: at("2026-12-07T08:00:00.000Z") };

    it("A4 a held entry before its x overlaps → overlap(A)", () => {
        expect(overlapCheck(candidate, [A], at("2026-12-01T09:59:00.000Z"))).toEqual({ ok: false, error: { kind: "overlap", bookingId: "A" } });
    });

    it("A4 the same held entry at its x (expired) → ok", () => {
        expect(overlapCheck(candidate, [A], at("2026-12-01T10:00:00.000Z"))).toEqual({ ok: true, value: undefined });
    });

    it("ignores `self`, and touching intervals do not overlap (half-open)", () => {
        expect(overlapCheck(candidate, [A], at("2026-12-01T09:00:00.000Z"), "A").ok).toBe(true);
        expect(overlapCheck({ start: A.e, end: A.e + 3_600_000 }, [A], at("2026-12-01T09:00:00.000Z")).ok).toBe(true);
    });

    it("pickResource takes the lowest id in string order", () => {
        expect(pickResource(["r2", "r10", "r1"])).toBe("r1");
        expect(() => pickResource([])).toThrow(RangeError);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Common rules (§ 5.3)
// ---------------------------------------------------------------------------------------------------------------

describe("changeDecision (§ 5.3)", () => {
    const cutoff = at("2026-12-06T07:00:00.000Z"); // start 2026-12-07T07:00Z − 24 h

    it("A9 customer cancel at cutoff − 1 ms → ok; at cutoff → tooLate(cutoff)", () => {
        expect(changeDecision(booking(), cutoff - 1, 24, "cancel", "customer")).toEqual({ ok: true, value: undefined });
        expect(changeDecision(booking(), cutoff, 24, "cancel", "customer")).toEqual({ ok: false, error: { kind: "tooLate", cutoff } });
    });

    it("A9 customer move of a held booking → notConfirmed", () => {
        const b = booking({ state: { kind: "held", expiresAt: at("2026-12-01T10:30:00.000Z"), mail: "sent" } });
        expect(changeDecision(b, at("2026-12-01T10:00:00.000Z"), 24, "move", "customer")).toEqual({ ok: false, error: { kind: "notConfirmed" } });
        expect(changeDecision(b, at("2026-12-01T10:00:00.000Z"), 24, "cancel", "customer").ok).toBe(true);
    });

    it("admin has no window", () => {
        expect(changeDecision(booking(), at("2026-12-07T06:00:00.000Z"), 24, "move", "admin").ok).toBe(true);
    });

    it("not active → notActive for every actor (cancelled; held and expired)", () => {
        const cancelled = booking({ state: { kind: "cancelled", at: 1, by: { kind: "customer" } } });
        expect(changeDecision(cancelled, 2, 24, "cancel", "admin")).toEqual({ ok: false, error: { kind: "notActive", state: "cancelled" } });
        const expired = booking({ state: { kind: "held", expiresAt: 5, mail: "sent" } });
        expect(changeDecision(expired, 5, 24, "cancel", "customer")).toEqual({ ok: false, error: { kind: "notActive", state: "expired" } });
    });
});

describe("confirmDecision (§ 5.3)", () => {
    const held = booking({ state: { kind: "held", expiresAt: at("2026-12-01T10:30:00.000Z"), mail: "sent" } });

    it("A10 confirm before expiresAt → apply; at expiresAt → expired(at)", () => {
        expect(confirmDecision(held, at("2026-12-01T10:29:00.000Z"))).toEqual({ ok: true, value: "apply" });
        expect(confirmDecision(held, at("2026-12-01T10:30:00.000Z"))).toEqual({ ok: false, error: { kind: "expired", at: at("2026-12-01T10:30:00.000Z") } });
    });

    it("A10 confirmed again → noop; cancelled → cancelled", () => {
        expect(confirmDecision(booking(), at("2026-12-01T10:29:00.000Z"))).toEqual({ ok: true, value: "noop" });
        expect(confirmDecision(booking({ state: { kind: "cancelled", at: 1, by: { kind: "customer" } } }), 2)).toEqual({ ok: false, error: { kind: "cancelled" } });
    });
});

describe("tokenView, isActive, holdExpiry (§ 5.3)", () => {
    it("token view: valid until the slot end + 30 days; cancelled → gone", () => {
        expect(tokenView(booking(), at("2027-01-06T07:59:59.999Z"))).toBe("valid");
        expect(tokenView(booking(), at("2027-01-06T08:00:00.000Z"))).toBe("gone");
        expect(tokenView(booking({ state: { kind: "cancelled", at: 1, by: { kind: "customer" } } }), 2)).toBe("gone");
    });

    it("isActive: held before expiry or confirmed; holdExpiry = now + holdMinutes", () => {
        expect(isActive({ kind: "held", expiresAt: 10, mail: "pending" }, 9)).toBe(true);
        expect(isActive({ kind: "held", expiresAt: 10, mail: "pending" }, 10)).toBe(false);
        expect(isActive({ kind: "confirmed", at: 1 }, 99)).toBe(true);
        expect(isActive({ kind: "cancelled", at: 1, by: { kind: "admin", email: "a@b.test" } }, 2)).toBe(false);
        expect(holdExpiry(at("2026-12-01T10:00:00.000Z"), 30)).toBe(at("2026-12-01T10:30:00.000Z"));
    });
});

describe("bookingBase (§ 5.3)", () => {
    const origin = "https://d1.cloudfront.net";

    it("A13 x.example → https://x.example", () => {
        expect(bookingBase({ id: "x", domain: "x.example" }, origin)).toBe("https://x.example");
    });

    it("A13 x.localhost → the preview base", () => {
        expect(bookingBase({ id: "atelier", domain: "atelier.localhost" }, origin)).toBe("https://d1.cloudfront.net/_site/atelier");
    });

    it("A13 domain absent → the preview base", () => {
        expect(bookingBase({ id: "x" }, origin)).toBe("https://d1.cloudfront.net/_site/x");
    });
});

// ---------------------------------------------------------------------------------------------------------------
// A14: exhaustiveness is enforced by the compiler (a temporary copy, compiled with tsc --strict, then deleted)
// ---------------------------------------------------------------------------------------------------------------

describe("A14 exhaustive switches (compile errors in a temporary copy)", () => {
    const shared = fileURLToPath(new URL("..", import.meta.url));
    const repo = join(shared, "..", "..");
    const tsc = join(repo, "node_modules", "typescript", "bin", "tsc");

    /** Compiles a mutated copy of the kernel; returns the sorted names of the functions that hold an error. */
    function errorSites(mutate: (source: string) => string): string[] {
        const dir = mkdtempSync(join(tmpdir(), "SCHED-1A-a14-"));
        try {
            for (const f of ["scheduling.ts", "zoned-time.ts", "normalizeEmail.ts"]) cpSync(join(shared, "src", f), join(dir, f));
            symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"), "dir");
            const file = join(dir, "scheduling.ts");
            const source = mutate(readFileSync(file, "utf8"));
            writeFileSync(file, source);
            let output = "";
            try {
                execFileSync(process.execPath, [tsc, "--noEmit", "--strict", "--target", "ES2022", "--module", "ESNext",
                    "--moduleResolution", "Bundler", "--skipLibCheck", file], { encoding: "utf8", cwd: dir });
            } catch (e) {
                output = String((e as { stdout?: string }).stdout ?? "");
            }
            const lines = source.split("\n");
            const sites = new Set<string>();
            for (const match of output.matchAll(/([\w.-]+\.ts)\((\d+),\d+\): error TS\d+/g)) {
                if (match[1] !== "scheduling.ts") { sites.add(`other file ${match[1]}`); continue; }
                let name = "(top level)";
                for (let i = Number(match[2]) - 1; i >= 0; i--) {
                    const fn = /function (\w+)/.exec(lines[i]);
                    if (fn) { name = fn[1]; break; }
                }
                sites.add(name);
            }
            return [...sites].sort();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    function insertAfter(anchor: string, addition: string) {
        return (source: string) => {
            expect(source.split(anchor).length - 1).toBe(1); // the anchor exists exactly once: the mutation is real
            return source.replace(anchor, anchor + addition);
        };
    }

    it("A14 the unchanged copy compiles with no error (the method is sound)", () => {
        expect(errorSites((s) => s)).toEqual([]);
    }, 120_000);

    it("A14 a second BookingWhat variant → errors where the kernel reads the slot's start and end", () => {
        // SCHED-GROUPS-REMOVE-1: BookingWhat has one shape (a plain object); a mutation that makes it a union again breaks
        // every kernel read of `what.start` / `what.end`.
        const slot = 'z.object({\n    kind: z.literal("slot"), serviceId: IdSchema, serviceName: NameSchema, resourceId: IdSchema, start: InstantSchema, end: InstantSchema,\n})';
        expect(errorSites((source) => {
            expect(source.split(`BookingWhatSchema = ${slot};`).length - 1).toBe(1); // the mutation is real
            return source.replace(`BookingWhatSchema = ${slot};`,
                `BookingWhatSchema = z.discriminatedUnion("kind", [${slot}, z.object({ kind: z.literal("waitlisted"), serviceId: IdSchema })]);`);
        })).toEqual(["changeDecision", "tokenView"]);
    }, 120_000);

    it("A14 a third DayOverride kind → errors at the three switches over DayOverride (DaySetting includes it)", () => {
        expect(errorSites(insertAfter(
            "[DayOffSchema, DayHoursSchema",
            ', z.object({ kind: z.literal("dayAway"), note: NoteSchema.optional() })',
        ))).toEqual(["applySetting", "dayWindows", "sameOverride"]);
    }, 120_000);

    it("A14 a fifth HistoryEntry action → no error: sched-1a has no switch over HistoryEntry (recorded difference)", () => {
        expect(errorSites(insertAfter(
            'z.object({ action: z.literal("confirmed"), at: InstantSchema }),',
            '\n    z.object({ action: z.literal("noted"), at: InstantSchema }),',
        ))).toEqual([]);
    }, 120_000);

    // Review R2: every policy decision on a closed union dispatches by switch + assertNever, so these also break.
    function replaceEvery(anchor: string, replacement: string) {
        return (source: string) => {
            expect(source.split(anchor).length - 1).toBeGreaterThan(0);
            return source.split(anchor).join(replacement);
        };
    }

    it("exhaustiveness (review R2): a new BookingSource variant → error in changeDecision", () => {
        expect(errorSites(insertAfter(
            'z.object({ kind: z.literal("visitor") }),',
            '\n    z.object({ kind: z.literal("gift") }),',
        ))).toEqual(["changeDecision"]);
    }, 120_000);

    it("exhaustiveness (review R2): a new change action → error in actionAllowed", () => {
        expect(errorSites(replaceEvery('"cancel" | "move"', '"cancel" | "move" | "rebook"'))).toEqual(["actionAllowed"]);
    }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Review R1: on a clock-change day a slot must fit the window in elapsed time, not in wall minutes
// ---------------------------------------------------------------------------------------------------------------

describe("Clock-change days: slot containment on instants (review R1)", () => {
    const sun = (start: string, end: string): AvailabilityRule => ({ weekday: 7, start, end });
    const svc = (durationMin: number): Service => ({ ...svc60, id: `s${durationMin}`, durationMin });
    const window0230to0430: DayOverride = { kind: "dayHours", windows: [{ start: "02:30", end: "04:30" }] };
    const sources = (date: string) => [
        { label: "weekly default", rules: [sun("02:30", "04:30")], days: {} as DayOverrides },
        { label: "dayHours override", rules: [] as AvailabilityRule[], days: { [date]: window0230to0430 } as DayOverrides },
    ];
    const slots = (date: string, s: { rules: AvailabilityRule[]; days: DayOverrides }, durationMin: number) => {
        const r = availableSlots({ service: svc(durationMin), resources: [r1], rules: { r1: s.rules }, days: { r1: s.days }, busy: [],
            from: date, to: date, lastBookableDate: FAR, tz: TZ, now: at("2026-10-01T00:00:00.000Z") });
        if (!r.ok) throw new Error("expected ok");
        return r.value[0].starts.map((x) => iso(x.start));
    };
    const decide = (s: { rules: AvailabilityRule[]; days: DayOverrides }, durationMin: number, start: string) =>
        slotDecision({ service: svc(durationMin), resource: r1, rules: s.rules, days: s.days, start: at(start),
            lastBookableDate: FAR, tz: TZ, now: at("2026-10-01T00:00:00.000Z") });

    for (const s of sources("2027-03-28")) {
        it(`spring 2027-03-28, ${s.label} 02:30-04:30 (one elapsed hour): a 120-minute slot from 02:30 (on the grid) is not offered and is refused outsideAvailability`, () => {
            expect(slots("2027-03-28", s, 120)).toEqual([]);
            expect(decide(s, 120, "2027-03-28T00:30:00.000Z")).toEqual({ ok: false, error: { kind: "outsideAvailability" } });
        });

        it(`spring 2027-03-28, ${s.label}: a 60-minute slot 02:30 fits (00:30Z-01:30Z) and planDay does not list it outside hours`, () => {
            expect(slots("2027-03-28", s, 60)).toEqual(["2027-03-28T00:30:00.000Z"]); // 03:30 is in the gap
            expect(decide(s, 60, "2027-03-28T00:30:00.000Z")).toEqual({ ok: true, value: { end: at("2027-03-28T01:30:00.000Z") } });
            const now = at("2027-03-20T00:00:00.000Z");
            const raw = [entry("S", "2027-03-28T00:30:00.000Z", "2027-03-28T01:30:00.000Z", 1)];
            const p = planDay({ rules: s.rules, days: s.days, date: "2027-03-28", entries: activeEntries(raw, localDaySpan("2027-03-28", TZ), now), tz: TZ, now });
            expect(p.kind === "planned" && p.outsideHours).toEqual([]);
        });
    }

    // Review R4: the same classification on an ordinary day (no clock change): grid membership and fit are separate.
    const mondaySources = [
        { label: "weekly default", rules: [mon0912], days: {} as DayOverrides },
        { label: "dayHours override", rules: [] as AvailabilityRule[], days: { "2026-12-07": { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] } } as DayOverrides },
    ];
    for (const s of mondaySources) {
        it(`ordinary day 2026-12-07, ${s.label} 09:00-12:00, 120 minutes: 11:00 is on the grid but overruns 12:00 → outsideAvailability; 09:30 is off the grid → notOnGrid; 09:00 fits`, () => {
            expect(decide(s, 120, "2026-12-07T09:00:00.000Z")).toEqual({ ok: false, error: { kind: "outsideAvailability" } });
            expect(decide(s, 120, "2026-12-07T07:30:00.000Z")).toEqual({ ok: false, error: { kind: "notOnGrid" } });
            expect(decide(s, 120, "2026-12-07T07:00:00.000Z")).toEqual({ ok: true, value: { end: at("2026-12-07T09:00:00.000Z") } });
            expect(slots("2026-12-07", s, 120)).toEqual(["2026-12-07T07:00:00.000Z"]);
        });
    }

    for (const s of sources("2026-10-25")) {
        it(`autumn 2026-10-25, ${s.label} 02:30-04:30 (three elapsed hours): a 180-minute slot from 02:30 fits and is offered and accepted`, () => {
            expect(slots("2026-10-25", s, 180)).toEqual(["2026-10-24T23:30:00.000Z"]);
            expect(decide(s, 180, "2026-10-24T23:30:00.000Z")).toEqual({ ok: true, value: { end: at("2026-10-25T02:30:00.000Z") } });
            expect(slots("2026-10-25", s, 240)).toEqual([]);
        });

        it(`autumn 2026-10-25, ${s.label}: the ambiguous 03:30 grid point is the earlier instant (00:30Z)`, () => {
            expect(slots("2026-10-25", s, 60)).toEqual(["2026-10-24T23:30:00.000Z", "2026-10-25T00:30:00.000Z"]);
        });
    }
});

// ---------------------------------------------------------------------------------------------------------------
// Zod schemas (§ 4; field evidence inventory § 17.3)
// ---------------------------------------------------------------------------------------------------------------

describe("Zod: person, service (§ 4)", () => {
    it("A15 email valid only after normalization → accepted in normalized form", () => {
        // Fullwidth at sign U+FF20: refused by `.email()` raw, valid after NFKC (normalizeEmail's pinned case).
        const parsed = PersonSchema.parse({ email: "  Ann＠Example.TEST ", name: "Ann" });
        expect(parsed.email).toBe("ann@example.test");
        expect(PersonSchema.safeParse({ email: "not an email", name: "Ann" }).success).toBe(false);
    });

    it("A15 duration 7 refused", () => {
        expect(issuePaths(ServiceSchema.safeParse({ ...svc60, durationMin: 7 }))).toContain("durationMin");
        expect(ServiceSchema.safeParse({ ...svc60, durationMin: 485 }).success).toBe(false);
    });
});

describe("Week planner precedence (§ 5.5)", () => {
    const hours = (...w: [string, string][]): DayOverride => ({ kind: "dayHours", windows: w.map(([start, end]) => ({ start, end })) as [{ start: string; end: string }, ...{ start: string; end: string }[]] });

    it("A16 dayWindows: Monday dayHours; Monday without override; Sunday dayHours with no Sunday default; Monday dayOff", () => {
        expect(dayWindows([mon0917], hours(["09:00", "12:00"]), "2026-12-07")).toEqual({ source: "dayHours", windows: [{ start: "09:00", end: "12:00" }] });
        expect(dayWindows([mon0917], undefined, "2026-12-14")).toEqual({ source: "default", windows: [{ start: "09:00", end: "17:00" }] });
        expect(dayWindows([mon0917], hours(["10:00", "12:00"]), "2026-12-13")).toEqual({ source: "dayHours", windows: [{ start: "10:00", end: "12:00" }] });
        expect(dayWindows([mon0917], { kind: "dayOff" }, "2026-12-07")).toEqual({ source: "dayOff", windows: [] });
    });

    it("A16 availableSlots over these days: starts only inside the effective windows", () => {
        const days: DayOverrides = { "2026-12-07": hours(["09:00", "12:00"]), "2026-12-13": hours(["10:00", "12:00"]), "2026-12-21": { kind: "dayOff" } };
        const r = availableSlots({ service: svc60, resources: [r1], rules: { r1: [mon0917] }, days: { r1: days }, busy: [],
            from: "2026-12-07", to: "2026-12-21", lastBookableDate: FAR, tz: TZ, now: at("2026-12-01T00:00:00.000Z") });
        if (!r.ok) throw new Error("expected ok");
        const startsOf = (day: string) => r.value.find((d) => d.day === day)!.starts.map((s) => iso(s.start).slice(11, 16));
        expect(startsOf("2026-12-07")).toEqual(["07:00", "08:00", "09:00"]);
        expect(startsOf("2026-12-13")).toEqual(["08:00", "09:00"]);
        expect(startsOf("2026-12-14")).toEqual(["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00"]);
        expect(startsOf("2026-12-21")).toEqual([]);
        expect(startsOf("2026-12-08")).toEqual([]);
        expect(r.value).toHaveLength(15);
    });

    it("A16 § 5.2 example: Monday 09:00-12:00 with override dayHours [09:00-10:00, 11:00-12:00] → 07:00Z, 09:00Z; dayOff → none", () => {
        const run1 = (o: DayOverride) => availableSlots({ service: svc60, resources: [r1], rules: { r1: [mon0912] }, days: { r1: { "2026-12-07": o } }, busy: [],
            from: "2026-12-07", to: "2026-12-07", lastBookableDate: FAR, tz: TZ, now: at("2026-12-01T00:00:00.000Z") });
        const a = run1(hours(["09:00", "10:00"], ["11:00", "12:00"]));
        expect(a.ok && a.value[0].starts.map((s) => s.start)).toEqual([at("2026-12-07T07:00:00.000Z"), at("2026-12-07T09:00:00.000Z")]);
        const b = run1({ kind: "dayOff" });
        expect(b.ok && b.value[0].starts).toEqual([]);
    });
});

describe("Booking horizon (§ 5.5)", () => {
    const now = at("2026-12-01T10:00:00.000Z");

    it("A17 lastBookableDate(2026-12-01T10:00Z, 8 weeks) → 2027-01-26", () => {
        expect(lastBookableDate(now, TZ, 8)).toBe("2027-01-26");
    });

    it("A17 availableSlots with `to` after it: the later days are present with no starts", () => {
        const every: AvailabilityRule[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday: weekday as AvailabilityRule["weekday"], start: "09:00", end: "12:00" }));
        const r = availableSlots({ service: svc60, resources: [r1], rules: { r1: every }, days: {}, busy: [],
            from: "2027-01-25", to: "2027-01-28", lastBookableDate: lastBookableDate(now, TZ, 8), tz: TZ, now });
        if (!r.ok) throw new Error("expected ok");
        expect(r.value.map((d) => [d.day, d.starts.length])).toEqual([["2027-01-25", 3], ["2027-01-26", 3], ["2027-01-27", 0], ["2027-01-28", 0]]);
    });

    it("A17 slotDecision on 2027-01-26 23:00 local → allowed; 2027-01-27 09:00 local → beyondHorizon(2027-01-26)", () => {
        const svc30: Service = { ...svc60, id: "s30", durationMin: 30 };
        const rules: AvailabilityRule[] = [{ weekday: 2, start: "22:00", end: "23:30" }, { weekday: 3, start: "09:00", end: "12:00" }];
        const base = { service: svc30, resource: r1, rules, days: {}, lastBookableDate: lastBookableDate(now, TZ, 8), tz: TZ, now };
        expect(slotDecision({ ...base, start: at("2027-01-26T21:00:00.000Z") })).toEqual({ ok: true, value: { end: at("2027-01-26T21:30:00.000Z") } });
        expect(slotDecision({ ...base, start: at("2027-01-27T07:00:00.000Z") })).toEqual({ ok: false, error: { kind: "beyondHorizon", lastBookableDate: "2027-01-26" } });
    });
});

describe("planDay (§ 5.5)", () => {
    const days: DayOverrides = { "2026-12-07": hours2(["09:00", "12:00"], ["13:00", "17:00"]) };
    function hours2(...w: [string, string][]): DayOverride {
        return { kind: "dayHours", windows: w.map(([start, end]) => ({ start, end })) as [{ start: string; end: string }, ...{ start: string; end: string }[]] };
    }

    it("A18 § 5.5 example: removed [12:00-13:00], outsideHours [id], open 07:00Z-10:00Z and 11:00Z-15:00Z", () => {
        const now = at("2026-12-01T12:00:00.000Z");
        const raw = [entry("B1", "2026-12-07T10:00:00.000Z", "2026-12-07T11:00:00.000Z", 2)];
        const p = planDay({ rules: [mon0917], days, date: "2026-12-07", entries: activeEntries(raw, localDaySpan("2026-12-07", TZ), now), tz: TZ, now });
        expect(p).toEqual({
            kind: "planned", date: "2026-12-07", source: "dayHours",
            windows: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
            removed: [{ start: "12:00", end: "13:00" }], entries: ["B1"], outsideHours: ["B1"],
            open: [{ start: at("2026-12-07T07:00:00.000Z"), end: at("2026-12-07T10:00:00.000Z") }, { start: at("2026-12-07T11:00:00.000Z"), end: at("2026-12-07T15:00:00.000Z") }],
        });
    });

    it("A18 a held entry after its x on that day neither cuts open nor appears in outsideHours", () => {
        const now = at("2026-12-01T12:00:00.000Z");
        const raw = [
            entry("B1", "2026-12-07T10:00:00.000Z", "2026-12-07T11:00:00.000Z", 2),
            entry("E1", "2026-12-07T07:00:00.000Z", "2026-12-07T08:00:00.000Z", 1, "2026-12-01T11:00:00.000Z"), // inside a window
            entry("E2", "2026-12-07T10:15:00.000Z", "2026-12-07T10:45:00.000Z", 1, "2026-12-01T11:00:00.000Z"), // outside hours
        ];
        const p = planDay({ rules: [mon0917], days, date: "2026-12-07", entries: activeEntries(raw, localDaySpan("2026-12-07", TZ), now), tz: TZ, now });
        if (p.kind !== "planned") throw new Error("expected planned");
        expect(p.entries).toEqual(["B1"]);
        expect(p.outsideHours).toEqual(["B1"]);
        expect(p.open[0]).toEqual({ start: at("2026-12-07T07:00:00.000Z"), end: at("2026-12-07T10:00:00.000Z") });
    });

    it("A18 a date before today − 6 → kind past with the entry ids only", () => {
        const now = at("2026-12-20T10:00:00.000Z");
        const raw = [entry("B1", "2026-12-07T10:00:00.000Z", "2026-12-07T11:00:00.000Z", 2)];
        expect(planDay({ rules: [mon0917], days, date: "2026-12-07", entries: raw, tz: TZ, now })).toEqual({ kind: "past", date: "2026-12-07", entries: ["B1"] });
        expect(planDay({ rules: [mon0917], days, date: "2026-12-14", entries: [], tz: TZ, now }).kind).toBe("planned"); // today − 6
    });

    it("A18 a window bound inside the 2027-03-28 spring gap (dayHours [03:30-06:00]) starts at 04:00 local (01:00Z)", () => {
        const p = planDay({ rules: [], days: { "2027-03-28": hours2(["03:30", "06:00"]) }, date: "2027-03-28", entries: [], tz: TZ, now: at("2027-03-20T10:00:00.000Z") });
        if (p.kind !== "planned") throw new Error("expected planned");
        expect(p.open).toEqual([{ start: at("2027-03-28T01:00:00.000Z"), end: at("2027-03-28T03:00:00.000Z") }]);
        expect(p.removed).toEqual([]); // no Sunday default
    });

    it("a dayOff removes every default window; note is carried", () => {
        const p = planDay({ rules: [mon0917], days: { "2026-12-07": { kind: "dayOff", note: "sick" } }, date: "2026-12-07", entries: [], tz: TZ, now: at("2026-12-01T00:00:00.000Z") });
        expect(p).toMatchObject({ kind: "planned", source: "dayOff", windows: [], removed: [{ start: "09:00", end: "17:00" }], note: "sick", open: [] });
    });
});

describe("activeEntries (§ 5.5)", () => {
    const now = at("2026-12-01T12:00:00.000Z");
    const day7 = localDaySpan("2026-12-07", TZ);

    it("A25 (a) the 01:30-02:30 local booking given twice (UTC dates 12-06 and 12-07), both rev 3 → one entry", () => {
        const copy = () => entry("A", "2026-12-06T23:30:00.000Z", "2026-12-07T00:30:00.000Z", 3);
        expect(activeEntries([copy(), copy()], day7, now)).toEqual([copy()]);
    });

    it("A25 (b) local 2026-12-07 23:30 - 2026-12-08 00:30 with 2026-12-08 dayOff → in entries of both days, outsideHours of 2026-12-08 (and of 12-07)", () => {
        const raw = [entry("M", "2026-12-07T21:30:00.000Z", "2026-12-07T22:30:00.000Z", 1)];
        const rules: AvailabilityRule[] = [mon0917, { weekday: 2, start: "09:00", end: "17:00" }];
        const days: DayOverrides = { "2026-12-08": { kind: "dayOff" } };
        const plan = (date: string) => planDay({ rules, days, date, entries: activeEntries(raw, localDaySpan(date, TZ), now), tz: TZ, now });
        const d7 = plan("2026-12-07");
        const d8 = plan("2026-12-08");
        if (d7.kind !== "planned" || d8.kind !== "planned") throw new Error("expected planned");
        expect([d7.entries, d8.entries]).toEqual([["M"], ["M"]]);
        expect(d8.outsideHours).toEqual(["M"]);
        expect(d7.outsideHours).toEqual(["M"]); // 23:30-24:00 is outside 09:00-17:00
    });

    it("A25 (c) two copies of one booking, rev 3 held and rev 4 confirmed → only the rev 4 copy", () => {
        const held = entry("A", "2026-12-07T07:00:00.000Z", "2026-12-07T08:00:00.000Z", 3, "2026-12-01T12:30:00.000Z");
        const confirmed = entry("A", "2026-12-07T07:00:00.000Z", "2026-12-07T08:00:00.000Z", 4);
        expect(activeEntries([held, confirmed], day7, now)).toEqual([confirmed]);
        expect(activeEntries([confirmed, held], day7, now)).toEqual([confirmed]);
    });

    it("A25 (d) a move seen half-way: old placement rev 5 in day A, new placement rev 6 in day B → only the new placement", () => {
        const old = entry("A", "2026-12-07T07:00:00.000Z", "2026-12-07T08:00:00.000Z", 5);
        const moved = entry("A", "2026-12-08T07:00:00.000Z", "2026-12-08T08:00:00.000Z", 6);
        const span = { start: day7.start, end: localDaySpan("2026-12-08", TZ).end };
        expect(activeEntries([old, moved], span, now)).toEqual([moved]);
        expect(activeEntries([old, moved], day7, now)).toEqual([]); // the newest copy is not in day A: the booking left it
    });

    it("A25 (e) overlapping A and B; B seen at rev 2 (held) and rev 3 (confirmed during the read); A twice at rev 7 → no error, A once, B once at rev 3", () => {
        const A1 = entry("A", "2026-12-07T21:30:00.000Z", "2026-12-07T22:30:00.000Z", 7);
        const A2 = entry("A", "2026-12-07T21:30:00.000Z", "2026-12-07T22:30:00.000Z", 7);
        const Bheld = entry("B", "2026-12-07T21:00:00.000Z", "2026-12-07T22:15:00.000Z", 2, "2026-12-01T12:30:00.000Z");
        const Bconf = entry("B", "2026-12-07T21:00:00.000Z", "2026-12-07T22:15:00.000Z", 3);
        const span = { start: day7.start, end: localDaySpan("2026-12-08", TZ).end };
        expect(activeEntries([A1, Bheld, A2, Bconf], span, now)).toEqual([A1, Bconf]);
    });

    it("A25 (f) one active copy and one expired copy of another booking → the expired one is dropped", () => {
        const X = entry("X", "2026-12-07T07:00:00.000Z", "2026-12-07T08:00:00.000Z", 1);
        const Y = entry("Y", "2026-12-07T09:00:00.000Z", "2026-12-07T10:00:00.000Z", 1, "2026-12-01T11:00:00.000Z");
        expect(activeEntries([X, Y], day7, now)).toEqual([X]);
    });
});

describe("editDays (§ 5.5)", () => {
    const today = "2026-12-01";
    const off: DayOverride = { kind: "dayOff" };
    const morning: DayOverride = { kind: "dayHours", windows: [{ start: "09:00", end: "12:00" }] };

    it("A19 set 2026-12-24…2026-12-27 dayOff → 4 keys, changed = those 4", () => {
        expect(editDays({}, { kind: "set", from: "2026-12-24", to: "2026-12-27", value: off }, today))
            .toEqual({ ok: true, value: { next: { "2026-12-24": off, "2026-12-25": off, "2026-12-26": off, "2026-12-27": off }, changed: ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27"] } });
    });

    it("A19 value default on a date with an override → the key removed", () => {
        expect(editDays({ "2026-12-24": off }, { kind: "set", from: "2026-12-24", to: "2026-12-24", value: { kind: "default" } }, today))
            .toEqual({ ok: true, value: { next: {}, changed: ["2026-12-24"] } });
    });

    it("A19 from > to → rangeInverted; 367 dates → rangeTooLong(366); from = yesterday → startsInPast(today)", () => {
        expect(editDays({}, { kind: "set", from: "2026-12-05", to: "2026-12-04", value: off }, today)).toEqual({ ok: false, error: { kind: "rangeInverted" } });
        expect(editDays({}, { kind: "set", from: "2026-12-01", to: "2027-12-02", value: off }, today)).toEqual({ ok: false, error: { kind: "rangeTooLong", maxDays: 366 } });
        expect(editDays({}, { kind: "set", from: "2026-12-01", to: "2027-12-01", value: off }, today).ok).toBe(true); // 366 dates
        expect(editDays({}, { kind: "set", from: "2026-11-30", to: "2026-12-02", value: off }, today)).toEqual({ ok: false, error: { kind: "startsInPast", today } });
    });

    it("A19 a result with 367 keys → tooManyDays(366)", () => {
        const full: DayOverrides = {};
        for (let i = 0; i < 366; i++) full[new Date(Date.UTC(2026, 11, 1 + i)).toISOString().slice(0, 10)] = off;
        expect(editDays(full, { kind: "set", from: "2027-12-05", to: "2027-12-05", value: off }, today)).toEqual({ ok: false, error: { kind: "tooManyDays", max: 366 } });
    });

    it("A19 keys at today − 7 and today − 6: the first pruned and not in changed, the second kept", () => {
        const r = editDays({ "2026-11-24": off, "2026-11-25": morning }, { kind: "set", from: "2026-12-24", to: "2026-12-24", value: off }, today);
        expect(r).toEqual({ ok: true, value: { next: { "2026-11-25": morning, "2026-12-24": off }, changed: ["2026-12-24"] } });
    });

    it("A20 copyWeek § 5.5 example: Mon 2026-12-07 dayHours [09:00-12:00] → Mondays 14, 21, 28; the other 18 target dates lose any override", () => {
        const current: DayOverrides = { "2026-12-07": morning, "2026-12-16": off, "2026-12-25": off, "2027-01-04": off };
        const r = editDays(current, { kind: "copyWeek", sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 3 }, today);
        expect(r).toEqual({ ok: true, value: {
            next: { "2026-12-07": morning, "2026-12-14": morning, "2026-12-21": morning, "2026-12-28": morning, "2027-01-04": off },
            changed: ["2026-12-14", "2026-12-16", "2026-12-21", "2026-12-25", "2026-12-28"],
        } });
    });

    it("A20 a Tuesday source with a Monday target → weekdayMismatch", () => {
        expect(editDays({}, { kind: "copyWeek", sourceStart: "2026-12-08", targetStart: "2026-12-14", weeks: 1 }, today)).toEqual({ ok: false, error: { kind: "weekdayMismatch" } });
    });

    it("A20 target week = source week → targetOverlapsSource", () => {
        expect(editDays({}, { kind: "copyWeek", sourceStart: "2026-12-07", targetStart: "2026-12-07", weeks: 1 }, today)).toEqual({ ok: false, error: { kind: "targetOverlapsSource" } });
    });

    it("A20 sourceStart = today − 7 → sourceTooOld(today − 6)", () => {
        expect(editDays({}, { kind: "copyWeek", sourceStart: "2026-11-24", targetStart: "2026-12-08", weeks: 1 }, today)).toEqual({ ok: false, error: { kind: "sourceTooOld", oldest: "2026-11-25" } });
    });

    it("A20 targetStart = yesterday → startsInPast(today)", () => {
        expect(editDays({}, { kind: "copyWeek", sourceStart: "2026-12-07", targetStart: "2026-11-30", weeks: 1 }, today)).toEqual({ ok: false, error: { kind: "startsInPast", today } });
    });

    it("copyWeek.weeks outside 1-52 breaks the precondition (the request schema refuses it) and throws", () => {
        expect(() => editDays({}, { kind: "copyWeek", sourceStart: "2026-12-07", targetStart: "2026-12-14", weeks: 53 }, today)).toThrow(RangeError);
    });
});

describe("weekMailDue (§ 5.5)", () => {
    const due = (s: string) => weekMailDue(at(s), TZ);

    it("A21 2026-12-06T06:59Z (Sun 08:59 local) → notDue", () => expect(due("2026-12-06T06:59:00.000Z")).toEqual({ kind: "notDue" }));
    it("A21 2026-12-06T07:00Z (Sun 09:00 local) → due 2026-12-07", () => expect(due("2026-12-06T07:00:00.000Z")).toEqual({ kind: "due", weekStart: "2026-12-07" }));
    it("A21 2026-12-06T21:59Z (Sun 23:59 local) → due 2026-12-07", () => expect(due("2026-12-06T21:59:00.000Z")).toEqual({ kind: "due", weekStart: "2026-12-07" }));
    it("A21 2026-12-06T22:00Z (Mon 00:00 local) → notDue", () => expect(due("2026-12-06T22:00:00.000Z")).toEqual({ kind: "notDue" }));
    it("A21 2026-12-05T23:00Z (Sun 01:00 local) → notDue", () => expect(due("2026-12-05T23:00:00.000Z")).toEqual({ kind: "notDue" }));
    it("A21 a Monday 10:00 local (2026-12-07T08:00Z) → notDue", () => expect(due("2026-12-07T08:00:00.000Z")).toEqual({ kind: "notDue" }));
});

describe("Zod DayOverride (§ 4.2; evidence taxonomy)", () => {
    const w = (start: string, end: string) => ({ start, end });

    it("A22 absent: no key for a date → the date follows the defaults", () => {
        const days = DayOverridesSchema.parse({});
        expect(dayWindows([mon0917], days["2026-12-07"], "2026-12-07")).toEqual({ source: "default", windows: [w("09:00", "17:00")] });
    });

    it("A22 valid: dayOff; dayOff with a 200-character note; dayHours with 1 and with 8 windows", () => {
        const eight = ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"].map((s) => w(s, s.replace(":00", ":30")));
        for (const v of [{ kind: "dayOff" }, { kind: "dayOff", note: "x".repeat(200) }, { kind: "dayHours", windows: [w("09:00", "12:00")] }, { kind: "dayHours", windows: eight }]) {
            expect(DayOverrideSchema.safeParse(v).success).toBe(true);
        }
    });

    it("A22 malformed values are refused with an issue that names the field", () => {
        const nine = Array.from({ length: 9 }, (_, i) => w(`0${i}:00`, `0${i}:30`));
        const cases: [unknown, string][] = [
            [{ kind: "dayHours", windows: [] }, "windows"],
            [{ kind: "dayHours", windows: nine }, "windows"],
            [{ kind: "dayHours", windows: [w("12:00", "09:00")] }, "windows.0.end"],
            [{ kind: "dayHours", windows: [w("12:00", "12:00")] }, "windows.0.end"],
            [{ kind: "dayHours", windows: [w("09:00", "12:00"), w("11:00", "13:00")] }, "windows.1.start"],
            [{ kind: "dayHours", windows: [w("09:03", "12:00")] }, "windows.0.start"],
            [{ kind: "dayHours", windows: [w("13:00", "15:00"), w("09:00", "12:00")] }, "windows.1.start"],
            [{ kind: "dayOff", note: "x".repeat(201) }, "note"],
            [{ kind: "closed" }, "kind"],
        ];
        for (const [value, field] of cases) expect(issuePaths(DayOverrideSchema.safeParse(value))).toContain(field);
    });

    it("A22 map keys 2026-13-01, 2026-12-7, 2026-02-30, tomorrow are refused (a key must be a real YYYY-MM-DD date)", () => {
        for (const key of ["2026-13-01", "2026-12-7", "2026-02-30", "tomorrow"]) {
            expect(issuePaths(DayOverridesSchema.safeParse({ [key]: { kind: "dayOff" } }))).toContain(key);
        }
        expect(DayOverridesSchema.safeParse({ "2026-12-07": { kind: "dayOff" } }).success).toBe(true);
    });
});

describe("Zod bookingHorizonWeeks (§ 4.1; evidence taxonomy)", () => {
    it("A23 absent → 8 by default", () => {
        expect(SchedulingSettingsSchema.parse({}).bookingHorizonWeeks).toBe(8);
    });

    it("A23 1 and 52 accepted", () => {
        expect(SchedulingSettingsSchema.parse({ bookingHorizonWeeks: 1 }).bookingHorizonWeeks).toBe(1);
        expect(SchedulingSettingsSchema.parse({ bookingHorizonWeeks: 52 }).bookingHorizonWeeks).toBe(52);
    });

    it("A23 malformed 0, 53, 2.5, \"8\" refused", () => {
        for (const v of [0, 53, 2.5, "8"]) expect(issuePaths(SchedulingSettingsSchema.safeParse({ bookingHorizonWeeks: v }))).toContain("bookingHorizonWeeks");
    });
});

describe("Zod HistoryEntry and appendHistory (§ 4.4; evidence taxonomy of Booking.history)", () => {
    const admin = { kind: "admin" as const, email: "owner@atelier.example" };
    const slot = { kind: "slot" as const, resourceId: "r1", start: 1, end: 2 };
    const four: HistoryEntry[] = [
        created,
        { action: "confirmed", at: 3 },
        { action: "cancelled", at: 4, by: admin },
        { action: "moved", at: 5, by: { kind: "customer" }, from: slot, to: { kind: "slot", resourceId: "r2", start: 3, end: 4 } },
    ];

    it("A24 absent history and history [] are refused (the stored list is non-empty)", () => {
        const { history: _omit, ...withoutHistory } = booking();
        expect(issuePaths(BookingSchema.safeParse(withoutHistory))).toContain("history");
        expect(issuePaths(BookingSchema.safeParse({ ...booking(), history: [] }))).toContain("history");
    });

    it("A24 each of the four actions is accepted", () => {
        for (const e of four) {
            expect(HistoryEntrySchema.safeParse(e).success).toBe(true);
            expect(BookingSchema.safeParse({ ...booking(), history: [e] }).success).toBe(true);
        }
    });

    it("A24 malformed: unknown action; moved without from; cancelled by admin without email; at not a number; a list of 51", () => {
        const { from: _f, ...movedWithoutFrom } = four[3] as Extract<HistoryEntry, { action: "moved" }>;
        expect(issuePaths(HistoryEntrySchema.safeParse({ action: "edited", at: 1 }))).toContain("action");
        expect(issuePaths(HistoryEntrySchema.safeParse(movedWithoutFrom))).toContain("from");
        expect(issuePaths(HistoryEntrySchema.safeParse({ action: "cancelled", at: 1, by: { kind: "admin" } }))).toContain("by.email");
        expect(issuePaths(HistoryEntrySchema.safeParse({ action: "confirmed", at: "1" }))).toContain("at");
        expect(issuePaths(BookingSchema.safeParse({ ...booking(), history: Array.from({ length: 51 }, () => four[1]) }))).toContain("history");
    });

    it("A24 appendHistory on 50 entries → 50 entries, the oldest dropped, the new one last", () => {
        const fifty: HistoryEntry[] = Array.from({ length: 50 }, (_, i) => ({ action: "confirmed", at: i }));
        const next = appendHistory(fifty, { action: "confirmed", at: 50 });
        expect(next).toHaveLength(50);
        expect(next[0]).toEqual({ action: "confirmed", at: 1 });
        expect(next[49]).toEqual({ action: "confirmed", at: 50 });
        expect(fifty).toHaveLength(50); // the input is not changed
        expect(appendHistory([created], four[1])).toEqual([created, four[1]]);
    });

    it("A26 50 entries starting with created + one more change → created gone, new entry last, and the stored-item schema accepts it", () => {
        const moved = four[3];
        const fifty: HistoryEntry[] = [created, ...Array.from({ length: 49 }, () => moved)];
        const last: HistoryEntry = { action: "cancelled", at: 99, by: admin };
        const next = appendHistory(fifty, last);
        expect(next).toHaveLength(50);
        expect(next.some((e) => e.action === "created")).toBe(false);
        expect(next[49]).toEqual(last);
        expect(BookingSchema.safeParse({ ...booking(), history: next }).success).toBe(true);
    });

    it("A26 a list of 50 moved entries with no created at all is accepted by the stored-item schema", () => {
        expect(BookingSchema.safeParse({ ...booking(), history: Array.from({ length: 50 }, () => four[3]) }).success).toBe(true);
    });
});
