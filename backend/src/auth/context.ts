// The shape of data passed from Authorizer -> Lambda
export interface AuthorizerContext {
    sub: string;
    email?: string;
    role?: string;
    tenantId?: string; // "ALL" or specific ID
    // SERVICE-ACCOUNT-1 — set only for a service-key caller (backend/src/lib/service-keys.ts). Simple-response contexts carry
    // primitives, so the key's scopes travel comma-joined and are parsed in policy.ts.
    scopes?: string;
    keyId?: string;
}
