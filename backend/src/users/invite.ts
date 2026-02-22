import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { CognitoIdentityProviderClient, AdminCreateUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { publishAudit } from "../lib/events.js";
import { renderTemplate } from "../lib/order-email.js";
import crypto from "crypto";

const cognito = new CognitoIdentityProviderClient({});
const ses = new SESClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL!;

function generateTempPassword(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const special = "!@#$%";
    let pw = "";
    for (let i = 0; i < 10; i++) pw += chars[crypto.randomInt(chars.length)];
    pw += special[crypto.randomInt(special.length)];
    pw += String(crypto.randomInt(10));
    return pw;
}

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

export const handler: Handler = async (event) => {
    try {
        const auth = event.requestContext.authorizer.lambda;

        // Check body for tenantId to ensure they aren't inviting to a tenant they don't own
        const body = JSON.parse(event.body || "{}");
        const targetTenant = body.tenantId;

        try {
            // Must be Tenant Admin for that specific tenant
            requireRole(auth, ["TENANT_ADMIN"], targetTenant);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const { email, role, tenantId, emailSubject, emailBody } = JSON.parse(event.body);

        // 1. Validate
        if (!email) return { statusCode: 400, body: "Email required" };

        // 2. Generate temporary password
        const tempPassword = generateTempPassword();

        // 3. Create User — suppress Cognito's default email, we send our own
        await cognito.send(new AdminCreateUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: email,
            TemporaryPassword: tempPassword,
            MessageAction: "SUPPRESS",
            UserAttributes: [
                { Name: "email", Value: email },
                { Name: "email_verified", Value: "true" },
                { Name: "custom:role", Value: role || "EDITOR" },
                { Name: "custom:tenantId", Value: tenantId || "GLOBAL" }
            ],
        }));

        // 4. Send custom invite email via SES
        if (emailSubject && emailBody) {
            const roleLabel = role === "GLOBAL_ADMIN" ? "Global Admin"
                : role === "TENANT_ADMIN" ? "Site Admin"
                : "Editor";

            const vars: Record<string, string> = {
                email,
                password: tempPassword,
                role: roleLabel,
                siteName: body.siteName || "AMODX",
            };

            const renderedSubject = renderTemplate(emailSubject, vars);
            const renderedBody = renderTemplate(emailBody, vars);

            await ses.send(new SendEmailCommand({
                Source: SES_FROM_EMAIL,
                Destination: { ToAddresses: [email] },
                Message: {
                    Subject: { Data: renderedSubject, Charset: "UTF-8" },
                    Body: { Text: { Data: renderedBody, Charset: "UTF-8" } },
                },
            }));
        }

        await publishAudit({
            tenantId: tenantId || "GLOBAL",
            actor: { id: auth.sub || "", email: auth.email },
            action: "INVITE_USER",
            target: { id: email, title: email },
            details: { role: role || "EDITOR", tenantId: tenantId || "GLOBAL", customEmail: !!emailSubject },
        });

        return { statusCode: 201, body: JSON.stringify({ message: "User invited" }) };

    } catch (e: any) {
        console.error(e);
        if (e.name === "UsernameExistsException") {
            return { statusCode: 409, body: JSON.stringify({ error: "A user with this email already exists. Delete the existing user first, then re-invite." }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
