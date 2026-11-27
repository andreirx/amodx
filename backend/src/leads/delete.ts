import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { DeleteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { normalizeEmail } from "@amodx/shared";
import { newsletterKey } from "./newsletter.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { errorName, INTERNAL_ERROR } from "../lib/value-free.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const _handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };

        const auth = event.requestContext.authorizer.lambda;
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Forbidden";
            return { statusCode: 403, body: JSON.stringify({ error: message }) };
        }

        // Email is URL-encoded in path
        const email = decodeURIComponent(event.pathParameters?.email || "");
        if (!email) return { statusCode: 400, body: "Missing email parameter" };

        // NEWSLETTER-1 (condition 2; NL1-R8): one lead identity, the normalized address. The lead `LEAD#<normalized>` and
        // its newsletter subscription (`NEWSLETTER#<normalized>`) go in ONE transaction: both, or neither. A lead item whose
        // stored key is another spelling of the address (stored before LEAD-NORMALIZE-1 by a writer that did not normalize) is a separate item:
        // only it is deleted; the subscription and the normalized lead stay. The subscriber in MailerLite is not removed.
        const leadKey = { PK: `TENANT#${tenantId}`, SK: `LEAD#${email}` };
        if (email === normalizeEmail(email)) {
            await db.send(new TransactWriteCommand({
                TransactItems: [
                    { Delete: { TableName: TABLE_NAME, Key: leadKey } },
                    { Delete: { TableName: TABLE_NAME, Key: newsletterKey(tenantId, email) } },
                ],
            }));
        } else {
            await db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: leadKey }));
        }

        return { statusCode: 200, body: JSON.stringify({ message: "Deleted" }) };
    } catch (error: unknown) {
        // NL1-R1 (lib/value-free.ts): the name only; the answer is a fixed text.
        console.error(`[leads/delete] error=${errorName(error)}`);
        return INTERNAL_ERROR;
    }
};

export const handler = _handler;
