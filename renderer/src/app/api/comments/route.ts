import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt"; // Decrypts the session cookie
import { getMasterKey } from "@/lib/api-client";

const API_URL = process.env.API_URL;

// GET /api/comments?pageId=... (Public)
export async function GET(req: NextRequest) {
    try {
        const tenantId = req.headers.get("x-tenant-id");
        const pageId = req.nextUrl.searchParams.get("pageId");

        if (!tenantId || !pageId) {
            return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
        }

        const apiKey = await getMasterKey();

        // Call Backend (read-only list)
        const res = await fetch(`${API_URL}/comments?pageId=${pageId}`, {
            headers: {
                "x-tenant-id": tenantId,
                "x-api-key": apiKey || "",
                "Authorization": "Bearer robot"
            }
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// POST /api/comments (Authenticated)
export async function POST(req: NextRequest) {
    try {
        // 1. Verify Authentication
        // This decrypts the HTTP-only cookie set by NextAuth
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

        if (!token || !token.email) {
            return NextResponse.json({ error: "You must be logged in to comment." }, { status: 401 });
        }

        // 2. Prepare Payload
        const body = await req.json();
        const tenantId = req.headers.get("x-tenant-id");

        if (!tenantId) return NextResponse.json({ error: "Missing Tenant ID" }, { status: 400 });

        const apiKey = await getMasterKey();

        // 3. Call Backend
        // We inject the Author details we verified from the Token
        const backendPayload = {
            ...body,
            authorName: token.name || "Anonymous",
            authorEmail: token.email,
            authorImage: token.picture,
            authorId: token.sub // Google/Auth Provider ID
        };

        const res = await fetch(`${API_URL}/comments`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-tenant-id": tenantId,
                "x-api-key": apiKey || "",
                "Authorization": "Bearer robot" // Pass Gatekeeper
            },
            body: JSON.stringify(backendPayload)
        });

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });

    } catch (e: any) {
        console.error("Comment Proxy Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
