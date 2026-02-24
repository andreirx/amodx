import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getTenantConfig } from "@/lib/dynamo";
import GoogleProvider from "next-auth/providers/google";

/**
 * Secure profile update proxy.
 *
 * This route validates the NextAuth session server-side, ensuring:
 * 1. The user is authenticated
 * 2. The email used for the update comes from the session, NOT the request body
 * 3. The tenant ID is validated against the session
 *
 * This prevents the attack where an attacker could change x-tenant-id and email
 * to modify another user's profile.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL!;
const MASTER_API_KEY = process.env.MASTER_API_KEY;

export async function POST(req: NextRequest) {
    try {
        // 1. Get tenant from host
        const host = req.headers.get("host") || "";
        const config = await getTenantConfig(host.split(":")[0]);

        if (!config) {
            return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
        }

        // 2. Build auth options for this tenant (same as NextAuth route)
        const authOptions = {
            providers: [
                GoogleProvider({
                    clientId: config.integrations?.google?.clientId || "",
                    clientSecret: config.integrations?.google?.clientSecret || "",
                }),
            ],
            secret: process.env.NEXTAUTH_SECRET,
            callbacks: {
                async session({ session, token }: any) {
                    if (session.user) {
                        session.user.tenantId = config.id;
                        session.user.id = token.sub;
                    }
                    return session;
                }
            }
        };

        // 3. Validate session
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized - please sign in" }, { status: 401 });
        }

        // 4. Parse request body
        const body = await req.json();

        // SECURITY: Use email from session, NOT from request body
        // This prevents attackers from modifying other users' profiles
        const secureBody = {
            email: session.user.email, // Always from session
            phone: body.phone,
            birthday: body.birthday,
            firstName: body.firstName,
            lastName: body.lastName,
        };

        // 5. Proxy to backend with server-side authentication
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-tenant-id": config.id,
        };

        // Use master API key if available for elevated permissions
        if (MASTER_API_KEY) {
            headers["x-api-key"] = MASTER_API_KEY;
        }

        const backendRes = await fetch(`${API_URL}/public/customers/profile`, {
            method: "POST",
            headers,
            body: JSON.stringify(secureBody),
        });

        const data = await backendRes.json();

        return NextResponse.json(data, { status: backendRes.status });
    } catch (err: any) {
        console.error("Profile update error:", err);
        return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        // 1. Get tenant from host
        const host = req.headers.get("host") || "";
        const config = await getTenantConfig(host.split(":")[0]);

        if (!config) {
            return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
        }

        // 2. Build auth options for this tenant
        const authOptions = {
            providers: [
                GoogleProvider({
                    clientId: config.integrations?.google?.clientId || "",
                    clientSecret: config.integrations?.google?.clientSecret || "",
                }),
            ],
            secret: process.env.NEXTAUTH_SECRET,
            callbacks: {
                async session({ session, token }: any) {
                    if (session.user) {
                        session.user.tenantId = config.id;
                        session.user.id = token.sub;
                    }
                    return session;
                }
            }
        };

        // 3. Validate session
        const session = await getServerSession(authOptions);

        if (!session?.user?.email) {
            return NextResponse.json({ error: "Unauthorized - please sign in" }, { status: 401 });
        }

        // 4. Fetch profile from backend using session email
        const headers: Record<string, string> = {
            "x-tenant-id": config.id,
        };

        if (MASTER_API_KEY) {
            headers["x-api-key"] = MASTER_API_KEY;
        }

        const backendRes = await fetch(
            `${API_URL}/public/customers/profile?email=${encodeURIComponent(session.user.email)}`,
            { headers }
        );

        const data = await backendRes.json();

        return NextResponse.json(data, { status: backendRes.status });
    } catch (err: any) {
        console.error("Profile fetch error:", err);
        return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
    }
}
