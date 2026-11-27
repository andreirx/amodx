import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

/**
 * STAY-1A (docs/slices/stay-1.md § 2, Build record) — the `date` field at `POST /public/forms/{slug}/submit`.
 *
 * The REAL handler over a mocked DynamoDB document client and SES client, as in forms-public-submit.test.ts (that suite
 * holds the dateless forms and passes unchanged). The clock is injected with fake `Date` timers (`vi.setSystemTime`):
 * the handler reads `Date.now()` once for "today". Credential-free.
 */

process.env.TABLE_NAME = "amodx-table";
process.env.SES_FROM_EMAIL = "noreply@platform.test";
delete process.env.RECAPTCHA_SECRET_KEY;
delete process.env.TENANT_VERIFY_PERMISSIVE;

const ddb = mockClient(DynamoDBDocumentClient);
const sesMock = mockClient(SESClient);

const { handler } = await import("../../src/forms/public-submit.js");

type Field = { id: string; label: string; type: string; required?: boolean; min?: string };
const field = (id: string, label: string, type: string, extra: Partial<Field> = {}): Field => ({ id, label, type, required: false, ...extra });

/** The "Request a stay" form: room, arrival, departure, guests, phone; departure later than arrival. */
const STAY_FIELDS: Field[] = [
    field("f-room", "Room", "text", { required: true }),
    field("f-arr", "Arrival", "date", { required: true, min: "today" }),
    field("f-dep", "Departure", "date"),
    field("f-guests", "Guests", "number"),
    field("f-phone", "Phone", "phone", { required: true }),
];
const STAY_ORDER = { earlier: "f-arr", later: "f-dep" };

function form(fields: Field[], over: Record<string, unknown> = {}) {
    ddb.on(GetCommand, { Key: { PK: "TENANT#t1", SK: "FORMSLUG#stay" } }).resolves({ Item: { formId: "form-stay", formName: "Stay" } });
    ddb.on(GetCommand, { Key: { PK: "TENANT#t1", SK: "FORM#form-stay" } }).resolves({ Item: {
        PK: "TENANT#t1", SK: "FORM#form-stay", id: "form-stay", tenantId: "t1", name: "Request a stay", slug: "stay", fields,
        submitButtonText: "Send", successMessage: "Thanks, we will call you.", notifyEmail: "owner@site.test", status: "active", ...over,
    } });
}
function tenant(extra: Record<string, unknown> = {}) {
    ddb.on(GetCommand, { Key: { PK: "SYSTEM", SK: "TENANT#t1" } }).resolves({ Item: { id: "t1", name: "Casa Satului", ...extra } });
}

const call = async (data: Record<string, unknown>) => {
    const res = (await handler({
        headers: { "x-tenant-id": "t1", origin: "https://site.test" },
        pathParameters: { slug: "stay" },
        requestContext: { http: { sourceIp: "127.0.0.1" } },
        body: JSON.stringify({ data, recaptchaToken: null }),
    } as any, {} as any, () => {})) as any;
    return { status: res.statusCode as number, body: JSON.parse(res.body) };
};
const puts = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item!);
const mailText = () => sesMock.commandCalls(SendEmailCommand)[0].args[0].input.Message!.Body!.Text!.Data!;

/** A valid stay request; `over` replaces values. */
const stay = (over: Record<string, unknown> = {}) => ({ Room: "Blue room", Arrival: "2026-12-20", Departure: "2026-12-23", Guests: "2", Phone: "0722 000 000", ...over });

