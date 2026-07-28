import { NodeViewWrapper } from '@tiptap/react';
import { FileVideo, TriangleAlert, Video, Youtube } from 'lucide-react';
import React from 'react';
import { BlockWidthControl } from '../BlockWidthControl';
import { parseVideoSource, type VideoSourceKind } from '../common/videoSource';

const Input = ({ value, onChange, placeholder }: any) => (
    <input className="w-full h-9 bg-white border border-gray-200 rounded px-3 text-sm focus:border-red-500 outline-none" value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
);

/**
 * Provider indicator per recognized parser kind — slice `vid-2`.
 *
 * Differentiation is by ICON SHAPE and LABEL TEXT only. Brand colours (YouTube red, Vimeo
 * blue) are forbidden by CLAUDE.md Critical Rule 6 and named explicitly as forbidden in
 * `docs/plan-youtube-vimeo-embed.md` § *Editor UX* — every indicator below is rendered in
 * `text-muted-foreground`, so a colour-blind or dark-mode reader gets the same information.
 *
 * `unknown` is deliberately absent: it is not a provider, it is the failure state, and it
 * gets the callout below rather than a row in this table.
 */
const SOURCE_HINT: Record<
    Exclude<VideoSourceKind, "unknown">,
    { Icon: typeof Youtube; label: string }
> = {
    youtube: { Icon: Youtube, label: "YouTube" },
    vimeo: { Icon: Video, label: "Vimeo" },
    direct: { Icon: FileVideo, label: "Media file" },
};

/**
 * Admin-side editor for the `video` block. Browser-only by construction (it is a Tiptap
 * NodeView, reached from `src/admin.ts`); the parser it imports is the one module shared
 * with the render path, and it is pure — importing it here does not cross the split-entry
 * boundary (CLAUDE.md Critical Rule 1).
 *
 * ## Why the failure state lives here
 *
 * `VideoRender.tsx` renders NOTHING for an unrecognized URL. That is correct for a visitor
 * — no broken box on a public page — but it means the author gets no signal from the live
 * site. So the signal has to be here, at the moment of typing: the callout below is the only
 * place a bad URL is ever visible. Validation stays WARNING-ONLY and never blocks a save;
 * blocking would need wiring through ContentEditor's save pipeline, which the plan puts out
 * of scope.
 */
export function VideoEditor(props: any) {
    const { url, caption, blockWidth } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    // Same classifier the renderer uses, so what the author is told here is exactly what the
    // public page will do — the two cannot drift.
    const source = parseVideoSource(typeof url === "string" ? url : "");
    const hint = source.kind === "unknown" ? null : SOURCE_HINT[source.kind];
    // An empty block is not a mistake, it is an unfinished one: warn only once something has
    // been typed. `rawUrl` is the caller's input verbatim, so this is a true "non-empty" test.
    const isUnrecognized = source.kind === "unknown" && source.rawUrl.trim() !== "";

    // The header badge is the block's identity AND its provider indicator. Before vid-2 it
    // was a fixed YouTube-red glyph on a block that now also serves Vimeo and uploaded media
    // — a name that no longer matched the behaviour. It is now the detected provider, in
    // theme tokens.
    const BadgeIcon = hint?.Icon ?? Video;

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground">
                            <BadgeIcon className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Video Embed</span>
                    </div>
                    <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                </div>
                <div className="p-5 space-y-4">
                    <Input value={url} onChange={(v: string) => update('url', v)} placeholder="Paste YouTube / Vimeo URL..." />
                    {hint && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <hint.Icon className="h-3.5 w-3.5" />
                            <span>{hint.label}</span>
                        </div>
                    )}
                    {isUnrecognized && (
                        // NEUTRAL themed styling, not amber. The plan asked for an amber
                        // warning, but this design system has no semantic `warning` token
                        // (admin/src/index.css defines muted / accent / destructive and no
                        // more) and `bg-amber-50` would be a hardcoded colour. `destructive`
                        // is the wrong semantic — nothing failed and the save is not blocked.
                        // So: muted surface + the TriangleAlert SHAPE carries the severity.
                        // This is the fallback the slice doc prescribes; the missing token is
                        // recorded in docs/TECH-DEBT.md.
                        // `role="status"` because this appears while the author is typing: a
                        // screen reader has already moved past this point in the DOM and would
                        // otherwise never announce it.
                        <div
                            className="flex items-start gap-2 rounded border border-border bg-muted p-2 text-xs text-muted-foreground"
                            role="status"
                        >
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>URL not recognized as YouTube or Vimeo — this block will not render on the published page.</span>
                        </div>
                    )}
                    <Input value={caption} onChange={(v: string) => update('caption', v)} placeholder="Caption (Optional)" />
                </div>
            </div>
        </NodeViewWrapper>
    );
}
