import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getTenantConfig } from "@/lib/dynamo";
import { getRendererKey } from "@/lib/api-client";

/**
 * Lead capture proxy.
 * Derives tenant from host header (server-side, not client-supplied).
 * Authenticates to backend with renderer API key.
 * Preserves referral cookie enrichment from original implementation.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        const apiUrl = process.env.API_URL;
        if (!apiUrl) {
            console.error("[Leads Proxy] API_URL is missing in Renderer Environment");
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        // Derive tenant from host — not from client-supplied x-tenant-id
        const host = req.headers.get("host") || "";
        const config = await getTenantConfig(host.split(":")[0]);
        if (!config) {
            return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
        }

        // Capture referral cookie (server-side enrichment)
        const cookieStore = await cookies();
        const referral = cookieStore.get("amodx_ref")?.value;
        const source = body.source || "Website";

        const backendPayload = {
            ...body,
            source,
            data: {
                ...body.data,
                referral: referral || null,
                userAgent: req.headers.get("user-agent"),
            },
        };

        const apiKey = await getRendererKey();
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-tenant-id": config.id,
        };
        if (apiKey) {
            headers["x-api-key"] = apiKey;
        }

        const response = await fetch(`${apiUrl}/leads`, {
            method: "POST",
            headers,
            body: JSON.stringify(backendPayload),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error("[Leads Proxy] Backend Error:", error);
            return NextResponse.json({ error: "Submission Failed" }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
