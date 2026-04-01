import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * Authorizer-level tests for the Public Cognito pool branch.
 *
 * These test the actual authorizer handler, not just requireRole().
 * CognitoJwtVerifier and SecretsManager are mocked to isolate the
 * cascade logic, env-pair validation, tenant_id enforcement, and
 * hard-coded CUSTOMER role.
 *
 * The authorizer reads env vars and creates verifiers at module scope.
 * We use vi.resetModules() + dynamic import so each describe block
 * loads the module with its own env var configuration.
 */

// --- Mock function refs (vi.hoisted runs before vi.mock factories) ---

const { mockAdminVerify, mockPublicVerify } = vi.hoisted(() => ({
    mockAdminVerify: vi.fn(),
    mockPublicVerify: vi.fn(),
}));

// --- Module-level mocks (hoisted above imports by vitest) ---

vi.mock('aws-jwt-verify', () => ({
    CognitoJwtVerifier: {
        create: vi.fn((config: any) => {
            if (config.userPoolId === 'public-pool-id') {
                return { verify: mockPublicVerify };
            }
            // Admin pool (or any other pool ID) gets the admin mock
            return { verify: mockAdminVerify };
        }),
    },
}));

// SecretsManagerClient is instantiated with `new` — arrow functions can't be constructors.
// Use class syntax so `new SecretsManagerClient({})` works in the authorizer module.
vi.mock('@aws-sdk/client-secrets-manager', () => ({
    SecretsManagerClient: class MockSecretsManagerClient {
        send = vi.fn().mockResolvedValue({
            SecretString: JSON.stringify({ apiKey: 'mock-api-key' }),
        });
    },
    GetSecretValueCommand: class MockGetSecretValueCommand {
        constructor(public readonly input: any) {}
    },
}));

// --- Helpers ---

function createAuthEvent(opts: {
    routeKey?: string;
    authorization?: string;
    apiKey?: string;
}): any {
    return {
        headers: {
            ...(opts.authorization ? { authorization: opts.authorization } : {}),
            ...(opts.apiKey ? { 'x-api-key': opts.apiKey } : {}),
        },
        routeKey: opts.routeKey ?? 'GET /test-route',
        requestContext: {
            http: { sourceIp: '127.0.0.1' },
        },
    };
}

const ADMIN_PAYLOAD = {
    sub: 'admin-sub-123',
    email: 'admin@agency.com',
    'custom:role': 'EDITOR',
    'custom:tenantId': 'tenant-1',
};

const PUBLIC_PAYLOAD = {
    sub: 'customer-sub-456',
    email: 'customer@example.com',
    'custom:tenant_id': 'tenant-1',
};

// --- Base env vars shared by all blocks ---

function setBaseEnv() {
    process.env.USER_POOL_ID = 'admin-pool-id';
    process.env.USER_POOL_CLIENT_ID = 'admin-client-id';
    process.env.MASTER_KEY_SECRET_NAME = 'test-master-secret';
    process.env.RENDERER_KEY_SECRET_NAME = 'test-renderer-secret';
}

// =========================================================================
// Block 1: Public pool enabled (both env vars set)
// =========================================================================

