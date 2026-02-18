import { NodeViewWrapper } from '@tiptap/react';
import { Code2, Hash, FileCode } from 'lucide-react';
import React from 'react';
import { LANGUAGES } from './schema';

export function CodeBlockEditor(props: any) {
    const { code, language, filename, showLineNumbers } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-slate-200 bg-white rounded-xl overflow-hidden shadow-sm">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-slate-200 text-slate-600">
                            <Code2 className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Code Block</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => update('showLineNumbers', !showLineNumbers)}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${showLineNumbers ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Toggle line numbers"
                        >
                            <Hash className="w-3 h-3" />
                            <span>Lines</span>
                        </button>
                        <select
                            value={language || "plaintext"}
                            onChange={e => update('language', e.target.value)}
                            className="text-xs bg-white border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none focus:border-slate-400"
                        >
                            {LANGUAGES.map(lang => (
                                <option key={lang} value={lang}>{lang}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Code area */}
                <div className="bg-slate-900">
                    <textarea
                        className="w-full min-h-[120px] p-4 text-sm font-mono bg-transparent text-slate-100 focus:outline-none resize-y placeholder:text-slate-500"
                        value={code || ""}
                        onChange={e => update('code', e.target.value)}
                        placeholder="// Paste your code here..."
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                    />
                </div>

                {/* Footer - filename */}
                <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-t border-slate-200">
                    <FileCode className="w-3 h-3 text-slate-400" />
                    <input
                        className="flex-1 text-xs bg-transparent text-slate-600 focus:outline-none placeholder:text-slate-400"
                        value={filename || ""}
                        onChange={e => update('filename', e.target.value)}
                        placeholder="filename (optional, e.g. index.ts)"
                    />
                </div>
            </div>
        </NodeViewWrapper>
    );
}