beforeEach(() => {
    ddb.reset();
    sesMock.reset();
    sesMock.on(SendEmailCommand).resolves({ MessageId: "m1" });
    ddb.on(GetCommand).resolves({});
    ddb.on(QueryCommand, { IndexName: "GSI_Domain", ExpressionAttributeValues: { ":domain": "site.test" } }).resolves({ Items: [{ id: "t1" }] });
    ddb.on(PutCommand).resolves({});
    tenant();
    form(STAY_FIELDS, { dateOrder: STAY_ORDER });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the value contract", () => {
    it("required date absent → 400 naming the field; nothing stored, nothing mailed", async () => {
        const { Arrival, ...rest } = stay();
        const res = await call(rest);
        expect(res).toEqual({ status: 400, body: { error: "Missing required fields", fields: ["Arrival"] } });
        expect(puts()).toEqual([]);
        expect(sesMock.commandCalls(SendEmailCommand)).toEqual([]);
    });

    it.each(["2026-02-30", "30/02/2026", "2026-2-3", 20261220, " 2026-12-20", "2026-12-20T00:00:00Z", true])("%j → 400 Invalid value naming the field", async (value) => {
        const res = await call(stay({ Arrival: value }));
        expect(res).toEqual({ status: 400, body: { error: "Invalid value", fields: ["Arrival"] } });
        expect(puts()).toEqual([]);
    });

    it('"" on a required date field → 400 Missing required fields', async () => {
        expect(await call(stay({ Arrival: "" }))).toEqual({ status: 400, body: { error: "Missing required fields", fields: ["Arrival"] } });
    });

    it("valid → 201; stored as the same text; the optional empty date stored as \"\"", async () => {
        expect((await call(stay())).status).toBe(201);
        expect(puts()[0].data).toEqual({ Room: "Blue room", Arrival: "2026-12-20", Departure: "2026-12-23", Guests: 2, Phone: "0722 000 000" });
        expect((await call(stay({ Departure: "" }))).status).toBe(201);
        expect(puts()[1].data.Departure).toBe("");
    });
});

describe('min: "today" — no timezone stored: the UTC date minus one day', () => {
    it("at 2026-11-27T12:00Z: 2026-11-25 refused; 2026-11-26 (a visitor west of UTC), today and tomorrow accepted", async () => {
        expect(await call(stay({ Arrival: "2026-11-25", Departure: "" }))).toEqual({ status: 400, body: { error: "Date is before today", fields: ["Arrival"] } });
        for (const date of ["2026-11-26", "2026-11-27", "2026-11-28"]) {
            expect((await call(stay({ Arrival: date, Departure: "" }))).status, date).toBe(201);
        }
    });

    it("both sides of UTC midnight", async () => {
        vi.setSystemTime(new Date("2026-11-27T23:59:59Z"));
        expect((await call(stay({ Arrival: "2026-11-26", Departure: "" }))).status).toBe(201);
        vi.setSystemTime(new Date("2026-11-28T00:00:00Z"));
        expect((await call(stay({ Arrival: "2026-11-26", Departure: "" }))).status).toBe(400);
        expect((await call(stay({ Arrival: "2026-11-27", Departure: "" }))).status).toBe(201);
    });

    it("a date field without min accepts a past date", async () => {
        form([field("f-d", "Day", "date", { required: true })]);
        expect((await call({ Day: "2001-01-01" })).status).toBe(201);
    });
});

describe('min: "today" — a timezone stored (scheduling.timezone): today in that zone', () => {
    beforeEach(() => tenant({ scheduling: { timezone: "Europe/Bucharest" } }));

    it("one second before local midnight (2026-11-26 23:59:59 in Bucharest): 2026-11-26 accepted, 2026-11-25 refused", async () => {
        vi.setSystemTime(new Date("2026-11-26T21:59:59Z"));
        expect((await call(stay({ Arrival: "2026-11-26", Departure: "" }))).status).toBe(201);
        expect(await call(stay({ Arrival: "2026-11-25", Departure: "" }))).toEqual({ status: 400, body: { error: "Date is before today", fields: ["Arrival"] } });
    });

    it("at local midnight (2026-11-27 00:00 in Bucharest): 2026-11-26 refused (no one-day tolerance), today and tomorrow accepted", async () => {
        vi.setSystemTime(new Date("2026-11-26T22:00:00Z"));
        expect((await call(stay({ Arrival: "2026-11-26", Departure: "" }))).status).toBe(400);
        expect((await call(stay({ Arrival: "2026-11-27", Departure: "" }))).status).toBe(201);
        expect((await call(stay({ Arrival: "2026-11-28", Departure: "" }))).status).toBe(201);
    });
});

