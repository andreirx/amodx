"use client";

import React from "react";

export function ThemeInjector({ theme, tenantId }: { theme?: any, tenantId?: string }) {
    if (!theme) return null;

    const {
        primaryColor = "#000000",
        primaryForeground = "#ffffff",

        secondaryColor = "#ffffff",
        secondaryForeground = "#000000",

        backgroundColor = "#ffffff",
        textColor = "#020817",

        surfaceColor = "#f4f4f5",

        fontHeading = "Prata",
        fontBody = "Lato",
        radius = "0.5rem"
    } = theme;

    const fonts = Array.from(new Set([fontHeading, fontBody]));
    const fontQuery = fonts.map(f => `family=${f.replace(/ /g, "+")}:wght@400;700`).join("&");
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
      --input: #e2e8f0 !important;
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

    return (
        <>
            <script dangerouslySetInnerHTML={{
                __html: `window.AMODX_TENANT_ID = "${tenantId || ''}";`
            }}/>

            <link rel="preconnect" href="https://fonts.googleapis.com"/>
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
            <link href={fontUrl} rel="stylesheet"/>
            <style dangerouslySetInnerHTML={{__html: css}}/>
        </>
    );
}
