import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { CouponSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing Tenant" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing Body" }) };

        const body = JSON.parse(event.body);

        const input = CouponSchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true, usageCount: true
        }).parse(body);

        const upperCode = input.code.toUpperCase();

        // Check code uniqueness
        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `COUPONCODE#${upperCode}` }
        }));

        if (existing.Item) {
            return { statusCode: 409, body: JSON.stringify({ error: "Coupon code already exists" }) };
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        // Atomic dual-write: COUPON# item + COUPONCODE# lookup item
        await db.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: `TENANT#${tenantId}`,
                            SK: `COUPON#${id}`,
                            Type: "Coupon",
                            id,
                            tenantId,
                            ...input,
                            code: upperCode,
                            usageCount: 0,
                            createdAt: now,
                            updatedAt: now,
                        }
                    }
                },
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: {
                            PK: `TENANT#${tenantId}`,
                            SK: `COUPONCODE#${upperCode}`,
                            Type: "CouponCode",
                            couponId: id,
                            code: upperCode,
                            status: input.status || "active",
                        }
                    }
                }
            ]
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_COUPON",
            target: { title: upperCode, id },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 201, body: JSON.stringify({ id, code: upperCode, message: "Coupon created" }) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
