import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * PAY-1 (docs/slices/pay-1.md § 2 items 2-4, 6; § 3 evidence taxonomy) — PUT /orders/{id}: the payment state is a
 * transition, the other fields are the generic patch of before. The REAL `orders/update.ts`, the real shared rule
 * (`paymentTransition`) and the real default templates. Mocked: `db.js` (`send`), `events.js` (`publishAudit`) and
 * the SES client. Credential-free. Each `it` names the taxonomy row it binds.
 */

const { ddbSend, sesSend, mockAudit } = vi.hoisted(() => {
    process.env.SES_FROM_EMAIL = "shop@platform.test";
    return { ddbSend: vi.fn(), sesSend: vi.fn(), mockAudit: vi.fn() };
});
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("../../src/lib/events.js", () => ({ publishAudit: mockAudit }));
vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: class { send = sesSend; },
    SendEmailCommand: class { constructor(public input: any) {} },
}));

import { handler as updateOrder } from "../../src/orders/update.js";

const NOW = "2026-11-21T10:00:00.000Z";
const ORDER_KEY = { PK: "TENANT#t1", SK: "ORDER#o1" };
const baseOrder = (extra: Record<string, unknown> = {}) => ({
    ...ORDER_KEY, id: "o1", orderNumber: "PPB-0042", customerName: "Ana", customerEmail: "ana@example.com",
    status: "confirmed", paymentMethod: "bank_transfer", total: "75.00", subtotal: "75.00", currency: "RON",
    items: [{ productTitle: "Ring", quantity: 1, totalPrice: "75.00" }], ...extra,
});
const TENANT = { PK: "SYSTEM", SK: "TENANT#t1", id: "t1", name: "Tenant One", integrations: { contactEmail: "owner@t1.test" } };

type Stored = { order?: Record<string, unknown>; tenant?: Record<string, unknown>; updateFails?: unknown };
function mockDb({ order, tenant = TENANT, updateFails }: Stored) {
    ddbSend.mockImplementation(async (cmd: any) => {
        if (cmd instanceof GetCommand) {
            const { PK, SK } = cmd.input.Key as any;
            if (PK === "TENANT#t1" && SK === "ORDER#o1") return { Item: order ? structuredClone(order) : undefined };
            if (PK === "SYSTEM" && SK === "TENANT#t1") return { Item: structuredClone(tenant) };
            return {};
        }
        if (cmd instanceof UpdateCommand && updateFails) throw updateFails;
        return {};
    });
}

const commands = () => ddbSend.mock.calls.map((c) => c[0]);
const updates = () => commands().filter((c) => c instanceof UpdateCommand) as UpdateCommand[];
const conditionFailed = () => Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });

