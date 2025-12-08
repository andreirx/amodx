"use client"; // Must be client-side to inject styles into the DOM

export function ThemeInjector({ theme }: { theme?: Record<string, string> }) {
    if (!theme) return null;

    // Convert JSON { primary: "#ff0000" } to CSS "--primary: #ff0000;"
    const cssVariables = Object.entries(theme)
        .map(([key, value]) => `--${key}: ${value};`)
        .join(" ");

    return (
        <style jsx global>{`
      :root {
        ${cssVariables}
      }
    `}</style>
    );
}
