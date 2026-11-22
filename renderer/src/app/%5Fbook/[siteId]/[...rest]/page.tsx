// SCHED-1G2 — the not-found of the booking tree (docs/slices/sched-1.md § 10.1). Every path under `/_booking/` that no
// page or handler of `app/%5Fbook/[siteId]/` serves (`/_booking/nope`, `/_booking/api`, `/_booking/feed/x`) lands here
// and answers 404 through `notFound()` in a force-dynamic page: `private, no-store`, never stored.
// Load-bearing: without this catch-all such a path falls through to the SITE catch-all `app/[siteId]/[[...slug]]` with
// `siteId = "_book"`, whose not-found handoff is a CACHEABLE 307 (`s-maxage=31536000`) to `/<host>/<rest>?nf=1` —
// measured before this file existed (row sched1g-not-found).
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function BookingPathNotFound(): never {
    notFound();
}
