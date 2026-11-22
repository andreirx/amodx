// SCHED-1G2 (docs/slices/sched-1.md § 10.1; SCHED-PAGE-LAYOUT = A, ratified 2026-11-21): the SECOND root layout, for
// the hosted booking pages only. Reached only by the middleware rewrite of `/_booking…` (domain host) and
// `/_site/<id>/_booking…` (preview host) to `/_book/<siteId>/…`; a wire request to `/_book…` is refused there.
//
// It writes `<html lang>` (the tenant locale's language), `<body>` and the tenant theme (`BookingTheme`: CSS variables
// and the theme's Google Fonts stylesheet, rendered on the server — not `ThemeInjector`, see that file for the measured
// reason). It renders NONE of the site layout's tenant scripts and chrome — no Analytics, Paddle, Facebook pixel,
// cookie banner, popups, referral beacon, navbar, footer or cart providers (finding G5, row G6). The book page adds
// reCAPTCHA itself; the manage page adds no third-party script.
//
// RULE (measured, build report step 3): no module of this tree that runs in the browser may import a client module of
// the site tree or `@amodx/shared` at runtime — a shared client module regroups the client chunks of every existing
// tenant page and changes their bytes (rows cm1-identity-*, sched1g-preserve).
//
// Everything in this tree is force-dynamic: nothing is stored by ISR or by CloudFront, every query parameter reaches
// the page (G10). A missing tenant renders `children` inside a bare document; the page then answers not-found.
import "../../globals.css";
import { getTenantConfig } from "@/lib/dynamo";
import { BODY_CLASS_NAME } from "@/lib/document-shell";
import { localeLanguageSubtag } from "@amodx/shared";
import { BookingTheme } from "./_components/BookingTheme";

export const dynamic = "force-dynamic";

type Props = { children: React.ReactNode; params: Promise<{ siteId: string }> };

export default async function BookingLayout({ children, params }: Props) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);
    return (
        <html lang={localeLanguageSubtag(config?.locale)}>
        <body className={BODY_CLASS_NAME}>
        {config && <BookingTheme theme={config.theme} />}
        {children}
        </body>
        </html>
    );
}
