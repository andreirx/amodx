import { reviewAssetCdnBase, toPublicReviewPhotos } from "@/lib/review-images";
import { URL_PREFIX_DEFAULTS, localeUsesDecimalComma, resolveLocaleStrings, fillTemplate, selectPluralText } from "@amodx/shared";
import Link from "next/link";
import Script from "next/script";
import { AddToCartButton } from "@/components/AddToCartButton";
import { ProductImageGallery } from "@/components/ProductImageGallery";
import { SearchBar } from "@/components/SearchBar";
import { sanitizeHtml } from "@/lib/sanitize";
import { InterestToggle } from "@/components/InterestShortlist";
import { QuoteRequest } from "@/components/QuoteRequest";
import { addToCartStrings, searchBarLabels, interestToggleStrings, quoteRequestStrings } from "@/components/site-page/locale-strings";
import { isEditorial } from "@/components/site-page/commerce-parts";

/**
 * CATALOG-MODE-1 (CM-D4 amended) — the catalog variant presenter: each variant group as a read-only set of options
 * (label + image), with no price and no availability. Rendered only on a catalog site, where it is the only
 * reader of `variants` (`AddToCartButton` is commerce-only). An imported product has exactly one group.
 *
 * Server-rendered, no JavaScript: each option is a native radio input, so the visitor's choice lives in the
 * form state. That is how the selected option is exposed to the interest control (`cat-interest-1`): the checked
 * input of the group named `catalog-option-<group id>`, whose value is the option label.
 */
