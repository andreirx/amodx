import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db } from "../lib/db.js";
import { customerRef } from "../lib/commerce-db.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { normalizeEmail } from "@amodx/shared";
import { commerceWriteFreezeRefusal } from "../lib/commerce-freeze.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const _handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const email = event.pathParameters?.email
            ? decodeURIComponent(event.pathParameters.email)
            : undefined;

        if (!tenantId || !email || !event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        // CMRC-2B (docs/slices/cmrc-2b.md): a frozen tenant's customer profile is not changed.
        const frozen = commerceWriteFreezeRefusal(tenantId);
        if (frozen) return frozen;

        const body = JSON.parse(event.body);
        const { notes } = body;

        // fnd-2: was RAW. Normalize so the admin note-write targets the same CUSTOMER#
        // record checkout created (see customers/get.ts for the missed-record failure).
        const normalizedEmail = normalizeEmail(email);

        const result = await db.send(new UpdateCommand({
            ...customerRef(tenantId, normalizedEmail),
            UpdateExpression: "SET notes = :notes, updatedAt = :now",
            ExpressionAttributeValues: {
                ":notes": notes ?? "",
                ":now": new Date().toISOString()
            },
            ConditionExpression: "attribute_exists(PK)",
            ReturnValues: "ALL_NEW"
        }));

        return { statusCode: 200, body: JSON.stringify(result.Attributes) };
    } catch (e: any) {
        if (e.name === "ConditionalCheckFailedException") {
            return { statusCode: 404, body: JSON.stringify({ error: "Customer not found" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};

export const handler = _handler;
