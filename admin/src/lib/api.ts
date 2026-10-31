import { fetchAuthSession, signOut } from 'aws-amplify/auth';

const getConfig = (key: string) => {
    // FIX: Prioritize Runtime Config (window) over Build Config (import.meta.env)
    // This prevents local .env.local from polluting Staging deployments
    // @ts-ignore
    return window.AMODX_CONFIG?.[key] || import.meta.env[key];
};

/**
 * A non-OK answer of the API (401/403 excepted: they sign out). `message` is exactly the message every caller saw
 * before (`API Error (<status>): <error>`), so callers that read only the message are unchanged. `status` and `body`
 * (the parsed JSON body, `null` when it was not JSON) are for a caller that must branch on the answer's members —
 * CAT-IMPORT-PROFILE-1C: the glam import's 409 "profile changed by another import" (`storedRevision`).
 */
export class ApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, body: unknown, message: string) {
        super(message);
        this.status = status;
        this.body = body;
    }
}

export async function apiRequest(path: string, options: RequestInit = {}) {
    const API_URL = getConfig('VITE_API_URL');
    if (!API_URL) {
        throw new Error("Configuration Error: VITE_API_URL is missing.");
    }

    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    const currentTenantId = localStorage.getItem("AMODX_TENANT_ID");

    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");

    // 1. Auth Token (Real)
    if (token) headers.set("Authorization", `Bearer ${token}`);

    // 2. Dummy API Key (To satisfy API Gateway identitySource check)
    headers.set("x-api-key", "web-client");

    // 3. Tenant Context
    if (currentTenantId) headers.set("x-tenant-id", currentTenantId);

    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            console.warn(`[API] Auth Error ${response.status}. Redirecting to login.`);
            localStorage.removeItem("AMODX_TENANT_ID");
            try { await signOut(); } catch (e) { /* ignore */ }
            if (window.location.pathname !== "/login") {
                window.location.href = "/login";
            }
            throw new Error("Session expired. Please login again.");
        }

        let errorMessage = response.statusText;
        let body: unknown = null;
        try {
            const errorBody = await response.json();
            errorMessage = errorBody.error || errorBody.message || JSON.stringify(errorBody);
            body = errorBody;
        } catch (e) {}
        throw new ApiError(response.status, body, `API Error (${response.status}): ${errorMessage}`);
    }

    return response.json();
}
