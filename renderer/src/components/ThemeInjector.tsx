"use client";

import React from "react";
import { sanitizeCssColor, sanitizeFontFamily, sanitizeCssLength } from "@/lib/sanitize";

interface ThemeInjectorProps {
    theme?: any;
    tenantId?: string;
    recaptchaSiteKey?: string;
}

/** CAT-THEME-1: a CSS font weight as the schema states it (an integer 100–900); anything else is ignored. */
function isFontWeight(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 100 && (value as number) <= 900;
}

/**
 * CAT-THEME-1 — the global rules of the `editorial` shape (CT-D1 = A), appended to the injected <style> only under that
 * shape. This <style> is unlayered, so its rules win over Tailwind's layered utilities. The other editorial details
 * are classes or marker attributes that the layout, Navbar, CommerceBar and SitePage emit only under the shape
 * (table: docs/slices/cat-theme-1-impl.md § 3).
 *  - no shadows — the two shadow mechanisms the consumers use (renderer + plugins, review-0 R-CT-4): every `shadow*`
 *    utility paints `var(--tw-shadow)` in `box-shadow`, forced here to a transparent zero shadow (Tailwind's own initial
 *    value), which keeps the focus rings (`ring*` paints `--tw-ring-shadow` in the same declaration); every
 *    `drop-shadow-*` utility (hero, video-hero) adds `var(--tw-drop-shadow,)` to the `filter` list, reset here to
 *    `initial` — the "never set" state of that registered variable — so the list loses only the drop shadow and keeps any
 *    other filter (EXECUTED in Chromium, record § 9);
 *  - "↗" after the marked links and buttons: CSS generated content, never text in the DOM. `[data-theme-arrow]` is set
 *    by the Navbar and the Commerce Bar under the shape; `[data-quote-request]` is the catalog quote button
 *    (QuoteRequest.tsx, unchanged — cat-quote-1 record D-10 left its arrow to this slice).
 */
const EDITORIAL_CSS = `

    *, ::before, ::after {
        --tw-shadow: 0 0 #0000 !important;
        --tw-drop-shadow: initial !important;
    }

    [data-theme-arrow]::after, [data-quote-request]::after {
        content: " \\2197";
    }`;

