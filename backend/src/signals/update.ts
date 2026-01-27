import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const signalId = event.pathParameters?.id;

        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN"], tenantId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Forbidden";
            return { statusCode: 403, body: JSON.stringify({ error: message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!signalId) return { statusCode: 400, body: JSON.stringify({ error: "Missing signal ID" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);
        const now = new Date().toISOString();

        // Build dynamic update expression from allowed fields
        const allowedFields: Record<string, string> = {
            status: "status",
            draftReply: "draftReply",
            analysis: "analysis",
            painScore: "painScore",
            walletSignal: "walletSignal",
        };

        const expressionParts: string[] = ["#updatedAt = :updatedAt"];
        const expressionNames: Record<string, string> = { "#updatedAt": "updatedAt" };
        const expressionValues: Record<string, unknown> = { ":updatedAt": now };

        for (const [inputKey, dbKey] of Object.entries(allowedFields)) {
            if (body[inputKey] !== undefined) {
                const placeholder = `:${inputKey}`;
                const nameToken = `#${inputKey}`;
                expressionParts.push(`${nameToken} = ${placeholder}`);
                expressionNames[nameToken] = dbKey;
                expressionValues[placeholder] = body[inputKey];
            }
        }

        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: `TENANT#${tenantId}`,
                SK: `SIGNAL#${signalId}`,
            },
            UpdateExpression: `SET ${expressionParts.join(", ")}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues,
            ConditionExpression: "attribute_exists(SK)",
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SIGNAL",
            target: { id: signalId },
            details: body,
            ip: event.requestContext.http.sourceIp,
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Signal updated" }) };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Internal error";
        if (e instanceof Error && e.name === "ConditionalCheckFailedException") {
            return { statusCode: 404, body: JSON.stringify({ error: "Signal not found" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
};
