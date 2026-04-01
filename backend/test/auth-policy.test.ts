import { describe, it, expect } from 'vitest';
import { requireRole } from '../src/auth/policy';
import { AuthorizerContext } from '../src/auth/context';

/**
 * Unit tests for requireRole() focusing on the CUSTOMER role.
 *
 * These tests verify that:
 * 1. CUSTOMER identity is rejected by all existing admin-only role lists
 * 2. CUSTOMER identity is accepted when explicitly allowed
 * 3. Cross-tenant access is blocked for CUSTOMER same as for any other role
 * 4. The EDITOR default fallback (policy.ts line 15) is documented and visible
 * 5. GLOBAL_ADMIN bypass works regardless of role list
 *
 * IMPORTANT: These tests do NOT test the authorizer itself — only the policy
 * function. The authorizer's CUSTOMER branch correctness (always setting
 * role: "CUSTOMER" and validated tenantId) must be verified via integration
 * tests against actual Cognito pool tokens.
 */

describe('requireRole — CUSTOMER role', () => {

    // --- CUSTOMER rejected by admin-only routes ---

    it('rejects CUSTOMER on EDITOR-only routes', () => {
        const auth: AuthorizerContext = {
            sub: 'pub-user-1',
            email: 'customer@example.com',
            role: 'CUSTOMER',
            tenantId: 'tenant-1',
        };
        expect(() => requireRole(auth, ['EDITOR', 'TENANT_ADMIN'], 'tenant-1'))
            .toThrow('Access Denied');
    });

    it('rejects CUSTOMER on the broadest admin role list', () => {
        const auth: AuthorizerContext = {
            sub: 'pub-user-1',
            email: 'customer@example.com',
            role: 'CUSTOMER',
            tenantId: 'tenant-1',
        };
        // This is the most permissive admin role list used in the codebase
        expect(() => requireRole(auth, ['GLOBAL_ADMIN', 'TENANT_ADMIN', 'EDITOR'], 'tenant-1'))
            .toThrow('Access Denied');
    });

    it('rejects CUSTOMER on TENANT_ADMIN-only routes', () => {
        const auth: AuthorizerContext = {
            sub: 'pub-user-1',
            email: 'customer@example.com',
            role: 'CUSTOMER',
            tenantId: 'tenant-1',
        };
        expect(() => requireRole(auth, ['TENANT_ADMIN'], 'tenant-1'))
            .toThrow('Access Denied');
    });

    it('rejects CUSTOMER on RENDERER-only routes', () => {
        const auth: AuthorizerContext = {
            sub: 'pub-user-1',
            email: 'customer@example.com',
            role: 'CUSTOMER',
            tenantId: 'tenant-1',
        };
        expect(() => requireRole(auth, ['GLOBAL_ADMIN', 'RENDERER'], 'tenant-1'))
            .toThrow('Access Denied');
    });

    // --- CUSTOMER accepted when explicitly allowed ---

    it('accepts CUSTOMER when CUSTOMER is in allowedRoles', () => {
        const auth: AuthorizerContext = {
            sub: 'pub-user-1',
            email: 'customer@example.com',
            role: 'CUSTOMER',
            tenantId: 'tenant-1',
        };
        expect(requireRole(auth, ['CUSTOMER'], 'tenant-1')).toBe(true);
    });

    it('accepts CUSTOMER in mixed role list including CUSTOMER', () => {
        const auth: AuthorizerContext = {
            sub: 'pub-user-1',
            email: 'customer@example.com',
            role: 'CUSTOMER',
            tenantId: 'tenant-1',
        };
        expect(requireRole(auth, ['EDITOR', 'CUSTOMER'], 'tenant-1')).toBe(true);
    });

    // --- Cross-tenant isolation ---

    it('rejects CUSTOMER accessing a different tenant', () => {
        const auth: AuthorizerContext = {
            sub: 'pub-user-1',
            email: 'customer@example.com',
            role: 'CUSTOMER',
            tenantId: 'tenant-1',
        };
        expect(() => requireRole(auth, ['CUSTOMER'], 'tenant-2'))
            .toThrow('Access Denied');
    });

    it('rejects CUSTOMER with empty tenantId', () => {
        const auth: AuthorizerContext = {
            sub: 'pub-user-1',
            email: 'customer@example.com',
            role: 'CUSTOMER',
            tenantId: '',
        };
        expect(() => requireRole(auth, ['CUSTOMER'], 'tenant-1'))
            .toThrow('Access Denied');
    });

    it('rejects CUSTOMER with undefined tenantId', () => {
        const auth: AuthorizerContext = {
            sub: 'pub-user-1',
            email: 'customer@example.com',
            role: 'CUSTOMER',
            tenantId: undefined,
        };
        expect(() => requireRole(auth, ['CUSTOMER'], 'tenant-1'))
            .toThrow('Access Denied');
    });
});

describe('requireRole — existing roles (regression)', () => {

    it('accepts EDITOR on EDITOR routes with matching tenant', () => {
        const auth: AuthorizerContext = {
            sub: 'admin-1',
            email: 'editor@agency.com',
            role: 'EDITOR',
            tenantId: 'tenant-1',
        };
        expect(requireRole(auth, ['EDITOR', 'TENANT_ADMIN'], 'tenant-1')).toBe(true);
    });

    it('GLOBAL_ADMIN bypasses any role list', () => {
        const auth: AuthorizerContext = {
            sub: 'admin-global',
            email: 'admin@agency.com',
            role: 'GLOBAL_ADMIN',
            tenantId: 'ALL',
        };
        // Even an empty allowedRoles list passes for GLOBAL_ADMIN
        expect(requireRole(auth, [])).toBe(true);
    });

    it('GLOBAL_ADMIN bypasses tenant scope check', () => {
        const auth: AuthorizerContext = {
            sub: 'admin-global',
            email: 'admin@agency.com',
            role: 'GLOBAL_ADMIN',
            tenantId: 'ALL',
        };
        expect(requireRole(auth, [], 'tenant-1')).toBe(true);
    });

    it('rejects EDITOR accessing a different tenant', () => {
        const auth: AuthorizerContext = {
            sub: 'admin-1',
            email: 'editor@agency.com',
            role: 'EDITOR',
            tenantId: 'tenant-1',
        };
        expect(() => requireRole(auth, ['EDITOR'], 'tenant-2'))
            .toThrow('Access Denied');
    });

    it('rejects when auth context is missing', () => {
        expect(() => requireRole(null as any, ['EDITOR'])).toThrow('Unauthorized');
    });

    // IMPORTANT: This test documents the EDITOR default fallback behavior.
    // policy.ts line 15: `const userRole = auth.role || 'EDITOR'`
    // If the authorizer ever returns a context without a role field,
    // the user is treated as EDITOR. This is why the public pool branch
    // must ALWAYS set role: "CUSTOMER" explicitly.
    it('defaults missing role to EDITOR (documents privilege escalation risk)', () => {
        const auth: AuthorizerContext = {
            sub: 'some-user',
            email: 'user@example.com',
            role: undefined,
            tenantId: 'tenant-1',
        };
        // This PASSES because undefined role defaults to EDITOR
        expect(requireRole(auth, ['EDITOR'], 'tenant-1')).toBe(true);
    });
});
