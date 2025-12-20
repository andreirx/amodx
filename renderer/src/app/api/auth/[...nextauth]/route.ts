import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getTenantConfig } from "@/lib/dynamo";
import { NextRequest } from "next/server";

// We need to construct the handler dynamically per request because
// each tenant has a different Client ID / Secret.
const handler = async (req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) => {
    // 1. Determine Tenant from Host header
    const host = req.headers.get("host")?.split(":")[0] || "";
    const config = await getTenantConfig(host);

    if (!config || !config.integrations?.google?.clientId || !config.integrations?.google?.clientSecret) {
        // Fallback or Error if no keys configured
        console.error(`Google Auth not configured for ${host}`);
        return new Response("Google Auth not configured for this site.", { status: 400 });
    }

    // 2. Configure Auth Options Dynamically
    const authOptions = {
        providers: [
            GoogleProvider({
                clientId: config.integrations.google.clientId,
                clientSecret: config.integrations.google.clientSecret,
            }),
        ],
        secret: process.env.NEXTAUTH_SECRET,
        callbacks: {
            async session({ session, token }: any) {
                // Attach Tenant ID to the session user so we know who they are contextually
                if (session.user) {
                    session.user.tenantId = config.id;
                    session.user.id = token.sub;
                }
                return session;
            }
        }
    };

    // 3. Hand off to NextAuth
    // @ts-ignore - NextAuth type definition quirk with App Router
    return NextAuth(req, ctx, authOptions);
};

export { handler as GET, handler as POST };