describe('authorizer — public pool enabled', () => {
    let handler: Function;

    beforeAll(async () => {
        vi.resetModules();
        setBaseEnv();
        process.env.PUBLIC_POOL_ID = 'public-pool-id';
        process.env.PUBLIC_POOL_CLIENT_ID = 'public-client-id';

        const mod = await import('../src/auth/authorizer');
        handler = mod.handler;
    });

    beforeEach(() => {
        mockAdminVerify.mockReset();
        mockPublicVerify.mockReset();
    });

    // --- Cascade order ---

    it('admin JWT succeeds → returns admin context, public branch not reached', async () => {
        mockAdminVerify.mockResolvedValue(ADMIN_PAYLOAD);

        const result = await handler(createAuthEvent({
            authorization: 'Bearer admin-token',
        }));

        expect(result.isAuthorized).toBe(true);
        expect(result.context.role).toBe('EDITOR');
        expect(result.context.tenantId).toBe('tenant-1');
        expect(result.context.sub).toBe('admin-sub-123');
        expect(mockPublicVerify).not.toHaveBeenCalled();
    });

    it('admin fails, public succeeds with valid tenant_id → CUSTOMER', async () => {
        mockAdminVerify.mockRejectedValue(new Error('Invalid token for admin pool'));
        mockPublicVerify.mockResolvedValue(PUBLIC_PAYLOAD);

        const result = await handler(createAuthEvent({
            authorization: 'Bearer public-token',
        }));

        expect(result.isAuthorized).toBe(true);
        expect(result.context.role).toBe('CUSTOMER');
        expect(result.context.tenantId).toBe('tenant-1');
        expect(result.context.email).toBe('customer@example.com');
        expect(result.context.sub).toBe('customer-sub-456');
    });

    // --- Hard guard: role is literal, never from token claims ---

    it('role is always "CUSTOMER" even if token has custom:role claim', async () => {
        mockAdminVerify.mockRejectedValue(new Error('Not an admin token'));
        mockPublicVerify.mockResolvedValue({
            ...PUBLIC_PAYLOAD,
            'custom:role': 'GLOBAL_ADMIN', // Malicious or misconfigured claim
        });

        const result = await handler(createAuthEvent({
            authorization: 'Bearer public-token',
        }));

        expect(result.isAuthorized).toBe(true);
        expect(result.context.role).toBe('CUSTOMER');
        // NOT 'GLOBAL_ADMIN' from token claims
    });

    // --- Hard guard: mandatory custom:tenant_id ---

    it('rejects public token with missing custom:tenant_id', async () => {
        mockAdminVerify.mockRejectedValue(new Error('Not an admin token'));
        mockPublicVerify.mockResolvedValue({
            sub: 'customer-sub-456',
            email: 'customer@example.com',
            // custom:tenant_id deliberately absent
        });

        const result = await handler(createAuthEvent({
            authorization: 'Bearer public-token',
        }));

        expect(result.isAuthorized).toBe(false);
    });

    it('rejects public token with empty string custom:tenant_id', async () => {
        mockAdminVerify.mockRejectedValue(new Error('Not an admin token'));
        mockPublicVerify.mockResolvedValue({
            ...PUBLIC_PAYLOAD,
            'custom:tenant_id': '',
        });

        const result = await handler(createAuthEvent({
            authorization: 'Bearer public-token',
        }));

        expect(result.isAuthorized).toBe(false);
    });

    it('rejects public token with whitespace-only custom:tenant_id', async () => {
        mockAdminVerify.mockRejectedValue(new Error('Not an admin token'));
        mockPublicVerify.mockResolvedValue({
            ...PUBLIC_PAYLOAD,
            'custom:tenant_id': '   ',
        });

        const result = await handler(createAuthEvent({
            authorization: 'Bearer public-token',
        }));

        expect(result.isAuthorized).toBe(false);
    });

    // --- Both pools fail ---

    it('rejects when both admin and public verification fail', async () => {
        mockAdminVerify.mockRejectedValue(new Error('Admin: invalid'));
        mockPublicVerify.mockRejectedValue(new Error('Public: invalid'));

        const result = await handler(createAuthEvent({
            authorization: 'Bearer garbage-token',
        }));

        expect(result.isAuthorized).toBe(false);
    });

    // --- No auth header ---

    it('rejects when no authorization header is present', async () => {
        const result = await handler(createAuthEvent({}));
        expect(result.isAuthorized).toBe(false);
        expect(mockAdminVerify).not.toHaveBeenCalled();
        expect(mockPublicVerify).not.toHaveBeenCalled();
    });

    // --- Anonymous bypass constraint ---

    it('anonymous bypass routes ignore bearer token (JWT branch not reached)', async () => {
        // This documents the constraint: customer routes must NOT use
        // POST /leads, POST /contact, or POST /consent path families.
        const result = await handler(createAuthEvent({
            routeKey: 'POST /leads',
            authorization: 'Bearer valid-public-token',
        }));

        expect(result.isAuthorized).toBe(true);
        expect(result.context.sub).toBe('anonymous');
        expect(result.context.role).toBeUndefined();
        // Neither verifier was called — the bearer token was silently ignored
        expect(mockAdminVerify).not.toHaveBeenCalled();
        expect(mockPublicVerify).not.toHaveBeenCalled();
    });
});

