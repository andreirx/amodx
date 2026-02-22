import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import {
    CognitoIdentityProviderClient,
    AdminDeleteUserCommand,
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

        // Fetch target user
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
            return { statusCode: 403, body: JSON.stringify({ error: "You cannot delete yourself" }) };
        }

        const actorRole = auth.role || "EDITOR";
        const actorLevel = ROLE_HIERARCHY[actorRole] || 0;
        const targetLevel = ROLE_HIERARCHY[targetRole] || 0;

        // Cannot manage someone with a higher role
        if (actorLevel < targetLevel) {
            return { statusCode: 403, body: JSON.stringify({ error: "Cannot delete a user with a higher role" }) };
        }

        // TENANT_ADMIN can only manage users in their own tenant
        if (actorRole === "TENANT_ADMIN" && targetTenant !== auth.tenantId) {
            return { statusCode: 403, body: JSON.stringify({ error: "Cannot delete users outside your tenant" }) };
        }

        await cognito.send(new AdminDeleteUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: targetUsername,
        }));

        await publishAudit({
            tenantId: targetTenant,
            actor: { id: auth.sub || "", email: auth.email },
            action: "DELETE_USER",
            target: { id: targetUsername, title: targetEmail },
        });

        return { statusCode: 200, body: JSON.stringify({ message: "User deleted" }) };

    } catch (e: any) {
        console.error(e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
