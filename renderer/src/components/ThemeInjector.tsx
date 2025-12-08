"use client";

export function ThemeInjector({ theme }: { theme?: Record<string, string> }) {
    if (!theme) return null;

    const primary = theme.primaryColor || "#000000";
    const fontHeading = theme.fontHeading || "Inter";
    const fontBody = theme.fontBody || "Inter";

    // We explicitly target :root with !important to ensure we override any defaults
    const css = `
    :root {
      --primary: ${primary} !important;
      --font-heading: ${fontHeading}, system-ui, sans-serif !important;
      --font-body: ${fontBody}, system-ui, sans-serif !important;
    }
  `;

    return (
        <style
            dangerouslySetInnerHTML={{
                __html: css
            }}
        />
    );
}
