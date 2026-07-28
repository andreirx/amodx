import { NodeViewWrapper } from '@tiptap/react';
import { Film, Link as LinkIcon, Image as ImageIcon, Upload, TriangleAlert, Youtube, Video, FileVideo, Library } from 'lucide-react';
import React, { useState } from 'react';
import { BlockWidthControl } from '../BlockWidthControl';
import { InlineRichTextField } from '../common/InlineRichTextField';
import { parseVideoSource, type VideoSourceKind } from '../common/videoSource';

/**
 * The three ways an author can supply a background video — slice `vid-3`, plan § *Editor UX*
 * option 4b. They are TABS rather than a row of buttons because they are mutually exclusive
 * inputs into ONE attribute (`videoSrc`): only one can be the source at a time, and the old
 * "UPLOAD or LIBRARY" link pair had no way to express "or paste an embed URL" without a
 * third link and no indication of which one produced the current value.
 */
type SourceTab = "upload" | "library" | "embed";

const SOURCE_TABS: { id: SourceTab; label: string; Icon: typeof Upload }[] = [
    { id: "upload", label: "Upload", Icon: Upload },
    { id: "library", label: "Library", Icon: Library },
    { id: "embed", label: "Embed", Icon: LinkIcon },
];

/**
 * Provider indicator per recognized parser kind.
 *
 * Identical policy to `video/VideoEditor.tsx` (`vid-2`): differentiation by icon SHAPE and
 * label TEXT only, rendered in `text-muted-foreground`. Brand colours are forbidden by
 * CLAUDE.md Critical Rule 6 and called out as forbidden in
 * `docs/plan-youtube-vimeo-embed.md` § *Editor UX*. `unknown` is absent on purpose — it is
 * the failure state and gets the warning callout, not a row here.
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
 * YouTube's static thumbnail endpoint, keyed by the id the parser already validated.
 *
 * `hqdefault` and not the plan's `maxresdefault`: maxres exists only for videos uploaded at
 * 720p or above and 404s otherwise, which would give the author a broken image for a video
 * that embeds perfectly well. `hqdefault` is generated for every video.
 *
 * Deliberately NOT in `common/videoSource.ts`. It has exactly one caller, it is admin-only
 * (the public render never shows a thumbnail), and no second surface is planned — the
 * parser module's job is the URL classification both entry points share. Vimeo has no
 * equivalent static URL; its thumbnail needs an oEmbed round trip, which the slice puts out
 * of scope, so the Vimeo preview is an id-labelled placeholder.
 */
function youtubeThumbnailUrl(providerId: string): string {
    return `https://img.youtube.com/vi/${providerId}/hqdefault.jpg`;
}

