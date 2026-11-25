import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { BOOKING_TEXT_KEYS, EN_LANGUAGE_PACK } from "@amodx/shared";

/**
 * SCHED-LABELS-1 — PUT /settings and the `bookingStrings` attribute (the booking-page texts of a site). Checked as sent
 * and only when the body contains it: the limits of `siteStrings` (docs/slices/locale-1.md § 4.4: a JSON object, key
 * form, 200 entries, 500 units per text, 32 768 bytes; unknown keys kept), plus the rule of this attribute only — a
 * booking key holds a text that keeps exactly the `{placeholders}` of its standard text; `""` is no override and is
 * accepted. A refused body → 400 before any read, nothing written. Same harness as locale-settings.test.ts: the real
 * handler; only `db.js` (`send`) and `events.js` (`publishAudit`) are mocked. Credential-free.
 */

const { ddbSend, mockAudit } = vi.hoisted(() => ({ ddbSend: vi.fn(), mockAudit: vi.fn() }));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));

import { updateHandler as putSettings } from "../../src/tenant/settings.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", Domain: "t1.test", locale: "ro-RO", bookingStrings: { back: "Înapoi" } };

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const tenantPuts = () => commands().filter((c) => c instanceof PutCommand && c.input.Item?.SK === "TENANT#t1");
const anyWrite = () => commands().some((c) => (c instanceof PutCommand || c instanceof UpdateCommand));

const event = (body: unknown) => ({
    headers: { "x-tenant-id": "t1" },
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: "127.0.0.1" } },
    body: JSON.stringify(body),
}) as any;
const put = async (body: unknown) => (await (putSettings as any)(event(body), {} as any, () => {})) as { statusCode: number; body: string };

beforeEach(() => {
    ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) return { Item: structuredClone(TENANT) };
        if (cmd instanceof QueryCommand) return { Items: [] };
        return {};
    });
    mockAudit.mockReset().mockResolvedValue(undefined);
});

async function expectRefused(body: unknown, message: string | RegExp) {
    const res = await put(body);
    expect(res.statusCode).toBe(400);
    const error = JSON.parse(res.body).error as string;
    if (typeof message === "string") expect(error).toBe(message);
    else expect(error).toMatch(message);
    expect(anyWrite()).toBe(false);
    expect(commands()).toEqual([]);          // refused before the tenant read: nothing read, nothing written
}

async function expectStored(body: Record<string, unknown>) {
    const res = await put(body);
    expect(res.statusCode, res.body).toBe(200);
    const items = tenantPuts();
    expect(items).toHaveLength(1);
    return items[0].input.Item as Record<string, unknown>;
}

describe("PUT /settings — bookingStrings (SCHED-LABELS-1)", () => {
    it("a body without bookingStrings is not checked by this rule, and the stored attribute is kept as stored", async () => {
        const item = await expectStored({ name: "Renamed" });
        expect(item.bookingStrings).toEqual({ back: "Înapoi" });
    });

    it("a text override is stored as sent; the object replaces the stored one whole; {} clears the part", async () => {
        expect((await expectStored({ bookingStrings: { bookTitle: "Programează-te" } })).bookingStrings).toEqual({ bookTitle: "Programează-te" });
        ddbSend.mockClear();
        expect((await expectStored({ bookingStrings: {} })).bookingStrings).toEqual({});
    });

    it("\"\" = no override: accepted and not checked, also for a key whose standard text has placeholders", async () => {
        const item = await expectStored({ bookingStrings: { checkMailHeld: "", bookTitle: "" } });
        expect(item.bookingStrings).toEqual({ checkMailHeld: "", bookTitle: "" });
    });

    it("placeholders: the same set in another order, repeated, or in another wording is accepted", async () => {
        const item = await expectStored({ bookingStrings: {
            checkMailHeld: "Până la {time}: confirmă rezervarea {ref} din mesajul trimis la {email} ({ref}).",
            durationMinutes: "{n} de minute",
        } });
        expect(Object.keys(item.bookingStrings as object)).toEqual(["checkMailHeld", "durationMinutes"]);
    });

    it("a missing placeholder → 400 naming the key and the placeholder", async () => {
        await expectRefused({ bookingStrings: { checkMailHeld: "Am trimis un link la {email}. Confirmă rezervarea {ref}." } },
            'bookingStrings.checkMailHeld must keep the placeholder {time} (the standard text "We sent a link to {email}. Open it and confirm your booking {ref} before {time}." has {email}, {ref}, {time}).');
    });

    it("an unknown placeholder → 400 naming the key and the placeholder (with and without placeholders in the standard text)", async () => {
        await expectRefused({ bookingStrings: { durationMinutes: "{n} minute, {price}" } },
            "bookingStrings.durationMinutes has the unknown placeholder {price}; the text may use only {n}.");
        await expectRefused({ bookingStrings: { bookTitle: "Programare la {name}" } },
            "bookingStrings.bookTitle has the unknown placeholder {name}; the text may use no placeholder.");
    });

    it("every booking key: its standard text is accepted as an override, and dropping any one of its placeholders is refused", async () => {
        for (const key of BOOKING_TEXT_KEYS) {
            const standard = EN_LANGUAGE_PACK.booking[key];
            ddbSend.mockClear();
            expect((await put({ bookingStrings: { [key]: standard } })).statusCode, key).toBe(200);
            for (const [whole, name] of standard.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
                ddbSend.mockClear();
                await expectRefused({ bookingStrings: { [key]: standard.split(whole).join("") } }, `bookingStrings.${key} must keep the placeholder {${name}} (the standard text "${standard}" has ${[...new Set([...standard.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => `{${m[1]}}`))].join(", ")}).`);
            }
        }
    });

    it("a booking key with a non-text value (a count object, a number, null) → 400", async () => {
        for (const bad of [{ other: "x" }, 3, null]) {
            ddbSend.mockClear();
            await expectRefused({ bookingStrings: { bookTitle: bad } }, /^bookingStrings\.bookTitle must be a text/);
        }
    });

    it("an unknown key is kept (§ 2.4) and not placeholder-checked; the siteStrings limits apply", async () => {
        const item = await expectStored({ bookingStrings: { futureKey: "{anything}", bookTitle: "Rezervă" } });
        expect(item.bookingStrings).toEqual({ futureKey: "{anything}", bookTitle: "Rezervă" });
        for (const [body, message] of [
            [{ bookingStrings: null }, /^bookingStrings must be a JSON object/],
            [{ bookingStrings: "text" }, /^bookingStrings must be a JSON object/],
            [{ bookingStrings: { "bad key": "x" } }, /^bookingStrings key "bad key" is not a valid key/],
            [{ bookingStrings: { bookTitle: "x".repeat(501) } }, /^bookingStrings\.bookTitle is 501 characters long; at most 500/],
            [{ bookingStrings: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, "x"])) }, /^bookingStrings has 201 entries; at most 200/],
            [{ bookingStrings: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, "ă".repeat(200)])) }, /^bookingStrings is \d+ bytes as JSON; at most 32768/],
        ] as const) {
            ddbSend.mockClear();
            await expectRefused(body, message);
        }
    });

    it("an override with HTML is stored as sent (no rewrite; the renderer shows it as text)", async () => {
        const item = await expectStored({ bookingStrings: { bookTitle: "<b>Programează-te</b>" } });
        expect(item.bookingStrings).toEqual({ bookTitle: "<b>Programează-te</b>" });
    });
});
