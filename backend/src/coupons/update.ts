import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { CouponSchema } from "@amodx/shared";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const id = event.pathParameters?.id;

        try {
            requireRole(auth, ["EDITOR", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId || !id || !event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing Data" }) };

        const body = JSON.parse(event.body);

        const existing = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `COUPON#${id}` }
        }));

        if (!existing.Item) return { statusCode: 404, body: JSON.stringify({ error: "Coupon not found" }) };

        const input = CouponSchema.omit({
            id: true, tenantId: true, createdAt: true, updatedAt: true, usageCount: true
        }).partial().parse(body);

        // Uppercase code if provided
        if (input.code) {
            input.code = input.code.toUpperCase();
        }

        const merged: Record<string, any> = {
            ...existing.Item,
            ...input,
            updatedAt: new Date().toISOString(),
        };

        const oldCode = existing.Item.code as string;
        const newCode = input.code;
        const codeChanged = newCode && newCode !== oldCode;

        if (codeChanged) {
            // Check new code uniqueness
            const codeCheck = await db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `COUPONCODE#${newCode}` }
            }));

            if (codeCheck.Item) {
                return { statusCode: 409, body: JSON.stringify({ error: "Coupon code already exists" }) };
            }

            // Atomic: delete old COUPONCODE#, write new COUPONCODE#, update COUPON#
            await db.send(new TransactWriteCommand({
                TransactItems: [
                    {
                        Delete: {
                            TableName: TABLE_NAME,
                            Key: { PK: `TENANT#${tenantId}`, SK: `COUPONCODE#${oldCode}` }
                        }
                    },
                    {
                        Put: {
                            TableName: TABLE_NAME,
                            Item: {
                                PK: `TENANT#${tenantId}`,
                                SK: `COUPONCODE#${newCode}`,
                                Type: "CouponCode",
                                couponId: id,
                                code: newCode,
                                status: merged.status,
                            }
                        }
                    },
                    {
                        Put: {
                            TableName: TABLE_NAME,
                            Item: merged
                        }
                    }
                ]
            }));
        } else {
            // Simple update — no code change
            await db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: merged
            }));

            // If status changed, also update the COUPONCODE# lookup item
            if (input.status && input.status !== existing.Item.status) {
                await db.send(new PutCommand({
                    TableName: TABLE_NAME,
                    Item: {
                        PK: `TENANT#${tenantId}`,
                        SK: `COUPONCODE#${oldCode}`,
                        Type: "CouponCode",
                        couponId: id,
                        code: oldCode,
                        status: input.status,
                    }
                }));
            }
        }

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_COUPON",
            target: { title: merged.code, id },
            details: { updatedFields: Object.keys(input).filter(key => input[key as keyof typeof input] !== undefined) },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify(merged) };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
