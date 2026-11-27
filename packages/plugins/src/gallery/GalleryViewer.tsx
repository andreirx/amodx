"use client";
import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { GalleryTexts } from "@amodx/shared";

/**
 * GALLERY-1 (docs/slices/gallery-1.md, scope item 4; rulings 3, 8, 9) — the photo viewer of the `gallery` block. It
 * takes a plain list of photos, so a later block can use it; in this slice only `GalleryRender` imports it.
 *
 * Opening. The viewer wraps the server-rendered grid (`children`). A plain left click on a tile link
 * (`a[data-gallery-index]`) opens the viewer at that position instead of following the link; a click with a modifier key
 * or another button keeps the browser's own action (a new tab, for example). Before the script runs, the click follows
 * the link, which opens the photo.
 *
 * Dialog. The native `<dialog>`, opened with `showModal()`: the browser makes the rest of the page inert and keeps focus
 * inside; focus moves to the first button (Close). The dialog's accessible name is the locale text `viewer`. Close:
 * the Close button, Escape (handled here too, so every engine closes the same way), or a click on the empty area around
 * the photo. On close, focus returns to the tile that opened the viewer. Previous / Next: the buttons, the arrow keys,
 * or a horizontal swipe; the steps wrap around at the ends; with one photo there is no step. The counter is the locale
 * template `counter` filled with the locale table's template rule (`fillLocaleTemplate`, see its comment: `{n}`, `{total}`)
 * and is announced politely on each step.
 *
 * Loading (ruling 9 as narrowed by GALLERY1-TILE-FILES = A). Closed, the viewer itself holds no image. Open, it holds the
 * photo of its position only, and after each step it fetches the next photo ahead (`new Image()`, in an effect: browser
 * only). What the TILES load is the grid's business (`GalleryRender.tsx`): a tile without `thumb` shows the large file,
 * so the viewer's rule says nothing about the large files a page loads.
 *
 * Hydration (ruling 3). The first render, on the server and in the browser, is the closed viewer: it reads no `window`
 * or `document`; the open state exists only after a click. No animation and no transition, so a visitor who asks for
 * reduced motion sees none. Colours from the theme variables only.
 */

/**
 * The locale table's template rule (`fillTemplate` of `@amodx/shared`): each `{name}` of `template` becomes
 * `String(values[name])`; a placeholder without a value stays as written. A COPY, kept by the stop condition of ruling
 * GALLERY1-TEMPLATE-IMPORT = C (build record): a runtime import of `fillTemplate` from a lazily loaded render chunk moved
 * the stylesheet link and a script of EVERY page into the root segment of the RSC payload — measured with the
 * `@amodx/shared` barrel (iteration 0) AND with the import-free module `@amodx/shared/dist/template.js` (iteration 1):
 * the same 11 serving rows of pages without the block each time. `test/galleryBlock.test.ts` checks that this copy and
 * `fillTemplate` give the same text; `test/renderLoaders.test.ts` keeps every render module off every runtime import of
 * `@amodx/shared`.
 */
export function fillLocaleTemplate(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole);
}

/** One photo of the viewer. */
export type ViewerPhoto = { src: string; alt: string; caption?: string; width?: number; height?: number };

/** The position after a step of `delta` from `index` among `count` photos (wraps around at the ends). */
export function steppedIndex(index: number, delta: -1 | 1, count: number): number {
    return (index + delta + count) % count;
}

/** The shortest horizontal travel, in CSS pixels, that counts as a swipe. */
export const SWIPE_MIN_PX = 40;

/** The step a touch that moved by (`dx`, `dy`) asks for: a mostly horizontal travel of at least `SWIPE_MIN_PX` — to the
 *  left = next (+1), to the right = previous (-1); anything else = none (0). */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
    return dx < 0 ? 1 : -1;
}

/** At least 44 × 44 px, so each button is reachable by a finger on a 390 px phone. */
const BUTTON = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground hover:bg-muted";

