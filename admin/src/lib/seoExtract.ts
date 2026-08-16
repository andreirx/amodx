/**
 * SEO auto-extraction from a Tiptap block document (admin-side, runs on save).
 *
 * Slice seo-extract-md / TECH-DEBT #1: the original helpers lived inline in
 * ContentEditor.tsx and walked ONLY rich-text nodes (`type === 'text'` + `.content`
 * children). The markdown plugin is an atom node — its prose lives in
 * `attrs.content` as a raw markdown string with NO child nodes — so a page authored
 * as one markdown block produced an EMPTY seoDescription/featuredImage (no meta
 * description, no post-grid excerpt).
 *
 * These functions are extracted here (not left in the React page) purely for a test
 * seam: the admin vitest config runs in a node environment over `src/**` .test.ts`,
 * so the covered logic must be importable without pulling in the page's DOM/React
 * graph. Sole current consumer: ContentEditor.tsx. Not promoted to packages/shared —
 * only one consumer and no cross-workspace boundary is crossed (Product/Category
 * editors edit seoDescription manually; they do NOT block-walk). Simpler alternative
 * rejected: keeping the helpers inline in ContentEditor.tsx, which is untestable
 * under the node-env unit config.
 */

/**
 * Reduce a markdown string to plain prose suitable for a meta description.
 * Strips fenced code, image refs, link URLs (keeping link text), heading/list/quote
 * markers, horizontal rules, inline code, and emphasis markers, then collapses
 * whitespace. Order matters: code fences and image refs are removed before the
 * link/emphasis passes so their inner punctuation is not partially unwrapped.
 */
export function stripMarkdown(md: string): string {
    return md
        // fenced code blocks (``` … ```) → drop entirely
        .replace(/```[\s\S]*?```/g, " ")
        // images ![alt](src) → drop (image URL handled by findImage, alt is not prose)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        // links [text](url) → keep the visible text only
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        // heading markers (#, ##, …) at line start
        .replace(/^#{1,6}\s+/gm, "")
        // horizontal rules (---, ***, ___) — before emphasis strip
        .replace(/^\s*([-*_])\1{2,}\s*$/gm, " ")
        // blockquote markers
        .replace(/^\s*>\s?/gm, "")
        // unordered list markers (-, *, +)
        .replace(/^\s*[-*+]\s+/gm, "")
        // ordered list markers (1. 2. …)
        .replace(/^\s*\d+\.\s+/gm, "")
        // inline code `code` → code
        .replace(/`([^`]*)`/g, "$1")
        // bold / italic / strikethrough markers
        .replace(/(\*\*|__|~~|\*|_)/g, "")
        // collapse all whitespace runs
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * First ~160 chars of page prose in DOCUMENT ORDER. Includes rich-text node text and
 * markdown-block content (syntax stripped). A leading markdown block contributes
 * before later paragraphs because traversal follows array/child order.
 */
export function extractText(blocks: any[]): string {
    let text = "";
    const traverse = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (node.type === "text" && typeof node.text === "string") text += node.text + " ";
        if (node.type === "markdown" && typeof node.attrs?.content === "string") {
            text += stripMarkdown(node.attrs.content) + " ";
        }
        if (Array.isArray(node.content)) node.content.forEach(traverse);
    };
    blocks.forEach(traverse);
    return text.substring(0, 160).trim();
}

/**
 * First image src in DOCUMENT ORDER — either a rich-text image node (`attrs.src`) or
 * the first markdown image ref (`![alt](src)`) inside a markdown block.
 */
export function findImage(blocks: any[]): string {
    let src = "";
    const traverse = (node: any) => {
        if (src) return;
        if (!node || typeof node !== "object") return;
        if (node.type === "image" && node.attrs?.src) {
            src = node.attrs.src;
            return;
        }
        if (node.type === "markdown" && typeof node.attrs?.content === "string") {
            const m = node.attrs.content.match(/!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/);
            if (m) {
                src = m[1];
                return;
            }
        }
        if (Array.isArray(node.content)) node.content.forEach(traverse);
    };
    blocks.forEach(traverse);
    return src;
}
