import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import {
    CognitoIdentityProviderClient,
    AdminUpdateUserAttributesCommand,
    AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

const ROLE_HIERARCHY: Record<string, number> = {
    GLOBAL_ADMIN: 3,
    TENANT_ADMIN: 2,
    EDITOR: 1,
};

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const auth = event.requestContext.authorizer.lambda;
        const targetUsername = event.pathParameters?.username;
        if (!targetUsername) return { statusCode: 400, body: JSON.stringify({ error: "Missing username" }) };

        // Must be at least TENANT_ADMIN
        try {
            requireRole(auth, ["TENANT_ADMIN"]);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        const body = JSON.parse(event.body || "{}");
        const { role: newRole, tenantId: newTenantId } = body;
        if (!newRole && newTenantId === undefined) {
            return { statusCode: 400, body: JSON.stringify({ error: "Nothing to update" }) };
        }

        // Fetch target user's current attributes
        const targetUser = await cognito.send(new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: targetUsername,
        }));
        const getAttr = (name: string) =>
            targetUser.UserAttributes?.find(a => a.Name === name)?.Value;
        const targetRole = getAttr("custom:role") || "EDITOR";
        const targetTenant = getAttr("custom:tenantId") || "GLOBAL";
        const targetEmail = getAttr("email") || targetUsername;

        // Self-protection
        if (auth.email === targetEmail) {
            return { statusCode: 403, body: JSON.stringify({ error: "You cannot change your own role" }) };
        }

        const actorRole = auth.role || "EDITOR";
        const actorLevel = ROLE_HIERARCHY[actorRole] || 0;
        const targetLevel = ROLE_HIERARCHY[targetRole] || 0;

        // Cannot manage someone with a higher role
        if (actorLevel < targetLevel) {
            return { statusCode: 403, body: JSON.stringify({ error: "Cannot manage a user with a higher role" }) };
        }

        // Validate new role
        if (newRole) {
            const newLevel = ROLE_HIERARCHY[newRole];
            if (newLevel === undefined) {
                return { statusCode: 400, body: JSON.stringify({ error: `Invalid role: ${newRole}` }) };
            }
            // Cannot promote above own level
            if (newLevel > actorLevel) {
                return { statusCode: 403, body: JSON.stringify({ error: "Cannot promote a user above your own role" }) };
            }
        }

        // Tenant scope change: only GLOBAL_ADMIN
        if (newTenantId !== undefined && actorRole !== "GLOBAL_ADMIN") {
            return { statusCode: 403, body: JSON.stringify({ error: "Only Global Admins can change tenant scope" }) };
        }

        // TENANT_ADMIN can only manage users in their own tenant
        if (actorRole === "TENANT_ADMIN" && targetTenant !== auth.tenantId) {
            return { statusCode: 403, body: JSON.stringify({ error: "Cannot manage users outside your tenant" }) };
        }

        // Build attribute updates
        const attributes: { Name: string; Value: string }[] = [];
        if (newRole) attributes.push({ Name: "custom:role", Value: newRole });
        if (newTenantId !== undefined) attributes.push({ Name: "custom:tenantId", Value: newTenantId });

        await cognito.send(new AdminUpdateUserAttributesCommand({
            UserPoolId: USER_POOL_ID,
            Username: targetUsername,
            UserAttributes: attributes,
        }));

        await publishAudit({
            tenantId: targetTenant,
            actor: { id: auth.sub || "", email: auth.email },
            action: "UPDATE_USER",
            target: { id: targetUsername, title: targetEmail },
            details: {
                ...(newRole ? { roleChange: { from: targetRole, to: newRole } } : {}),
                ...(newTenantId !== undefined ? { tenantChange: { from: targetTenant, to: newTenantId } } : {}),
            },
        });

        return { statusCode: 200, body: JSON.stringify({ message: "User updated" }) };

    } catch (e: any) {
        console.error(e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
