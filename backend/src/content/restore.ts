import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { requireRole } from "../auth/policy.js";
import { ContentItem } from "@amodx/shared"; // Import the type
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { purgeStoredPagesOfRequestTenant } from "../lib/revalidate.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// POST /content/{id}/restore
const _restoreHandler: Handler = async (event) => {
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

        // LANG-1A (docs/slices/lang-1.md § 6.3, ruling LANG1-RESTORE-SCOPE = A). The Put replaces the whole LATEST, so it
        // is conditioned on the key as read (and, for a member, on the address as read):
        //  - the current LATEST has a `translationKey` (attribute present): the restored item keeps the CURRENT `slug`
        //    and the CURRENT key, conditioned `slug = :readSlug AND translationKey = :readKey` — a restore cannot change
        //    a member's derived language or set, and a concurrent rename fails it (409) instead of writing the old
        //    address back;
        //  - no key: today's restore exactly (the history's fields, its `slug` included, no route moved — finding
        //    F-LANG-RESTORE-SLUG stays), except that the restored item takes NO key from the history item; conditioned
        //    `attribute_not_exists(translationKey)`. A one-language site holds no key (rule C2), so the condition
        //    always holds and the stored item is HEAD's.
        const current = currentRes.Item;
        delete (restoredItem as { translationKey?: unknown }).translationKey;
        let condition: { ConditionExpression: string; ExpressionAttributeValues?: Record<string, unknown> };
        if (current !== undefined && current.translationKey !== undefined) {
            (restoredItem as Record<string, unknown>).translationKey = current.translationKey;
            if (current.slug === undefined) delete (restoredItem as { slug?: unknown }).slug;
            else restoredItem.slug = current.slug;
            condition = current.slug === undefined
                ? { ConditionExpression: "attribute_not_exists(slug) AND translationKey = :readKey", ExpressionAttributeValues: { ":readKey": current.translationKey } }
                : { ConditionExpression: "slug = :readSlug AND translationKey = :readKey", ExpressionAttributeValues: { ":readSlug": current.slug, ":readKey": current.translationKey } };
        } else {
            condition = { ConditionExpression: "attribute_not_exists(translationKey)" };
        }

        try {
            await db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: restoredItem,
                ...condition,
            }));
        } catch (e: any) {
            if (e?.name === "ConditionalCheckFailedException") {
                return { statusCode: 409, body: JSON.stringify({ error: "The page changed while restoring (its address or translation set); load it again." }) };
            }
            throw e;
        }

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

export const restoreHandler = withInvalidation(_restoreHandler, purgeStoredPagesOfRequestTenant);
