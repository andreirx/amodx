import { RenderBlocks } from "@/components/RenderBlocks";
import { URL_PREFIX_DEFAULTS, resolveLocaleStrings, fillTemplate, selectPluralText, blockStrings, type LocaleStrings } from "@amodx/shared";
import Link from "next/link";
import { SearchBar } from "@/components/SearchBar";
import { HREF_BUDGET, type FacetListing, type FacetValueView } from "@amodx/shared";
import type { ReactNode } from "react";
import { searchBarLabels } from "@/components/site-page/locale-strings";
import { isEditorial, cardThemeProps, ProductCard, Pagination } from "@/components/site-page/commerce-parts";

// --- CAT-FACETS-1: the filter panel of a catalog site's shop and category pages (spec §§ 4, 5.1, 6) ---
//
// Server-rendered, no JavaScript. Every value is a plain `<a>` to the URL with that value added or removed: no form,
// no client state, no prefetch (a plain anchor is never prefetched — load reduction, § 5.3), `rel="nofollow"` (§ 5.4).
// The model — which facets, which values, every href already measured against the URL budget — comes from
// `@amodx/shared` (`facets.ts`); these components only lay it out. LOCALE-1B: the copy is the tenant's catalog texts
// (`strings`, docs/slices/locale-1.md § 6.3); the facet ids in every href never change.

/** The catalog listing's filter state, passed to the shop and category views only on a catalog site. */
type CatalogFacets = { listing: FacetListing<any>; pagerBase: string };

function FacetValueRow({ v, strings }: { v: FacetValueView; strings: LocaleStrings["catalog"] }) {
    switch (v.state) {
        case "link":
            return <a href={v.href} rel="nofollow" className="hover:text-primary" data-facet-value="link">{v.value} ({v.count})</a>;
        case "selected": {
            const text = <><span aria-hidden="true">✓ </span>{v.value} ({v.count})</>;
            return v.href
                ? <a href={v.href} rel="nofollow" aria-current="true" className="font-semibold text-primary" data-facet-value="selected">{text}</a>
                : <span className="font-semibold" data-facet-value="selected">{text}</span>;
        }
        case "zero":
            return <span aria-disabled="true" className="text-muted-foreground opacity-60" data-facet-value="zero">{v.value} (0)</span>;
        case "too-long":
            return <span aria-disabled="true" title={strings.facetsTooMany} className="text-muted-foreground opacity-60" data-facet-value="too-long">{v.value} ({v.count})</span>;
        default: {
            const unreachable: never = v;
            return unreachable;
        }
    }
}

function FacetPanel({ listing, strings }: { listing: FacetListing<any>; strings: LocaleStrings["catalog"] }) {
    const n = listing.items.length;
    return (
        <div className="space-y-4 text-sm">
            <p className="text-muted-foreground" data-facet-total={n}>{fillTemplate(selectPluralText(strings.facetsCount, n), { n })}</p>
            {listing.tooLong && <p role="status" className="text-muted-foreground" data-facet-notice>{strings.facetsUrlTooLong}</p>}
            {listing.chips.length > 0 && (
                <ul className="flex flex-wrap gap-2" data-facet-chips>
                    {listing.chips.map((c) => (
                        <li key={`${c.facetLabel}\u0000${c.value}`}>
                            {c.href
                                ? <a href={c.href} rel="nofollow" aria-label={fillTemplate(strings.facetsRemove, { facet: c.facetLabel, value: c.value })} className="inline-block rounded-full border px-3 py-1 hover:bg-muted">{c.facetLabel}: {c.value} <span aria-hidden="true">×</span></a>
                                : <span className="inline-block rounded-full border px-3 py-1">{c.facetLabel}: {c.value}</span>}
                        </li>
                    ))}
                </ul>
            )}
            {(listing.chips.length > 0 || listing.tooLong) && listing.clearHref && (
                <a href={listing.clearHref} rel="nofollow" className="inline-block underline hover:text-primary" data-facet-clear>{strings.facetsClear}</a>
            )}
            {listing.budgetHint && <p className="text-muted-foreground" data-facet-hint>{strings.facetsTooMany}</p>}
            {listing.facets.map((f) => (
                <details key={f.id} open={f.values.some((v) => v.state === "selected") || f.values.length <= 10} className="border-t pt-3" data-facet={f.id}>
                    <summary className="cursor-pointer font-medium">{f.label}</summary>
                    <ul className="mt-2 space-y-1">
                        {f.values.map((v) => <li key={v.value}><FacetValueRow v={v} strings={strings} /></li>)}
                    </ul>
                </details>
            ))}
        </div>
    );
}

