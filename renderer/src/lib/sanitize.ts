import DOMPurify from "dompurify";

/**
 * Sanitize HTML to prevent XSS attacks.
 * Allows basic formatting tags only.
 */
export function sanitizeHtml(dirty: string): string {
    if (typeof window === "undefined") {
        // Server-side: strip all HTML tags as fallback
        // DOMPurify requires a DOM, so we do basic stripping
        return dirty
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<[^>]*on\w+\s*=/gi, "<") // Remove event handlers
            .replace(/<(iframe|object|embed|form|input|button)/gi, "&lt;$1"); // Neuter dangerous tags
    }

    return DOMPurify.sanitize(dirty, {
        ALLOWED_TAGS: [
            "b", "i", "em", "strong", "u", "s", "strike",
            "br", "p", "span", "div",
            "ul", "ol", "li",
            "a", "h1", "h2", "h3", "h4", "h5", "h6",
            "blockquote", "code", "pre",
            "table", "thead", "tbody", "tr", "th", "td",
            "img", "hr"
        ],
        ALLOWED_ATTR: [
            "href", "target", "rel", "src", "alt", "title",
            "class", "style", "width", "height"
        ],
        ALLOW_DATA_ATTR: false,
        ADD_ATTR: ["target"], // Allow target="_blank"
        FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select"],
        FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"]
    });
}

/**
 * Sanitize HTML more strictly - only inline formatting allowed.
 * Use for short text like TopBar announcements.
 */
export function sanitizeInlineHtml(dirty: string): string {
    if (typeof window === "undefined") {
        return dirty
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<[^>]*on\w+\s*=/gi, "<");
    }

    return DOMPurify.sanitize(dirty, {
        ALLOWED_TAGS: ["b", "i", "em", "strong", "u", "s", "span", "a", "br"],
        ALLOWED_ATTR: ["href", "target", "rel", "class", "style"],
        ALLOW_DATA_ATTR: false
    });
}

/**
 * Validate and sanitize a CSS color value.
 * Returns the color if valid, or a fallback.
 */
export function sanitizeCssColor(color: string, fallback: string = "#000000"): string {
    if (!color || typeof color !== "string") return fallback;

    // Allow hex colors
    if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;

    // Allow rgb/rgba
    if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+)?\s*\)$/.test(color)) return color;

    // Allow hsl/hsla
    if (/^hsla?\(\s*\d{1,3}\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+)?\s*\)$/.test(color)) return color;

    // Allow named colors (limited safe list)
    const safeColors = [
        "black", "white", "red", "green", "blue", "yellow", "cyan", "magenta",
        "gray", "grey", "silver", "maroon", "olive", "lime", "aqua", "teal",
        "navy", "fuchsia", "purple", "orange", "pink", "brown", "transparent"
    ];
    if (safeColors.includes(color.toLowerCase())) return color;

    return fallback;
}

/**
 * Validate and sanitize a font family name.
 * Returns the font if valid, or a fallback.
 */
export function sanitizeFontFamily(font: string, fallback: string = "sans-serif"): string {
    if (!font || typeof font !== "string") return fallback;

    // Only allow alphanumeric, spaces, and hyphens
    // This blocks quotes, semicolons, and other CSS injection vectors
    if (!/^[a-zA-Z0-9\s\-]+$/.test(font)) return fallback;

    // Max length to prevent DoS
    if (font.length > 50) return fallback;

    return font;
}

/**
 * Validate and sanitize a CSS length/radius value.
 */
export function sanitizeCssLength(value: string, fallback: string = "0.5rem"): string {
    if (!value || typeof value !== "string") return fallback;

    // Allow common length patterns
    if (/^[\d.]+(px|rem|em|%|vh|vw)$/.test(value)) return value;
    if (/^\d+$/.test(value)) return value + "px";

    return fallback;
}
