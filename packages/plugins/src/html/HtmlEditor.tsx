import { NodeViewWrapper } from '@tiptap/react';
import { Code, Eye } from 'lucide-react';
import React from 'react';
import { BlockWidthControl } from '../BlockWidthControl';

export function HtmlEditor(props: any) {
    const { content, blockWidth } = props.node.attrs;
    const update = (value: string) => props.updateAttributes({ content: value });

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-amber-200 bg-amber-50/30 rounded-xl overflow-hidden shadow-sm">
                <div className="flex items-center justify-between px-4 py-2 bg-amber-100/50 border-b border-amber-100">
                    <div className="flex items-center gap-2">
                        <Code className="w-4 h-4 text-amber-600" />
                        <span className="text-xs font-bold text-amber-700 uppercase tracking-widest">Raw HTML / Embed</span>
                    </div>
                    <BlockWidthControl value={blockWidth} onChange={v => props.updateAttributes({ blockWidth: v })} />
                </div>
                <div className="p-0">
                    <textarea
                        className="w-full h-32 p-4 text-xs font-mono bg-white focus:outline-none resize-y text-slate-700"
                        value={content}
                        onChange={(e) => update(e.target.value)}
                        placeholder="<iframe src='...' />"
                        spellCheck={false}
                    />
                </div>
                <div className="px-4 py-2 bg-amber-50/50 border-t border-amber-100 text-[10px] text-amber-600/80 flex gap-2">
                    <Eye className="w-3 h-3" />
                    <span>Renders exactly as entered. Be careful with scripts.</span>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
