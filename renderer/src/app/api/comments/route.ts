import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getMasterKey } from "@/lib/api-client";
import { getTenantConfig } from "@/lib/dynamo";

const API_URL = process.env.API_URL;

// GET /api/comments?pageId=... (Public List)
export async function GET(req: NextRequest) {
    try {
        console.log("[Comments Proxy] GET Start");

        // 1. Resolve Tenant ID (Header or Host)
        let tenantId = req.headers.get("x-tenant-id");
        if (!tenantId) {
            const host = req.headers.get("host")?.split(":")[0] || "";
            const config = await getTenantConfig(host);
            if (config) tenantId = config.id;
        }

        const pageId = req.nextUrl.searchParams.get("pageId");

        if (!tenantId || !pageId) {
            console.error("[Comments Proxy] Missing parameters:", { tenantId, pageId });
            return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
        }

        const apiKey = await getMasterKey();

        console.log(`[Comments Proxy] Fetching from backend: ${API_URL}/comments`);

        // 2. Call Backend
        const res = await fetch(`${API_URL}/comments?pageId=${pageId}`, {
            headers: {
                "x-tenant-id": tenantId,
                "x-api-key": apiKey || "",
                "Authorization": "Bearer robot"
            }
        });

        if (!res.ok) {
            const txt = await res.text();
            console.error(`[Comments Proxy] Backend GET Error ${res.status}: ${txt}`);
            return NextResponse.json({ error: "Backend Failed" }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data, { status: 200 });

    } catch (e: any) {
        console.error("[Comments Proxy] GET Crash:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST /api/comments (Authenticated Create)
export async function POST(req: NextRequest) {
    try {
        console.log("[Comments Proxy] POST Start");

        // 1. Resolve Tenant
        let tenantId = req.headers.get("x-tenant-id");
        if (!tenantId) {
            const host = req.headers.get("host")?.split(":")[0] || "";
            const config = await getTenantConfig(host);
            if (config) tenantId = config.id;
        }

        if (!tenantId) return NextResponse.json({ error: "Missing Tenant ID" }, { status: 400 });

        // 2. Verify Auth
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const apiKey = await getMasterKey();
        const body = await req.json();

        // 3. Call Backend
        const backendPayload = {
            ...body,
            authorName: token.name || "Anonymous",
            authorEmail: token.email,
            authorImage: token.picture,
            authorId: token.sub
        };

        const res = await fetch(`${API_URL}/comments`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-tenant-id": tenantId,
                "x-api-key": apiKey || "",
                "Authorization": "Bearer robot"
            },
            body: JSON.stringify(backendPayload)
        });

        if (!res.ok) {
            const txt = await res.text();
            console.error(`[Comments Proxy] Backend POST Error ${res.status}: ${txt}`);
            return NextResponse.json({ error: "Backend Failed" }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data, { status: 201 });

    } catch (e: any) {
        console.error("[Comments Proxy] POST Crash:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
