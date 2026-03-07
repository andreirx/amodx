import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getTenantConfig, getCustomerOrders } from "@/lib/dynamo";
import GoogleProvider from "next-auth/providers/google";

/**
 * Secure customer orders endpoint.
 * Phase 3.1: Session-validated reads for customer data.
 *
 * This route validates the NextAuth session server-side, ensuring:
 * 1. The user is authenticated
 * 2. The email used to fetch orders comes from the session, NOT the request
 * 3. The tenant ID is derived from the host header
 *
 * This prevents attacks where an attacker could fetch another user's orders.
 */

export async function GET(req: NextRequest) {
    try {
        // 1. Get tenant from host header
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

        // 4. Fetch orders using session email (NOT from request)
        // The email is guaranteed to come from the authenticated session
        const orders = await getCustomerOrders(config.id, session.user.email);

        return NextResponse.json({
            orders: orders || [],
            email: session.user.email
        });
    } catch (err: any) {
        console.error("Account orders fetch error:", err);
        return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
    }
}
