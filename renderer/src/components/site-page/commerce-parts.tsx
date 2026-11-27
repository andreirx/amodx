import { getAllCategories } from "@/lib/dynamo";
import { fillTemplate, type LocaleStrings } from "@amodx/shared";
import Link from "next/link";
import { InterestToggle } from "@/components/InterestShortlist";
import { utf8Bytes } from "@amodx/shared";
import { interestToggleStrings } from "@/components/site-page/locale-strings";

// --- COMMERCE PAGE COMPONENTS ---

/** CAT-THEME-1: the tenant theme's `editorial` shape (CT-D1 = A); absent or "default" → false (today's classes). */
export function isEditorial(config: any): boolean {
    return config.theme?.shape === "editorial";
}

/**
 * CAT-THEME-1 (§ 3 item 5): the tenant's categories for the card's category line — read only when the theme turns the
 * line on, so every other tenant's category and search pages make exactly the reads they made before.
 */
export async function cardCategoriesOf(config: any): Promise<any[] | undefined> {
    return config.theme?.cardCategoryLine === true ? getAllCategories(config.id) : undefined;
}

/**
 * CAT-THEME-1 (§ 3 item 5): the theme's card options for one product — `landscape` (`theme.cardImage`) and, when
 * `theme.cardCategoryLine` is on, the name of the product's FIRST category (`categoryIds[0]`) found in `categories`; a
 * first category that is not there gives no line. A theme that sets neither gives `{ landscape: false }` — ProductCard's
 * own defaults, so the card renders as before.
 */
export function cardThemeProps(config: any, categories: any[] | undefined, product: any): { landscape?: boolean; categoryName?: string } {
    const first = Array.isArray(product.categoryIds) ? product.categoryIds[0] : undefined;
    const categoryName = config.theme?.cardCategoryLine === true ? categories?.find((c: any) => c.id === first)?.name : undefined;
    return { landscape: config.theme?.cardImage === "landscape", ...(categoryName ? { categoryName } : {}) };
}

/**
 * `catalog` (CATALOG-MODE-1): no price line and no availability badge — not emitted, not hidden by CSS.
 * CAT-INTEREST-1: on a catalog site the card is followed by the "Mă interesează" toggle (a button may not sit inside
 * the card's link); any other site renders the link alone, exactly as before. LOCALE-1B: `catalogStrings` = the
 * tenant's catalog texts (the toggle's three texts are taken from it per card).
 */
export function ProductCard({ product, productPrefix, basePath = "", catalog = false, tenantId, catalogStrings, landscape = false, categoryName }: { product: any; productPrefix: string; basePath?: string; catalog?: boolean; tenantId: string; catalogStrings: LocaleStrings["catalog"]; landscape?: boolean; categoryName?: string }) {
    const title = <h3 className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">{product.title}</h3>;
    const card = (
        <Link href={`${basePath}${productPrefix}/${product.slug}`} className="group block">
            <div className={landscape ? "h-[245px] bg-muted rounded-lg overflow-hidden mb-3" : "aspect-square bg-muted rounded-lg overflow-hidden mb-3"}>
                {product.imageLink ? (
                    <img src={product.imageLink} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-4xl">🛍</div>
                )}
            </div>
            {/* CAT-THEME-1: the category line shares the title's child slot (a fragment), so a card without it has
                exactly the children it had: the Link is a client element, and its children travel in the payload by position. */}
            {categoryName ? <>{title}<p className="text-xs text-muted-foreground mt-1">{categoryName}</p></> : title}
            {!catalog && <div className="mt-1">
                {product.salePrice ? (
                    <div className="flex items-center gap-2">
                        <span className="text-red-600 font-bold">{product.salePrice} {product.currency}</span>
                        <span className="line-through text-muted-foreground text-sm">{product.price}</span>
                    </div>
                ) : (
                    <span className="font-semibold">{product.price} {product.currency}</span>
                )}
            </div>}
            {!catalog && product.availability !== 'in_stock' && (
                <span className="text-xs text-amber-600 mt-1 block capitalize">{(product.availability || '').replace('_', ' ')}</span>
            )}
        </Link>
    );
    if (!catalog) return card;
    return (
        <div>
            {card}
            <InterestToggle tenantId={tenantId} productId={product.id} title={product.title} slug={product.slug} {...(product.imageLink ? { imageLink: product.imageLink } : {})} strings={interestToggleStrings(catalogStrings)} />
        </div>
    );
}

/**
 * `maxHrefBytes` (CAT-FACETS-1, catalog listings only): a pager link longer than this many UTF-8 bytes is not
 * emitted (spec § 5.1 invariant, measured on the final string). Absent → every link is emitted, as before.
 */
export function Pagination({ page, total, limit, baseUrl, basePath = "", maxHrefBytes, strings }: { page: number; total: number; limit: number; baseUrl: string; basePath?: string; maxHrefBytes?: number; strings: Pick<LocaleStrings["site"], "paginationPrevious" | "paginationPageOf" | "paginationNext"> }) {
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) return null;
    const sep = baseUrl.includes('?') ? '&' : '?';
    const fullBaseUrl = `${basePath}${baseUrl}`;
    const fits = (href: string) => maxHrefBytes === undefined || utf8Bytes(href) <= maxHrefBytes;

    return (
        <div className="flex items-center justify-center gap-2 mt-12">
            {page > 1 && fits(`${fullBaseUrl}${sep}page=${page - 1}`) && (
                <Link href={`${fullBaseUrl}${sep}page=${page - 1}`} className="px-4 py-2 border rounded-md text-sm hover:bg-muted">{strings.paginationPrevious}</Link>
            )}
            <span className="text-sm text-muted-foreground px-4">{fillTemplate(strings.paginationPageOf, { page, total: totalPages })}</span>
            {page < totalPages && fits(`${fullBaseUrl}${sep}page=${page + 1}`) && (
                <Link href={`${fullBaseUrl}${sep}page=${page + 1}`} className="px-4 py-2 border rounded-md text-sm hover:bg-muted">{strings.paginationNext}</Link>
            )}
        </div>
    );
}
