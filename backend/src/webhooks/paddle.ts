import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

/**
 * POST /webhooks/paddle — public route. It fulfils NOTHING (PADDLE-HOOK-1).
 *
 * Why: this route verifies no signature, so the request body is not evidence of a payment. Before this slice, a
 * forged `payment_succeeded` body with a public product id and any email address made the platform sign a 24-hour
 * link to the product's private file and mail it to that address: a free paid file and mail sent to anyone.
 *
 * Contract now: every request gets 200 with the fixed body below (a provider stops retrying on 2xx). The handler
 * writes one log line with the event name only; it never logs the body, an email or an id from the request. It
 * makes no table read, no S3 call and no mail.
 *
 * Fulfilment returns only with a verified notification, in `pay-2` (docs/slices/pay-2.md). That slice also removes
 * the table, bucket and SES grants that `infra/lib/api.ts` still gives this function.
 */

/** Paddle event names are short lowercase tokens (`payment_succeeded`, `transaction.completed`). Any other value
 *  is logged as `unrecognised`, so a request cannot put its own text (line breaks, an address) into the log. */
const EVENT_NAME = /^[a-z][a-z0-9_.]{0,63}$/;

/** The event name in the body, if it has the expected shape: `alert_name` (Paddle Classic, JSON or form-encoded)
 *  or `event_type` (Paddle Billing, JSON). Never throws. */
function eventNameOf(body: string | undefined, isBase64Encoded: boolean | undefined): string {
    if (!body) return "unrecognised";
    const text = isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
    let name: unknown;
    try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
            const record = parsed as Record<string, unknown>;
            name = record.alert_name ?? record.event_type;
        }
    } catch {
        name = new URLSearchParams(text).get("alert_name");
    }
    return typeof name === "string" && EVENT_NAME.test(name) ? name : "unrecognised";
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    console.log(`paddle-hook: not fulfilled (unverified route), event=${eventNameOf(event.body, event.isBase64Encoded)}`);
    return { statusCode: 200, body: "Not processed" };
};
