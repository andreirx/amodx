import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { CognitoIdentityProviderClient, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
import { AuthorizerContext } from "../auth/context.js";
import {requireRole} from "../auth/policy.js";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const auth = event.requestContext.authorizer.lambda;
        const tenantId = event.headers['x-tenant-id'];
        const requesterRole = auth.role || "EDITOR";
        const requesterTenant = auth.tenantId;

        // 1. FAIL if no tenant ID (No more "DEMO")
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // 2. ENFORCE Policy
        // Editors and Admins can list content
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        // 1. Fetch Users
        const command = new ListUsersCommand({
            UserPoolId: USER_POOL_ID,
            // In a real app with >60 users, handle PaginationToken
        });
        const response = await cognito.send(command);

        // 2. Map & Filter
        const users = (response.Users || []).map(u => {
            const attrs = u.Attributes || [];
            const getAttr = (name: string) => attrs.find(a => a.Name === name)?.Value;

            return {
                username: u.Username,
                status: u.UserStatus,
                enabled: u.Enabled !== false,
                email: getAttr('email'),
                role: getAttr('custom:role') || 'EDITOR',
                tenantId: getAttr('custom:tenantId') || 'GLOBAL',
                created: u.UserCreateDate
            };
        }).filter(u => {
            // Global Admins see everyone
            if (requesterRole === 'GLOBAL_ADMIN') return true;
            // Tenant Admins only see their own tenant users
            if (requesterTenant && u.tenantId === requesterTenant) return true;
            return false;
        });

        return { statusCode: 200, body: JSON.stringify({ items: users }) };

    } catch (e: any) {
        console.error(e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
