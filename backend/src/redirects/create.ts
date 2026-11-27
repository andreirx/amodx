import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "../lib/db.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { readReservedAddresses } from "../lib/slug-guard.js";
import { revalidateTenantPaths } from "../lib/revalidate.js";
import { redirectRouteItem } from "../content/update.js";
import { createRefusal, createRequestOf, effectiveTarget, fromRefusal, refusalResponse, routeAtOf } from "./rules.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * REDIRECT-1 — `POST /redirects` `{from, to}`: an owner adds a permanent redirect from an old address. Writes the ONE
 * redirect route item (`redirectRouteItem`, content/update.ts — the item of the slug rename and of the WordPress
 * importer) at `ROUTE#<from>` in ONE transaction of two actions: the Put under `attribute_not_exists(SK)` (a page or
 * another redirect at `from` is never overwritten), and a ConditionCheck that the route at the effective target
 * (`effectiveTarget`: `to`, or for `/` the home page's route) is a page route or missing at commit time — `IsRedirect`
 * absent or `false`, exactly `routeAtOf`'s page/none (review-2 F-R1-TARGET-PREDICATE: any other stored value, which the
 * renderer may serve as a redirect, is refused). Guarantee, and only this: the
 * destination is checked at insertion, so two concurrent adds `/a → /b` and `/b → /a` cannot both succeed (DynamoDB
 * serializes the transactions; tested). NOT guaranteed: no check that another redirect points AT `from`, so when
 * `/a → /b` commits before `/b → /c` (also when the requests overlap) both succeed and make a chain
 * (F-REDIRECT1-REVERSE-CHAIN); in the other order the second add is refused. Keys come from `x-tenant-id` only.
 * Reads: the tenant record twice (reserved addresses; `homePageSlug`), the route at `from` and at the target.
 * Refusals: redirects/rules.ts. 201 `{from, to}` as stored.
 */
export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers["x-tenant-id"];
        const auth = event.requestContext.authorizer.lambda;
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id" }) };
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        let body: any;
        try {
            body = JSON.parse(event.body || "{}");
        } catch {
            return { statusCode: 400, body: JSON.stringify({ error: "The body is not JSON." }) };
        }
        const request = createRequestOf(body && typeof body === "object" ? body : {});
        if (!request.ok) return refusalResponse(request.refusal);
        const { from, to } = request.value;

        const [reserved, tenant] = await Promise.all([
            readReservedAddresses(tenantId),
            db.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }, ProjectionExpression: "homePageSlug" })),
        ]);
        const onSite = fromRefusal(from, reserved);
        if (onSite) return refusalResponse(onSite);
        const homePageSlug = typeof tenant.Item?.homePageSlug === "string" ? tenant.Item.homePageSlug : undefined;
        const target = effectiveTarget(to, homePageSlug);

        const routeKey = (address: string) => ({ PK: `TENANT#${tenantId}`, SK: `ROUTE#${address}` });
        const [atFrom, atTarget] = await Promise.all([
            db.send(new GetCommand({ TableName: TABLE_NAME, Key: routeKey(from) })),
            db.send(new GetCommand({ TableName: TABLE_NAME, Key: routeKey(target) })),
        ]);
        const onTable = createRefusal(from, to, homePageSlug, routeAtOf(atFrom.Item), routeAtOf(atTarget.Item));
        if (onTable) return refusalResponse(onTable);

        // `target !== from` here (createRefusal refuses equality), so the two actions name two items.
        const guarded = [from, target];
        try {
            await db.send(new TransactWriteCommand({
                TransactItems: [
                    { Put: { TableName: TABLE_NAME, Item: redirectRouteItem(tenantId, from, to, new Date().toISOString(), auth.sub), ConditionExpression: "attribute_not_exists(SK)" } },
                    // `routeAtOf`'s page or none, nothing else: no `IsRedirect` (a missing route, or a page route of
                    // content/create.ts or the rename) or Boolean `false`. `true` and every other stored value fail it.
                    { ConditionCheck: { TableName: TABLE_NAME, Key: routeKey(target), ConditionExpression: "attribute_not_exists(IsRedirect) OR IsRedirect = :no", ExpressionAttributeValues: { ":no": false } } },
                ],
            }));
        } catch (e: any) {
            if (e?.name === "TransactionCanceledException") {
                // ConditionalCheckFailed: the state read changed; TransactionConflict: another transaction holds the item.
                const at = (e.CancellationReasons as { Code?: string }[] | undefined)
                    ?.findIndex((r) => r?.Code === "ConditionalCheckFailed" || r?.Code === "TransactionConflict") ?? -1;
                if (at >= 0) return refusalResponse({ kind: "changed-meanwhile", address: guarded[at] });
            }
            throw e;
        }

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "CREATE_REDIRECT",
            target: { id: `ROUTE#${from}`, title: `${from} → ${to}` },
            details: { from, to },
            ip: event.requestContext.http.sourceIp,
        });
        // The way a slug rename purges its old slug (content/update.ts): `from` may hold a cached 404.
        await revalidateTenantPaths(tenantId, "page", [from]);

        return { statusCode: 201, body: JSON.stringify({ from, to }) };
    } catch (error: any) {
        console.error("[CreateRedirect]", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
