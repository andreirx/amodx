import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        const auth = event.requestContext.authorizer.lambda;
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: "DELIVERYCONFIG#default" }
        }));

        const config = result.Item || {
            freeDeliveryThreshold: 0,
            flatShippingCost: 0,
            minimumOrderAmount: 0,
            deliveryLeadDays: 1,
            blockedDates: [],
            yearlyOffDays: [],
            unblockedDates: [],
            deliveryDaysOfWeek: [1, 2, 3, 4, 5],
            restrictDeliveryZones: false,
            allowedCountries: [],
            allowedCounties: [],
            defaultCountry: "",
            availableCountries: [],
            availableCounties: [],
        };

        return { statusCode: 200, body: JSON.stringify(config) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
