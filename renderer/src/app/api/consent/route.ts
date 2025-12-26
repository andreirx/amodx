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

        // 2. Extract tenant ID from header
        const tenantId = req.headers.get("x-tenant-id");
        if (!tenantId) {
            return NextResponse.json({ error: "Missing tenant ID" }, { status: 400 });
        }

        // 3. Capture client IP and user agent for audit trail
        const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
        const userAgent = req.headers.get("user-agent") || "unknown";

        // 4. Prepare payload for backend
        const consentPayload = {
            ...body,
            ip: clientIp,
            userAgent,
        };

        // 5. Forward to Backend Lambda
        const response = await fetch(`${apiUrl}/consent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-tenant-id': tenantId,
            },
            body: JSON.stringify(consentPayload)
        });

        if (!response.ok) {
            const error = await response.text();
            console.error("Backend Consent Error:", error);
            return NextResponse.json({ error: "Consent logging failed" }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (err: any) {
        console.error("Consent API Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
