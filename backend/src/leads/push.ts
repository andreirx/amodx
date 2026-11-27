import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { NewsletterSubscriptionSchema, newsletterCanSendAgain, type NewsletterPush } from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { errorName, INTERNAL_ERROR } from "../lib/value-free.js";
import { mailerLiteSettingsOf, newsletterKey, pushWithinDeadline } from "./newsletter.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * NEWSLETTER-1 (ruling 10) — `POST /leads/{email}/push`: "Send again" on the admin Leads page. Named gain: the owner
 * recovers a push whose STORED state is `Failed` or `Pending` (no result stored), or that found no settings at signup.
 *
 * Order (NL1-R2): read the subscription; CLAIM a new attempt — one conditional write of `Pending(<new attempt id>)`, only
 * while the stored consent id and push attempt are still the ones read (a concurrent "Send again" or a newer signup makes
 * the claim fail → 409, nothing sent); then `pushWithinDeadline` with the new attempt (at most `POST_STORE_DEADLINE_MS`).
 *
 * Refused: no subscription (404); not readable (409); already `Sent` (409 — sending again could reverse an unsubscribe
 * made in MailerLite since); no MailerLite settings now (409); the claim lost (409). Same roles as deleting a lead. The
 * answer `{ push, resultWrite }` — `push` = the state MailerLite's answer means (absent without an answer in time),
 * `resultWrite` = `recorded` | `unconfirmed` (NL1-WRITE-ACK-UNCERTAINTY = A) — and the audit event hold no token and no
 * address. The admin page then reloads the STORED state, the only truth.
 */
export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing Tenant" }) };

        const auth = event.requestContext.authorizer.lambda;
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Forbidden";
            return { statusCode: 403, body: JSON.stringify({ error: message }) };
        }

        const email = decodeURIComponent(event.pathParameters?.email || "");
        if (!email) return { statusCode: 400, body: JSON.stringify({ error: "Missing email parameter" }) };
        const key = newsletterKey(tenantId, email);

        const stored = (await db.send(new GetCommand({ TableName: TABLE_NAME, Key: key, ConsistentRead: true }))).Item;
        if (!stored) return { statusCode: 404, body: JSON.stringify({ error: "This lead has no newsletter subscription." }) };
        const subscription = NewsletterSubscriptionSchema.safeParse(stored);
        if (!subscription.success) return { statusCode: 409, body: JSON.stringify({ error: "The stored subscription is not readable." }) };
        const { consent, push: storedPush } = subscription.data;
        if (!newsletterCanSendAgain(storedPush)) return { statusCode: 409, body: JSON.stringify({ error: "Already sent to MailerLite." }) };

        const tenant = (await db.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` } }))).Item;
        const settings = mailerLiteSettingsOf(tenant);
        if (!settings) {
            return { statusCode: 409, body: JSON.stringify({ error: "MailerLite is not connected. Add the API token and the group ID in Settings." }) };
        }

        // The claim: this request owns the next attempt only if nothing changed since the read.
        const attempt = crypto.randomUUID();
        const pending: NewsletterPush = { state: "Pending", attempt };
        const readAttempt = storedPush.state === "NoSettings" ? undefined : storedPush.attempt;
        try {
            await db.send(new UpdateCommand({
                TableName: TABLE_NAME,
                Key: key,
                UpdateExpression: "SET #push = :pending",
                ConditionExpression: readAttempt === undefined
                    ? "consent.#cid = :consentId AND attribute_not_exists(#push.#attempt)"
                    : "consent.#cid = :consentId AND #push.#attempt = :readAttempt",
                ExpressionAttributeNames: { "#push": "push", "#cid": "id", "#attempt": "attempt" },
                ExpressionAttributeValues: { ":pending": pending, ":consentId": consent.id, ...(readAttempt === undefined ? {} : { ":readAttempt": readAttempt }) },
            }));
        } catch (error: unknown) {
            if (errorName(error) === "ConditionalCheckFailedException") {
                return { statusCode: 409, body: JSON.stringify({ error: "The subscription changed meanwhile (another send or a new signup). Reload the page." }) };
            }
            throw error;
        }

        const outcome = await pushWithinDeadline(tenantId, email, consent.id, attempt, settings);

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "NEWSLETTER_SEND_AGAIN",
            target: { title: "Newsletter subscriber (address not recorded)" },
            details: { mailerliteAnswer: outcome.attempted?.state ?? null, resultWrite: outcome.resultWrite },
            ip: event.requestContext.http.sourceIp,
        });

        return { statusCode: 200, body: JSON.stringify({ ...(outcome.attempted ? { push: outcome.attempted } : {}), resultWrite: outcome.resultWrite }) };
    } catch (error: unknown) {
        console.error(`[leads/push] error=${errorName(error)}`);
        return INTERNAL_ERROR;
    }
};