/**
 * The listing area of a catalog page: the panel (a left column on `lg` and up; one collapsed block above the grid
 * on smaller screens — a CSS-only toggle, the `peer` idiom of `CatalogVariantPresenter`) and the grid. When the
 * panel has nothing to show (no facet narrows, no selection, no notice) the grid renders alone, as before.
 * A selection that matches nothing replaces the grid with the § 4.3 empty result.
 */
function FacetedListing({ listing, grid, strings }: { listing: FacetListing<any>; grid: ReactNode; strings: LocaleStrings["catalog"] }) {
    if (listing.facets.length === 0 && listing.chips.length === 0 && !listing.tooLong) return grid;
    const active = listing.chips.length;
    const body = listing.items.length === 0 && listing.selection.size > 0 ? (
        <div className="py-12 text-center space-y-3" data-facet-empty>
            <p className="text-muted-foreground">{strings.facetsNoMatch}</p>
            {listing.clearHref && <a href={listing.clearHref} rel="nofollow" className="underline hover:text-primary">{strings.facetsClear}</a>}
        </div>
    ) : grid;
    return (
        <div className="lg:flex lg:gap-8 lg:items-start">
            <aside className="mb-6 lg:mb-0 lg:w-64 lg:shrink-0" aria-label={strings.facetsTitle} data-facet-panel>
                <input type="checkbox" id="facet-panel-toggle" className="peer sr-only lg:hidden" />
                <label htmlFor="facet-panel-toggle" className="lg:hidden flex items-center justify-between rounded-lg border px-4 py-3 font-medium cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                    {strings.facetsTitle}{active > 0 ? ` (${active})` : ""}
                </label>
                <h2 className="hidden lg:block font-semibold mb-3">{strings.facetsTitle}</h2>
                <div className="hidden peer-checked:block lg:block mt-4 lg:mt-0">
                    <FacetPanel listing={listing} strings={strings} />
                </div>
            </aside>
            <div className="flex-1 min-w-0">{body}</div>
        </div>
    );
}

