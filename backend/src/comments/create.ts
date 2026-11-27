import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { CommentSchema, normalizeEmail } from "@amodx/shared";
import { createOrFillLead } from "../lib/lead-write.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// Phase 2.2: RENDERER role can create comments (in addition to admin roles)
const ALLOWED_ROLES = ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR", "RENDERER"];

const _handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };

        // Verify role (RENDERER role is allowed for comment creation)
        const auth = event.requestContext.authorizer?.lambda as AuthorizerContext;
        try {
            requireRole(auth, ALLOWED_ROLES, tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        const body = JSON.parse(event.body || "{}");

        // 1. Trust the Proxy
        // Since the request passed the Authorizer with Master Key (Robot),
        // we accept the author details provided in the body.

        // Schema Validation (Ensure body contains author details)
        // We might need to update CommentSchema to make sure these are required in the payload
        // if we are passing them from the proxy.
        // For now, let's merge manually to ensure they overwrite any defaults.

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        // 1. Validate Comment. LEAD-NORMALIZE-1 (docs/slices/lead-normalize-1.md): the address is validated on its
        // normalized form (PD-001); an invalid one throws here → 500, nothing written (unchanged answer). The comment item
        // below keeps `authorEmail` as sent; only the lead uses the normalized address.
        const authorEmail = typeof body.authorEmail === "string" ? normalizeEmail(body.authorEmail) : body.authorEmail;
        const input = CommentSchema.omit({
            id: true,
            tenantId: true,
            createdAt: true
        }).parse({ ...body, authorEmail });

        // 2. Prepare Items
        const commentItem = {
            PK: `TENANT#${tenantId}`,
            SK: `COMMENT#${input.pageId}#${now}`,
            id,
            tenantId,
            ...input,
            // Trust the proxy/auth details
            authorName: body.authorName,
            authorEmail: body.authorEmail,
            authorImage: body.authorImage,
            authorId: body.authorId,
            status: "Approved", // Auto-approve per current strategy
            createdAt: now,
            Type: "Comment"
        };

        // 3. The lead: created when absent; an existing lead (any writer's) keeps every stored value — its first `createdAt`
        // and `source`, the owner's `status` (LEAD-NORMALIZE-1, `createOrFillLead`).
        const leadUpdate = createOrFillLead(tenantId, input.authorEmail, { name: body.authorName, source: "Comment", createdAt: now });

        // 4. Atomic Write
        await db.send(new TransactWriteCommand({
            TransactItems: [
                {
                    Put: {
                        TableName: TABLE_NAME,
                        Item: commentItem
                    }
                },
                { Update: leadUpdate }
            ]
        }));

        return { statusCode: 201, body: JSON.stringify({ id, message: "Comment Posted" }) };
    } catch (error: any) {
        console.error(error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export const handler = _handler;
