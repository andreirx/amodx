import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * PADDLE-HOOK-1 — POST /webhooks/paddle fulfils nothing. The REAL `webhooks/paddle.ts`. Mocked so that each call
 * is recorded: `db.js` (`send`), the S3 client, the presigner and the SES client. The handler must make zero calls
 * on all of them for any request, answer 200 with the fixed body, and log one line that carries no email and no id
 * from the request. Credential-free.
 *
 * Every absence assertion here goes through the DETECTORS table, and the calibration case drives each entry of that
 * same table through the interface the old handler used (docs/testing-strategy.md: an absence assertion ships with a
 * positive control on the same detector). A detector cannot be asserted absent without being calibrated.
 */

const { ddbSend, s3Send, presign, sesSend } = vi.hoisted(() => ({
    ddbSend: vi.fn(), s3Send: vi.fn(), presign: vi.fn(), sesSend: vi.fn(),
}));
vi.mock("../../src/lib/db.js", () => ({ db: { send: ddbSend }, TABLE_NAME: "test-table" }));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = s3Send; },
    GetObjectCommand: class { constructor(public input: any) {} },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: presign }));
vi.mock("@aws-sdk/client-ses", () => ({
    SESClient: class { send = sesSend; },
    SendEmailCommand: class { constructor(public input: any) {} },
}));

import { handler } from "../../src/webhooks/paddle.js";
import { db } from "../../src/lib/db.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

const TENANT_ID = "3f2a9c1e-tenant-0001";
const PRODUCT_ID = "8b7d6e5f-product-0001";
const EMAIL = "attacker@example.com";
const FORGED = {
    alert_name: "payment_succeeded",
    email: EMAIL,
    p_product_id: "pro_01hxyz",
    passthrough: JSON.stringify({ tenantId: TENANT_ID, productId: PRODUCT_ID }),
};

const event = (body: string | undefined, extra: Record<string, unknown> = {}) =>
    ({ headers: {}, requestContext: { http: { method: "POST" } }, body, isBase64Encoded: false, ...extra }) as any;
const call = async (body: string | undefined, extra?: Record<string, unknown>) =>
    (await (handler as any)(event(body, extra), {} as any, () => {})) as { statusCode: number; body: string };

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    for (const d of DETECTORS) d.recorder.mockReset().mockResolvedValue({});
    // The table holds a product linked to a private file, so the pre-PADDLE-HOOK-1 handler would have gone all the
    // way: table read → presigned link → mail. The new handler must still make zero calls.
    ddbSend.mockResolvedValue({ Item: { title: "Paid file", resourceId: "r1", s3Key: "private/paid.zip" } });
    presign.mockResolvedValue("https://private.example/paid.zip?signature=x");
    log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

/** Each forbidden effect: its recorder, and how the old handler reached it (the positive control). */
const DETECTORS = [
    { name: "DynamoDB", recorder: ddbSend,
      fire: () => db.send(new GetCommand({ TableName: "test-table", Key: { PK: `TENANT#${TENANT_ID}`, SK: `PRODUCT#${PRODUCT_ID}` } })) },
    { name: "S3", recorder: s3Send,
      fire: () => new S3Client({}).send(new GetObjectCommand({ Bucket: "private", Key: "k" }) as any) },
    { name: "presigner", recorder: presign,
      fire: () => getSignedUrl(new S3Client({}), new GetObjectCommand({ Bucket: "private", Key: "k" }) as any, { expiresIn: 86400 }) },
    { name: "SES", recorder: sesSend,
      fire: () => new SESClient({}).send(new SendEmailCommand({ Source: "a@b.test", Destination: { ToAddresses: [EMAIL] } } as any) as any) },
];
const REQUEST_SECRETS = [EMAIL, TENANT_ID, PRODUCT_ID, "pro_01hxyz"];

function expectNothingFulfilled(res: { statusCode: number; body: string }) {
    // Soft, so that every detector reports on one run; a soft failure still fails the test.
    for (const d of DETECTORS) expect.soft(d.recorder, `${d.name} calls`).not.toHaveBeenCalled();
    expect(res).toEqual({ statusCode: 200, body: "Not processed" });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    for (const secret of REQUEST_SECRETS) expect(line).not.toContain(secret);
    return line;
}

describe("PADDLE-HOOK-1 — calibration: every detector used for an absence claim does detect", () => {
    it.each(DETECTORS.map((d) => [d.name, d] as const))("%s recorder counts a call made through the module interface the old handler imported", async (_n, d) => {
        expect(d.recorder).not.toHaveBeenCalled();
        await d.fire();
        expect(d.recorder).toHaveBeenCalledTimes(1);
        for (const other of DETECTORS) if (other !== d) expect(other.recorder, `${other.name} untouched`).not.toHaveBeenCalled();
    });

    it("log spy captures a line, and the secret check rejects a line that carries request data", () => {
        console.log(`would leak ${EMAIL} ${TENANT_ID}`);
        expect(log).toHaveBeenCalledTimes(1);
        const line = String(log.mock.calls[0][0]);
        expect(REQUEST_SECRETS.some((secret) => line.includes(secret))).toBe(true);
    });
});

describe("PADDLE-HOOK-1 — the unverified route fulfils nothing", () => {
    it("forged payment_succeeded with valid-looking ids (JSON) → 200, zero table/S3/mail calls, event name logged", async () => {
        const line = expectNothingFulfilled(await call(JSON.stringify(FORGED)));
        expect(line).toBe("paddle-hook: not fulfilled (unverified route), event=payment_succeeded");
    });

    it("forged payment_succeeded, form-encoded → 200, zero calls", async () => {
        const line = expectNothingFulfilled(await call(new URLSearchParams(FORGED).toString()));
        expect(line).toContain("event=payment_succeeded");
    });

    it("forged payment_succeeded, form-encoded and base64 (as API Gateway may pass it) → 200, zero calls", async () => {
        const body = Buffer.from(new URLSearchParams(FORGED).toString()).toString("base64");
        const line = expectNothingFulfilled(await call(body, { isBase64Encoded: true }));
        expect(line).toContain("event=payment_succeeded");
    });

    it("Paddle Billing shape (event_type) → 200, zero calls, event name logged", async () => {
        const body = JSON.stringify({ event_type: "transaction.completed", data: { customer: { email: EMAIL } } });
        expect(expectNothingFulfilled(await call(body))).toContain("event=transaction.completed");
    });

    it("empty body and absent body → 200, zero calls", async () => {
        expect(expectNothingFulfilled(await call(""))).toContain("event=unrecognised");
        log.mockClear();
        expect(expectNothingFulfilled(await call(undefined))).toContain("event=unrecognised");
    });

    it("malformed JSON → 200, zero calls", async () => {
        expect(expectNothingFulfilled(await call('{"alert_name": "payment_succeeded", '))).toContain("event=unrecognised");
    });

    it("an event name that is not a plain token (line break, address) is not written to the log", async () => {
        const body = JSON.stringify({ alert_name: `payment_succeeded\nemail=${EMAIL}` });
        expect(expectNothingFulfilled(await call(body))).toContain("event=unrecognised");
    });
});
