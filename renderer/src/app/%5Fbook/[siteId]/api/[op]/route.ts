// SCHED-1G2 — the booking proxy (docs/slices/sched-1.md § 10.1): `<base>/api/<op>` → one backend visitor route.
// `[siteId]` is bound by the middleware only (`lib/booking-path.ts`); every rule is in `lib/booking-proxy.ts`.
import { handleBookingApi } from "@/lib/booking-proxy";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ siteId: string; op: string }> };

export async function GET(req: Request, { params }: Context) {
    const { siteId, op } = await params;
    return handleBookingApi(req, siteId, op);
}

export async function POST(req: Request, { params }: Context) {
    const { siteId, op } = await params;
    return handleBookingApi(req, siteId, op);
}
