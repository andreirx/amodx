import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // 1. Get Environment Variable (Injected by CDK)
        const apiUrl = process.env.API_URL;
        if (!apiUrl) {
            console.error("API_URL is missing in Renderer Environment");
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        // 2. Forward to Backend
        // We pass the Tenant ID header which the Client sent to us
        const tenantId = req.headers.get("x-tenant-id");

        const response = await fetch(`${apiUrl}/contact`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-tenant-id': tenantId || '',
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.text();
            console.error("Backend Leads Error:", error);
            return NextResponse.json({ error: "Submission Failed" }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
