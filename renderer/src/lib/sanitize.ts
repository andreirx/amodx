import sanitizeHtmlLib from "sanitize-html";

/**
 * Sanitize HTML to prevent XSS attacks.
 * Uses sanitize-html for Lambda-compatible, pure-JS sanitization.
 * Phase 2.6: Replaced isomorphic-dompurify (jsdom native deps fail in Lambda ARM64).
 */
export function sanitizeHtml(dirty: string): string {
    return sanitizeHtmlLib(dirty, {
        allowedTags: [
            "b", "i", "em", "strong", "u", "s", "strike",
            "br", "p", "span", "div",
            "ul", "ol", "li",
            "a", "h1", "h2", "h3", "h4", "h5", "h6",
            "blockquote", "code", "pre",
            "table", "thead", "tbody", "tr", "th", "td",
            "img", "hr"
        ],
        allowedAttributes: {
            "a": ["href", "target", "rel", "title", "class", "style"],
            "img": ["src", "alt", "title", "width", "height", "class", "style"],
            "span": ["class", "style"],
            "div": ["class", "style"],
            "p": ["class", "style"],
            "table": ["class", "style"],
            "th": ["class", "style"],
            "td": ["class", "style"],
            "h1": ["class", "style"],
            "h2": ["class", "style"],
            "h3": ["class", "style"],
            "h4": ["class", "style"],
            "h5": ["class", "style"],
            "h6": ["class", "style"],
            "blockquote": ["class", "style"],
            "pre": ["class", "style"],
            "code": ["class", "style"],
            "ul": ["class", "style"],
            "ol": ["class", "style"],
            "li": ["class", "style"]
        },
        disallowedTagsMode: "discard"
    });
}

/**
 * Sanitize HTML more strictly - only inline formatting allowed.
 * Use for short text like TopBar announcements.
 */
export function sanitizeInlineHtml(dirty: string): string {
    return sanitizeHtmlLib(dirty, {
        allowedTags: ["b", "i", "em", "strong", "u", "s", "span", "a", "br"],
        allowedAttributes: {
            "a": ["href", "target", "rel", "class", "style"],
            "span": ["class", "style"]
        },
        disallowedTagsMode: "discard"
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
