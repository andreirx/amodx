import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE_NAME } from "../lib/db.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { revalidateTenantPaths } from "../lib/revalidate.js";
import { deletableRedirect, deleteRequestOf, refusalResponse, routeAtOf } from "./rules.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * REDIRECT-1 — `DELETE /redirects` `{from}`: deletes the redirect at `ROUTE#<from>`, `from` exactly as the list shows
 * it. Only a redirect: the delete is conditioned on the redirect as read (`IsRedirect = true AND RedirectTo = <read>`),
 * so a page route is never deleted (409). `/` and `/contact` are refused before any read (system routes,
 * docs/database-patterns.md Hard Rules item 4). Keys come from `x-tenant-id` only. 200 `{from}`.
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
        const address = deleteRequestOf(body && typeof body === "object" ? body : {});
        if (!address.ok) return refusalResponse(address.refusal);
        const from = address.value;

        const key = { PK: `TENANT#${tenantId}`, SK: `ROUTE#${from}` };
        const at = routeAtOf((await db.send(new GetCommand({ TableName: TABLE_NAME, Key: key }))).Item);
        const redirect = deletableRedirect(from, at);
        if (!redirect.ok) return refusalResponse(redirect.refusal);
        const { to } = redirect.value;

        try {
            await db.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: key,
                // The redirect as read: a page route, or a redirect replaced meanwhile, is not deleted.
                ConditionExpression: "IsRedirect = :yes AND RedirectTo = :to",
                ExpressionAttributeValues: { ":yes": true, ":to": to },
            }));
        } catch (e: any) {
            if (e?.name === "ConditionalCheckFailedException") return refusalResponse({ kind: "changed-meanwhile", address: from });
            throw e;
        }

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "DELETE_REDIRECT",
            target: { id: `ROUTE#${from}`, title: `${from} → ${to}` },
            details: { from, to },
            ip: event.requestContext.http.sourceIp,
        });
        await revalidateTenantPaths(tenantId, "page", [from]);

        return { statusCode: 200, body: JSON.stringify({ from }) };
    } catch (error: any) {
        console.error("[DeleteRedirect]", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
