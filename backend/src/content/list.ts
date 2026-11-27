import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand, QueryCommand, type QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { routeAtOf, targetFound, type RouteAt } from "../redirects/rules.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    const start = Date.now();
    let itemCount = 0;

    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const type = event.queryStringParameters?.type || "Content";

        if (type === "Redirect") {
            // REDIRECT-1 (docs/slices/redirect-1.md, ruling 4): every route of the tenant (paginated, projected — Critical
            // Rule 2), the redirects among them, each with `targetFound` (redirects/rules.ts `targetFound`: route presence
            // only), computed from the routes this query already reads + one tenant read (`homePageSlug`, for `/`).
            // Before REDIRECT-1: one unpaginated page, whole items.
            const routes: Record<string, any>[] = [];
            let startKey: Record<string, any> | undefined = undefined;
            do {
                const page: QueryCommandOutput = await db.send(new QueryCommand({
                    TableName: TABLE_NAME,
                    KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                    ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "ROUTE#" },
                    ProjectionExpression: "SK, #redirect, #to, #created, #by",
                    ExpressionAttributeNames: { "#redirect": "IsRedirect", "#to": "RedirectTo", "#created": "CreatedAt", "#by": "UpdatedBy" },
                    ExclusiveStartKey: startKey,
                }));
                routes.push(...(page.Items ?? []));
                startKey = page.LastEvaluatedKey;
            } while (startKey);
            const tenant = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }, ProjectionExpression: "homePageSlug" }));
            const byAddress = new Map<string, RouteAt>(routes.map((r) => [String(r.SK).slice("ROUTE#".length), routeAtOf(r)]));
            const homePageSlug = typeof tenant.Item?.homePageSlug === "string" ? tenant.Item.homePageSlug : undefined;
            const redirects = routes.filter(i => i.IsRedirect === true)
                .map((i) => ({ ...i, targetFound: targetFound(String(i.RedirectTo), byAddress, homePageSlug) }));
            return { statusCode: 200, body: JSON.stringify({ items: redirects }) };
        }

        let items: Record<string, any>[] = [];
        let lastEvaluatedKey: Record<string, any> | undefined = undefined;
        let loopCount = 0;

        do {
            // FIX: Explicit Type
            const command: QueryCommand = new QueryCommand({
                TableName: TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues: {
                    ":pk": `TENANT#${tenantId}`,
                    ":sk": "CONTENT#"
                },
                // LANG-1A (§ 10): `translationKey` too, so the editor's "Translation of" picker needs no other read.
                ProjectionExpression: "SK, nodeId, id, title, slug, #s, commentsMode, accessPolicy, tags, featuredImage, createdAt, updatedAt, author, authorEmail, seoDescription, translationKey",
                ExpressionAttributeNames: { "#s": "status" },
                ExclusiveStartKey: lastEvaluatedKey
            });

            const res = await db.send(command);

            if (res.Items) {
                items.push(...res.Items);
            }

            lastEvaluatedKey = res.LastEvaluatedKey;
            loopCount++;

            if (loopCount > 20) break;

        } while (lastEvaluatedKey);

        itemCount = items.length;
        const filtered = items.filter(item => item.SK.endsWith("#LATEST"));

        // LANG-1A (docs/slices/lang-1.md § 6.2, § 10; review R-L1A-01): the editor applies the membership rule, so a page
        // whose LATEST holds a set key gets `hasTranslationItem` = whether `TRANSLATION#<that key>#<nodeId>` exists
        // (conditions 1 and 3; status and address are in the item). The membership items are read only when a page
        // holds a key: a site without keys (every one-language site, rule C2) gets today's response and query.
        const keyed = filtered.filter(item => typeof item.translationKey === "string" && item.translationKey !== "");
        if (keyed.length > 0) {
            const memberships = new Set<string>();
            let start: Record<string, any> | undefined = undefined;
            do {
                const page: QueryCommandOutput = await db.send(new QueryCommand({
                    TableName: TABLE_NAME,
                    KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                    ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "TRANSLATION#" },
                    ProjectionExpression: "SK",
                    ExclusiveStartKey: start,
                }));
                for (const m of page.Items ?? []) memberships.add(String(m.SK));
                start = page.LastEvaluatedKey;
            } while (start);
            for (const item of keyed) item.hasTranslationItem = memberships.has(`TRANSLATION#${item.translationKey}#${item.nodeId}`);
        }

        const duration = Date.now() - start;
        console.log(`[ListContent] Success. RawItems: ${itemCount}, Returned: ${filtered.length}, Time: ${duration}ms`);

        return { statusCode: 200, body: JSON.stringify({ items: filtered }) };

    } catch (error: any) {
        console.error("[ListContent] CRITICAL ERROR:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message,
                requestId: event.requestContext.requestId
            })
        };
    }
};
