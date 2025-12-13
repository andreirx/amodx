import { apiRequest } from "@/lib/api";

export async function uploadFile(file: File): Promise<string> {
    try {
        // 1. Get Presigned URL from Backend
        const res = await apiRequest('/assets', {
            method: 'POST',
            body: JSON.stringify({
                filename: file.name,
                contentType: file.type,
                size: file.size
            })
        });

        // 2. Upload binary to S3
        await fetch(res.uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type }
        });

        // 3. Return the Public CDN URL
        return res.publicUrl;
    } catch (e) {
        console.error("Upload failed", e);
        throw e;
    }
}
