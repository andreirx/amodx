import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

interface BraveSearchResult {
    title: string;
    url: string;
    description: string;
}

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Forbidden";
            return { statusCode: 403, body: JSON.stringify({ error: message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing body" }) };

        const body = JSON.parse(event.body);
        const query = body.query;

        if (!query || typeof query !== "string") {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid 'query' in body" }) };
        }

        // Fetch tenant config to get Brave API key
        const tenantResult = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
        }));

        const tenantConfig = tenantResult.Item;
        if (!tenantConfig) {
            return { statusCode: 404, body: JSON.stringify({ error: "Tenant not found" }) };
        }

        const braveApiKey = tenantConfig.integrations?.braveApiKey;
        if (!braveApiKey) {
            return { statusCode: 400, body: JSON.stringify({ error: "Brave Search not configured. Add API key in Settings." }) };
        }

        // Call Brave Search API
        const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
        const braveResponse = await fetch(searchUrl, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "X-Subscription-Token": braveApiKey,
            },
        });

        if (!braveResponse.ok) {
            const errorText = await braveResponse.text();
            return { statusCode: braveResponse.status, body: JSON.stringify({ error: `Brave API error: ${errorText}` }) };
        }

        const braveData = await braveResponse.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };

        // Format results
        const results: BraveSearchResult[] = (braveData.web?.results || []).slice(0, 10).map((r) => ({
            title: r.title,
            url: r.url,
            description: r.description,
        }));

        return { statusCode: 200, body: JSON.stringify({ query, results }) };
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Internal error";
        return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
};
