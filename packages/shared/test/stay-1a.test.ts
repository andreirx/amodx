import { describe, it, expect } from "vitest";
import {
    FormFieldSchema, FormDefinitionSchema, formFieldsOf, resolveFormDateOrder, earliestFormDate, formatFormDate, isFormDate,
    type FormField,
} from "../src/index.js";

/**
 * STAY-1A (docs/slices/stay-1.md § 2, Build record) — the `date` field of stored forms: the schema, the pair rule, the
 * "today" floor (injected instant), the locale formatter. Pure: no I/O, no clock read.
 */

const dateField = (id: string, label: string, extra: Partial<FormField> = {}): FormField => ({ id, label, type: "date", required: false, ...extra });
const textField = (id: string, label: string): FormField => ({ id, label, type: "text", required: false });

describe("schema", () => {
    it("a date field with min: today parses; any other min is refused", () => {
        expect(FormFieldSchema.parse({ id: "a", label: "Arrival", type: "date", min: "today" })).toEqual({ id: "a", label: "Arrival", type: "date", required: false, min: "today" });
        expect(FormFieldSchema.safeParse({ id: "a", label: "Arrival", type: "date", min: "tomorrow" }).success).toBe(false);
    });

    it("a field without min parses with no min key (forms without a date field keep their shape)", () => {
        const parsed = FormFieldSchema.parse({ id: "n", label: "Name", type: "text" });
        expect("min" in parsed).toBe(false);
    });

    it("FormDefinitionSchema: dateOrder optional; absent → no key", () => {
        const base = { id: "f", tenantId: "t", name: "Stay", slug: "stay", createdAt: "x", updatedAt: "x" };
        expect("dateOrder" in FormDefinitionSchema.parse(base)).toBe(false);
        expect(FormDefinitionSchema.parse({ ...base, dateOrder: { earlier: "a", later: "b" } }).dateOrder).toEqual({ earlier: "a", later: "b" });
    });
});

describe("isFormDate (the value check)", () => {
    it.each(["2026-11-27", "2028-02-29", "2026-01-01"])("%s accepted", (v) => expect(isFormDate(v)).toBe(true));
    it.each(["2026-02-30", "2027-02-29", "30/02/2026", "2026-2-3", "", "2026-11-27T00:00", " 2026-11-27", "2026-13-01"])("%j refused", (v) => expect(isFormDate(v)).toBe(false));
    // F-STAY1A-YEAR-REMAP: every four-digit year is a year (Date.UTC would read 0-99 as 1900-1999).
    it.each(["0099-12-31", "0100-01-01", "0000-01-01", "0000-02-29", "0004-02-29", "0001-01-01", "9999-12-31"])("%s accepted (four-digit year kept)", (v) => expect(isFormDate(v)).toBe(true));
    it.each(["0099-02-29", "0100-02-29", "1900-02-29", "0099-12-32"])("%s refused (not a calendar day of that year)", (v) => expect(isFormDate(v)).toBe(false));
});

describe("formFieldsOf", () => {
    it("parses the entries that are fields, the first of each label, in order", () => {
        const stored = [dateField("a", "Arrival"), { nope: 1 }, textField("n", "Name"), dateField("a2", "Arrival")];
        expect(formFieldsOf(stored).map((f) => f.id)).toEqual(["a", "n"]);
        expect(formFieldsOf(undefined)).toEqual([]);
    });
});

describe("resolveFormDateOrder", () => {
    const fields = [dateField("arr", "Arrival"), dateField("dep", "Departure"), textField("name", "Name")];

    it("absent → no rule", () => expect(resolveFormDateOrder(fields, undefined)).toEqual({ ok: true, value: null }));

    it("two different date fields → the pair", () => {
        const r = resolveFormDateOrder(fields, { earlier: "arr", later: "dep" });
        expect(r.ok && r.value?.earlier.label).toBe("Arrival");
        expect(r.ok && r.value?.later.label).toBe("Departure");
    });

    it.each([
        [{ earlier: "arr", later: "gone" }, /dateOrder\.later: the form has no field with id "gone"/],
        [{ earlier: "gone", later: "dep" }, /dateOrder\.earlier: the form has no field with id "gone"/],
        [{ earlier: "arr", later: "name" }, /dateOrder\.later: the field "Name" is not a date field/],
        [{ earlier: "name", later: "dep" }, /dateOrder\.earlier: the field "Name" is not a date field/],
        [{ earlier: "arr", later: "arr" }, /two different fields/],
        [{ earlier: "arr" }, /must be \{ earlier, later \}/],
        [null, /must be \{ earlier, later \}/],
        ["arr>dep", /must be \{ earlier, later \}/],
    ])("%j → error", (rule, message) => {
        const r = resolveFormDateOrder(fields, rule);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(message);
    });
});

