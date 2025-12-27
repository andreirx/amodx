import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // 1. Get Environment Variable
        // Remove trailing slash if present to prevent double slashes (https://api.com//contact)
        const apiUrl = process.env.API_URL?.replace(/\/$/, "");

        if (!apiUrl) {
            console.error("[Contact Proxy] API_URL is missing in Renderer Environment");
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        // 2. Forward to Backend
        const tenantId = req.headers.get("x-tenant-id");

        console.log(`[Contact Proxy] Forwarding to ${apiUrl}/contact for tenant ${tenantId}`);

        const response = await fetch(`${apiUrl}/contact`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-tenant-id': tenantId || '',
                'x-api-key': 'web-client',
                'Authorization': 'Bearer public'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.text();
            console.error(`[Contact Proxy] Backend Error (${response.status}):`, error);
            return NextResponse.json({ error: "Submission Failed" }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (err: any) {
        console.error("[Contact Proxy] Exception:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
