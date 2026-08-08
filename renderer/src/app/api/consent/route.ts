import { NextRequest, NextResponse } from "next/server";
import { getTenantConfig } from "@/lib/dynamo";
import { getRendererKey } from "@/lib/api-client";
import { isFirstPartyWrite } from "@/lib/origin-guard";

/**
 * Consent recording proxy.
 * Derives tenant from host header (server-side, not client-supplied).
 * Authenticates to backend with renderer API key.
 *
 * STATIC-1: anonymous credential-free write → same-origin guarded (isFirstPartyWrite).
 * The first-party caller is CookieConsent.tsx (same-origin fetch).
 */
export async function POST(req: NextRequest) {
    // STATIC-1 isolation barrier: reject cross-site / null-origin (sandboxed opaque-frame) writes.
    if (!isFirstPartyWrite(req)) {
        return NextResponse.json({ error: "Cross-origin write rejected" }, { status: 403 });
    }
    try {
        const body = await req.json();

        const apiUrl = process.env.API_URL;
        if (!apiUrl) {
            console.error("[Consent Proxy] API_URL missing");
            return NextResponse.json({ error: "Config Error" }, { status: 500 });
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

        const response = await fetch(`${apiUrl}/consent`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error("[Consent Proxy] Backend Error:", error);
            return NextResponse.json({ error: "Submission Failed" }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (err: any) {
        console.error("[Consent Proxy] Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