const event = (body: unknown, tenant = "t1", id = "o1") => ({
    headers: { "x-tenant-id": tenant },
    pathParameters: { id },
    requestContext: {
        http: { sourceIp: "127.0.0.1" },
        authorizer: { lambda: { sub: "u1", email: "owner@t1.test", role: "TENANT_ADMIN", tenantId: tenant } },
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
}) as any;
const call = async (body: unknown, tenant?: string, id?: string) =>
    (await (updateOrder as any)(event(body, tenant, id), {} as any, () => {})) as { statusCode: number; body: string };
const json = (res: { body: string }) => JSON.parse(res.body);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    ddbSend.mockReset();
    sesSend.mockReset().mockResolvedValue({});
    mockAudit.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("PAY-1 — allowed transitions", () => {
    it("pending → paid: 200; conditional update with paidAt; one audit entry; one 'paid' mail to the customer", async () => {
        mockDb({ order: baseOrder({ paymentStatus: "pending" }) });
        const res = await call({ paymentStatus: "paid", note: "Bank statement 12" });
        expect(res.statusCode).toBe(200);
        expect(json(res)).toEqual({ message: "Payment status updated", paymentStatus: "paid" });

        expect(updates()).toHaveLength(1);
        expect(updates()[0].input).toEqual({
            TableName: "test-table",
            Key: ORDER_KEY,
            UpdateExpression: "SET #paymentStatus = :next, #updatedAt = :now, #paidAt = :now",
            ConditionExpression: "attribute_exists(SK) AND #paymentStatus = :previous",
            ExpressionAttributeNames: { "#paymentStatus": "paymentStatus", "#updatedAt": "updatedAt", "#paidAt": "paidAt" },
            ExpressionAttributeValues: { ":next": "paid", ":now": NOW, ":previous": "pending" },
        });

        expect(mockAudit).toHaveBeenCalledTimes(1);
        expect(mockAudit).toHaveBeenCalledWith({
            tenantId: "t1",
            actor: { id: "u1", email: "owner@t1.test" },
            action: "UPDATE_ORDER_PAYMENT",
            target: { id: "o1", title: "PPB-0042" },
            details: { previous: "pending", next: "paid", note: "Bank statement 12" },
            ip: "127.0.0.1",
        });

        // Default 'paid' template: customer only (admin and processing flags off), so exactly one send.
        expect(sesSend).toHaveBeenCalledTimes(1);
        const mail = sesSend.mock.calls[0][0].input;
        expect(mail.Destination).toEqual({ ToAddresses: ["ana@example.com"] });
        expect(mail.Source).toContain("shop@platform.test");
        expect(mail.Message.Subject.Data).toBe("[Tenant One] Order PPB-0042 – Payment Received");
        expect(mail.Message.Body.Text.Data).toBe("We have received the payment for your order PPB-0042. Thank you!");
    });

    it("order record without paymentStatus, request paid: as pending → paid; the condition is 'attribute absent'", async () => {
        mockDb({ order: baseOrder() });
        const res = await call({ paymentStatus: "paid" });
        expect(res.statusCode).toBe(200);
        expect(updates()).toHaveLength(1);
        const input = updates()[0].input;
        expect(input.ConditionExpression).toBe("attribute_exists(SK) AND attribute_not_exists(#paymentStatus)");
        expect(input.ExpressionAttributeValues).toEqual({ ":next": "paid", ":now": NOW });
        expect(input.UpdateExpression).toBe("SET #paymentStatus = :next, #updatedAt = :now, #paidAt = :now");
        expect(mockAudit).toHaveBeenCalledTimes(1);
        expect(mockAudit.mock.calls[0][0].details).toEqual({ previous: "pending", next: "paid", note: undefined });
        expect(sesSend).toHaveBeenCalledTimes(1);
    });

    it("paid → refunded: 200; refundedAt; audit; no mail", async () => {
        mockDb({ order: baseOrder({ paymentStatus: "paid" }) });
        const res = await call({ paymentStatus: "refunded" });
        expect(res.statusCode).toBe(200);
        expect(updates()).toHaveLength(1);
        expect(updates()[0].input).toMatchObject({
            UpdateExpression: "SET #paymentStatus = :next, #updatedAt = :now, #refundedAt = :now",
            ExpressionAttributeNames: { "#refundedAt": "refundedAt" },
            ExpressionAttributeValues: { ":next": "refunded", ":previous": "paid" },
        });
        expect(mockAudit).toHaveBeenCalledTimes(1);
        expect(mockAudit.mock.calls[0][0]).toMatchObject({ action: "UPDATE_ORDER_PAYMENT", details: { previous: "paid", next: "refunded" } });
        expect(sesSend).not.toHaveBeenCalled();
    });
});

describe("PAY-1 — no-op and refused", () => {
    it("paid → paid: 200; no write, no audit, no mail", async () => {
        mockDb({ order: baseOrder({ paymentStatus: "paid" }) });
        const res = await call({ paymentStatus: "paid" });
        expect(res.statusCode).toBe(200);
        expect(json(res)).toEqual({ message: "Payment status unchanged", paymentStatus: "paid" });
        expect(commands().every((c) => c instanceof GetCommand)).toBe(true);
        expect(mockAudit).not.toHaveBeenCalled();
        expect(sesSend).not.toHaveBeenCalled();
    });

    for (const [from, to, reason] of [
        ["paid", "pending", "A paid order cannot go back to pending."],
        ["refunded", "paid", "A refunded order cannot change its payment state."],
        ["pending", "refunded", "Only a paid order can be refunded."],
    ] as const) {
        it(`${from} → ${to}: 409 with the reason and the current state; no write`, async () => {
            mockDb({ order: baseOrder({ paymentStatus: from }) });
            const res = await call({ paymentStatus: to });
            expect(res.statusCode).toBe(409);
            expect(json(res)).toEqual({ error: reason, paymentStatus: from });
            expect(updates()).toHaveLength(0);
            expect(mockAudit).not.toHaveBeenCalled();
            expect(sesSend).not.toHaveBeenCalled();
        });
    }

    it("stored payment state null (not absent, ruling R2): 409, no write, no audit, no mail", async () => {
        mockDb({ order: baseOrder({ paymentStatus: null }) });
        const res = await call({ paymentStatus: "paid" });
        expect(res.statusCode).toBe(409);
        expect(json(res)).toEqual({ error: "The stored payment state is not one of pending, paid, refunded.", paymentStatus: null });
        expect(updates()).toHaveLength(0);
        expect(mockAudit).not.toHaveBeenCalled();
        expect(sesSend).not.toHaveBeenCalled();
    });

    it("stored payment state outside the enum (written by the old patch): 409, no write", async () => {
        mockDb({ order: baseOrder({ paymentStatus: "PAID" }) });
        const res = await call({ paymentStatus: "paid" });
        expect(res.statusCode).toBe(409);
        expect(json(res)).toEqual({ error: "The stored payment state is not one of pending, paid, refunded.", paymentStatus: "PAID" });
        expect(updates()).toHaveLength(0);
    });
});

describe("PAY-1 — request validation", () => {
    for (const value of ["PAID", "unknown", null, 1, ""]) {
        it(`value outside the enum (${JSON.stringify(value)}): 400; no read of the order`, async () => {
            mockDb({ order: baseOrder() });
            const res = await call({ paymentStatus: value });
            expect(res.statusCode).toBe(400);
            expect(json(res).error).toBe("paymentStatus must be one of: pending, paid, refunded");
            expect(ddbSend).not.toHaveBeenCalled();
        });
    }

    for (const extra of [{ trackingNumber: "T1" }, { internalNotes: "x" }, { estimatedDeliveryDate: "2026-12-01" }, { foo: 1 }]) {
        it(`paymentStatus with another field (${Object.keys(extra)[0]}): 400 "send the payment state alone"`, async () => {
            mockDb({ order: baseOrder() });
            const res = await call({ paymentStatus: "paid", ...extra });
            expect(res.statusCode).toBe(400);
            expect(json(res).error).toBe("Send the payment state alone: paymentStatus and an optional note.");
            expect(updates()).toHaveLength(0);
        });
    }

    it("note longer than 500 characters, or not text: 400; 500 characters is accepted", async () => {
        mockDb({ order: baseOrder() });
        for (const note of ["x".repeat(501), 5]) {
            const res = await call({ paymentStatus: "paid", note });
            expect(res.statusCode).toBe(400);
            expect(json(res).error).toBe("note must be text of at most 500 characters");
        }
        expect(updates()).toHaveLength(0);
        expect((await call({ paymentStatus: "paid", note: "x".repeat(500) })).statusCode).toBe(200);
    });
});

describe("PAY-1 — race, tenant, failures", () => {
    it("the condition fails at write (state changed between read and write): 409; no audit, no mail", async () => {
        mockDb({ order: baseOrder({ paymentStatus: "pending" }), updateFails: conditionFailed() });
        const res = await call({ paymentStatus: "paid" });
        expect(res.statusCode).toBe(409);
        expect(json(res)).toEqual({ error: "The payment state changed; read the order again." });
        expect(updates()).toHaveLength(1);
        expect(mockAudit).not.toHaveBeenCalled();
        expect(sesSend).not.toHaveBeenCalled();
    });

    it("another tenant's order id: 404, no write (the read uses the caller's tenant key)", async () => {
        mockDb({ order: undefined });
        const res = await call({ paymentStatus: "paid" }, "t1", "other-tenants-order");
        expect(res.statusCode).toBe(404);
        expect(json(res)).toEqual({ error: "Order not found" });
        const get = commands()[0] as GetCommand;
        expect(get.input.Key).toEqual({ PK: "TENANT#t1", SK: "ORDER#other-tenants-order" });
        expect(updates()).toHaveLength(0);
    });

    it("the first dependency throws (payment path): 500 with the fixed text; the failure text not in the body; logged", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        ddbSend.mockRejectedValue(new Error("AccessDenied arn:aws:dynamodb:eu-central-1:123:table/secret"));
        const res = await call({ paymentStatus: "paid" });
        expect(res.statusCode).toBe(500);
        expect(json(res)).toEqual({ error: "Internal error" });
        expect(res.body).not.toContain("arn:aws");
        expect(log).toHaveBeenCalledWith("[orders/update] Error:", expect.any(Error));
    });

    it("the first dependency throws (field patch path): 500 with the fixed text; the failure text not in the body", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        ddbSend.mockRejectedValue(new Error("AccessDenied arn:aws:dynamodb:eu-central-1:123:table/secret"));
        const res = await call({ trackingNumber: "T1" });
        expect(res.statusCode).toBe(500);
        expect(json(res)).toEqual({ error: "Internal error" });
        expect(res.body).not.toContain("arn:aws");
        expect(log).toHaveBeenCalledTimes(1);
    });
});