// =========================================================================
// Block 2: Public pool disabled (env vars unset)
// =========================================================================

describe('authorizer — public pool disabled (env vars unset)', () => {
    let handler: Function;

    beforeAll(async () => {
        vi.resetModules();
        setBaseEnv();
        delete process.env.PUBLIC_POOL_ID;
        delete process.env.PUBLIC_POOL_CLIENT_ID;

        const mod = await import('../src/auth/authorizer');
        handler = mod.handler;
    });

    beforeEach(() => {
        mockAdminVerify.mockReset();
        mockPublicVerify.mockReset();
    });

    it('admin failure is terminal — no public fallback', async () => {
        mockAdminVerify.mockRejectedValue(new Error('Invalid token'));

        const result = await handler(createAuthEvent({
            authorization: 'Bearer some-token',
        }));

        expect(result.isAuthorized).toBe(false);
        expect(mockPublicVerify).not.toHaveBeenCalled();
    });

    it('admin success still works normally', async () => {
        mockAdminVerify.mockResolvedValue(ADMIN_PAYLOAD);

        const result = await handler(createAuthEvent({
            authorization: 'Bearer admin-token',
        }));

        expect(result.isAuthorized).toBe(true);
        expect(result.context.role).toBe('EDITOR');
    });
});

// =========================================================================
// Block 3: Public pool misconfigured (env pair mismatch)
// =========================================================================

describe('authorizer — public pool misconfigured (only PUBLIC_POOL_ID set)', () => {
    let handler: Function;
    let criticalErrorLogged: boolean;

    beforeAll(async () => {
        vi.resetModules();
        setBaseEnv();
        process.env.PUBLIC_POOL_ID = 'public-pool-id';
        delete process.env.PUBLIC_POOL_CLIENT_ID; // Intentionally missing

        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mod = await import('../src/auth/authorizer');
        handler = mod.handler;

        // Check if the CRITICAL error was logged at module load time
        criticalErrorLogged = spy.mock.calls.some(call =>
            typeof call[0] === 'string' &&
            call[0].includes('CRITICAL') &&
            call[0].includes('PUBLIC_POOL_ID and PUBLIC_POOL_CLIENT_ID must both be set')
        );
        spy.mockRestore();
    });

    beforeEach(() => {
        mockAdminVerify.mockReset();
        mockPublicVerify.mockReset();
    });

    it('logs CRITICAL error about env pair mismatch at module load', () => {
        expect(criticalErrorLogged).toBe(true);
    });

    it('public pool branch is disabled — admin failure is terminal', async () => {
        mockAdminVerify.mockRejectedValue(new Error('Invalid token'));

        const result = await handler(createAuthEvent({
            authorization: 'Bearer some-token',
        }));

        expect(result.isAuthorized).toBe(false);
        expect(mockPublicVerify).not.toHaveBeenCalled();
    });
});

describe('authorizer — public pool misconfigured (only PUBLIC_POOL_CLIENT_ID set)', () => {
    let handler: Function;
    let criticalErrorLogged: boolean;

    beforeAll(async () => {
        vi.resetModules();
        setBaseEnv();
        delete process.env.PUBLIC_POOL_ID; // Intentionally missing
        process.env.PUBLIC_POOL_CLIENT_ID = 'public-client-id';

        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mod = await import('../src/auth/authorizer');
        handler = mod.handler;

        criticalErrorLogged = spy.mock.calls.some(call =>
            typeof call[0] === 'string' &&
            call[0].includes('CRITICAL') &&
            call[0].includes('PUBLIC_POOL_ID and PUBLIC_POOL_CLIENT_ID must both be set')
        );
        spy.mockRestore();
    });

    beforeEach(() => {
        mockAdminVerify.mockReset();
        mockPublicVerify.mockReset();
    });

    it('logs CRITICAL error about env pair mismatch at module load', () => {
        expect(criticalErrorLogged).toBe(true);
    });

    it('public pool branch is disabled — admin failure is terminal', async () => {
        mockAdminVerify.mockRejectedValue(new Error('Invalid token'));

        const result = await handler(createAuthEvent({
            authorization: 'Bearer some-token',
        }));

        expect(result.isAuthorized).toBe(false);
        expect(mockPublicVerify).not.toHaveBeenCalled();
    });
});
