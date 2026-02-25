import { NodeViewWrapper } from '@tiptap/react';
import { FileText, Eye, Code2 } from 'lucide-react';
import React, { useState, useMemo } from 'react';
import { BlockWidthControl } from '../BlockWidthControl';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import { MARKDOWN_STYLES } from './MarkdownRender';

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

export function MarkdownEditor(props: any) {
    const { content, blockWidth } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });
    const [preview, setPreview] = useState(false);

    const html = useMemo(() => {
        if (!preview || !content) return "";
        return marked.parse(content) as string;
    }, [preview, content]);

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-violet-200 bg-white rounded-xl overflow-hidden shadow-sm">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-violet-50 border-b border-violet-200">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-violet-200 text-violet-600">
                            <FileText className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Markdown</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-violet-200" />
                        <button
                            onClick={() => setPreview(!preview)}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                                preview
                                    ? 'bg-violet-200 text-violet-800'
                                    : 'text-violet-400 hover:text-violet-600'
                            }`}
                            title={preview ? "Switch to edit" : "Preview rendered"}
                        >
                            {preview ? <Code2 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            <span>{preview ? "Edit" : "Preview"}</span>
                        </button>
                    </div>
                </div>

                {/* Content area */}
                {preview ? (
                    <div className="p-6 min-h-[120px] bg-white">
                        <style dangerouslySetInnerHTML={{ __html: MARKDOWN_STYLES }} />
                        <div
                            className="amodx-md"
                            dangerouslySetInnerHTML={{ __html: html }}
                        />
                    </div>
                ) : (
                    <textarea
                        className="w-full min-h-[200px] p-4 text-sm font-mono bg-slate-900 text-slate-100 focus:outline-none resize-y placeholder:text-slate-500"
                        value={content || ""}
                        onChange={e => update('content', e.target.value)}
                        placeholder="# Paste your markdown here..."
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                    />
                )}

                {/* Footer */}
                <div className="px-4 py-2 bg-violet-50/50 border-t border-violet-200 text-[10px] text-violet-500 flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    <span>Supports headings, lists, tables, code blocks with syntax highlighting, and more.</span>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