describe("PAY-1 — the 'paid' mail", () => {
    it("tenant template 'paid' present: the tenant's text (and its flags)", async () => {
        mockDb({
            order: baseOrder({ paymentStatus: "pending" }),
            tenant: { ...TENANT, orderEmailConfig: { templates: { paid: {
                subject: "Plata pentru {{orderNumber}}", body: "Am primit {{total}} {{currency}}, {{customerName}}. {{note}}",
                sendToCustomer: true, sendToAdmin: true, sendToProcessing: false,
            } } } },
        });
        const res = await call({ paymentStatus: "paid", note: "OP 7" });
        expect(res.statusCode).toBe(200);
        expect(sesSend).toHaveBeenCalledTimes(2);
        const [toCustomer, toAdmin] = sesSend.mock.calls.map((c) => c[0].input);
        expect(toCustomer.Destination.ToAddresses).toEqual(["ana@example.com"]);
        expect(toCustomer.Message.Subject.Data).toBe("[Tenant One] Plata pentru PPB-0042");
        expect(toCustomer.Message.Body.Text.Data).toBe("Am primit 75.00 RON, Ana. OP 7");
        expect(toAdmin.Destination.ToAddresses).toEqual(["owner@t1.test"]);
    });

    it("tenant template 'paid' absent (config holds other keys): the default", async () => {
        mockDb({
            order: baseOrder({ paymentStatus: "pending" }),
            tenant: { ...TENANT, orderEmailConfig: { templates: { confirmed: { subject: "C", body: "C", sendToCustomer: true, sendToAdmin: false, sendToProcessing: false } } } },
        });
        await call({ paymentStatus: "paid" });
        expect(sesSend).toHaveBeenCalledTimes(1);
        expect(sesSend.mock.calls[0][0].input.Message.Subject.Data).toBe("[Tenant One] Order PPB-0042 – Payment Received");
    });

    it("the mail send throws: 200 all the same; the failure logged; audit written", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        mockDb({ order: baseOrder({ paymentStatus: "pending" }) });
        sesSend.mockRejectedValue(new Error("SES throttled"));
        const res = await call({ paymentStatus: "paid" });
        expect(res.statusCode).toBe(200);
        expect(mockAudit).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith("Failed to send payment notification email:", expect.any(Error));
    });

    it("order without customerEmail: 200, no mail", async () => {
        mockDb({ order: baseOrder({ paymentStatus: "pending", customerEmail: undefined }) });
        expect((await call({ paymentStatus: "paid" })).statusCode).toBe(200);
        expect(sesSend).not.toHaveBeenCalled();
    });
});

