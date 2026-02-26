"use client";

import React, { useState, useMemo } from "react";
import hljs from "highlight.js/lib/common";

// Inline highlight.js theme — Catppuccin Mocha palette (matches markdown plugin)
const CODE_HIGHLIGHT_STYLES = `
.amodx-code .hljs-keyword, .amodx-code .hljs-selector-tag, .amodx-code .hljs-built_in { color: #cba6f7; }
.amodx-code .hljs-string, .amodx-code .hljs-attr, .amodx-code .hljs-addition { color: #a6e3a1; }
.amodx-code .hljs-comment, .amodx-code .hljs-quote { color: #6c7086; font-style: italic; }
.amodx-code .hljs-number, .amodx-code .hljs-literal { color: #fab387; }
.amodx-code .hljs-function .hljs-title, .amodx-code .hljs-title.function_ { color: #89b4fa; }
.amodx-code .hljs-type, .amodx-code .hljs-title.class_ { color: #f9e2af; }
.amodx-code .hljs-variable, .amodx-code .hljs-template-variable { color: #f38ba8; }
.amodx-code .hljs-regexp { color: #f5c2e7; }
.amodx-code .hljs-symbol, .amodx-code .hljs-bullet { color: #f2cdcd; }
.amodx-code .hljs-meta { color: #89dceb; }
.amodx-code .hljs-deletion { color: #f38ba8; background: rgba(243,139,168,0.1); }
.amodx-code .hljs-emphasis { font-style: italic; }
.amodx-code .hljs-strong { font-weight: 700; }
.amodx-code .hljs-section { color: #89b4fa; font-weight: 700; }
.amodx-code .hljs-tag { color: #89dceb; }
.amodx-code .hljs-name { color: #cba6f7; }
.amodx-code .hljs-attribute { color: #89b4fa; }
`;

export function CodeBlockRender({ attrs }: { attrs: any }) {
    const { code, language, filename, showLineNumbers } = attrs;
    const [copied, setCopied] = useState(false);

    const highlighted = useMemo(() => {
        if (!code) return "";
        if (language && language !== "plaintext" && hljs.getLanguage(language)) {
            return hljs.highlight(code, { language }).value;
        }
        return hljs.highlightAuto(code).value;
    }, [code, language]);

    if (!code) return null;

    const lines = highlighted.split("\n");

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            const textarea = document.createElement("textarea");
            textarea.value = code;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <>
            <style dangerouslySetInnerHTML={{ __html: CODE_HIGHLIGHT_STYLES }} />
            <div className="amodx-code my-8 rounded-lg overflow-hidden border border-border/50 bg-[#1e1e2e] text-sm">
                {/* Header bar */}
                {(filename || language !== "plaintext") && (
                    <div className="flex items-center justify-between px-4 py-2 bg-[#181825] border-b border-[#313244] text-xs">
                        <span className="text-[#cdd6f4] font-mono">
                            {filename || ""}
                        </span>
                        <span className="text-[#6c7086]">{language}</span>
                    </div>
                )}

                {/* Code area */}
                <div className="relative group">
                    <button
                        onClick={handleCopy}
                        className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity bg-[#313244] text-[#cdd6f4] hover:bg-[#45475a]"
                    >
                        {copied ? "Copied!" : "Copy"}
                    </button>

                    <pre className="overflow-x-auto p-4">
                        <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                            {lines.map((line: string, i: number) => (
                                <div key={i} className="leading-6">
                                    {showLineNumbers && (
                                        <span className="inline-block w-8 text-right mr-4 text-[#6c7086] select-none text-xs">
                                            {i + 1}
                                        </span>
                                    )}
                                    <span className="text-[#cdd6f4]" dangerouslySetInnerHTML={{ __html: line || "\n" }} />
                                </div>
                            ))}
                        </code>
                    </pre>
                </div>
            </div>
        </>
    );
}
