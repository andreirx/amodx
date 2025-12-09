import { fetchAuthSession } from 'aws-amplify/auth';

const getConfig = (key: string) => {
    // @ts-ignore
    return import.meta.env[key] || window.AMODX_CONFIG?.[key];
};

export async function apiRequest(path: string, options: RequestInit = {}) {
    const API_URL = getConfig('VITE_API_URL');
    if (!API_URL) throw new Error("VITE_API_URL missing");

    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    // NEW: Get current tenant
    const currentTenantId = localStorage.getItem("AMODX_TENANT_ID");

    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    // NEW: Inject Header
    if (currentTenantId) {
        headers.set("x-tenant-id", currentTenantId);
    }

    const response = await fetch(`${API_URL}${path}`, { ...options, headers });

    if (!response.ok) {
        let errorMessage = response.statusText;
        try {
            const errorBody = await response.json();
            errorMessage = errorBody.error || errorBody.message || JSON.stringify(errorBody);
        } catch (e) {}
        throw new Error(`API Error (${response.status}): ${errorMessage}`);
    }

    return response.json();
}