/**
 * Golden: a patch without `paymentStatus` sends the same `UpdateCommand` input as before PAY-1. The expected objects
 * are what `orders/update.ts` at c1e8a9b builds (allowlist loop in the order trackingNumber, internalNotes,
 * estimatedDeliveryDate; condition `attribute_exists(SK)`). The same `it`s were run against the c1e8a9b handler;
 * the build record of docs/slices/pay-1.md holds that run.
 */
describe("PAY-1 — patch without paymentStatus: request and stored update equal to before", () => {
    it("trackingNumber + internalNotes + estimatedDeliveryDate: golden UpdateCommand input, 200 'Order updated'", async () => {
        mockDb({ order: baseOrder() });
        const res = await call({ estimatedDeliveryDate: "2026-12-01", internalNotes: "call first", trackingNumber: "AWB1" });
        expect(res.statusCode).toBe(200);
        expect(json(res)).toEqual({ message: "Order updated" });
        expect(commands()).toHaveLength(1);
        expect(updates()[0].input).toEqual({
            TableName: "test-table",
            Key: ORDER_KEY,
            UpdateExpression: "SET #updatedAt = :updatedAt, #trackingNumber = :trackingNumber, #internalNotes = :internalNotes, #estimatedDeliveryDate = :estimatedDeliveryDate",
            ExpressionAttributeNames: { "#updatedAt": "updatedAt", "#trackingNumber": "trackingNumber", "#internalNotes": "internalNotes", "#estimatedDeliveryDate": "estimatedDeliveryDate" },
            ExpressionAttributeValues: { ":updatedAt": NOW, ":trackingNumber": "AWB1", ":internalNotes": "call first", ":estimatedDeliveryDate": "2026-12-01" },
            ConditionExpression: "attribute_exists(SK)",
        });
        expect(mockAudit).not.toHaveBeenCalled();
        expect(sesSend).not.toHaveBeenCalled();
    });

    it("trackingNumber alone (the admin page's call): golden UpdateCommand input", async () => {
        mockDb({ order: baseOrder() });
        await call({ trackingNumber: "AWB2" });
        expect(updates()[0].input).toEqual({
            TableName: "test-table",
            Key: ORDER_KEY,
            UpdateExpression: "SET #updatedAt = :updatedAt, #trackingNumber = :trackingNumber",
            ExpressionAttributeNames: { "#updatedAt": "updatedAt", "#trackingNumber": "trackingNumber" },
            ExpressionAttributeValues: { ":updatedAt": NOW, ":trackingNumber": "AWB2" },
            ConditionExpression: "attribute_exists(SK)",
        });
    });

    it("no allowed field: 400 'No valid fields to update', nothing sent", async () => {
        mockDb({ order: baseOrder() });
        const res = await call({ foo: 1 });
        expect(res.statusCode).toBe(400);
        expect(json(res)).toEqual({ error: "No valid fields to update" });
        expect(ddbSend).not.toHaveBeenCalled();
    });

    it("order missing (condition fails): 404 'Order not found' as before", async () => {
        mockDb({ order: undefined, updateFails: conditionFailed() });
        const res = await call({ internalNotes: "x" });
        expect(res.statusCode).toBe(404);
        expect(json(res)).toEqual({ error: "Order not found" });
    });
});