export function CategoryPageView({ category, products, total, page, config, prefixes, basePath = "", catalog = false, facets, cardCategories }: { category: any; products: any[]; total: number; page: number; config: any; prefixes: any; basePath?: string; catalog?: boolean; facets?: CatalogFacets; cardCategories?: any[] }) {
    // LOCALE-1A: breadcrumb Home, pagination; LOCALE-1B: the shared product texts and the catalog texts.
    const resolved = resolveLocaleStrings(config);
    const { site, commerce: strings, catalog: catalogStrings } = resolved.strings;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const grid = products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">{strings.categoryEmpty}</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || URL_PREFIX_DEFAULTS.product} basePath={basePath} catalog={catalog} tenantId={config.id} catalogStrings={catalogStrings} {...cardThemeProps(config, cardCategories, product)} />
                    ))}
                </div>
            );
    const titleBlock = (
            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight">{category.name}</h1>
                {category.description && (
                    <p className="text-muted-foreground mt-2">{category.description}</p>
                )}
                <p className="text-sm text-muted-foreground mt-1">{fillTemplate(selectPluralText(strings.productCount, total), { n: total })}</p>
            </div>
    );
    // CATEGORY-CONTENT-1: the category's own blocks, after the title block and before the filters and the list, on every
    // page and filter state; prepared by `prepareBlocks` in SitePage. Width: no `contentMaxWidth` is given, so
    // `RenderBlocks` adds no per-block wrapper and each block takes the width of this page's container (`<main>`, the
    // site width), aligned with the title and the grid. No blocks (absent, `[]`, not an array) → `undefined`, and the
    // title block stays the element it was: no extra child (a `false` child would still change the RSC payload).
    const pageContent = Array.isArray(category.blocks) && category.blocks.length > 0 ? (
        <div className="mb-8" data-category-content>
            <RenderBlocks blocks={category.blocks} tenantId={config.id} basePath={basePath}
                strings={blockStrings(resolved, { catalogMode: catalog })} />
        </div>
    ) : undefined;
    return (
        <>
            {config.searchBar?.enabled && (
                <SearchBar
                    placeholder={config.searchBar?.placeholder || strings.searchPlaceholder}
                    searchPrefix={prefixes.search || "/search"}
                    productPrefix={prefixes.product || "/product"}
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    contentMaxWidth={config.header?.contentMaxWidth || "max-w-6xl"}
                    labels={searchBarLabels(resolved)}
                    {...(catalog ? { showPrices: false } : {})}
                />
            )}
            <main className={`${config.header?.contentMaxWidth || "max-w-6xl"} mx-auto ${isEditorial(config) ? "py-[var(--section-gap)]" : "py-12"} px-6`}>
                {/* Breadcrumbs */}
                <nav className="text-sm text-muted-foreground mb-8">
                <Link href={`${basePath}/`} className="hover:text-primary">{site.breadcrumbHome}</Link>
                <span className="mx-2">/</span>
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="hover:text-primary">{strings.shopTitle}</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{category.name}</span>
            </nav>

            {pageContent ? <>{titleBlock}{pageContent}</> : titleBlock}

            {facets ? <FacetedListing listing={facets.listing} grid={grid} strings={catalogStrings} /> : grid}

                <Pagination page={page} total={total} limit={24} baseUrl={facets ? facets.pagerBase : `${prefixes.category}/${category.slug}`} basePath={basePath} maxHrefBytes={facets ? HREF_BUDGET : undefined} strings={site} />
            </main>
        </>
    );
}

export function ShopPageView({ products, categories, total, page, config, prefixes, basePath = "", availability, catalog = false, facets }: { products: any[]; categories: any[]; total: number; page: number; config: any; prefixes: any; basePath?: string; availability?: string; catalog?: boolean; facets?: CatalogFacets }) {
    // LOCALE-1A: breadcrumb Home, pagination; LOCALE-1B: the shared product texts and the catalog texts.
    const resolved = resolveLocaleStrings(config);
    const { site, commerce: strings, catalog: catalogStrings } = resolved.strings;
    const shopUrl = prefixes.shop || URL_PREFIX_DEFAULTS.shop;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const grid = products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">
                    {availability === 'in_stock' ? strings.shopEmptyInStock : strings.shopEmpty}
                </p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || URL_PREFIX_DEFAULTS.product} basePath={basePath} catalog={catalog} tenantId={config.id} catalogStrings={catalogStrings} {...cardThemeProps(config, categories, product)} />
                    ))}
                </div>
            );
    return (
        <>
            {config.searchBar?.enabled && (
                <SearchBar
                    placeholder={config.searchBar?.placeholder || strings.searchPlaceholder}
                    searchPrefix={prefixes.search || "/search"}
                    productPrefix={prefixes.product || "/product"}
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    contentMaxWidth={config.header?.contentMaxWidth || "max-w-6xl"}
                    labels={searchBarLabels(resolved)}
                    {...(catalog ? { showPrices: false } : {})}
                />
            )}
            <main className={`${config.header?.contentMaxWidth || "max-w-6xl"} mx-auto ${isEditorial(config) ? "py-[var(--section-gap)]" : "py-12"} px-6`}>
                <h1 className="text-3xl font-bold tracking-tight mb-4">{strings.shopTitle}</h1>

            {/* Availability Filter (none on a catalog site) */}
            {!catalog && <div className="flex flex-wrap gap-2 mb-4">
                <Link
                    href={`${basePath}${shopUrl}`}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${!availability ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                >
                    {strings.shopAllProducts}
                </Link>
                <Link
                    href={`${basePath}${shopUrl}?availability=in_stock`}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${availability === 'in_stock' ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                >
                    {strings.inStock}
                </Link>
            </div>}

            {/* Category Navigation */}
            {categories.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-8">
                    {categories.map((cat: any) => (
                        <Link key={cat.id} href={`${basePath}${prefixes.category}/${cat.slug}`} className="px-4 py-2 rounded-full border text-sm font-medium hover:bg-muted transition-colors">
                            {cat.name} {cat.productCount > 0 && <span className="text-muted-foreground ml-1">({cat.productCount})</span>}
                        </Link>
                    ))}
                </div>
            )}

            {facets ? <FacetedListing listing={facets.listing} grid={grid} strings={catalogStrings} /> : grid}

            <Pagination page={page} total={total} limit={24} baseUrl={facets ? facets.pagerBase : availability ? `${shopUrl}?availability=${availability}` : shopUrl} basePath={basePath} maxHrefBytes={facets ? HREF_BUDGET : undefined} strings={site} />
            </main>
        </>
    );
}

