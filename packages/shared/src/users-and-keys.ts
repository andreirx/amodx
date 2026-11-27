// Staff users (UserRole, UserProfileSchema), site members (TenantMemberSchema) and service keys (SERVICE-ACCOUNT-1).
// Moved out of index.ts by REFACTOR-SHARED-1 (moves only); index.ts re-exports it. Import siblings from their file, never from ./index.js.

import { z } from "zod";

export const UserRole = z.enum(["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"]);

// SERVICE-ACCOUNT-1: tenant-bound machine credentials (`amx_sk_…` keys). Fixed scope set. A key reaches a
// route only when the authorizer's allowlist SERVICE_ROUTE_SCOPES maps the route to a scope the key holds, and
// the key also holds the scope the route's handler declares to `requireRole` (backend/src/auth/policy.ts).
// The two declarations are kept equal by tests, not compared at runtime. A scope is added in the same change
// as the route that honours it.
//   catalog:read → GET /products     leads:read → GET /leads
//   catalog:write → POST /import/glam-pricelist (CAT-IMPORT-1; the future glamCRM push)
export const ServiceKeyScope = z.enum(["catalog:read", "leads:read", "catalog:write"]);
export type ServiceKeyScope = z.infer<typeof ServiceKeyScope>;

// What the API returns and the admin renders for one key. Never carries the hash or the secret.
export const ServiceKeyView = z.object({
    id: z.string(),
    tenantId: z.string(),
    name: z.string(),
    scopes: z.array(ServiceKeyScope),
    createdBy: z.string(),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
});
export type ServiceKeyView = z.infer<typeof ServiceKeyView>;

// USER PROFILE SCHEMA (Stored in DynamoDB, linked to Cognito ID)
export const UserProfileSchema = z.object({
    id: z.string(), // Matches Cognito SUB
    email: z.string(),

    // Multi-tenancy linkage
    tenantId: z.string(), // "SYSTEM" for you, "client-bob" for Bob
    role: UserRole,

    firstName: z.string().optional(),
    lastName: z.string().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// --- TENANT MEMBERS (End Users) ---
// People who log in to the Client Site (not the Agency Admin)
export const TenantMemberSchema = z.object({
    id: z.string(), // Cognito SUB from the "End User Pool"
    tenantId: z.string(),
    email: z.string(),
    role: z.enum(["Member", "Subscriber", "VIP"]).default("Member"),
    createdAt: z.string(),
});
export type TenantMember = z.infer<typeof TenantMemberSchema>;
