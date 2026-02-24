"use client";

import React from "react";
import { sanitizeCssColor, sanitizeFontFamily, sanitizeCssLength } from "@/lib/sanitize";

export function ThemeInjector({ theme, tenantId }: { theme?: any, tenantId?: string }) {
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

    const fonts = Array.from(new Set([fontHeading, fontBody]));
    const fontQuery = fonts.map(f => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;700`).join("&");

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
      --muted-foreground: #64748b !important;
      
      --accent: ${secondaryColor} !important;
      --accent-foreground: ${secondaryForeground} !important;
      
      --destructive: #ef4444 !important;
      --destructive-foreground: #ffffff !important;
      
      /* Borders & Inputs */
      --border: #e2e8f0 !important;
      --input: #e2e8f0 !important;\
      --ring: ${primaryColor} !important;
      
      /* Shape & Type */
      --radius: ${radius} !important;
      --font-heading: '${fontHeading}', sans-serif !important;
      --font-body: '${fontBody}', sans-serif !important;
    }
    
    body {
        font-family: var(--font-body);
        background-color: var(--background);
        color: var(--foreground);
    }
    
    h1, h2, h3, h4, h5, h6 {
        font-family: var(--font-heading);
    }
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

    return (
        <>
            <script dangerouslySetInnerHTML={{
                __html: `window.AMODX_TENANT_ID = ${JSON.stringify(safeTenantId)};`
            }}/>

            {/* Injected Font Loader (Hidden container) */}
            <div dangerouslySetInnerHTML={{ __html: fontLoaderHtml }} style={{ display: "none" }} />

            <style dangerouslySetInnerHTML={{__html: css}}/>
        </>
    );
}
