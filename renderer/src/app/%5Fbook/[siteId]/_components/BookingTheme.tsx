// SCHED-1G2 — the tenant theme on the booking pages, rendered on the SERVER (docs/slices/sched-1.md § 10.1).
//
// DEVIATION from § 10.1 "the tenant theme through `ThemeInjector`" (recorded in the build report, DECISION
// SCHED-1G2-THEME): `ThemeInjector` is a client module ("use client"). Measured in this slice: when the booking tree
// references it, Turbopack regroups the client chunks of EVERY existing tenant page (three more chunk references per
// page), so rows cm1-identity-* and sched1g-preserve fail — the slice's first obligation is that existing pages keep
// their bytes. This server component writes the theme variables the booking pages read, with the SAME sanitizers
// (`lib/sanitize.ts`) and the SAME defaults as `ThemeInjector`, and the theme's two fonts (400 and 700). Not written
// here (no booking element reads them): secondary/accent colours, the nav font, heading weight, the editorial shape.
//
// Abstraction line: users — the booking root layout; axis: none; rejected: `ThemeInjector` (changes existing pages'
// bytes, measured) and no theme at all (the booking pages would not look like the tenant's site).
import { sanitizeCssColor, sanitizeCssLength, sanitizeFontFamily } from "@/lib/sanitize";

export function BookingTheme({ theme }: { theme?: Record<string, unknown> }) {
    const t = (theme ?? {}) as Record<string, string>;
    const primary = sanitizeCssColor(t.primaryColor, "#000000");
    const fontHeading = sanitizeFontFamily(t.fontHeading, "Prata");
    const fontBody = sanitizeFontFamily(t.fontBody, "Lato");
    const css = `:root{` +
        `--background:${sanitizeCssColor(t.backgroundColor, "#ffffff")} !important;` +
        `--foreground:${sanitizeCssColor(t.textColor, "#020817")} !important;` +
        `--primary:${primary} !important;` +
        `--primary-foreground:${sanitizeCssColor(t.primaryForeground, "#ffffff")} !important;` +
        `--muted:${sanitizeCssColor(t.surfaceColor, "#f4f4f5")} !important;` +
        `--muted-foreground:${sanitizeCssColor(t.mutedColor, "#64748b")} !important;` +
        `--border:${sanitizeCssColor(t.borderColor, "#e2e8f0")} !important;` +
        `--input:${sanitizeCssColor(t.borderColor, "#e2e8f0")} !important;` +
        `--ring:${primary} !important;` +
        `--radius:${sanitizeCssLength(t.radius, "0.5rem")} !important;` +
        `--font-heading:'${fontHeading}', sans-serif !important;` +
        `--font-body:'${fontBody}', sans-serif !important;}` +
        `body{font-family:var(--font-body);background-color:var(--background);color:var(--foreground);}` +
        `h1,h2,h3{font-family:var(--font-heading);}`;
    const family = (f: string) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;700`;
    const fontUrl = `https://fonts.googleapis.com/css2?${Array.from(new Set([fontHeading, fontBody])).map(family).join("&")}&display=swap`;
    return (
        <>
            <link rel="stylesheet" href={fontUrl} />
            <style dangerouslySetInnerHTML={{ __html: css }} />
        </>
    );
}
