import React from "react";

/**
 * Pure React renderer for InlineTextSegment[] (Shape B).
 * No dangerouslySetInnerHTML. Deterministic, SSR-safe.
 *
 * Produces <strong> and/or <em> wrappers around text segments.
 * Falls back to a plain string when given undefined/empty.
 */

interface InlineTextSegment {
    text?: string;
    bold?: boolean;
    italic?: boolean;
    br?: boolean;
}

interface Props {
    segments: InlineTextSegment[] | undefined;
    className?: string;
    as?: keyof React.JSX.IntrinsicElements;
}

export function InlineRichTextRenderer({ segments, className, as: Tag = "span" }: Props) {
    if (!segments || segments.length === 0) return null;

    return (
        <Tag className={className}>
            {segments.map((seg, i) => {
                if (seg.br) return <br key={i} />;
                let el: React.ReactNode = seg.text || "";
                if (seg.italic) el = <em key={`i${i}`}>{el}</em>;
                if (seg.bold) el = <strong key={`b${i}`}>{el}</strong>;
                return <React.Fragment key={i}>{el}</React.Fragment>;
            })}
        </Tag>
    );
}