describe("earliestFormDate (injected instant)", () => {
    it("with a timezone: today in that zone, at both sides of local midnight", () => {
        // Bucharest is UTC+2 in November: local midnight of 2026-11-27 = 2026-11-26T22:00Z.
        expect(earliestFormDate(Date.parse("2026-11-26T21:59:59Z"), "Europe/Bucharest")).toBe("2026-11-26");
        expect(earliestFormDate(Date.parse("2026-11-26T22:00:00Z"), "Europe/Bucharest")).toBe("2026-11-27");
        // New York is UTC-5: at 2026-11-27T04:00Z it is still 2026-11-26 there.
        expect(earliestFormDate(Date.parse("2026-11-27T04:00:00Z"), "America/New_York")).toBe("2026-11-26");
    });

    it("without a timezone: the UTC date minus one day, at both sides of UTC midnight", () => {
        expect(earliestFormDate(Date.parse("2026-11-27T23:59:59Z"), undefined)).toBe("2026-11-26");
        expect(earliestFormDate(Date.parse("2026-11-28T00:00:00Z"), undefined)).toBe("2026-11-27");
    });

    it("a stored zone that is not valid, or empty, is treated as no zone", () => {
        expect(earliestFormDate(Date.parse("2026-11-27T12:00:00Z"), "Mars/Olympus")).toBe("2026-11-26");
        expect(earliestFormDate(Date.parse("2026-11-27T12:00:00Z"), "")).toBe("2026-11-26");
    });
});

describe("formatFormDate (the four languages)", () => {
    it.each([
        ["en-US", "11/27/2026", "02/03/2026"],
        ["ro-RO", "27.11.2026", "03.02.2026"],
        ["de-DE", "27.11.2026", "03.02.2026"],
        ["fr-FR", "27/11/2026", "03/02/2026"],
    ])("%s", (locale, nov27, feb3) => {
        expect(formatFormDate("2026-11-27", locale)).toBe(nov27);
        expect(formatFormDate("2026-02-03", locale)).toBe(feb3);
    });

    it("the day does not move: the first and last day of a year, whatever the process zone", () => {
        expect(formatFormDate("2026-01-01", "ro-RO")).toBe("01.01.2026");
        expect(formatFormDate("2026-12-31", "ro-RO")).toBe("31.12.2026");
    });

    it("years 0000-0099 keep their four digits and their day (F-STAY1A-YEAR-REMAP): 0099-12-31 → 0100-01-01", () => {
        expect(formatFormDate("0099-12-31", "ro-RO")).toBe("31.12.0099");
        expect(formatFormDate("0100-01-01", "ro-RO")).toBe("01.01.0100");
        expect(formatFormDate("0099-12-31", "en-US")).toBe("12/31/0099");
        expect(formatFormDate("0000-02-29", "de-DE")).toBe("29.02.0000");
        expect(formatFormDate("0001-01-01", "fr-FR")).toBe("01/01/0001");
    });

    it("absent or malformed locale → en-US; a value that is not a date text → unchanged", () => {
        expect(formatFormDate("2026-11-27", undefined)).toBe("11/27/2026");
        expect(formatFormDate("2026-11-27", "not a locale!")).toBe("11/27/2026");
        expect(formatFormDate("2026-02-30", "ro-RO")).toBe("2026-02-30");
        expect(formatFormDate("", "ro-RO")).toBe("");
    });
});

// F-STAY1A-YEAR-REMAP — the rule that closes the class: the form-date module builds a day only with `setUTCFullYear`
// (`utcDay`); `Date.UTC` reads a year 0-99 as 1900-1999. Source check of the module (its comment names the API).
describe("form-date.ts calls no year-remapping constructor", () => {
    it("no Date.UTC( call and no new Date(<year>, …) in the code", async () => {
        const { readFileSync } = await import("node:fs");
        const code = readFileSync(new URL("../src/form-date.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        expect(code).not.toMatch(/Date\.UTC\s*\(/);
        expect(code).not.toMatch(/new Date\(\s*[a-z_]\w*\s*,/i);
    });
});
