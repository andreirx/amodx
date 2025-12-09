import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { domain, slug } = body;

        // Security check could go here (e.g., verify a shared secret)

        if (!domain) {
            return NextResponse.json({ error: "Missing domain" }, { status: 400 });
        }

        console.log(`[Cache] Purging: /${domain}${slug || ''}`);

        // Revalidate the rewritten path
        revalidatePath(`/${domain}${slug || ''}`);

        // Also revalidate the layout (theme changes)
        revalidatePath(`/${domain}`, 'layout');

        return NextResponse.json({ revalidated: true, now: Date.now() });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
