import type React from "react";

/**
 * Resolve semantic color tokens to CSS classes/values for Hero cover mode.
 *
 * Tokens are framework-agnostic IDs stored in the block schema.
 * This resolver maps them to Tailwind classes at render time.
 * "auto" preserves the original cover defaults (black overlay, white text).
 */

const OVERLAY_BG_MAP: Record<string, string> = {
    auto: "rgba(0, 0, 0,",       // completed with opacity in the caller
    black: "rgba(0, 0, 0,",
    foreground: "var(--foreground)",
    primary: "var(--primary)",
    muted: "var(--muted)",
    accent: "var(--accent)",
};

const TEXT_CLASS_MAP: Record<string, string> = {
    auto: "",                      // caller supplies the default
    white: "text-white",
    foreground: "text-foreground",
    primary: "text-primary",
    "primary-foreground": "text-primary-foreground",
    "muted-foreground": "text-muted-foreground",
    "accent-foreground": "text-accent-foreground",
};

/**
 * Resolve the overlay background for cover mode.
 * Returns an inline style object for the overlay div.
 */
export function resolveOverlayStyle(token: string | undefined, opacity: number): React.CSSProperties {
    const key = token || "auto";

    if (key === "auto" || key === "black") {
        return { backgroundColor: `rgba(0, 0, 0, ${opacity})` };
    }

    // For theme tokens, use the CSS variable with opacity via a two-layer approach:
    // solid background color + opacity on the div itself.
    const cssVar = OVERLAY_BG_MAP[key];
    if (cssVar) {
        return { backgroundColor: cssVar, opacity };
    }

    return { backgroundColor: `rgba(0, 0, 0, ${opacity})` };
}

/**
 * Resolve a text color token to a Tailwind class.
 * Returns the class string, or the provided default if token is "auto" or absent.
 */
export function resolveTextClass(token: string | undefined, defaultClass: string): string {
    const key = token || "auto";
    if (key === "auto") return defaultClass;
    return TEXT_CLASS_MAP[key] || defaultClass;
}
