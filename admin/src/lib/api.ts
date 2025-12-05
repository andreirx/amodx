import { fetchAuthSession } from 'aws-amplify/auth';

const API_URL = import.meta.env.VITE_API_URL;

export async function apiRequest(path: string, options: RequestInit = {}) {
    // 1. Get the JWT Token from Cognito
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    // 2. Prepare Headers
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (token) {
        headers.set("Authorization", `Bearer ${token}`);
    }

    // 3. Execute
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
}
