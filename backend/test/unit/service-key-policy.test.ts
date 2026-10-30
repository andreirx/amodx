import { describe, it, expect } from "vitest";
import { requireRole, SERVICE_ROUTE_SCOPES } from "../../src/auth/policy.js";

/**
 * SERVICE-ACCOUNT-1 — `requireRole`'s fourth argument is the handler-side admission of a service key (defence in
 * depth; the guarantee for every authorized route is the authorizer allowlist SERVICE_ROUTE_SCOPES, pinned at the end of this file).
 * A SERVICE context (as built by the authorizer's `amx_sk_` branch) passes only when the route declares a
 * scope, names a target tenant equal to the key's tenant, and the key holds the scope. Every other role's
 * behaviour is unchanged by a declared scope. Pure: no AWS, no mocks.
 */

const ADMIN_ROLES = ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"];
const SERVICE = { sub: "service:k1", role: "SERVICE", tenantId: "t1", scopes: "catalog:read,leads:read", keyId: "k1" };

describe("SERVICE-ACCOUNT-1 — requireRole with a SERVICE context", () => {
    it("SERVICE holding the scope, header = key tenant → authorised", () => {
        expect(requireRole(SERVICE, ADMIN_ROLES, "t1", "catalog:read")).toBe(true);
        expect(requireRole(SERVICE, ADMIN_ROLES, "t1", "leads:read")).toBe(true);
    });

    it("SERVICE lacking the declared scope → throws 'lacks scope'", () => {
        const catalogOnly = { ...SERVICE, scopes: "catalog:read" };
        expect(() => requireRole(catalogOnly, ADMIN_ROLES, "t1", "leads:read")).toThrow(/lacks scope leads:read/);
    });

    it("SERVICE on a route with no declared scope → throws 'not available to service keys'", () => {
        expect(() => requireRole(SERVICE, ADMIN_ROLES, "t1")).toThrow(/not available to service keys/);
    });

    it("SERVICE with header ≠ key tenant → throws 'bound to another tenant'", () => {
        expect(() => requireRole(SERVICE, ADMIN_ROLES, "t2", "catalog:read")).toThrow(/bound to another tenant/);
    });

    it("SERVICE with no target tenant → throws", () => {
        expect(() => requireRole(SERVICE, ADMIN_ROLES, undefined, "catalog:read")).toThrow(/Access Denied/);
    });

    it("SERVICE with empty scopes string → throws", () => {
        expect(() => requireRole({ ...SERVICE, scopes: "" }, ADMIN_ROLES, "t1", "catalog:read")).toThrow(/lacks scope/);
        // and with the field absent altogether
        const { scopes: _drop, ...noScopes } = SERVICE;
        expect(() => requireRole(noScopes, ADMIN_ROLES, "t1", "catalog:read")).toThrow(/lacks scope/);
    });

    it("allowedRoles containing 'SERVICE' does not admit a key without a declared scope", () => {
        expect(() => requireRole(SERVICE, [...ADMIN_ROLES, "SERVICE"], "t1")).toThrow(/not available to service keys/);
    });
});

describe("SERVICE-ACCOUNT-1 — other roles unchanged when a serviceScope is declared", () => {
    it.each([
        ["EDITOR", { sub: "u1", role: "EDITOR", tenantId: "t1" }],
        ["TENANT_ADMIN", { sub: "u2", role: "TENANT_ADMIN", tenantId: "t1" }],
    ])("EDITOR / TENANT_ADMIN / CUSTOMER rows unchanged when a serviceScope is declared — %s: own tenant passes, foreign tenant throws", (_n, ctx) => {
        expect(requireRole(ctx, ADMIN_ROLES, "t1", "catalog:read")).toBe(true);
        expect(() => requireRole(ctx, ADMIN_ROLES, "t2", "catalog:read")).toThrow(/do not have access to this tenant/);
    });

    it("EDITOR / TENANT_ADMIN / CUSTOMER rows unchanged when a serviceScope is declared — CUSTOMER: refused by role as before", () => {
        const customer = { sub: "c1", role: "CUSTOMER", tenantId: "t1" };
        expect(() => requireRole(customer, ADMIN_ROLES, "t1", "catalog:read")).toThrow(/Role 'CUSTOMER' is not in/);
    });

    it("GLOBAL_ADMIN bypass unchanged with a serviceScope declared", () => {
        const robot = { sub: "system-robot", role: "GLOBAL_ADMIN", tenantId: "ALL" };
        expect(requireRole(robot, ADMIN_ROLES, "t2", "catalog:read")).toBe(true);
        expect(requireRole(robot, ["TENANT_ADMIN"], undefined, "leads:read")).toBe(true);
    });
});

describe("SERVICE-ACCOUNT-1 — the authorizer's route allowlist (D-SA-E)", () => {
    it("SERVICE_ROUTE_SCOPES has exactly 'GET /products', 'GET /leads', 'POST /import/glam-pricelist' and 'POST /import/glam-pricelist/images'", () => {
        // Pins the allowlist: opening a route to service keys is a deliberate edit of this table AND this test.
        expect({ ...SERVICE_ROUTE_SCOPES }).toEqual({
            "GET /products": "catalog:read",
            "GET /leads": "leads:read",
            "POST /import/glam-pricelist": "catalog:write",
            "POST /import/glam-pricelist/images": "catalog:write",
        });
        expect(Object.isFrozen(SERVICE_ROUTE_SCOPES)).toBe(true);
    });
});
