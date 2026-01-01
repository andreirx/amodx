import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { CognitoIdentityProviderClient, AdminCreateUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { AuthorizerContext } from "../auth/context";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const { email, role, tenantId } = JSON.parse(event.body);

        // 1. Validate
        if (!email) return { statusCode: 400, body: "Email required" };

        // 2. Create User (Sends Email Invitation automatically)
        await cognito.send(new AdminCreateUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: email,
            UserAttributes: [
                { Name: "email", Value: email },
                { Name: "email_verified", Value: "true" }, // Mark email as verified so they don't get stuck
                { Name: "custom:role", Value: role || "EDITOR" },
                { Name: "custom:tenantId", Value: tenantId || "GLOBAL" }
            ],
            DesiredDeliveryMediums: ["EMAIL"]
        }));

        return { statusCode: 201, body: JSON.stringify({ message: "User invited" }) };

    } catch (e: any) {
        console.error(e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
