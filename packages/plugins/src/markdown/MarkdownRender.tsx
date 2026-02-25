import React from "react";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/common";

// Self-contained styles scoped to .amodx-md — no external CSS dependency
export const MARKDOWN_STYLES = `
.amodx-md {
    line-height: 1.75;
    color: inherit;
}
/* Headings */
.amodx-md h1 { font-size: 2em; font-weight: 700; margin: 1.2em 0 0.6em; line-height: 1.2; }
.amodx-md h2 { font-size: 1.5em; font-weight: 700; margin: 1.1em 0 0.5em; line-height: 1.3; }
.amodx-md h3 { font-size: 1.25em; font-weight: 600; margin: 1em 0 0.4em; line-height: 1.4; }
.amodx-md h4 { font-size: 1.1em; font-weight: 600; margin: 0.9em 0 0.4em; }
.amodx-md h5 { font-size: 1em; font-weight: 600; margin: 0.8em 0 0.3em; }
.amodx-md h6 { font-size: 0.9em; font-weight: 600; margin: 0.8em 0 0.3em; color: #6b7280; }
/* Paragraphs */
.amodx-md p { margin: 0.75em 0; }
/* Links */
.amodx-md a { color: hsl(var(--primary, 220 90% 56%)); text-decoration: underline; text-underline-offset: 2px; }
.amodx-md a:hover { opacity: 0.8; }
/* Lists */
.amodx-md ul { list-style-type: disc; padding-left: 1.5em; margin: 0.75em 0; }
.amodx-md ol { list-style-type: decimal; padding-left: 1.5em; margin: 0.75em 0; }
.amodx-md li { margin: 0.25em 0; }
.amodx-md li > ul, .amodx-md li > ol { margin: 0.25em 0; }
/* Blockquotes */
.amodx-md blockquote {
    border-left: 4px solid #d1d5db;
    padding: 0.5em 1em;
    margin: 1em 0;
    color: #6b7280;
    font-style: italic;
}
.amodx-md blockquote p { margin: 0.25em 0; }
/* Horizontal Rule */
.amodx-md hr { border: none; border-top: 1px solid #e5e7eb; margin: 2em 0; }
/* Images */
.amodx-md img { max-width: 100%; height: auto; border-radius: 0.5rem; margin: 1em 0; }
/* Tables */
.amodx-md table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.9em; }
.amodx-md th { border: 1px solid #d1d5db; padding: 0.5em 0.75em; text-align: left; font-weight: 600; background: #f9fafb; }
.amodx-md td { border: 1px solid #d1d5db; padding: 0.5em 0.75em; }
.amodx-md tr:nth-child(even) td { background: #f9fafb; }
/* Inline code */
.amodx-md code:not(pre code) {
    background: #f3f4f6;
    padding: 0.15em 0.4em;
    border-radius: 0.25em;
    font-size: 0.875em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
/* Code blocks */
.amodx-md pre {
    background: #1e1e2e;
    border-radius: 0.5rem;
    padding: 1em 1.25em;
    overflow-x: auto;
    margin: 1em 0;
    border: 1px solid rgba(255,255,255,0.05);
}
.amodx-md pre code {
    background: none;
    padding: 0;
    font-size: 0.85em;
    line-height: 1.7;
    color: #cdd6f4;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
/* highlight.js token colors — Catppuccin Mocha palette */
.amodx-md .hljs-keyword, .amodx-md .hljs-selector-tag, .amodx-md .hljs-built_in { color: #cba6f7; }
.amodx-md .hljs-string, .amodx-md .hljs-attr, .amodx-md .hljs-addition { color: #a6e3a1; }
.amodx-md .hljs-comment, .amodx-md .hljs-quote { color: #6c7086; font-style: italic; }
.amodx-md .hljs-number, .amodx-md .hljs-literal { color: #fab387; }
.amodx-md .hljs-function .hljs-title, .amodx-md .hljs-title.function_ { color: #89b4fa; }
.amodx-md .hljs-type, .amodx-md .hljs-title.class_ { color: #f9e2af; }
.amodx-md .hljs-variable, .amodx-md .hljs-template-variable { color: #f38ba8; }
.amodx-md .hljs-regexp { color: #f5c2e7; }
.amodx-md .hljs-symbol, .amodx-md .hljs-bullet { color: #f2cdcd; }
.amodx-md .hljs-meta { color: #89dceb; }
.amodx-md .hljs-deletion { color: #f38ba8; background: rgba(243,139,168,0.1); }
.amodx-md .hljs-emphasis { font-style: italic; }
.amodx-md .hljs-strong { font-weight: 700; }
.amodx-md .hljs-section { color: #89b4fa; font-weight: 700; }
.amodx-md .hljs-tag { color: #89dceb; }
.amodx-md .hljs-name { color: #cba6f7; }
.amodx-md .hljs-attribute { color: #89b4fa; }
`;

const marked = new Marked(
    markedHighlight({
        langPrefix: "hljs language-",
        highlight(code: string, lang: string) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
    })
);

export function MarkdownRender({ attrs }: { attrs: any }) {
    const { content } = attrs;

    if (!content) return null;

    const html = marked.parse(content) as string;

    return (
        <>
            <style dangerouslySetInnerHTML={{ __html: MARKDOWN_STYLES }} />
            <div
                className="amodx-md my-8"
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </>
    );
}
