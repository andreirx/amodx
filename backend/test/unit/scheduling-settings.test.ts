import { describe, it, expect, beforeEach, vi } from "vitest";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * SCHED-1D1 — PUT /settings with the scheduling attributes (docs/slices/sched-1.md § 4.1, § 6.5 point 4, § 17.3 rows
 * D13 (settings part), D14 (PUT part), D17, D10 (settings part)). The real handler, `requireRole`, `withInvalidation`
 * and `events.ts`; replaced: the main-table client (`db.js`) and the EventBridge client, which records every
 * `PutEvents`. Same style as cat-quote-settings.test.ts. Credential-free.
 *
 * D14's stored-value part ("a stored 0 written directly → visitor slots 500 storedDataInvalid") is a visitor route:
 * `sched-1d2`.
 */

const h = vi.hoisted(() => {
    process.env.EVENT_BUS_NAME = "test-bus";
    return { ddbSend: vi.fn(), putEvents: [] as any[] };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: h.ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("@aws-sdk/client-eventbridge", () => ({
    EventBridgeClient: class { async send(cmd: any) { h.putEvents.push(cmd.input); return {}; } },
    PutEventsCommand: class { constructor(public input: any) {} },
}));

import { updateHandler as putSettings } from "../../src/tenant/settings.js";

const TENANT_ADMIN = { sub: "u1", email: "admin@t1.test", role: "TENANT_ADMIN", tenantId: "t1" };
const SOURCE_IP = "198.51.100.23";
const BASE = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", domain: "t1.test", Domain: "t1.test" };
let stored: Record<string, any>;

const commands = () => h.ddbSend.mock.calls.map((c) => c[0]);
const tenantPuts = () => commands().filter((c) => c instanceof PutCommand && c.input.Item?.SK === "TENANT#t1");
const anyWrite = () => commands().some((c) => (c instanceof PutCommand || c instanceof UpdateCommand) && c.input.Item?.SK === "TENANT#t1");
const auditDetails = () => h.putEvents.flatMap((input) => input.Entries.map((e: any) => JSON.parse(e.Detail)));

const put = async (body: unknown) => (await (putSettings as any)({
    headers: { "x-tenant-id": "t1" },
    requestContext: { authorizer: { lambda: TENANT_ADMIN }, http: { sourceIp: SOURCE_IP } },
    body: JSON.stringify(body),
}, {} as any, () => {})) as { statusCode: number; body: string };

beforeEach(() => {
    stored = structuredClone(BASE);
    h.putEvents.length = 0;
    h.ddbSend.mockReset().mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) return { Item: structuredClone(stored) };
        if (cmd instanceof QueryCommand) return { Items: [] };
        if (cmd instanceof PutCommand && cmd.input.Item?.SK === "TENANT#t1") stored = structuredClone(cmd.input.Item);
        return {};
    });
});

async function expectRefused(body: unknown, message: RegExp) {
    h.ddbSend.mockClear();
    h.putEvents.length = 0;
    const res = await put(body);
    expect({ body, status: res.statusCode }).toEqual({ body, status: 400 });
    expect(JSON.parse(res.body).error).toMatch(message);
    expect(anyWrite()).toBe(false);
    expect(h.putEvents).toEqual([]);
}

