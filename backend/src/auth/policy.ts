import { AuthorizerContext } from "./context.js";
import type { ServiceKeyScope } from "@amodx/shared";

/**
 * SERVICE-ACCOUNT-1 (ruling D-SA-E) — the ONLY authorizer-protected routes a service key may reach, and the scope
 * each needs. (Routes configured `authorizationType: NONE` run no authorizer; a key there is not evaluated and
 * confers nothing over anonymous.)
 * The authorizer refuses a found key on any route key absent from this table, before any Lambda runs, so the
 * guarantee does not depend on a handler calling `requireRole`. The route's handler also declares a scope as
 * `requireRole`'s fourth argument (defence in depth). Each layer checks only ITS OWN declaration: a route absent
 * from this table is denied by the authorizer; a handler with no declaration is denied by `requireRole`. Nothing
 * compares the two declarations at runtime — keeping them equal is a maintenance requirement, pinned by the policy
 * test (exact table contents) and the route tests (each handler admits a key holding only its table scope).
 */
export const SERVICE_ROUTE_SCOPES: Readonly<Record<string, ServiceKeyScope>> = Object.freeze({
    "GET /products": "catalog:read",
    "GET /leads": "leads:read",
});

/**
 * `serviceScope` (SERVICE-ACCOUNT-1) is the HANDLER-side admission of a service key (`role: "SERVICE"`), defence
 * in depth behind the authorizer's SERVICE_ROUTE_SCOPES allowlist (the guarantee for every route behind the Lambda
 * authorizer, including handlers that never call this function). Here, a SERVICE caller passes only when the handler declares a scope,
 * names a target tenant equal to the key's tenant, and the key holds that scope; a handler that omits the argument
 * refuses keys, and putting "SERVICE" in `allowedRoles` admits nothing. Non-SERVICE callers ignore `serviceScope`.
 */
export function requireRole(
    auth: AuthorizerContext,
    allowedRoles: string[],
    targetTenantId?: string,
    serviceScope?: ServiceKeyScope
) {
    // 0. Safety Check
    if (!auth) throw new Error("Unauthorized: No Auth Context");

    // 1. Global Admin (or Robot) allows everything
    if (auth.role === 'GLOBAL_ADMIN') return true;

    // 1b. Service key — decided here, before the EDITOR default below can apply.
    if (auth.role === 'SERVICE') {
        if (!serviceScope) {
            throw new Error("Access Denied: this route is not available to service keys");
        }
        if (!targetTenantId) {
            throw new Error("Access Denied: service key call names no target tenant");
        }
        if (auth.tenantId !== targetTenantId) {
            console.warn(`Security Alert: Service key ${auth.sub} (Tenant: ${auth.tenantId}) tried to access ${targetTenantId}`);
            throw new Error("Access Denied: service key is bound to another tenant");
        }
        const held = (auth.scopes ?? "").split(",");
        if (!held.includes(serviceScope)) {
            throw new Error(`Access Denied: service key lacks scope ${serviceScope}`);
        }
        return true;
    }

    // 2. Role Check
    const userRole = auth.role || 'EDITOR';
    if (!allowedRoles.includes(userRole)) {
        throw new Error(`Access Denied: Role '${userRole}' is not in [${allowedRoles.join(', ')}]`);
    }

    // 3. Tenant Scope Check
    // If user is NOT Global, they MUST be scoped to the tenant they are trying to access.
    if (targetTenantId) {
        if (!auth.tenantId) throw new Error("Access Denied: Token has no tenant scope");

        // Strict Equality Check
        if (auth.tenantId !== targetTenantId) {
            console.warn(`Security Alert: User ${auth.sub} (Tenant: ${auth.tenantId}) tried to access ${targetTenantId}`);
            throw new Error(`Access Denied: You do not have access to this tenant.`);
        }
    }

    return true;
}
