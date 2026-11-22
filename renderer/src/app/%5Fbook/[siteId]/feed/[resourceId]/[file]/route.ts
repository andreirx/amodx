// SCHED-1G2 — the calendar feed (docs/slices/sched-1.md § 12): `<base>/feed/<resourceId>/<secret>.ics` → POST
// `/scheduling/visitor/feed`. `[siteId]` is bound by the middleware only; the rules are in `lib/booking-proxy.ts`.
import { handleBookingFeed } from "@/lib/booking-proxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ siteId: string; resourceId: string; file: string }> };

export async function GET(_req: Request, { params }: Context) {
    const { siteId, resourceId, file } = await params;
    return handleBookingFeed(siteId, resourceId, file);
}
