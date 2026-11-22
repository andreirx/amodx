// SCHED-1G2 — the manage page `/_booking/manage` (docs/slices/sched-1.md § 8.2, § 8.3, § 10.1), opened from the mailed
// link with the token in the FRAGMENT (`#t=…`): the server never receives the token, so this page renders the same
// shell for every visitor and makes no backend call. The browser part (`ManageView`) reads and removes the fragment,
// then sends `POST view`; only its Confirm button confirms. No third-party script at all (row G6); the middleware adds
// `Referrer-Policy: no-referrer` to this path. Force-dynamic: never stored.
// SCHED-1G3: 404 (the tree's not-found) when the tenant has no record or scheduling is off (`getBookingTenant`).
// SCHED-LABELS-1: the texts include the tenant's own `bookingStrings` on a page in the tenant's own language only
// (`bookingTexts(language, config)`, lib/booking-text.ts).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBookingTenant } from "@/lib/booking-tenant";
import { bookingLanguage, bookingTexts } from "@/lib/booking-text";
import { ManageView } from "../_components/ManageView";
import { PageShell } from "../_components/PageShell";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
    const { siteId } = await params;
    const config = await getBookingTenant(siteId);
    if (!config) return {};
    const texts = bookingTexts(bookingLanguage(one((await searchParams).lang), config.locale).language, config);
    return { title: `${texts.manageTitle} | ${config.name}`, robots: { index: false, follow: false } };
}

export default async function ManagePage({ params, searchParams }: Props) {
    const { siteId } = await params;
    const query = await searchParams;
    const config = await getBookingTenant(siteId);
    if (!config) notFound();
    const { language, locale } = bookingLanguage(one(query.lang), config.locale);
    const texts = bookingTexts(language, config);
    return (
        <PageShell config={config} frame={one(query.frame) === "1"} language={language} title={texts.manageTitle}>
            <ManageView texts={texts} locale={locale} />
        </PageShell>
    );
}