function CatalogVariantPresenter({ variants }: { variants: { id: string; name: string; options?: { value: string; imageLink?: string }[] }[] }) {
    const groups = variants.filter((group) => (group.options || []).length > 0);
    if (groups.length === 0) return null;
    return (
        <div className="space-y-6">
            {groups.map((group, gi) => (
                <fieldset key={group.id || gi} className="space-y-3" data-catalog-variants={group.id}>
                    <legend className="text-sm font-medium mb-2">{group.name}</legend>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {(group.options || []).map((option, oi) => (
                            <label key={oi} className="cursor-pointer">
                                <input type="radio" name={`catalog-option-${group.id || gi}`} value={option.value} className="peer sr-only" />
                                <span className="block rounded-lg border-2 border-border overflow-hidden peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                                    {option.imageLink ? (
                                        <img src={option.imageLink} alt={option.value} loading="lazy" className="aspect-square w-full object-cover" />
                                    ) : (
                                        <span className="aspect-square w-full flex items-center justify-center bg-muted text-muted-foreground text-xs">—</span>
                                    )}
                                    <span className="block px-2 py-1 text-xs text-center">{option.value}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
            ))}
        </div>
    );
}

/**
 * The presenter's FIRST group with options (an imported product has exactly one group) and the name of its radio
 * group, as `CatalogVariantPresenter` names it. Readers of the choice: the interest toggle (`interestToggleProps`)
 * and the gallery's option picker (`catalogGalleryProps`, CAT-VARIANT-GALLERY-1).
 */
function firstOptionGroup(product: any): { name: string; options: any[] } | undefined {
    const group = (product.variants || []).find((g: any) => (g.options || []).length > 0);
    return group ? { name: `catalog-option-${group.id || 0}`, options: group.options } : undefined;
}

/**
 * CAT-INTEREST-1: the product-page toggle's props. The option comes from `firstOptionGroup`.
 */
function interestToggleProps(tenantId: string, product: any) {
    const group = firstOptionGroup(product);
    return {
        tenantId, productId: product.id, title: product.title, slug: product.slug || "",
        ...(product.imageLink ? { imageLink: product.imageLink } : {}),
        ...(group ? {
            optionGroupName: group.name,
            options: group.options.map((o: any) => (o.imageLink ? { value: o.value, imageLink: o.imageLink } : { value: o.value })),
        } : {}),
    };
}

/**
 * CAT-VARIANT-GALLERY-1 (ruling CVG1-HEADER-CLEARANCE): the SERVER value of the pinned gallery's CSS `top` — the tallest
 * height the site's sticky header (app/[siteId]/layout.tsx) can have on this tenant WITH A ONE-LINE TOP BAR, plus a 1rem
 * gap. It is the `top` in the HTML, before hydration and without JavaScript. After hydration ProductImageGallery
 * replaces it with the header's measured height + 1rem (review-1: a Top Bar with line breaks, or text that wraps at the
 * window's width, is taller than any configuration value can know). Derived from the same configuration that sizes
 * the header. Its parts at `md` and up:
 *  - the editorial top border (`theme.shape` "editorial"): 3px;
 *  - the Top Bar (`topBar.show`): 2rem — `text-xs` (line height 1rem) + `py-2` (2 × 0.5rem), one line of text;
 *  - the Navbar: its 1px bottom border + the TALLER of `header.navHeight` and `header.navHeightScrolled` (`h-<n>` =
 *    n × 0.25rem; the bar switches to the scrolled height after 20px of scroll, so the taller one clears both states).
 *    Absent → the Navbar's own defaults `h-16` / `h-12`. A value that is not `h-<n>` counts as `h-36` (9rem), the
 *    tallest admin choice.
 * The Commerce Bar is never in a catalog header (catalogMode excludes commerceEnabled, CM-D11). The rem part stays in
 * rem so that the offset grows with the visitor's root font size as the header does; the borders stay px.
 */
function pinnedGalleryTop(config: any): string {
    const navRem = (value: unknown, absent: string) => {
        const m = /^h-(\d+)$/.exec(value === undefined ? absent : String(value));
        return m ? Number(m[1]) / 4 : 9;
    };
    const rem = (config.topBar?.show ? 2 : 0)
        + Math.max(navRem(config.header?.navHeight, "h-16"), navRem(config.header?.navHeightScrolled, "h-12"))
        + 1;
    const px = 1 + (isEditorial(config) ? 3 : 0);
    return `calc(${rem}rem + ${px}px)`;
}

/**
 * CAT-VARIANT-GALLERY-1 (docs/slices/cat-variant-gallery-1.md § 1): the gallery props of a CATALOG product page —
 * pinned from `md` up below the site header (`pinnedGalleryTop`), and, when the product has an option group, that
 * group's radio name and each option's pictures (the gallery uses them as its picker only when an option has an
 * `imageLink`). Only the keys an option holds are passed. Never called for a commerce product page, whose gallery
 * props stay the three of before.
 */
function catalogGalleryProps(product: any, config: any) {
    const group = firstOptionGroup(product);
    return {
        pinnedTop: pinnedGalleryTop(config),
        ...(group ? {
            optionGroupName: group.name,
            options: group.options.map((o: any) => ({
                value: o.value,
                ...(o.imageLink ? { imageLink: o.imageLink } : {}),
                ...(o.additionalImageLinks?.length ? { additionalImageLinks: o.additionalImageLinks } : {}),
            })),
        } : {}),
    };
}

/**
 * CATALOG-MODE-1 (F-1): the product's `attributes` (e.g. unit, packaging, minimum order) as a key/value list.
 * CAT-IMPORT-PROFILE-1B (design § 2.5): a key may be stored more than once (a value per option, or a split list);
 * such a key is ONE row, at the place of its first entry, with its values in stored order joined by ", ". A product
 * whose keys are all distinct renders exactly the rows it rendered before.
 */
function ProductAttributes({ attributes, editorial = false }: { attributes: { key: string; value: string }[]; editorial?: boolean }) {
    const rows = new Map<string, string[]>();
    for (const a of attributes) {
        if (!a.key || !a.value) continue;
        const values = rows.get(a.key);
        if (values) values.push(a.value);
        else rows.set(a.key, [a.value]);
    }
    if (rows.size === 0) return null;
    // CAT-THEME-1 (`editorial` shape, § 3 item 6): the key column takes half the width and every row sits between 1 px
    // hairlines (`border` = the theme's borderColor). Otherwise the classes are the ones before the slice.
    const [dl, dt, dd] = editorial
        ? ["grid grid-cols-2 gap-x-6 text-sm border-t", "text-muted-foreground py-2 border-b", "font-medium py-2 border-b"]
        : ["grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm border-t pt-4", "text-muted-foreground", "font-medium"];
    return (
        <dl className={dl}>
            {[...rows].map(([key, values], i) => (
                <div key={i} className="contents">
                    <dt className={dt}>{key}</dt>
                    <dd className={dd}>{values.join(", ")}</dd>
                </div>
            ))}
        </dl>
    );
}

export function ProductPageView({ product, config, prefixes, reviews, commerceEnabled = false, catalog = false, basePath = "", categories = [], categoryPaths = [], rawCategoryIds = [] }: { product: any; config: any; prefixes: any; reviews?: { items: any[]; averageRating: number; totalReviews: number }; commerceEnabled?: boolean; catalog?: boolean; basePath?: string; categories?: any[]; categoryPaths?: { category: any; parents: any[] }[]; rawCategoryIds?: string[] }) {
    // LOCALE-1A: site chrome; LOCALE-1B: the commerce texts of the product page and the catalog texts; LOCALE-1D: the add-to-cart texts.
    const resolved = resolveLocaleStrings(config);
    const { site, commerce: strings, catalog: catalogStrings } = resolved.strings;
    const siteWidth = config.header?.contentMaxWidth || "max-w-6xl";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const jsonLd: any = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": product.title,
        "description": product.description,
        "image": product.imageLink,
        // CATALOG-MODE-1: a catalog product is a `Product` with no `offers` key (no price, no availability).
        ...(catalog ? {} : {
            "offers": {
                "@type": "Offer",
                "price": product.salePrice || product.price,
                "priceCurrency": product.currency || "USD",
                "availability": product.availability === 'in_stock' ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
            }
        })
    };
    if (reviews && reviews.totalReviews > 0) {
        jsonLd.aggregateRating = {
            "@type": "AggregateRating",
            "ratingValue": reviews.averageRating,
            "reviewCount": reviews.totalReviews,
        };
    }

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
            <main className={`${siteWidth} mx-auto py-12 px-6`}>
                <Script id="product-schema" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

            {/* Breadcrumbs */}
            <nav className="text-sm text-muted-foreground mb-8">
                <Link href={`${basePath}/`} className="hover:text-primary">{site.breadcrumbHome}</Link>
                <span className="mx-2">/</span>
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="hover:text-primary">{strings.shopTitle}</Link>
                <span className="mx-2">/</span>
                <span className="text-foreground">{product.title}</span>
            </nav>

            <div className="grid md:grid-cols-2 gap-12">
                {/* Images */}
                <ProductImageGallery
                    mainImage={product.imageLink}
                    additionalImages={product.additionalImageLinks || []}
                    title={product.title}
                    {...(catalog ? catalogGalleryProps(product, config) : {})}
                />

                {/* Product Info */}
                <div className="space-y-6">
                    <h1 className="text-3xl font-bold tracking-tight">{product.title}</h1>

                    {/* Price */}
                    {!catalog && <div className="text-2xl">
                        {product.salePrice ? (
                            <div className="flex items-center gap-3">
                                <span className="font-bold text-red-600">{product.salePrice} {product.currency}</span>
                                <span className="line-through text-muted-foreground text-lg">{product.price} {product.currency}</span>
                            </div>
                        ) : (
                            <span className="font-bold">{product.price} {product.currency}</span>
                        )}
                    </div>}

                    {/* Volume Pricing */}
                    {!catalog && product.volumePricing?.length > 0 && (
                        <div className="border rounded-lg p-4">
                            <p className="text-sm font-medium mb-2">{strings.volumePricing}</p>
                            <div className="space-y-1">
                                {product.volumePricing.map((tier: any, i: number) => (
                                    <div key={i} className="flex justify-between text-sm">
                                        <span>{tier.minQuantity}+ {strings.units}</span>
                                        <span className="font-medium">{tier.price} {product.currency}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Availability */}
                    {!catalog && <div>
                        {product.availability === 'in_stock' ? (
                            <span className="inline-flex items-center gap-1.5 text-green-600 text-sm font-medium">
                                <span className="w-2 h-2 bg-green-500 rounded-full" /> {strings.inStock}
                            </span>
                        ) : product.availability === 'preorder' ? (
                            <span className="text-amber-600 text-sm font-medium">{strings.preOrder}</span>
                        ) : (
                            <span className="text-red-600 text-sm font-medium">{strings.outOfStock}</span>
                        )}
                    </div>}

                    {/* Categories as clickable badges */}
                    {categories.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-2">
                            {categories.map((cat: any) => (
                                <Link
                                    key={cat.id}
                                    href={`${basePath}${prefixes.category || "/category"}/${cat.slug}`}
                                    className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                >
                                    {cat.name}
                                </Link>
                            ))}
                        </div>
                    ) : rawCategoryIds.length > 0 ? (
                        /* Fallback: show raw category IDs as links (assuming slug = id) */
                        <div className="flex flex-wrap items-center gap-2">
                            {rawCategoryIds.map((cid: string) => (
                                <Link
                                    key={cid}
                                    href={`${basePath}${prefixes.category || "/category"}/${cid}`}
                                    className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                                >
                                    {cid.replace(/-/g, ' ')}
                                </Link>
                            ))}
                        </div>
                    ) : null}

                    {/* Short Description */}
                    {product.description && (
                        <div
                            className="text-muted-foreground prose prose-sm max-w-none"
                            dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(
                                    product.description
                                        .replace(/\\n/g, '<br>')
                                        .replace(/&nbsp;/g, ' ')
                                )
                            }}
                        />
                    )}

                    {/* Digital product: Paddle button — always, regardless of commerceEnabled */}
                    {!catalog && product.paymentLinkId && (
                        <a
                            href="#"
                            className="paddle_button inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-11 px-8 hover:opacity-90 transition-opacity"
                            data-product={product.paymentLinkId}
                        >
                            {strings.buyNow}
                        </a>
                    )}

                    {/* Physical product: Add to Cart — only when commerceEnabled AND not a digital product.
                        Catalog site (never commerceEnabled): this slot holds the variant presenter and the attributes. */}
                    {catalog ? (() => {
                        // CAT-INTEREST-1 (review-0 F4): keyed by product, so a client navigation to another product
                        // mounts fresh radio inputs and a fresh toggle — no choice carries over between products.
                        // CAT-QUOTE-1 (spec § 3 items 2-3): with a contact channel, "Request a quote" above the presenter; the
                        // interest toggle is the low-key link, under the button, in its place after the presenter (one order
                        // for every catalog tenant). Two fragments, not a conditional child: a tenant without a channel
                        // keeps the slot's children (and their order) as before.
                        const presenter = <CatalogVariantPresenter key={`presenter-${product.id}`} variants={product.variants || []} />;
                        const toggle = <InterestToggle key={`interest-${product.id}`} variant="link" {...interestToggleProps(config.id, product)} strings={interestToggleStrings(catalogStrings)} />;
                        const attributes = <ProductAttributes attributes={product.attributes || []} editorial={isEditorial(config)} />;
                        const channels = config.contactChannels;
                        if (!(channels && (channels.phone || channels.whatsapp || channels.email))) return <>{presenter}{toggle}{attributes}</>;
                        const group = interestToggleProps(config.id, product).optionGroupName;
                        const quote = (
                            <QuoteRequest
                                key={`quote-${product.id}`}
                                channels={channels}
                                productTitle={product.title}
                                productUrl={`https://${config.domain}${prefixes.product || URL_PREFIX_DEFAULTS.product}/${product.slug}`}
                                {...(group ? { optionGroupName: group } : {})}
                                strings={quoteRequestStrings(catalogStrings)}
                            />
                        );
                        return <>{quote}{presenter}{toggle}{attributes}</>;
                    })() : commerceEnabled && !product.paymentLinkId && (
                        <AddToCartButton
                            productId={product.id}
                            title={product.title}
                            slug={product.slug || ""}
                            imageLink={product.imageLink || ""}
                            price={product.price}
                            salePrice={product.salePrice}
                            currency={product.currency || "USD"}
                            availability={product.availability || "in_stock"}
                            variants={product.variants || []}
                            personalizations={product.personalizations || []}
                            volumePricing={product.volumePricing || []}
                            strings={addToCartStrings(resolved)}
                            {...(localeUsesDecimalComma(resolved.locale) ? { priceLocale: resolved.locale } : {})}
                        />
                    )}

                    {/* Tags */}
                    {product.tags?.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {product.tags.map((tag: string) => (
                                <span key={tag} className="bg-muted px-2 py-1 rounded text-xs">{tag}</span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Tabs: Long Description / Ingredients / Nutritional Values */}
            {(product.longDescription || product.ingredients || product.nutritionalValues?.length > 0) && (
                <div className="mt-16 border-t pt-12">
                    {product.longDescription && (
                        <div className="prose max-w-none mb-12">
                            <h2 className="text-xl font-bold mb-4">{strings.description}</h2>
                            <div dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(
                                    product.longDescription
                                        .replace(/\\n/g, '')
                                        .replace(/&nbsp;/g, ' ')
                                )
                            }} />
                        </div>
                    )}
                    {product.ingredients && (
                        <div className="mb-12">
                            <h2 className="text-xl font-bold mb-4">{strings.ingredients}</h2>
                            <p className="text-muted-foreground whitespace-pre-wrap">{product.ingredients}</p>
                        </div>
                    )}
                    {product.nutritionalValues?.length > 0 && (
                        <div>
                            <h2 className="text-xl font-bold mb-4">{strings.nutritionalValues}</h2>
                            <div className="border rounded-lg overflow-hidden">
                                {product.nutritionalValues.map((nv: any, i: number) => (
                                    <div key={i} className={`flex justify-between px-4 py-2.5 text-sm ${i % 2 === 0 ? 'bg-muted/50' : ''}`}>
                                        <span>{nv.label}</span>
                                        <div className="flex gap-4">
                                            <span className="font-medium">{nv.value}</span>
                                            {nv.dailyPercent && <span className="text-muted-foreground">{nv.dailyPercent}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Reviews */}
            {reviews && reviews.totalReviews > 0 && (
                <div className="mt-16 border-t pt-12">
                    <div className="flex items-center gap-3 mb-8">
                        <h2 className="text-xl font-bold">{strings.reviewsHeading}</h2>
                        <div className="flex items-center gap-1.5">
                            <span className="text-amber-500 text-lg">{"★".repeat(Math.round(reviews.averageRating))}</span>
                            <span className="text-sm text-muted-foreground">{fillTemplate(selectPluralText(strings.reviewsSummary, reviews.totalReviews), { rating: reviews.averageRating, n: reviews.totalReviews })}</span>
                        </div>
                    </div>
                    <div className="space-y-6">
                        {reviews.items.map((review: any) => (
                            <div key={review.id} className="border rounded-lg p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{review.authorName}</span>
                                        {review.source === "google" && <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">Google</span>}
                                    </div>
                                    <span className="text-xs text-muted-foreground">{new Date(review.createdAt).toLocaleDateString(config.locale || "en-US")}</span>
                                </div>
                                <div className="text-amber-500 text-sm mb-2">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
                                {review.content && <p className="text-sm text-muted-foreground">{review.content}</p>}
                                {/* rev-4: approved review photos. assetKey → raw asset URL resolved
                                    server-side; bounded thumbnails, lazy, alt from schema; plain <a>
                                    to the full image (lightbox-free, phase 1). NEVER next/image. */}
                                {(() => {
                                    const photos = toPublicReviewPhotos(review.images, reviewAssetCdnBase());
                                    if (photos.length === 0) return null;
                                    return (
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {photos.map((photo, i) => (
                                                <a key={i} href={photo.url} target="_blank" rel="noopener noreferrer" className="block w-20 h-20 rounded-lg overflow-hidden border border-border">
                                                    <img src={photo.url} alt={photo.alt || ""} loading="lazy" className="w-full h-full object-cover" />
                                                </a>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            </main>
        </>
    );
}
