import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * GET /settings/secrets — returns only secret fields from tenant config.
 * Restricted to TENANT_ADMIN and GLOBAL_ADMIN.
 *
 * The main GET /settings endpoint strips these fields for all callers.
 * This endpoint exists so that the admin UI can load secrets into
 * privileged form fields without exposing them to EDITOR-role users.
 *
 * Secret fields returned:
 *   - recaptcha.secretKey
 *   - integrations.google.clientSecret
 *   - integrations.braveApiKey
 */
export const handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        }

        // Strict: TENANT_ADMIN or GLOBAL_ADMIN only
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }
        }));

        if (!result.Item) {
            return { statusCode: 404, body: JSON.stringify({ error: "Tenant not found" }) };
        }

        const config = result.Item;

        // Return only secret fields — structured to allow deep merge on the client
        const secrets = {
            recaptcha: {
                secretKey: config.recaptcha?.secretKey || "",
            },
            integrations: {
                google: {
                    clientSecret: config.integrations?.google?.clientSecret || "",
                },
                braveApiKey: config.integrations?.braveApiKey || "",
            },
        };

        return {
            statusCode: 200,
            headers: { "Cache-Control": "no-store" },
            body: JSON.stringify(secrets),
        };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
