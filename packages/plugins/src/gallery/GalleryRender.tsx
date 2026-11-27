import React from "react";
import type { GalleryTexts } from "@amodx/shared";
import { GalleryViewer, fillLocaleTemplate, type ViewerPhoto } from "./GalleryViewer";

/**
 * GALLERY-1 (docs/slices/gallery-1.md, scope items 2-4; rulings 2, 3, 6-9) — the `gallery` block on the public site.
 *
 * Grid (server-rendered). A list of tiles; each tile is a plain link to its large photo (`<a href={src}>`) holding the
 * tile photo (`thumb`, else `src`) with `loading="lazy"`. Without script every tile opens its photo, so the page works
 * and a search engine indexes the photos and their descriptions. With script, `GalleryViewer` (a client component
 * around the grid) opens a tile's photo in the viewer instead.
 *
 * Tile loading (ruling 9 as narrowed by GALLERY1-TILE-FILES = A). A tile with `thumb` loads the small file. A tile
 * without `thumb` loads the LARGE file (`src`), deferred only by the browser's native lazy loading: Chromium loads every
 * lazy image within its distance of the screen (measured on fixture GL1: 30 of 30 tiles by default, 28 of 30 under 4G
 * emulation), so for such tiles NO page-load guarantee is claimed. The editor writes no `thumb`; small files made at
 * upload are the follow-up slice `gallery-thumbs-1`.
 *
 * Texts. The viewer's and the tiles' visitor texts come from the renderer's server pass (`prepareBlocks` in
 * `renderer/src/components/SitePage.tsx`): `attrs._gallery` = `galleryTexts` of the tenant's locale table in the page's
 * language. No `_gallery` (no server pass: the admin preview) → the block draws nothing, so no English text reaches a
 * page in another language. A tile's accessible name is the photo's description (`alt`); a photo without one gets the
 * locale text `photo` with its position (`fillLocaleTemplate`, the locale table's template rule; see its comment).
 *
 * Stored data. The backend does not check block attributes, so every stored item is checked here (`photosOf`): an item
 * whose `src` is not a string, is blank, or does not pass the address rule (`galleryAddress`) is dropped and the others
 * render; no item left → nothing. A `thumb` that does not pass the rule is ignored (the tile uses `src`).
 *
 * Tile shape. Every tile is a 4:3 box with the photo cropped to fill it (`object-cover`), so a tile reserves its space
 * before its photo loads, with or without sizes (no layout shift). `width`/`height`, when both are positive integers, go
 * on the `<img>` as attributes (and on the viewer's photo, which then has its ratio before it loads).
 */

const TEXT_KEYS = ["viewer", "close", "previous", "next", "counter", "photo"] as const;

/** The server pass's `_gallery`, or null when it is absent or not of that shape (each text a non-blank string). */
function preparedTexts(value: unknown): GalleryTexts | null {
    if (typeof value !== "object" || value === null) return null;
    const t = value as Record<string, unknown>;
    return TEXT_KEYS.every((k) => typeof t[k] === "string" && (t[k] as string).trim() !== "") ? (t as unknown as GalleryTexts) : null;
}

/** A character a browser removes from an address (tab, newline: C0 controls, DEL) or reads as `/` (backslash). Either
 *  can turn `/…` into `//host…`, an address on another host, after this check has passed it. */
const UNSAFE_ADDRESS_CHAR = /[\u0000-\u001F\u007F\\]/;
const HTTPS_ADDRESS = /^https:\/\/[^/?#]/i;
const ROOT_RELATIVE_PATH = /^\/(?!\/)/;

/**
 * The gallery's address rule (Evidence taxonomy rows 4-5): the trimmed address when it is `https://<host>…` or a
 * root-relative path (`/…`, not `//…`); null for anything else — not a string, blank, another scheme (`http:`,
 * `javascript:`, `data:`), a scheme-relative `//host` or a relative path, or an address that holds a control character or
 * a backslash. Not `isDirectMediaUrl` (`common/videoSource.ts`): that rule accepts `http:`, `//host` and relative paths
 * and needs a video file extension.
 */
export function galleryAddress(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const address = value.trim();
    if (address === "" || UNSAFE_ADDRESS_CHAR.test(address)) return null;
    return HTTPS_ADDRESS.test(address) || ROOT_RELATIVE_PATH.test(address) ? address : null;
}

/** `value` when it is a positive integer, else null. */
const pixels = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);

/** A non-blank string, trimmed; anything else → null. */
const textOf = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** One photo as the grid and the viewer draw it; `tile` = the tile's photo address. */
type Photo = ViewerPhoto & { tile: string };

/** The stored items that can be drawn, in stored order (see "Stored data" above). */
function photosOf(items: unknown): Photo[] {
    if (!Array.isArray(items)) return [];
    const photos: Photo[] = [];
    for (const item of items) {
        if (typeof item !== "object" || item === null) continue;
        const src = galleryAddress(item.src);
        if (src === null) continue;
        const width = pixels(item.width);
        const height = pixels(item.height);
        const caption = textOf(item.caption);
        photos.push({
            src,
            tile: galleryAddress(item.thumb) ?? src,
            alt: textOf(item.alt) ?? "",
            ...(caption !== null ? { caption } : {}),
            ...(width !== null && height !== null ? { width, height } : {}),
        });
    }
    return photos;
}

/** Two tile columns on a phone, more from `sm` / `lg` up to the block's `columns`. Complete literals (Tailwind scans them). */
const GRID_CLASS: Record<"2" | "3" | "4", string> = {
    "2": "grid grid-cols-2 gap-2 sm:gap-4",
    "3": "grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4",
    "4": "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4",
};

export function GalleryRender({ attrs }: { attrs: any }) {
    const texts = preparedTexts(attrs._gallery);
    if (!texts) return null;
    const photos = photosOf(attrs.items);
    if (photos.length === 0) return null;
    // An own key only: a stored value such as "constructor" must not reach an inherited member of the object.
    const gridClass = typeof attrs.columns === "string" && Object.hasOwn(GRID_CLASS, attrs.columns) ? GRID_CLASS[attrs.columns as "2" | "3" | "4"] : GRID_CLASS["3"];

    return (
        <GalleryViewer photos={photos} texts={texts}>
            <ul className={gridClass}>
                {photos.map((photo, i) => (
                    <li key={i}>
                        <a
                            href={photo.src}
                            data-gallery-index={i}
                            aria-label={photo.alt === "" ? fillLocaleTemplate(texts.photo, { n: i + 1 }) : undefined}
                            className="block aspect-[4/3] overflow-hidden rounded-md bg-muted"
                        >
                            <img
                                src={photo.tile}
                                alt={photo.alt}
                                loading="lazy"
                                decoding="async"
                                width={photo.width}
                                height={photo.height}
                                className="h-full w-full object-cover"
                            />
                        </a>
                    </li>
                ))}
            </ul>
        </GalleryViewer>
    );
}
