import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getTenantConfig } from "@/lib/dynamo";
import { getCustomerProfile } from "@/lib/customer-api";
import { getRendererKey } from "@/lib/api-client";
import GoogleProvider from "next-auth/providers/google";

/**
 * Secure profile read/update routes.
 *
 * Both methods validate the NextAuth session server-side, ensuring:
 * 1. The user is authenticated
 * 2. The email comes from the session, NOT from the request
 * 3. The tenant ID is derived from host header (not caller-supplied)
 *
 * GET: asks the backend, POST /customer/profile-read, with the renderer API key and the session
 *      email (CMRC-1B, lib/customer-api.ts). It reads no customer item from DynamoDB.
 *
 * POST: proxies to backend POST /public/customers/profile via renderer API key.
 *       Backend enforces requireRole(["GLOBAL_ADMIN", "RENDERER"]).
 *
 * Env vars (set by CDK in renderer-hosting.ts):
 *   - API_URL: backend API Gateway URL
 *   - AMODX_API_KEY_SECRET: Secrets Manager name for renderer API key
 *     (resolved by getRendererKey() from api-client.ts)
 */

const API_URL = process.env.API_URL;

export async function POST(req: NextRequest) {
    try {
        if (!API_URL) {
            console.error("[Profile Proxy] API_URL is missing in Renderer Environment");
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

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

        // 5. Proxy to backend with renderer API key
        const apiKey = await getRendererKey();
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "x-tenant-id": config.id,
        };

        if (apiKey) {
            headers["x-api-key"] = apiKey;
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

        // 4. Read the profile through the backend (CMRC-1B) using the session email.
        // Session validation above guarantees the email is the authenticated
        // user's own; no value of the request selects the customer.
        const profile = await getCustomerProfile(config.id, session.user.email);

        return NextResponse.json(profile || { email: session.user.email });
    } catch (err: any) {
        console.error("Profile fetch error:", err);
        return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
    }
}
