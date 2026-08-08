import { NextRequest, NextResponse } from "next/server";
import { getTenantConfig } from "@/lib/dynamo";
import { getRendererKey } from "@/lib/api-client";
import { isFirstPartyWrite } from "@/lib/origin-guard";

/**
 * Contact form proxy.
 * Derives tenant from host header (server-side, not client-supplied).
 * Authenticates to backend with renderer API key so the backend can
 * distinguish this from an anonymous browser call and skip Origin verification.
 *
 * STATIC-1: because the backend skips Origin verification for the RENDERER role
 * (tenant-verify.ts), the browser Origin is only checkable HERE. isFirstPartyWrite
 * closes this credential-free proxy to cross-site / null-origin writes. The first-party
 * caller is ContactRender.tsx (same-origin fetch).
 */
export async function POST(req: NextRequest) {
    // STATIC-1 isolation barrier: reject cross-site / null-origin (sandboxed opaque-frame) writes.
    if (!isFirstPartyWrite(req)) {
        return NextResponse.json({ error: "Cross-origin write rejected" }, { status: 403 });
    }
    try {
        const body = await req.json();

        const apiUrl = process.env.API_URL?.replace(/\/$/, "");
        if (!apiUrl) {
            console.error("[Contact Proxy] API_URL is missing in Renderer Environment");
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        // Derive tenant from host — not from client-supplied x-tenant-id
        const host = req.headers.get("host") || "";
        const config = await getTenantConfig(host.split(":")[0]);
        if (!config) {
            return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
        }

        const apiKey = await getRendererKey();
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-tenant-id": config.id,
        };
        if (apiKey) {
            headers["x-api-key"] = apiKey;
        }

        const response = await fetch(`${apiUrl}/contact`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
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
