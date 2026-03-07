import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

// Phase 2.5: Secure revalidation endpoint with secret token
const REVALIDATION_SECRET = process.env.REVALIDATION_SECRET;

export async function POST(req: NextRequest) {
    try {
        // Verify revalidation token
        const token = req.headers.get('x-revalidation-token');
        if (!REVALIDATION_SECRET || token !== REVALIDATION_SECRET) {
            console.warn("[Cache] Unauthorized revalidation attempt");
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { domain, slug, tag } = body;

        // Tag-based revalidation (for product/category updates affecting multiple pages)
        if (tag) {
            console.log(`[Cache] Revalidating tag: ${tag}`);
            // Next.js 16+ requires second argument 'max' for full cache invalidation
            revalidateTag(tag, 'max');
            return NextResponse.json({ revalidated: true, tag, now: Date.now() });
        }

        // Path-based revalidation
        if (!domain) {
            return NextResponse.json({ error: "Missing domain or tag" }, { status: 400 });
        }

        console.log(`[Cache] Purging: /${domain}${slug || ''}`);

        // Revalidate the rewritten path
        revalidatePath(`/${domain}${slug || ''}`);

        // Also revalidate the layout (theme changes)
        revalidatePath(`/${domain}`, 'layout');

        return NextResponse.json({ revalidated: true, path: `/${domain}${slug || ''}`, now: Date.now() });
    } catch (err: any) {
        console.error("[Cache] Revalidation error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
