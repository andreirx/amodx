import React from 'react';
import { AlignCenter, AlignJustify, Maximize } from 'lucide-react';

const OPTIONS = [
    { id: 'content', icon: AlignCenter, title: 'Content width' },
    { id: 'wide', icon: AlignJustify, title: 'Wide (site width)' },
    { id: 'full', icon: Maximize, title: 'Full bleed' },
] as const;

export function BlockWidthControl({ value = "content", onChange }: { value?: string; onChange: (v: string) => void }) {
    return (
        <div className="flex bg-gray-100 rounded-md p-0.5" title="Block width">
            {OPTIONS.map(opt => (
                <button
                    key={opt.id}
                    onClick={() => onChange(opt.id)}
                    className={`p-1 rounded-sm transition-all ${value === opt.id ? 'bg-white shadow text-slate-800' : 'text-gray-400 hover:text-gray-600'}`}
                    title={opt.title}
                >
                    <opt.icon className="w-3 h-3" />
                </button>
            ))}
        </div>
    );
}
