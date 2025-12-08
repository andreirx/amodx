import { fetchAuthSession } from 'aws-amplify/auth';

// Helper to get config safely at runtime
const getConfig = (key: string) => {
    // @ts-ignore
    return import.meta.env[key] || window.AMODX_CONFIG?.[key];
};

export async function apiRequest(path: string, options: RequestInit = {}) {
    // 1. Get API URL (Lazy load - ensures main.tsx has finished fetching config)
    const API_URL = getConfig('VITE_API_URL');

    if (!API_URL) {
        throw new Error("Configuration Error: VITE_API_URL is missing. Check config.json or .env");
    }

    // 2. Get the JWT Token from Cognito
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    // 3. Prepare Headers
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    // 4. Execute
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        let errorMessage = response.statusText;
        try {
            const errorBody = await response.json();
            errorMessage = errorBody.error || errorBody.message || JSON.stringify(errorBody);
        } catch (e) {
            // Body wasn't JSON
        }
        throw new Error(`API Error (${response.status}): ${errorMessage}`);
    }

    return response.json();
}
