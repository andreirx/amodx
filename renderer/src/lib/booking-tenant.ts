/**
 * SCHED-1G3 — which tenant the hosted booking pages serve (docs/slices/sched-1.md § 10.1, § 25 `sched-1g3`). Server
 * only (reads DynamoDB through `getTenantConfig`).
 *
 * Rule: the book page, the manage page and the calendar feed of `[siteId]` exist only when the tenant record exists AND
 * its `schedulingEnabled` is exactly `true` (absent or `false` = off, § 4.1). Otherwise they answer 404, never stored:
 * the pages through `notFound()` (the booking tree's not-found, `private, no-store`), the feed through its one
 * URL-holder answer `404 linkNotValid` (§ 12). The API proxy is NOT gated here: the backend answers its own 403
 * `notAvailable` when the switch is off (§ 9 "Switch").
 *
 * No new read: each caller already read the tenant record; this replaces that call. The middleware does not read the
 * switch, so no other path pays for it.
 *
 * Abstraction line: `getBookingTenant` — users: `app/%5Fbook/[siteId]/page.tsx` (page and metadata),
 * `manage/page.tsx` (page and metadata), `handleBookingFeed` (`lib/booking-proxy.ts`); axis: none (one rule for three
 * surfaces, so they cannot disagree); rejected: the condition `config?.schedulingEnabled === true` written at each of
 * the five call sites.
 */
import type { TenantConfig } from "@amodx/shared";
import { getTenantConfig } from "@/lib/dynamo";

/** The tenant record of `siteId` when its booking pages are on; `null` when there is no record or scheduling is off. */
export async function getBookingTenant(siteId: string): Promise<TenantConfig | null> {
    const config = await getTenantConfig(siteId);
    return config !== null && config.schedulingEnabled === true ? config : null;
}
