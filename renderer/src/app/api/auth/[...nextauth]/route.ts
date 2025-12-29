import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getTenantConfig } from "@/lib/dynamo";
import { NextRequest } from "next/server";

// We need to construct the handler dynamically per request because
// each tenant has a different Client ID / Secret AND a different Domain.
const handler = async (req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) => {
    // 1. Determine Tenant Domain & Protocol
    const host = req.headers.get("host") || "";
    const protocol = req.headers.get("x-forwarded-proto") || "https";

    // CRITICAL FIX: Override the static global URL with the dynamic tenant URL
    // This ensures redirect_uri becomes "https://blog.bijup.com/..."
    // instead of "https://amodx.net/..."
    process.env.NEXTAUTH_URL = `${protocol}://${host}`;

    // 2. Fetch Tenant Config
    const config = await getTenantConfig(host.split(":")[0]);

    if (!config || !config.integrations?.google?.clientId || !config.integrations?.google?.clientSecret) {
        console.error(`Google Auth not configured for ${host}`);
        return new Response("Google Auth not configured for this site.", { status: 400 });
    }

    // 3. Configure Auth Options
    const authOptions = {
        providers: [
            GoogleProvider({
                clientId: config.integrations.google.clientId,
                clientSecret: config.integrations.google.clientSecret,
            }),
        ],
        secret: process.env.NEXTAUTH_SECRET,
        // Explicitly defining cookie settings helps stability in multi-tenant envs
        cookies: {
            sessionToken: {
                name: `next-auth.session-token`,
                options: {
                    httpOnly: true,
                    sameSite: 'lax',
                    path: '/',
                    secure: true
                }
            }
        },
        callbacks: {
            async session({ session, token }: any) {
                // Attach Tenant ID to the session user
                if (session.user) {
                    session.user.tenantId = config.id;
                    session.user.id = token.sub;
                }
                return session;
            }
        }
    };

    // 4. Hand off to NextAuth
    // @ts-ignore - NextAuth type definition quirk with App Router
    return NextAuth(req, ctx, authOptions);
};

export { handler as GET, handler as POST };
