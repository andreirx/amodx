import React from "react";

// Note: HTML block is intentionally NOT sanitized to allow advanced users
// to embed widgets, iframes, custom scripts. This is a power-user feature.
// Access is restricted to EDITOR/ADMIN roles who are trusted.
// If you need to sanitize, import sanitizeHtml from renderer/src/lib/sanitize
export function HtmlRender({ attrs }: { attrs: any }) {
    const { content } = attrs;

    if (!content) return null;

    // WARNING: This renders raw HTML without sanitization.
    // Only EDITOR/ADMIN roles can create HTML blocks.
    // Consider the security implications for your use case.
    return (
        <div
            className="my-8 raw-html-embed"
            dangerouslySetInnerHTML={{ __html: content }}
        />
    );
}
