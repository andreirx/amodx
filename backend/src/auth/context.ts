// The shape of data passed from Authorizer -> Lambda
export interface AuthorizerContext {
    sub: string;
    email?: string;
    role?: string;
    tenantId?: string; // "ALL" or specific ID
}