describe("the pair rule (departure later than arrival)", () => {
    it.each(["2026-12-20", "2026-12-19"])("departure %s with arrival 2026-12-20 → 400 naming the later field", async (dep) => {
        expect(await call(stay({ Departure: dep }))).toEqual({ status: 400, body: { error: "Date must be after the earlier date", fields: ["Departure"] } });
        expect(puts()).toEqual([]);
    });

    it("departure one day after arrival → 201", async () => {
        expect((await call(stay({ Departure: "2026-12-21" }))).status).toBe(201);
    });

    it("one value absent (the optional departure left empty, or not sent) → accepted", async () => {
        expect((await call(stay({ Departure: "" }))).status).toBe(201);
        const { Departure, ...rest } = stay();
        expect((await call(rest)).status).toBe(201);
    });

    it("the earlier field optional and empty → accepted", async () => {
        form([field("f-arr", "Arrival", "date"), field("f-dep", "Departure", "date")], { dateOrder: STAY_ORDER });
        expect((await call({ Arrival: "", Departure: "2026-12-01" })).status).toBe(201);
    });

    it("a stored rule that does not resolve (names a text field) is not applied, and logged", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        form(STAY_FIELDS, { dateOrder: { earlier: "f-arr", later: "f-room" } });
        expect((await call(stay({ Departure: "2026-12-01" }))).status).toBe(201);
        expect(warn).toHaveBeenCalledWith("[forms/public-submit] dateOrder not applied:", expect.stringContaining('the field "Room" is not a date field'));
        warn.mockRestore();
    });

    it("no rule on the form → departure before arrival accepted", async () => {
        form(STAY_FIELDS);
        expect((await call(stay({ Departure: "2026-12-01" }))).status).toBe(201);
    });
});

describe("the e-mail shows a date in the site's locale, from the stored text", () => {
    it("ro-RO → 27.12.2026 style; the empty optional date stays (empty)", async () => {
        tenant({ locale: "ro-RO" });
        expect((await call(stay({ Arrival: "2026-12-01", Departure: "" }))).status).toBe(201);
        expect(mailText()).toContain("Arrival: 01.12.2026\n");
        expect(mailText()).toContain("Departure: (empty)\n");
        expect(puts()[0].data.Arrival).toBe("2026-12-01");
    });

    it("no locale stored → en-US", async () => {
        expect((await call(stay())).status).toBe(201);
        expect(mailText()).toContain("Arrival: 12/20/2026\nDeparture: 12/23/2026\n");
    });
});

// F-STAY1A-YEAR-REMAP (review-0): every four-digit year is accepted and kept; no 0-99 → 19xx reading anywhere.
describe("years 0000-0099 (ruling 3: any real YYYY-MM-DD date)", () => {
    const EARLY = [field("f-arr", "Arrival", "date", { required: true }), field("f-dep", "Departure", "date")];

    it("0099-12-31 and 0100-01-01: accepted, stored as sent; the mail shows the four-digit year (ro-RO)", async () => {
        tenant({ locale: "ro-RO" });
        form(EARLY, { dateOrder: STAY_ORDER });
        expect((await call({ Arrival: "0099-12-31", Departure: "0100-01-01" })).status).toBe(201);
        expect(puts()[0].data).toEqual({ Arrival: "0099-12-31", Departure: "0100-01-01" });
        expect(mailText()).toContain("Arrival: 31.12.0099\nDeparture: 01.01.0100\n");
    });

    it("the pair rule across the 0099/0100 boundary: 0100-01-01 → 0099-12-31 refused naming the later field", async () => {
        form(EARLY, { dateOrder: STAY_ORDER });
        expect(await call({ Arrival: "0100-01-01", Departure: "0099-12-31" })).toEqual({ status: 400, body: { error: "Date must be after the earlier date", fields: ["Departure"] } });
    });

    it("0000-02-29 (a leap day of year 0) accepted; 0099-02-29 (not a leap year) refused", async () => {
        form(EARLY);
        expect((await call({ Arrival: "0000-02-29" })).status).toBe(201);
        expect(await call({ Arrival: "0099-02-29" })).toEqual({ status: 400, body: { error: "Invalid value", fields: ["Arrival"] } });
    });
});
