import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Readable } from "node:stream";
import { HttpResponse } from "@smithy/protocol-http";

/**
 * NEWSLETTER-1 — finding NL1-R4 under NL1-WRITE-ACK-UNCERTAINTY = A: the answer comes at most `POST_STORE_DEADLINE_MS`
 * after the committed signup transaction, THROUGH THE REAL SDK. `db.js` is replaced by a real `DynamoDBDocumentClient`
 * (default retry strategy: 3 attempts, throttling backoff) whose request handler is a local stand-in: GetItem → no
 * item; TransactWriteItems → committed at once; UpdateItem (the push result) → answered only after 1.5 s, with
 * `ProvisionedThroughputExceededException`, every time, ignoring the abort signal (a slow server answers late). The SDK
 * therefore retries with backoff past 4 s. MailerLite (global fetch) answers 201 at once. Credential-free: fake
 * credentials, no network (the handler answers every request in-process).
 *
 * Contract: `newsletterSignup` (which races a timer around the post-store work) answers within the bound.
 *
 * No control test on `pushAndRecord` alone (removed 2026-11-27). It asserted that the SDK's retry backoff does NOT
 * observe the abort signal (an overrun past the bound). That is a property of one SDK version, not of this product:
 * true with `@aws-sdk/client-dynamodb` 3.1009 (the lockfile), false with 3.1178 (4009 ms; the CI workflow installs
 * without the lockfile). The timer race in `newsletterSignup` holds the bound with either behaviour.
 */

const stub = vi.hoisted(() => ({
    calls: [] as { target: string; at: number }[],
    txAckAt: 0,
}));

vi.mock("../../src/lib/db.js", async () => {
    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
    const answer = (status: number, body: unknown) => ({
        response: new HttpResponse({ statusCode: status, headers: { "content-type": "application/x-amz-json-1.0" }, body: Readable.from([Buffer.from(JSON.stringify(body))]) }),
    });
    const requestHandler = {
        async handle(request: { headers: Record<string, string> }) {
            const target = String(request.headers["x-amz-target"] ?? "").replace("DynamoDB_20120810.", "");
            stub.calls.push({ target, at: Date.now() });
            if (target === "GetItem") return answer(200, {});
            if (target === "TransactWriteItems") { stub.txAckAt = Date.now(); return answer(200, {}); }
            if (target === "UpdateItem") {
                await new Promise((r) => setTimeout(r, 1_500));
                return answer(400, { __type: "com.amazonaws.dynamodb.v20120810#ProvisionedThroughputExceededException", message: "Rate exceeded" });
            }
            return answer(400, { __type: "com.amazon.coral.validate#ValidationException", message: `unmodelled ${target}` });
        },
        updateHttpClientConfig() {},
        httpHandlerConfigs() { return {}; },
    };
    const client = new DynamoDBClient({
        region: "eu-central-1", endpoint: "http://127.0.0.1:9", credentials: { accessKeyId: "AKIDNEWSLETTER1", secretAccessKey: "not-a-secret" },
        requestHandler: requestHandler as any,
    });
    return { db: DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } }), TABLE_NAME: "test-table" };
});

import { newsletterSignup, POST_STORE_DEADLINE_MS } from "../../src/leads/newsletter.js";
import { LANGUAGE_PACKS } from "@amodx/shared";

const TENANT = { id: "t1", locale: "en-US", integrations: { mailerlite: { apiToken: "SENTINEL-ML-TOKEN-sdk", groupId: "g1" } } };

beforeEach(() => {
    stub.calls = [];
    stub.txAckAt = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 201 })));
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("NL1-R4 through the real SDK: throttling + retry backoff on the result write", () => {
    it(`contract: the signup answers within ${POST_STORE_DEADLINE_MS} ms of the committed transaction, while the SDK is still retrying the result write`, async () => {
        const res = await newsletterSignup("t1", TENANT, { email: "reader@example.test", consentText: LANGUAGE_PACKS.en.site.newsletterConsent, consentLocale: "en-US" });
        const answeredAt = Date.now();
        expect(res.statusCode).toBe(201);
        expect(stub.txAckAt).toBeGreaterThan(0);
        const afterStore = answeredAt - stub.txAckAt;
        expect(afterStore).toBeGreaterThanOrEqual(POST_STORE_DEADLINE_MS - 50);
        expect(afterStore).toBeLessThan(POST_STORE_DEADLINE_MS + 250);
        expect(stub.calls.filter((c) => c.target === "UpdateItem").length).toBeGreaterThanOrEqual(2);
    }, 20_000);
});
