import { fetchAuthSession, signOut } from 'aws-amplify/auth';

const getConfig = (key: string) => {
    // FIX: Prioritize Runtime Config (window) over Build Config (import.meta.env)
    // This prevents local .env.local from polluting Staging deployments
    // @ts-ignore
    return window.AMODX_CONFIG?.[key] || import.meta.env[key];
};

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
        try {
            const errorBody = await response.json();
            errorMessage = errorBody.error || errorBody.message || JSON.stringify(errorBody);
        } catch (e) {}
        throw new Error(`API Error (${response.status}): ${errorMessage}`);
    }

    return response.json();
}
