import React from "react";

/**
 * SHOP-LOOK-1C (docs/slices/shop-look-1.md § 3 rows 4-5, § 4.2, § 6.2; record docs/slices/shop-look-1c.md) — the
 * `categoryGrid` block: tall tiles of owner-picked categories, then optional pill links ("chips").
 *
 * Data. The renderer's server pass (`prepareBlocks` in `renderer/src/components/SitePage.tsx`) reads the picked
 * categories and gives them as `attrs._categories`: the categories that resolved (active, existing), in the picked order,
 * each `{ id, name, path, description?, imageLink? }` — `path` is the site path of the category page (the tenant's
 * category prefix + slug). Without `_categories` (no server pass: the admin preview) the block draws nothing (design
 * SL-D12; no browser fetch). With `_categories` empty (nothing picked, or nothing resolved) it draws the eyebrow, the
 * headline and the chips only; with none of those either, nothing.
 *
 * Texts. Every visible text is owner content (eyebrow, headline, `ctaText`, chip labels) or category data (name,
 * description). The image is decorative (`alt=""`): the category name is the tile's text. So the block reads no
 * `strings` key and imports nothing from `@amodx/shared` (design § 5; locale-1c D3).
 *
 * Overlay rule (tile text over a photo). The tile's text sits on a scrim of the theme's text colour at 75 % opacity
 * (`bg-foreground/75`) that covers every line of the text; the text is the theme's background colour (`text-background`).
 * A fade above the scrim (`bg-gradient-to-t from-foreground/75`, no text on it) softens the edge. Worst case for
 * contrast: a photo pixel of the text's own colour. Default theme (text #020817 on #ffffff): white tile text on 75 %
 * #020817 over white = 9.5 : 1; a dark theme (#f8fafc on #020817) over black = 10.4 : 1 (WCAG ratio, calculated). Any
 * photo gives at least that; a theme's own pair sets the bound (the scrim is that pair, mixed).
 */

/** One tile, as the server pass gives it. */
interface Tile {
    id: string;
    name: string;
    path: string;
    description?: string;
    imageLink?: string;
}

/** Design § 6.2: one column on a phone, two from `sm`, the block's `columns` from `lg`. Complete literals (Tailwind scans them). */
const GRID_CLASS: Record<"2" | "3" | "4", string> = {
    "2": "grid grid-cols-1 sm:grid-cols-2 gap-6",
    "3": "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6",
    "4": "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6",
};

/** A non-blank string, trimmed; anything else → null (blank = absent, design § 4). */
function textOf(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function CategoryGridRender({ attrs }: { attrs: any }) {
    const tiles: Tile[] | undefined = Array.isArray(attrs._categories) ? attrs._categories : undefined;
    if (!tiles) return null;

    // URL helper injected by RenderBlocks (handles the /_site/ preview prefix); identity when absent.
    const getUrl: (path: string) => string = typeof attrs._getUrl === "function" ? attrs._getUrl : (p: string) => p;
    const eyebrow = textOf(attrs.eyebrow);
    const headline = textOf(attrs.headline);
    const ctaText = textOf(attrs.ctaText);
    const chips = (Array.isArray(attrs.chips) ? attrs.chips : [])
        .map((c: any) => ({ label: textOf(c?.label), href: textOf(c?.href) }))
        .filter((c: { label: string | null; href: string | null }) => c.label !== null && c.href !== null) as { label: string; href: string }[];
    // An own key only: a stored value such as "constructor" must not reach an inherited member of the object.
    const gridClass = typeof attrs.columns === "string" && Object.hasOwn(GRID_CLASS, attrs.columns) ? GRID_CLASS[attrs.columns as "2" | "3" | "4"] : GRID_CLASS["4"];

    if (tiles.length === 0 && !eyebrow && !headline && chips.length === 0) return null;

    return (
        <section className="my-12">
            {(eyebrow || headline) && (
                <div className="text-center mb-10">
                    {eyebrow && (
                        <p className="inline-block w-fit rounded-full border px-3 py-1 mb-4 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary">{eyebrow}</p>
                    )}
                    {headline && <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">{headline}</h2>}
                </div>
            )}

            {tiles.length > 0 && (
                <div className={gridClass}>
                    {tiles.map((tile) => {
                        const imageLink = textOf(tile.imageLink);
                        const description = textOf(tile.description);
                        return (
                            <a key={tile.id} href={getUrl(tile.path)} className="group relative block aspect-[3/4] overflow-hidden rounded-lg bg-muted">
                                {imageLink && (
                                    <img
                                        src={imageLink}
                                        alt=""
                                        loading="lazy"
                                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                    />
                                )}
                                <div className="absolute inset-x-0 bottom-0 flex flex-col">
                                    <div aria-hidden="true" className="h-16 bg-gradient-to-t from-foreground/75 to-transparent" />
                                    <div className="bg-foreground/75 px-5 pb-5 text-background">
                                        <h3 className="text-xl font-semibold leading-tight">{tile.name}</h3>
                                        {description && <p className="mt-1 text-sm line-clamp-2">{description}</p>}
                                        {ctaText && <p className="mt-3 text-xs font-semibold uppercase tracking-widest">{ctaText}</p>}
                                    </div>
                                </div>
                            </a>
                        );
                    })}
                </div>
            )}

            {chips.length > 0 && (
                <ul className="mt-8 flex flex-wrap justify-center gap-3">
                    {chips.map((chip, i) => (
                        <li key={i}>
                            <a href={getUrl(chip.href)} className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">{chip.label}</a>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