export function ThemeInjector({ theme, tenantId, recaptchaSiteKey }: ThemeInjectorProps) {
    if (!theme) return null;

    // Sanitize all theme values to prevent CSS injection
    const primaryColor = sanitizeCssColor(theme.primaryColor, "#000000");
    const primaryForeground = sanitizeCssColor(theme.primaryForeground, "#ffffff");
    const secondaryColor = sanitizeCssColor(theme.secondaryColor, "#ffffff");
    const secondaryForeground = sanitizeCssColor(theme.secondaryForeground, "#000000");
    const backgroundColor = sanitizeCssColor(theme.backgroundColor, "#ffffff");
    const textColor = sanitizeCssColor(theme.textColor, "#020817");
    const surfaceColor = sanitizeCssColor(theme.surfaceColor, "#f4f4f5");
    const fontHeading = sanitizeFontFamily(theme.fontHeading, "Prata");
    const fontBody = sanitizeFontFamily(theme.fontBody, "Lato");
    const radius = sanitizeCssLength(theme.radius, "0.5rem");
    // CAT-THEME-1 (docs/slices/cat-theme-1-impl.md § 2). Every new value is sanitized like the existing ones, and every
    // one that is absent (or invalid) adds NOTHING to the output: the <style> text and the font <link> stay byte-equal.
    // The muted-text and hairline defaults are the constants this file wrote before the slice.
    const mutedForeground = sanitizeCssColor(theme.mutedColor, "#64748b");
    const borderColor = sanitizeCssColor(theme.borderColor, "#e2e8f0");
    const fontNav = sanitizeFontFamily(theme.fontNav, "");          // "" = no nav font (the nav keeps today's font)
    const headingWeight = isFontWeight(theme.headingWeight) ? theme.headingWeight : undefined;
    const editorial = theme.shape === "editorial";
    // CT-D2 = B: 400 and 700 for every tenant, plus the weights the theme lists (valid ones only), ascending.
    const extraWeights: number[] = Array.isArray(theme.fontWeights) ? theme.fontWeights.filter(isFontWeight) : [];
    const weights = Array.from(new Set([400, 700, ...extraWeights])).sort((a, b) => a - b).join(";");

    const fonts = Array.from(new Set([fontHeading, fontBody, ...(fontNav ? [fontNav] : [])]));
    const fontQuery = fonts.map(f => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@${weights}`).join("&");

    // 1. Ensure display=swap is present (Google supports this natively)
    const fontUrl = `https://fonts.googleapis.com/css2?${fontQuery}&display=swap`;

    const css = `
    :root {
      /* Base Colors */
      --background: ${backgroundColor} !important;
      --foreground: ${textColor} !important;
      
      /* Primary Brand */
      --primary: ${primaryColor} !important;
      --primary-foreground: ${primaryForeground} !important;
      
      /* Secondary/Accents */
      --secondary: ${secondaryColor} !important;
      --secondary-foreground: ${secondaryForeground} !important;
      
      /* UI Elements */
      --card: ${surfaceColor} !important;
      --card-foreground: #020817 !important;
      
      --popover: ${surfaceColor} !important;
      --popover-foreground: ${textColor} !important;
      
      --muted: ${surfaceColor} !important;
      --muted-foreground: ${mutedForeground} !important;
      
      --accent: ${secondaryColor} !important;
      --accent-foreground: ${secondaryForeground} !important;
      
      --destructive: #ef4444 !important;
      --destructive-foreground: #ffffff !important;
      
      /* Borders & Inputs */
      --border: ${borderColor} !important;
      --input: ${borderColor} !important;\
      --ring: ${primaryColor} !important;
      
      /* Shape & Type */
      --radius: ${radius} !important;
      --font-heading: '${fontHeading}', sans-serif !important;
      --font-body: '${fontBody}', sans-serif !important;${fontNav ? `
      --font-nav: '${fontNav}', sans-serif !important;` : ""}${editorial ? `
      --section-gap: 6rem !important;` : ""}
    }
    
    body {
        font-family: var(--font-body);
        background-color: var(--background);
        color: var(--foreground);
    }
    
    h1, h2, h3, h4, h5, h6 {
        font-family: var(--font-heading);
    }${headingWeight !== undefined ? `

    h1, h2, h3, h4, h5, h6 {
        font-weight: ${headingWeight};
    }` : ""}${editorial ? EDITORIAL_CSS : ""}
  `;

    // OPTIMIZATION: Non-blocking Font Loading Strategy
    // 1. Preload the resource (High Priority fetch)
    // 2. Load as 'print' media (Non-blocking for render)
    // 3. Swap to 'all' media once loaded (Applies style)
    // 4. Fallback <noscript> for non-JS users
    const fontLoaderHtml = `
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link rel="preload" as="style" href="${fontUrl}" />
      <link rel="stylesheet" href="${fontUrl}" media="print" onload="this.media='all'" />
      <noscript>
        <link rel="stylesheet" href="${fontUrl}" />
      </noscript>
    `;

    // Sanitize tenantId for JS injection (only allow alphanumeric, hyphen, underscore)
    const safeTenantId = (tenantId || "").replace(/[^a-zA-Z0-9\-_]/g, "");
    // Sanitize reCAPTCHA key (only allow alphanumeric, hyphen, underscore)
    const safeRecaptchaKey = (recaptchaSiteKey || "").replace(/[^a-zA-Z0-9\-_]/g, "");

    return (
        <>
            <script dangerouslySetInnerHTML={{
                __html: `window.AMODX_TENANT_ID = ${JSON.stringify(safeTenantId)};${safeRecaptchaKey ? `\nwindow.AMODX_RECAPTCHA_KEY = ${JSON.stringify(safeRecaptchaKey)};` : ""}`
            }}/>

            {/* Injected Font Loader (Hidden container) */}
            <div dangerouslySetInnerHTML={{ __html: fontLoaderHtml }} style={{ display: "none" }} />

            <style dangerouslySetInnerHTML={{__html: css}}/>
        </>
    );
}
