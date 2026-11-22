// SCHED-1G2 — the book page `/_booking` (docs/slices/sched-1.md § 10.1). Query: `frame=1` (no header, transparent
// background), `lang=<tag>` (texts of that language when a pack exists), `service=<id>` / `course=<id>` (start on that
// service or course). The flow runs in the browser (`BookFlow`) against the renderer proxy `<base>/api/<op>`.
// reCAPTCHA v3 is the ONLY third-party script (row G6), with the tenant's site key when the tenant set both keys
// (`mapTenant`, § 9.1), else the deployment key. It is a plain `<script async>` rendered here, NOT the site's
// `RecaptchaProvider` client component: a client module shared with the site tree regroups the client chunks of every
// existing page (measured, build report step 3). Force-dynamic: never stored (row G1).
// SCHED-1G3: 404 (the tree's not-found) when the tenant has no record or scheduling is off (`getBookingTenant`); the
// robots meta `noindex, nofollow` keeps the page out of search indexes (rows sched1g3-*).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBookingTenant } from "@/lib/booking-tenant";
import { bookingLanguage, bookingTexts } from "@/lib/booking-text";
import { BookFlow } from "./_components/BookFlow";
import { PageShell } from "./_components/PageShell";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ siteId: string }>; searchParams: Promise<SearchParams> };

/** One value of a query parameter: a repeated or absent parameter counts as absent. */
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
    const { siteId } = await params;
    const config = await getBookingTenant(siteId);
    if (!config) return {};
    const texts = bookingTexts(bookingLanguage(one((await searchParams).lang), config.locale).language);
    return { title: `${texts.bookTitle} | ${config.name}`, robots: { index: false, follow: false } };
}

export default async function BookPage({ params, searchParams }: Props) {
    const { siteId } = await params;
    const query = await searchParams;
    const config = await getBookingTenant(siteId);
    if (!config) notFound();
    const { language, locale } = bookingLanguage(one(query.lang), config.locale);
    const texts = bookingTexts(language);
    const recaptchaSiteKey = config.recaptcha?.siteKey || process.env.RECAPTCHA_SITE_KEY || undefined;
    return (
        <PageShell config={config} frame={one(query.frame) === "1"} language={language} title={texts.bookTitle}>
            <BookFlow texts={texts} locale={locale} recaptchaSiteKey={recaptchaSiteKey}
                initialServiceId={one(query.service)} initialCourseId={one(query.course)} />
            {recaptchaSiteKey && <script src={`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(recaptchaSiteKey)}`} async />}
        </PageShell>
    );
}
