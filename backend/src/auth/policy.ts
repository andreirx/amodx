import { AuthorizerContext } from "./context.js";

export function requireRole(
    auth: AuthorizerContext,
    allowedRoles: string[],
    targetTenantId?: string
) {
    // 0. Safety Check
    if (!auth) throw new Error("Unauthorized: No Auth Context");

    // 1. Global Admin (or Robot) allows everything
    if (auth.role === 'GLOBAL_ADMIN') return true;

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
