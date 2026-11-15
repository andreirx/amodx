"use client";

import { useEffect, useState } from "react";

/** CAT-VARIANT-GALLERY-1: one option of the catalog variant presenter's radio group, with its own pictures. */
type GalleryOption = { value: string; imageLink?: string; additionalImageLinks?: string[] };

const NO_OPTIONS: GalleryOption[] = [];

/**
 * CAT-VARIANT-GALLERY-1: the site's sticky header, which a pinned gallery must clear — the wrapper of the Top Bar and the
 * Navbar in app/[siteId]/layout.tsx (`sticky top-0 z-50`, plus a border class under the editorial theme). Bound to the
 * real layout by test/unit/cat-variant-gallery-1-header-clearance.test.ts (exactly one match, holding the Navbar).
 */
export const SITE_HEADER_SELECTOR = "body .sticky.top-0.z-50";

/** The pictures of the option `value`: its `imageLink` then its `additionalImageLinks`, each address once; none when the option has no `imageLink`. */
function picturesOf(options: GalleryOption[], value: string | undefined): string[] | null {
    const option = options.find((o) => o.value === value);
    return option?.imageLink ? [...new Set([option.imageLink, ...(option.additionalImageLinks ?? [])])] : null;
}

/**
 * The product page's picture gallery: the preview, the arrows and counter, the thumbnail row.
 *
 * CAT-VARIANT-GALLERY-1 (docs/slices/cat-variant-gallery-1.md) — two optional modes, used only by a CATALOG product
 * page (SitePage.tsx `catalogGalleryProps`). Without them (the commerce product page) the output is the one before
 * the slice.
 *  - `optionGroupName` + `options`, when at least one option has an `imageLink`: the variant tiles (the server-rendered
 *    radio group of that name, SitePage.tsx `CatalogVariantPresenter`) are the picker. The whole-gallery pictures
 *    (`additionalImages`) are not shown. With no option checked the preview is `mainImage` alone. Checking an option
 *    with a picture shows that option's pictures (thumbnails, arrows and counter only when it has more than one);
 *    checking an option without a picture leaves the preview as it is. The checked radio is read and followed as
 *    `InterestToggle` does (InterestShortlist.tsx): read once when the options change, then the document `change`
 *    event. New `options` (another product) re-read the checked radio, so no picture carries over between products.
 *  - `pinnedTop` (a CSS length): from the `md` breakpoint up the gallery is `position: sticky`, under the site header,
 *    while the other grid column scrolls. `self-start` keeps the grid cell from stretching, which sticky needs. Below
 *    `md` the gallery is not positioned, so its `top` has no effect. The `top`:
 *      - in the server HTML and until hydration (and without JavaScript): `pinnedTop`, which SitePage.tsx
 *        `pinnedGalleryTop` derives from the header's configuration with a ONE-LINE Top Bar;
 *      - after hydration: the header's real rendered height (`SITE_HEADER_SELECTOR`, `getBoundingClientRect`) + 1rem,
 *        followed by a `ResizeObserver` — so a Top Bar with line breaks or text that wraps at the window's width, the
 *        visitor's font size and the Navbar's scrolled height are all cleared. No header found → `pinnedTop` stays.
 */
export function ProductImageGallery({ mainImage, additionalImages, title, optionGroupName, options = NO_OPTIONS, pinnedTop }: {
    mainImage: string;
    additionalImages: string[];
    title: string;
    optionGroupName?: string;
    options?: GalleryOption[];
    pinnedTop?: string;
}) {
    const optionPicker = optionGroupName !== undefined && options.some((o) => o.imageLink);
    const [optionImages, setOptionImages] = useState<string[] | null>(null);
    const allImages = optionPicker ? (optionImages ?? [mainImage]) : [mainImage, ...additionalImages].filter(Boolean);
    const [activeIndex, setActiveIndex] = useState(0);
    const activeImage = allImages[activeIndex] || mainImage;
    const [measuredTop, setMeasuredTop] = useState<string | null>(null);

    useEffect(() => {
        if (pinnedTop === undefined || typeof ResizeObserver === "undefined") return;
        const header = document.querySelector<HTMLElement>(SITE_HEADER_SELECTOR);
        if (!header) return;
        const measure = () => setMeasuredTop(`calc(${header.getBoundingClientRect().height}px + 1rem)`);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(header);
        return () => observer.disconnect();
    }, [pinnedTop]);

    useEffect(() => {
        if (!optionPicker) return;
        const checked = document.querySelector<HTMLInputElement>(`input[name="${optionGroupName}"]:checked`);
        setOptionImages(picturesOf(options, checked?.value));
        setActiveIndex(0);
        const onChange = (e: Event) => {
            const t = e.target as HTMLInputElement | null;
            if (t?.name !== optionGroupName || !t.checked) return;
            const pictures = picturesOf(options, t.value);
            if (pictures) { setOptionImages(pictures); setActiveIndex(0); }
        };
        document.addEventListener("change", onChange);
        return () => document.removeEventListener("change", onChange);
    }, [optionPicker, optionGroupName, options]);

    if (!mainImage) return null;

    return (
        <div className={pinnedTop === undefined ? "space-y-3" : "space-y-3 md:sticky md:self-start"} style={pinnedTop === undefined ? undefined : { top: measuredTop ?? pinnedTop }}>
            {/* Main image */}
            <div className="aspect-square bg-muted rounded-lg overflow-hidden relative group">
                <img
                    src={activeImage}
                    alt={title}
                    className="w-full h-full object-cover transition-opacity duration-200"
                />
                {/* Navigation arrows for mobile */}
                {allImages.length > 1 && (
                    <>
                        <button
                            onClick={() => setActiveIndex(i => (i - 1 + allImages.length) % allImages.length)}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 border border-border shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        </button>
                        <button
                            onClick={() => setActiveIndex(i => (i + 1) % allImages.length)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 border border-border shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </>
                )}
                {/* Image counter */}
                {allImages.length > 1 && (
                    <span className="absolute bottom-2 right-2 bg-background/80 text-foreground text-xs px-2 py-0.5 rounded-full border border-border">
                        {activeIndex + 1} / {allImages.length}
                    </span>
                )}
            </div>

            {/* Thumbnails */}
            {allImages.length > 1 && (
                <div className="grid grid-cols-5 gap-2">
                    {allImages.map((img, i) => (
                        <button
                            key={i}
                            onClick={() => setActiveIndex(i)}
                            className={`aspect-square bg-muted rounded overflow-hidden border-2 transition-colors ${
                                i === activeIndex ? 'border-primary' : 'border-transparent hover:border-primary/30'
                            }`}
                        >
                            <img src={img} alt="" className="w-full h-full object-cover" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