export function GalleryViewer({ photos, texts, children }: { photos: ViewerPhoto[]; texts: GalleryTexts; children: React.ReactNode }) {
    const [index, setIndex] = useState<number | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const touchRef = useRef<{ x: number; y: number } | null>(null);
    const count = photos.length;
    const photo = index !== null && index < count ? photos[index] : null;
    const aheadSrc = index !== null && count > 1 ? photos[steppedIndex(index, 1, count)].src : null;

    useEffect(() => {
        if (aheadSrc === null) return;
        const ahead = new Image();
        ahead.src = aheadSrc;
    }, [aheadSrc]);

    function onGridClick(e: React.MouseEvent<HTMLDivElement>) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const tile = (e.target as Element).closest?.("a[data-gallery-index]");
        const dialog = dialogRef.current;
        if (!(tile instanceof HTMLElement) || !dialog) return;
        const at = Number(tile.getAttribute("data-gallery-index"));
        if (!Number.isInteger(at) || at < 0 || at >= count) return;
        e.preventDefault();
        openerRef.current = tile;
        setIndex(at);
        if (!dialog.open) dialog.showModal();
    }

    const close = () => dialogRef.current?.close();   // fires `close` → onClosed
    function onClosed() {
        setIndex(null);
        openerRef.current?.focus();
        openerRef.current = null;
    }
    const step = (delta: -1 | 1) => setIndex((i) => (i === null || count < 2 ? i : steppedIndex(i, delta, count)));

    function onKeyDown(e: React.KeyboardEvent<HTMLDialogElement>) {
        if (e.key === "Escape") { e.preventDefault(); close(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    }
    function onTouchStart(e: React.TouchEvent<HTMLDialogElement>) {
        const t = e.touches[0];
        touchRef.current = t ? { x: t.clientX, y: t.clientY } : null;
    }
    function onTouchEnd(e: React.TouchEvent<HTMLDialogElement>) {
        const start = touchRef.current;
        const t = e.changedTouches[0];
        touchRef.current = null;
        if (!start || !t) return;
        const delta = swipeStep(t.clientX - start.x, t.clientY - start.y);
        if (delta !== 0) step(delta);
    }

    return (
        <div className="my-8" onClick={onGridClick}>
            {children}
            <dialog
                ref={dialogRef}
                aria-label={texts.viewer}
                onClose={onClosed}
                onKeyDown={onKeyDown}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
                className="m-0 h-full max-h-none w-full max-w-none border-0 bg-background p-0 text-foreground backdrop:bg-foreground/80"
            >
                <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between gap-2 p-2">
                        <p aria-live="polite" className="px-2 text-sm text-muted-foreground">
                            {index !== null ? fillLocaleTemplate(texts.counter, { n: index + 1, total: count }) : ""}
                        </p>
                        <button type="button" onClick={close} aria-label={texts.close} title={texts.close} className={BUTTON}>
                            <X aria-hidden="true" className="h-5 w-5" />
                        </button>
                    </div>
                    <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
                        {photo && (
                            <img key={index} src={photo.src} alt={photo.alt} width={photo.width} height={photo.height} className="max-h-full max-w-full object-contain" />
                        )}
                        {count > 1 && (
                            <>
                                <button type="button" onClick={() => step(-1)} aria-label={texts.previous} title={texts.previous} className={`${BUTTON} absolute left-2 top-1/2 -translate-y-1/2`}>
                                    <ChevronLeft aria-hidden="true" className="h-6 w-6" />
                                </button>
                                <button type="button" onClick={() => step(1)} aria-label={texts.next} title={texts.next} className={`${BUTTON} absolute right-2 top-1/2 -translate-y-1/2`}>
                                    <ChevronRight aria-hidden="true" className="h-6 w-6" />
                                </button>
                            </>
                        )}
                    </div>
                    <p className="min-h-6 px-4 pb-4 pt-2 text-center text-sm">{photo?.caption ?? ""}</p>
                </div>
            </dialog>
        </div>
    );
}
