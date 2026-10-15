// In-process SQS stub for the built-bundle serving harness (slice opennext-1a).
//
// The OpenNext server bundle sends exactly one SQS operation: `SendMessage` on the revalidation
// queue, when a response is served `x-nextjs-cache: STALE` (open-next 3.1.3 `queue/sqs.js`,
// called from `core/routing/util.js` `revalidateIfRequired`). The SDK bundled into the server
// function (`@aws-sdk/client-sqs` 3.1004) speaks the JSON protocol: `POST /` with
// `x-amz-target: AmazonSQS.SendMessage` and an `application/x-amz-json-1.0` body.
//
// It answers that one operation, records it in `journal()`, and answers anything else with a
// LOUD error recorded in `unhandled()` — the same rule as `ddb-stub.mjs` (CACHE-1-D4): the
// adapter does not surface queue errors to the response, so only the journal can show them.
//
// `MD5OfMessageBody` is computed for real: the SQS client validates it against the body it sent
// (`@aws-sdk/middleware-sdk-sqs`) and fails the call on a mismatch.
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

/**
 * Starts the stub on an ephemeral port.
 * @param {{ queueName: string }} options  the only queue this stub serves (last path segment of the URL)
 */
export async function startSqsStub({ queueName }) {
    const journal = [];
    const unhandled = [];

    const server = createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const target = String(req.headers["x-amz-target"] ?? "");
            let parsed;
            try {
                parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            } catch {
                unhandled.push(`unparseable body for ${req.method} ${req.url} (${target || "no x-amz-target"})`);
                return amzError(res, 400, "InvalidParameterValue", "sqs-stub: unparseable body");
            }
            if (target !== "AmazonSQS.SendMessage") {
                unhandled.push(`unsupported operation ${target || `${req.method} ${req.url}`}`);
                return amzError(res, 400, "UnsupportedOperation", `sqs-stub does not implement ${target}`);
            }
            const queue = String(parsed.QueueUrl ?? "").split("/").pop();
            if (queue !== queueName) {
                unhandled.push(`SendMessage to queue "${queue}" (stub serves "${queueName}")`);
                return amzError(res, 400, "QueueDoesNotExist", `sqs-stub serves only ${queueName}`);
            }
            const body = String(parsed.MessageBody ?? "");
            journal.push({
                op: "SendMessage",
                queue,
                body,
                deduplicationId: parsed.MessageDeduplicationId,
                groupId: parsed.MessageGroupId,
            });
            const payload = JSON.stringify({
                MessageId: randomUUID(),
                MD5OfMessageBody: createHash("md5").update(body, "utf8").digest("hex"),
            });
            res.writeHead(200, { "content-type": "application/x-amz-json-1.0", "content-length": Buffer.byteLength(payload) });
            res.end(payload);
        });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;

    return {
        url,
        /** The queue URL to hand the bundle: it points at this stub, so the call stays local even
         *  if the client used the queue URL as its endpoint instead of `AWS_ENDPOINT_URL_SQS`. */
        queueUrl: `${url}/000000000000/${queueName}`,
        journal: () => journal.map((e) => ({ ...e })),
        unhandled: () => [...unhandled],
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

function amzError(res, status, type, message) {
    const body = JSON.stringify({ __type: `com.amazonaws.sqs#${type}`, message });
    res.writeHead(status, {
        "content-type": "application/x-amz-json-1.0",
        "x-amzn-query-error": `AWS.SimpleQueueService.${type};Sender`,
        "content-length": Buffer.byteLength(body),
    });
    res.end(body);
}