describe("D14 scheduling.bookingHorizonWeeks through PUT /settings", () => {
    it("D14 absent → saved, and the default 8 applies on read; 1 and 52 → stored as sent", async () => {
        expect((await put({ scheduling: { timezone: "Europe/Bucharest" } })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.scheduling).toEqual({ timezone: "Europe/Bucharest" });
        const { SchedulingSettingsSchema } = await import("@amodx/shared");
        expect(SchedulingSettingsSchema.parse(stored.scheduling).bookingHorizonWeeks).toBe(8);
        for (const weeks of [1, 52]) {
            h.ddbSend.mockClear();
            expect((await put({ scheduling: { timezone: "Europe/Bucharest", bookingHorizonWeeks: weeks } })).statusCode).toBe(200);
            expect(tenantPuts()[0].input.Item.scheduling.bookingHorizonWeeks).toBe(weeks);
        }
    });

    it("D14 0, 53, 2.5, \"8\" → 400 naming the field, nothing written", async () => {
        for (const weeks of [0, 53, 2.5, "8"]) {
            await expectRefused({ scheduling: { timezone: "Europe/Bucharest", bookingHorizonWeeks: weeks } }, /^scheduling\.bookingHorizonWeeks: /);
        }
    });

    it("the other § 4.5 ranges, an unknown timezone and an unknown key → 400 naming the field", async () => {
        await expectRefused({ scheduling: { holdMinutes: 4 } }, /^scheduling\.holdMinutes: /);
        await expectRefused({ scheduling: { holdMinutes: 1441 } }, /^scheduling\.holdMinutes: /);
        await expectRefused({ scheduling: { changeCutoffHours: 169 } }, /^scheduling\.changeCutoffHours: /);
        await expectRefused({ scheduling: { reminderHours: -1 } }, /^scheduling\.reminderHours: /);
        await expectRefused({ scheduling: { timezone: "Mars/Olympus" } }, /^scheduling\.timezone: /);
        await expectRefused({ scheduling: { timezon: "Europe/Bucharest" } }, /^scheduling: .*timezon/);
        await expectRefused({ scheduling: "on" }, /^scheduling: /);
        await expectRefused({ schedulingEnabled: "yes" }, /^schedulingEnabled: /);
    });
});

describe("§ 4.1 enabling needs a timezone (checked on the merged record)", () => {
    it("enable without a timezone → 400, nothing written", async () => {
        await expectRefused({ schedulingEnabled: true }, /^scheduling\.timezone: a time zone is required/);
        await expectRefused({ schedulingEnabled: true, scheduling: { holdMinutes: 30 } }, /^scheduling\.timezone: /);
    });
    it("enable with a timezone in the body, or with one already stored → 200; disabling never needs one", async () => {
        expect((await put({ schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" } })).statusCode).toBe(200);
        expect(stored).toMatchObject({ schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" } });
        stored = { ...structuredClone(BASE), scheduling: { timezone: "Europe/Bucharest" } };
        expect((await put({ schedulingEnabled: true })).statusCode).toBe(200);
        stored = structuredClone(BASE);
        expect((await put({ schedulingEnabled: false })).statusCode).toBe(200);
    });
    it("a save that names no scheduling attribute is not refused by this rule", async () => {
        stored = { ...structuredClone(BASE), schedulingEnabled: true };   // an inconsistent record written directly
        expect((await put({ name: "Renamed" })).statusCode).toBe(200);
    });
});

describe("D13 schedulingEmailConfig.templates.weekAhead through PUT /settings", () => {
    it("D13 absent → saved (the default is used); valid → stored as sent", async () => {
        expect((await put({ schedulingEmailConfig: { templates: {} } })).statusCode).toBe(200);
        const valid = { templates: { weekAhead: { subject: "Week {{weekStart}}", body: "{{summary}}", sendToAdmin: false } } };
        h.ddbSend.mockClear();
        expect((await put({ schedulingEmailConfig: valid })).statusCode).toBe(200);
        expect(tenantPuts()[0].input.Item.schedulingEmailConfig).toEqual(valid);
    });
    it("D13 malformed (no subject) → 400; an unknown mail key → 400; a template that is not an object → 400", async () => {
        await expectRefused({ schedulingEmailConfig: { templates: { weekAhead: { body: "x" } } } }, /^schedulingEmailConfig\.templates\.weekAhead\.subject: /);
        await expectRefused({ schedulingEmailConfig: { templates: { welcome: { subject: "a", body: "b" } } } }, /^schedulingEmailConfig\.templates/);
        await expectRefused({ schedulingEmailConfig: { templates: { hold: "x" } } }, /^schedulingEmailConfig\.templates\.hold: /);
    });
});

describe("D17 UPDATE_SETTINGS audit: no ip on a save that names a scheduling attribute (§ 6.5 point 4)", () => {
    it("D17 only scheduling keys → no ip key", async () => {
        expect((await put({ scheduling: { timezone: "Europe/Bucharest" } })).statusCode).toBe(200);
        const [event] = auditDetails();
        expect(event.action).toBe("UPDATE_SETTINGS");
        expect(event).not.toHaveProperty("ip");
        expect(event.details.updatedFields).toEqual(["scheduling"]);
    });

    it("D17 scheduling + name (mixed) → no ip key; updatedFields lists both; the record is saved", async () => {
        expect((await put({ scheduling: { timezone: "Europe/Bucharest" }, name: "Renamed" })).statusCode).toBe(200);
        const [event] = auditDetails();
        expect(event).not.toHaveProperty("ip");
        expect(event.details.updatedFields).toEqual(["scheduling", "name"]);
        expect(stored).toMatchObject({ name: "Renamed", scheduling: { timezone: "Europe/Bucharest" } });
    });

    it("D17 only name → ip = the source address (today's behaviour preserved)", async () => {
        expect((await put({ name: "Renamed" })).statusCode).toBe(200);
        expect(auditDetails()[0].ip).toBe(SOURCE_IP);
    });

    it("D17 the mixed body again after a reload of the record → still no ip; rejectedFields as before", async () => {
        await put({ schedulingEnabled: true, scheduling: { timezone: "Europe/Bucharest" } });
        h.putEvents.length = 0;
        const reloaded = structuredClone(stored);   // what the admin's Settings page sends back: the whole record
        const res = await put({ ...reloaded, name: "Renamed again" });
        expect(res.statusCode).toBe(200);
        const [event] = auditDetails();
        expect(event).not.toHaveProperty("ip");
        expect(event.details.rejectedFields).toEqual(["PK", "SK", "id", "Domain"]);
        expect(stored.name).toBe("Renamed again");
    });

    it("each of the three attributes alone removes ip (schedulingEnabled, scheduling, schedulingEmailConfig)", async () => {
        for (const body of [{ schedulingEnabled: false }, { scheduling: { holdMinutes: 30 } }, { schedulingEmailConfig: { templates: {} } }]) {
            h.putEvents.length = 0;
            expect((await put(body)).statusCode).toBe(200);
            expect({ body, hasIp: Object.hasOwn(auditDetails()[0], "ip") }).toEqual({ body, hasIp: false });
        }
    });
});
