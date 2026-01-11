import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";
import { ContentItem } from "@amodx/shared"; // Import the type

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// POST /content/{id}/restore
export const restoreHandler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const nodeId = event.pathParameters?.id;
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId || !nodeId) return { statusCode: 400, body: "Missing ID" };
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const body = JSON.parse(event.body || "{}");
        const targetVersion = body.version;

        if (!targetVersion) return { statusCode: 400, body: "Missing target version" };

        // 1. Fetch the Historical Version
        const historyRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#v${targetVersion}` }
        }));

        if (!historyRes.Item) return { statusCode: 404, body: "Version not found" };

        // TYPE ASSERTION: Tell TS this DB item is a ContentItem
        const historyItem = historyRes.Item as ContentItem;

        // 2. Fetch Current (to determine NEXT version number)
        const currentRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` }
        }));
        const nextVersion = (currentRes.Item?.version || 1) + 1;

        // 3. Overwrite LATEST with History Data (Forward Rollback)
        const restoredItem = {
            ...historyItem, // Spread the typed item
            SK: `CONTENT#${nodeId}#LATEST`,
            version: nextVersion,
            updatedAt: new Date().toISOString(),
            updatedBy: auth.sub,
            restoredFromVersion: targetVersion
        };

        // Remove snapshot specific fields if they exist
        // @ts-ignore - snapshotCreatedAt might not be in ContentItem type definition but exists in DB
        delete restoredItem.snapshotCreatedAt;

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: restoredItem
        }));

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "RESTORE_PAGE",
            // FIX: Now TS knows restoredItem has a title
            target: { id: nodeId, title: restoredItem.title },
            details: { restoredFrom: targetVersion, newVersion: nextVersion },
            ip: event.requestContext.http.sourceIp
        });

        return { statusCode: 200, body: JSON.stringify({ message: "Restored", version: nextVersion }) };

    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
