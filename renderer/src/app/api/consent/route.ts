import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const apiUrl = process.env.API_URL;
        if (!apiUrl) {
            console.error("API_URL missing");
            return NextResponse.json({ error: "Config Error" }, { status: 500 });
        }

        const tenantId = req.headers.get("x-tenant-id");

        const response = await fetch(`${apiUrl}/consent`, {
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
            console.error("Backend Consent Error:", error);
            return NextResponse.json({ error: "Submission Failed" }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (err: any) {
        console.error("Consent API Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