export function SearchPageView({ query, products, total, page, config, prefixes, basePath = "", catalog = false, cardCategories }: { query: string; products: any[]; total: number; page: number; config: any; prefixes: any; basePath?: string; catalog?: boolean; cardCategories?: any[] }) {
    // LOCALE-1A: breadcrumb Home, pagination; LOCALE-1B: the commerce texts of the search page (§ 5.2) and the catalog
    // texts.
    const resolved = resolveLocaleStrings(config);
    const { site, commerce: strings, catalog: catalogStrings } = resolved.strings;
    const siteWidth = config.header?.contentMaxWidth || "max-w-6xl";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    return (
        <>
            {config.searchBar?.enabled && (
                <SearchBar
                    placeholder={config.searchBar?.placeholder || strings.searchPlaceholder}
                    searchPrefix={prefixes.search || "/search"}
                    productPrefix={prefixes.product || "/product"}
                    tenantId={config.id}
                    apiUrl={apiUrl}
                    contentMaxWidth={siteWidth}
                    labels={searchBarLabels(resolved)}
                    {...(catalog ? { showPrices: false } : {})}
                />
            )}
            <main className={`${siteWidth} mx-auto ${isEditorial(config) ? "py-[var(--section-gap)]" : "py-12"} px-6`}>
                <nav className="text-sm text-muted-foreground mb-8">
                <Link href={`${basePath}/`} className="hover:text-primary">{site.breadcrumbHome}</Link>
                <span className="mx-2">/</span>
                <Link href={`${basePath}${prefixes.shop || "/shop"}`} className="hover:text-primary">{strings.shopTitle}</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{strings.searchBreadcrumb}</span>
            </nav>

            <h1 className="text-3xl font-bold tracking-tight mb-2">
                {query ? `${strings.resultsFor} "${query}"` : strings.searchProducts}
            </h1>
            {query && <p className="text-sm text-muted-foreground mb-8">{fillTemplate(selectPluralText(strings.searchResultCount, total), { n: total })}</p>}

            {!query ? (
                <p className="text-muted-foreground py-12 text-center">{strings.searchEnterTerm}</p>
            ) : products.length === 0 ? (
                <p className="text-muted-foreground py-12 text-center">{strings.searchNoResults} &ldquo;{query}&rdquo;.</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {products.map((product: any) => (
                        <ProductCard key={product.id} product={product} productPrefix={prefixes.product || "/product"} basePath={basePath} catalog={catalog} tenantId={config.id} catalogStrings={catalogStrings} {...cardThemeProps(config, cardCategories, product)} />
                    ))}
                </div>
            )}

                <Pagination page={page} total={total} limit={24} baseUrl={`${prefixes.search || "/search"}?q=${encodeURIComponent(query)}`} basePath={basePath} strings={site} />
            </main>
        </>
    );
}