const Input = ({ value, onChange, placeholder, className = "" }: any) => (
    <input
        className={`flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm shadow-sm transition-all focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none placeholder:text-gray-400 ${className}`}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

const Label = ({ children, icon: Icon }: any) => (
    <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-gray-600">
        {Icon && <Icon className="w-3.5 h-3.5 text-violet-500" />}
        {children}
    </div>
);

export function VideoHeroEditor(props: any) {
    const {
        headline, subheadline, subheadlineRich,
        videoSrc, posterSrc, ctaText, ctaLink,
        blockWidth, overlayOpacity,
        overlayColorToken, headlineColorToken, subheadlineColorToken,
        muted, loop,
    } = props.node.attrs;
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    // The SAME classifier the public render calls, so what this editor promises and what the
    // page does cannot drift — the property `vid-2` established for the `video` block.
    const source = parseVideoSource(typeof videoSrc === "string" ? videoSrc : "");
    const hint = source.kind === "unknown" ? null : SOURCE_HINT[source.kind];
    const isEmbed = source.kind === "youtube" || source.kind === "vimeo";
    // An empty block is unfinished, not wrong: warn only once something has been typed.
    // `rawUrl` is the author's input verbatim, so this is a true non-empty test.
    const isUnrecognized = source.kind === "unknown" && source.rawUrl.trim() !== "";

    const [uploading, setUploading] = useState<"video" | "poster" | null>(null);
    // Opens on the tab that matches what is already stored, so re-editing a block does not
    // present the author with a control that has nothing to do with the current value.
    // Initialiser form: this is the tab's STARTING point, not a mirror of `videoSrc` — once
    // open, the author's tab choice is theirs, and re-deriving it on every keystroke would
    // yank the panel away mid-typing.
    const [tab, setTab] = useState<SourceTab>(isEmbed ? "embed" : "upload");

    const handleUpload = async (file: File, field: string, type: "video" | "poster") => {
        const uploadFn = props.editor.storage.image?.uploadFn;
        if (!uploadFn) return;
        setUploading(type);
        try {
            const url = await uploadFn(file);
            update(field, url);
        } catch (e: any) {
            alert(e.message || "Upload failed");
        } finally {
            setUploading(null);
        }
    };

    const handlePickVideo = () => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) pickFn((url: string) => update('videoSrc', url), { mediaType: "video" });
    };

    const handlePickPoster = () => {
        const pickFn = props.editor.storage.image?.pickFn;
        if (pickFn) pickFn((url: string) => update('posterSrc', url), { mediaType: "image" });
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-violet-50 text-violet-600">
                            <Film className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Video Hero</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
                        {isEmbed ? (
                            // `buildBackgroundEmbedUrl` hardcodes mute+loop for both providers:
                            // an unmuted background embed would be refused autoplay by every
                            // browser, and YouTube only loops via the `playlist={id}` pairing.
                            // The two checkboxes therefore have NO effect on this source kind,
                            // so showing them enabled would be a lie in the UI. The attributes
                            // are left untouched — switching back to an upload restores them.
                            <span className="text-xs text-muted-foreground">Muted + looped (embed)</span>
                        ) : (
                            <>
                                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                                    <input type="checkbox" checked={muted ?? true} onChange={e => update('muted', e.target.checked)} className="accent-violet-600" />
                                    Muted
                                </label>
                                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                                    <input type="checkbox" checked={loop ?? true} onChange={e => update('loop', e.target.checked)} className="accent-violet-600" />
                                    Loop
                                </label>
                            </>
                        )}
                    </div>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left: text controls */}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Headline & Text</Label>
                            <Input value={headline} onChange={(v: string) => update('headline', v)} className="font-bold" placeholder="Headline" />
                            <InlineRichTextField
                                value={subheadlineRich}
                                fallbackText={subheadline}
                                onChange={(segments, plainText) => {
                                    update('subheadlineRich', segments);
                                    update('subheadline', plainText);
                                }}
                                placeholder="Subheadline (bold / italic supported)"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Button Text</Label>
                                <Input value={ctaText} onChange={(v: string) => update('ctaText', v)} placeholder="Shop Now" />
                            </div>
                            <div className="space-y-1">
                                <Label icon={LinkIcon}>Link</Label>
                                <Input value={ctaLink} onChange={(v: string) => update('ctaLink', v)} list="amodx-links" placeholder="/path" className="font-mono text-xs" />
                            </div>
                        </div>
                    </div>

                    {/* Right: media controls */}
                    <div className="space-y-4">
                        {/* Video source — tabbed Upload | Library | Embed (plan § Editor UX 4b) */}
                        <div>
                            <Label icon={Film}>Background Video</Label>

                            {/*
                              * The tabs REPLACE the old hover-overlay "Replace / Library"
                              * actions: those were the only way to change an existing source
                              * and they were invisible until hover. No capability is lost —
                              * upload lives on the Upload tab, the picker on Library, and
                              * clearing is the always-visible Remove button below the preview.
                              */}
                            <div role="tablist" aria-label="Background video source" className="mt-1 flex gap-1 rounded-md bg-muted p-0.5">
                                {SOURCE_TABS.map(t => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        role="tab"
                                        id={`videohero-tab-${t.id}`}
                                        aria-controls="videohero-tabpanel"
                                        aria-selected={tab === t.id}
                                        onClick={() => setTab(t.id)}
                                        className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold transition-colors ${tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                                    >
                                        <t.Icon className="w-3 h-3" />
                                        {t.label}
                                    </button>
                                ))}
                            </div>

                            {/* Preview — driven by the parser's kind, not by the active tab, so
                              * it always shows what is actually STORED. */}
                            <div className="mt-2 relative aspect-video bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 overflow-hidden">
                                {uploading === "video" ? (
                                    <div className="flex items-center gap-2 text-xs"><Upload className="w-4 h-4 animate-pulse" /> Uploading video...</div>
                                ) : source.kind === "direct" ? (
                                    <video src={source.embedUrl ?? undefined} muted className="w-full h-full object-cover" />
                                ) : source.kind === "youtube" && source.providerId ? (
                                    // YouTube is the one provider with a static, id-derivable
                                    // thumbnail. NOTE for the CSP work tracked in `vid-2`: this
                                    // needs `img-src https://img.youtube.com` in the ADMIN app
                                    // if a policy is ever introduced there.
                                    <img src={youtubeThumbnailUrl(source.providerId)} alt="" className="w-full h-full object-cover" />
                                ) : source.kind === "vimeo" ? (
                                    // No static thumbnail without an oEmbed call (out of scope),
                                    // so the confirmation the author gets is the parsed id.
                                    <div className="flex items-center gap-2 text-xs"><Video className="w-4 h-4" /> Vimeo · {source.providerId}</div>
                                ) : (
                                    <div className="text-[10px] text-gray-500">No background video</div>
                                )}
                            </div>

                            {videoSrc ? (
                                <button
                                    type="button"
                                    onClick={() => update('videoSrc', '')}
                                    className="mt-1 text-[10px] font-bold text-muted-foreground hover:underline"
                                >
                                    REMOVE
                                </button>
                            ) : null}

                            {/*
                              * Active tab's control.
                              *
                              * One panel, relabelled by whichever tab is selected — there is
                              * exactly one control at a time, so three panels would be three
                              * empty divs. `aria-labelledby` therefore points at the SELECTED
                              * tab, not a fixed id.
                              *
                              * Known gap, deliberate: this is a tablist WITHOUT roving
                              * arrow-key navigation. Each button keeps its default tab stop,
                              * so every source is still keyboard-reachable and activatable —
                              * the keyboard idiom is Tab rather than Arrow. Adding roving
                              * `tabIndex` + a keydown handler is real interaction logic that
                              * this package has no DOM test harness to cover
                              * (`docs/testing-strategy.md` §4), so it is recorded rather than
                              * written blind.
                              */}
                            <div
                                role="tabpanel"
                                id="videohero-tabpanel"
                                aria-labelledby={`videohero-tab-${tab}`}
                                className="mt-2"
                            >
                                {tab === "upload" && (
                                    <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded border border-border bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
                                        <Upload className="w-3.5 h-3.5" />
                                        Choose a video file
                                        <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'videoSrc', 'video')} accept="video/*" />
                                    </label>
                                )}
                                {tab === "library" && (
                                    <button
                                        type="button"
                                        onClick={handlePickVideo}
                                        className="flex w-full items-center justify-center gap-1.5 rounded border border-border bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                                    >
                                        <Library className="w-3.5 h-3.5" />
                                        Open media library
                                    </button>
                                )}
                                {tab === "embed" && (
                                    <Input
                                        value={videoSrc}
                                        onChange={(v: string) => update('videoSrc', v)}
                                        placeholder="Paste a YouTube or Vimeo URL..."
                                        className="font-mono text-xs"
                                    />
                                )}
                            </div>

                            {/* Provider detection + failure state. Both are OUTSIDE the tab
                              * panel: the stored value is unrecognized regardless of which tab
                              * the author happens to be looking at. */}
                            {hint && (
                                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <hint.Icon className="w-3.5 h-3.5" />
                                    <span>{hint.label}</span>
                                </div>
                            )}
                            {isUnrecognized && (
                                // Neutral tokens, not amber: the admin design system has no
                                // semantic warning token (`VID2-WARNING-TOKEN`,
                                // docs/TECH-DEBT.md § vid-2 residuals), so the TriangleAlert
                                // SHAPE carries the severity. `role="status"` because this
                                // appears while the author types — a screen reader has already
                                // moved past this point in the DOM.
                                <div
                                    className="mt-2 flex items-start gap-2 rounded border border-border bg-muted p-2 text-xs text-muted-foreground"
                                    role="status"
                                >
                                    <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>URL not recognized as YouTube, Vimeo, or an uploaded media file — the published hero will show the poster image instead.</span>
                                </div>
                            )}
                        </div>

                        {/* Poster image */}
                        <div>
                            <Label icon={ImageIcon}>Poster Image (fallback)</Label>
                            <div className="mt-1 relative h-20 bg-gray-50 rounded-lg border border-dashed border-gray-200 flex items-center justify-center text-gray-400 overflow-hidden group/poster">
                                {uploading === "poster" ? (
                                    <div className="flex items-center gap-2 text-xs"><Upload className="w-4 h-4 animate-pulse" /> Uploading...</div>
                                ) : posterSrc ? (
                                    <>
                                        <img src={posterSrc} className="h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/poster:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                                            <label className="cursor-pointer bg-white text-gray-900 px-2 py-1 rounded text-[10px] font-medium hover:bg-gray-100">
                                                Replace
                                                <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'posterSrc', 'poster')} accept="image/*" />
                                            </label>
                                            <button onClick={() => update('posterSrc', '')} className="bg-red-600 text-white px-2 py-1 rounded text-[10px] font-medium hover:bg-red-700">Remove</button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex gap-2 items-center">
                                        <label className="cursor-pointer text-[10px] font-bold text-violet-400 hover:underline">
                                            UPLOAD
                                            <input type="file" className="hidden" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'posterSrc', 'poster')} accept="image/*" />
                                        </label>
                                        <span className="text-[10px] text-gray-500">OR</span>
                                        <button onClick={handlePickPoster} className="text-[10px] font-bold text-violet-400 hover:underline">LIBRARY</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Cover controls: overlay + color tokens */}
                <div className="px-5 pb-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <Label>Overlay</Label>
                        <input
                            type="range"
                            min={0} max={1} step={0.05}
                            value={overlayOpacity ?? 0.4}
                            onChange={e => update('overlayOpacity', parseFloat(e.target.value))}
                            className="flex-1 accent-violet-600"
                        />
                        <span className="text-xs text-gray-500 font-mono w-8 text-right">{Math.round((overlayOpacity ?? 0.4) * 100)}%</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Overlay Color</label>
                            <select value={overlayColorToken || 'auto'} onChange={e => update('overlayColorToken', e.target.value)} className="w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-violet-500 outline-none">
                                <option value="auto">Auto (Black)</option>
                                <option value="black">Black</option>
                                <option value="primary">Primary</option>
                                <option value="foreground">Foreground</option>
                                <option value="muted">Muted</option>
                                <option value="accent">Accent</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Headline</label>
                            <select value={headlineColorToken || 'auto'} onChange={e => update('headlineColorToken', e.target.value)} className="w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-violet-500 outline-none">
                                <option value="auto">Auto (White)</option>
                                <option value="white">White</option>
                                <option value="foreground">Foreground</option>
                                <option value="primary">Primary</option>
                                <option value="primary-foreground">Primary FG</option>
                                <option value="muted-foreground">Muted FG</option>
                                <option value="accent-foreground">Accent FG</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Subheadline</label>
                            <select value={subheadlineColorToken || 'auto'} onChange={e => update('subheadlineColorToken', e.target.value)} className="w-full h-8 text-xs border border-gray-200 rounded px-2 bg-white focus:border-violet-500 outline-none">
                                <option value="auto">Auto (White 90%)</option>
                                <option value="white">White</option>
                                <option value="foreground">Foreground</option>
                                <option value="primary">Primary</option>
                                <option value="primary-foreground">Primary FG</option>
                                <option value="muted-foreground">Muted FG</option>
                                <option value="accent-foreground">Accent FG</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
