import { cookies } from 'next/headers';

// Server-side helper to get preview base path from cookie
// Call this in server components to get the URL prefix
export async function getPreviewBase(): Promise<string> {
    const cookieStore = await cookies();
    return cookieStore.get('amodx_preview_base')?.value || '';
}
