import { NextRequest, NextResponse } from "next/server";
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // 1. Get Environment Variable (Injected by CDK)
        const apiUrl = process.env.API_URL;
        if (!apiUrl) {
            console.error("API_URL is missing in Renderer Environment");
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const tenantId = req.headers.get("x-tenant-id");

        // 1. Capture Referral Cookie
        const cookieStore = await cookies();
        const referral = cookieStore.get('amodx_ref')?.value;
        const source = body.source || 'Website'; // Source passed from component

        // 2. Prepare Payload for Backend
        // We inject the referral into the 'data' map if LeadSchema allows it
        const backendPayload = {
            ...body,
            source: source,
            data: {
                ...body.data,
                referral: referral || null,
                userAgent: req.headers.get('user-agent'),
            }
        };

        const response = await fetch(`${apiUrl}/leads`, {
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
            console.error("Backend Leads Error:", error);
            return NextResponse.json({ error: "Submission Failed" }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
