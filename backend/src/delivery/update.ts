import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId || !event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing data" }) };

        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        const body = JSON.parse(event.body);

        const item = {
            PK: `TENANT#${tenantId}`,
            SK: "DELIVERYCONFIG#default",
            freeDeliveryThreshold: body.freeDeliveryThreshold ?? 0,
            flatShippingCost: body.flatShippingCost ?? 0,
            minimumOrderAmount: body.minimumOrderAmount ?? 0,
            deliveryLeadDays: body.deliveryLeadDays ?? 1,
            blockedDates: body.blockedDates ?? [],
            deliveryDaysOfWeek: body.deliveryDaysOfWeek ?? [1, 2, 3, 4, 5],
            updatedAt: new Date().toISOString()
        };

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: item
        }));

        return { statusCode: 200, body: JSON.stringify(item) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
