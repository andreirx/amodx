"use client";

import React, { useState } from "react";

export function CodeBlockRender({ attrs }: { attrs: any }) {
    const { code, language, filename, showLineNumbers } = attrs;
    const [copied, setCopied] = useState(false);

    if (!code) return null;

    const lines = code.split("\n");

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback for older browsers
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
        <div className="my-8 rounded-lg overflow-hidden border border-border/50 bg-[#1e1e2e] text-sm">
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
                    <code>
                        {lines.map((line: string, i: number) => (
                            <div key={i} className="leading-6">
                                {showLineNumbers && (
                                    <span className="inline-block w-8 text-right mr-4 text-[#6c7086] select-none text-xs">
                                        {i + 1}
                                    </span>
                                )}
                                <span className="text-[#cdd6f4]">{line || "\n"}</span>
                            </div>
                        ))}
                    </code>
                </pre>
            </div>
        </div>
    );
}
