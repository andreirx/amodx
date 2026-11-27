import { getPosts, getCategoryBySlug, getProductsByCategory, getAllCategories, getProductReviews, getSiteReviews, getActiveCategoriesByIds, getProductById, getFormBySlug } from "@/lib/dynamo";
import { reviewAssetCdnBase, toCarouselReviewItems } from "@/lib/review-images";
import { formFieldsOf, resolveFormDateOrder, URL_PREFIX_DEFAULTS, urlPrefixesOf, isCatalogMode, localeUsesDecimalComma, parseMoney, resolveLocaleStrings, newsletterTexts, galleryTexts, fillTemplate, selectPluralText, type LocaleStrings, type ResolvedLocaleStrings } from "@amodx/shared";
import sanitizeHtmlLib from "sanitize-html";

/**
 * SERVER PRE-FETCH FOR PLUGIN BLOCKS — the preparation pass every list of blocks gets before `RenderBlocks` draws it.
 * Injects server-fetched data and tenant settings into the attrs of the blocks, IN PLACE: `postGrid` posts,
 * `categoryShowcase` products (+ the catalog-mode reduction and the URL prefixes), `reviewsCarousel` reviews,
 * `categoryGrid` categories (SHOP-LOOK-1C).
 * Eliminates client-side browser→API Gateway fetches which are fragile (CORS, missing env vars, silent failures).
 * A value that is not an array is left alone (no read). Users: the content page and the category page
 * (CATEGORY-CONTENT-1), so a block works the same on both.
 */
/**
 * PRICE-LOCALE-1 (ruling PL1-SHOWCASE = C, narrowed): the showcase card's price range (min and max of `price` and the
 * tier prices — the card's own rule) for a product with tiers whose `price` or a tier price contains a comma, read by
 * `parseMoney` with the tenant locale and given to the card as `_priceRange`. Any other product is returned as it is (the
 * same object). A text that does not parse → no range: the card keeps its own reading. Pure; never mutates `product`.
 */
function withCommaPriceRange(product: any, locale: string | undefined): any {
    const tiers: any[] = Array.isArray(product?.volumePricing) ? product.volumePricing : [];
    const texts: unknown[] = [product?.price, ...tiers.map((t) => t?.price)];
    if (tiers.length === 0 || !texts.some((t) => typeof t === "string" && t.includes(","))) return product;
    const numbers = texts.map((t) => (typeof t === "string" ? parseMoney(t, locale) : undefined));
    if (numbers.some((n) => n === undefined)) return product;
    const values = numbers as number[];
    return { ...product, _priceRange: { min: Math.min(...values), max: Math.max(...values) } };
}

/** SHOP-LOOK-1D (design § 6.4): the card data is read for at most this many products per block — the schema's `limit`
 *  maximum; a larger stored `limit` (the backend does not check block attributes) shows its extra cards without it. */
const SHOWCASE_CARD_READ_LIMIT = 12;
/** SHOP-LOOK-1D (§ 7.2): the most characters of short text a card receives. The card shows two lines (`line-clamp-2`);
 *  two lines of the widest card (two columns, full width) hold fewer, so the cut never shows; it bounds the payload. */
const SHORT_TEXT_MAX = 400;

/**
 * SHOP-LOOK-1D (§ 7.2): a product description as the plain text of a showcase card — never HTML. The stored text may be
 * HTML (the product page sanitizes and draws it as HTML, and reads a literal `\n` as a line break). Here: a literal `\n`
 * and each block-level tag become a space (so two paragraphs do not run together), sanitize-html removes every tag (and
 * the content of `script` / `style`), its three escapes (`&lt;` `&gt;` `&amp;`, the only ones it writes) are undone
 * because React escapes the text again, white space collapses, and the result is cut to `SHORT_TEXT_MAX` characters
 * (code points). Not a string, or nothing left → undefined (no element).
 */
function cardShortText(description: unknown): string | undefined {
    if (typeof description !== "string") return undefined;
    const separated = description.replace(/\\n/g, " ").replace(/<(\/?)(p|div|br|li|h[1-6]|tr|td|th|blockquote|pre|hr)\b/gi, " <$1$2");
    const text = sanitizeHtmlLib(separated, { allowedTags: [], allowedAttributes: {} })
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/\s+/g, " ").trim();
    return text === "" ? undefined : Array.from(text).slice(0, SHORT_TEXT_MAX).join("");
}

/**
 * SHOP-LOOK-1D (design § 6.3 rule 3, § 6.4, § 7): the showcase card data that the block's options ask for, added to the
 * products this pass read. Each option reads ONLY when it is on (stored exactly `true`); with all three off the same
 * array returns and no read is made. Never called for a catalog tenant (SL-D10). Per block, at most:
 * - `showCategoryLabel`: 1 `getAllCategories` call (paginating Query, active categories only) → `_categoryName` = the
 *   name of the product's FIRST category (`categoryIds[0]`, SL-D7); a first category that is hidden or missing → no key.
 * - `showDescription`: 1 `getProductById` (one `GetCommand`) per product → `_descriptionText` (`cardShortText`).
 * - `showRating`: 1 `getProductReviews` (paginating Query, approved only) per product → `_rating` = `{ average, count,
 *   text }`, `text` = the tenant's `reviewsSummary` filled as on the product page; no approved review → no key.
 * Products past the first `SHOWCASE_CARD_READ_LIMIT` are returned as they are. A product without new data is the same
 * object; one with new data is a copy with only the new keys added.
 */
async function withShowcaseCardData(attrs: any, products: any[], config: any): Promise<any[]> {
    const label = attrs.showCategoryLabel === true;
    const description = attrs.showDescription === true;
    const rating = attrs.showRating === true;
    if (!label && !description && !rating) return products;
    const names = label ? new Map((await getAllCategories(config.id)).map((c: any) => [c.id, c.name])) : undefined;
    const summary = rating ? resolveLocaleStrings(config).strings.commerce.reviewsSummary : undefined;
    return Promise.all(products.map(async (product: any, i: number) => {
        if (i >= SHOWCASE_CARD_READ_LIMIT) return product;
        const [item, reviews] = await Promise.all([
            description ? getProductById(config.id, product.id) : undefined,
            rating ? getProductReviews(config.id, product.id) : undefined,
        ]);
        const categoryName = names?.get(Array.isArray(product.categoryIds) ? product.categoryIds[0] : undefined);
        const shortText = cardShortText(item?.description);
        const extra = {
            ...(typeof categoryName === "string" && categoryName.trim() !== "" ? { _categoryName: categoryName } : {}),
            ...(shortText !== undefined ? { _descriptionText: shortText } : {}),
            ...(summary && reviews && reviews.totalReviews > 0 && Number.isFinite(reviews.averageRating)
                ? { _rating: { average: reviews.averageRating, count: reviews.totalReviews, text: fillTemplate(selectPluralText(summary, reviews.totalReviews), { rating: reviews.averageRating, n: reviews.totalReviews }) } }
                : {}),
        };
        return Object.keys(extra).length > 0 ? { ...product, ...extra } : product;
    }));
}

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md § 2): the `form` block's `_form`, built field by field from the form
 * `getFormBySlug` read (an active form of this tenant) — never the stored item, which also holds the owner's notify
 * address and the keys. `fields`: the stored entries that are fields (`FormFieldSchema`), the first field of each label
 * only — the rule of the submit handler (`backend/src/forms/public-submit.ts` `formFields`), so the page shows exactly
 * the fields the handler reads (STAY-1A: one shared rule, `formFieldsOf`). `strings`: the four form texts of the tenant's
 * locale table (three of them are not block keys, so `strings` of RenderBlocks does not hold them). `dateOrder`
 * (STAY-1A): the pair rule's two field ids, only when it resolves against `fields`; absent otherwise, so a form without
 * a rule gives the same `_form` as before.
 */
function formForBlock(form: Record<string, any>, slug: string, site: LocaleStrings["site"]) {
    const fields = formFieldsOf(form.fields);
    const order = resolveFormDateOrder(fields, form.dateOrder);
    return {
        slug,
        name: typeof form.name === "string" ? form.name : "",
        fields,
        submitButtonText: typeof form.submitButtonText === "string" ? form.submitButtonText : "",
        successMessage: typeof form.successMessage === "string" ? form.successMessage : "",
        strings: {
            formSubmissionFailed: site.formSubmissionFailed, formErrorShort: site.formErrorShort,
            formSelectPlaceholder: site.formSelectPlaceholder, formSubmitting: site.formSubmitting,
        },
        ...(order.ok && order.value !== null ? { dateOrder: { earlier: order.value.earlier.id, later: order.value.later.id } } : {}),
    };
}

/** `resolved`: the page's texts (its language, LANG-1B) — read only by the `newsletter` and `gallery` branches; a caller without a page
 *  language (the category page) gets the tenant's default language. */
export async function prepareBlocks(blocks: unknown, config: any, resolved: ResolvedLocaleStrings = resolveLocaleStrings(config)): Promise<void> {
    if (!Array.isArray(blocks)) return;
    await Promise.all(blocks.map(async (block: any) => {
        if (block.type === 'postGrid') {
            const tag = block.attrs.filterTag;
            let limit = 6;
            if (block.attrs.limit !== undefined && block.attrs.limit !== null && block.attrs.limit !== "") {
                limit = parseInt(block.attrs.limit);
            }
            const posts = await getPosts(config.id, tag, limit);
            block.attrs.prefetchedPosts = posts;
            block.attrs.serverDomain = config.domain;
        }

        if (block.type === 'categoryShowcase') {
            const slug = block.attrs.categorySlug;
            if (slug) {
                const category = await getCategoryBySlug(config.id, slug);
                if (category) {
                    const limit = block.attrs.limit || 4;
                    const { items } = await getProductsByCategory(config.id, category.id, 1, limit);
                    block.attrs.prefetchedProducts = items;
                    // SHOP-LOOK-1D: the card options' data (`withShowcaseCardData`), only for the products read here and
                    // only on a non-catalog tenant (SL-D10); with every option off the same array stays (no read).
                    if (!isCatalogMode(config)) block.attrs.prefetchedProducts = await withShowcaseCardData(block.attrs, items, config);
                }
            }
            // PRICE-LOCALE-1 (ruling PL1-SHOWCASE = C, narrowed): for a decimal-comma tenant only, each product whose price
            // texts hold a comma gets its card range from the shared parser (`withCommaPriceRange`). Every other tenant and
            // product keeps the same attrs, so its payload does not change. Before the catalog reduction below, which
            // keeps display fields only.
            if (Array.isArray(block.attrs.prefetchedProducts) && localeUsesDecimalComma(config.locale)) {
                block.attrs.prefetchedProducts = block.attrs.prefetchedProducts.map((p: any) => withCommaPriceRange(p, config.locale));
            }
            // CATALOG-MODE-1 (§ 3.2.6): on EVERY showcase block of a catalog tenant — whether or not the lookup
            // above succeeded. `_catalogMode` is the mechanism: the plugin emits no price, currency or stock overlay
            // for any product source (this prefetch, stale authored attrs, its browser fallback fetch). Defence in
            // depth: the block is a client component, so its attrs travel in the RSC payload — whatever their
            // source, catalog `prefetchedProducts` keep display fields only (no currency, availability, tiers).
            // Neither key changes for a non-catalog tenant, so their attrs and RSC payloads do not change.
            if (isCatalogMode(config)) {
                block.attrs._catalogMode = true;
                if (Array.isArray(block.attrs.prefetchedProducts)) block.attrs.prefetchedProducts = block.attrs.prefetchedProducts.map((p: any) => ({ id: p.id, title: p.title, slug: p.slug, ...(p.imageLink !== undefined ? { imageLink: p.imageLink } : {}) }));
            }
            // Inject tenant-resolved URL prefixes so the component doesn't
            // need to read from document meta tags (unavailable during SSR).
            const resolvedPrefixes = config.urlPrefixes || URL_PREFIX_DEFAULTS;
            block.attrs._productPrefix = resolvedPrefixes.product || "/product";
            block.attrs._categoryPrefix = resolvedPrefixes.category || "/category";
        }

        // SHOP-LOOK-1C (docs/slices/shop-look-1.md § 6.4; record docs/slices/shop-look-1c.md): the picked categories of a
        // tile grid. Only this block's attrs gain a key (`_categories`, § 6.3 rule 3). The stored ids: strings that are not
        // blank, the first 12 (the schema's limit; the backend does not check block attributes, so a stored 13th id is not
        // read and not drawn) — one `getActiveCategoriesByIds` call per block, one `GetCommand` per id, none when no id is
        // left. A hidden or missing category is skipped by the read; the others keep the picked order. Each tile is built
        // field by field — id, name, description and imageLink when present, and the site path of its category page
        // (`urlPrefixesOf`: the tenant's category prefix, else the default) — so the payload holds these fields whatever
        // the read returns (the attrs of a client block travel in the RSC payload).
        if (block.type === 'categoryGrid') {
            const stored: unknown[] = Array.isArray(block.attrs.categoryIds) ? block.attrs.categoryIds : [];
            const ids = stored.filter((id): id is string => typeof id === "string" && id.trim() !== "").slice(0, 12);
            const categoryPrefix = urlPrefixesOf(config.urlPrefixes).category;
            const categories = ids.length > 0 ? await getActiveCategoriesByIds(config.id, ids) : [];
            block.attrs._categories = categories.map((c) => ({
                id: c.id,
                name: c.name,
                ...(c.description !== undefined ? { description: c.description } : {}),
                ...(c.imageLink !== undefined ? { imageLink: c.imageLink } : {}),
                path: `${categoryPrefix}/${c.slug}`,
            }));
        }

        // SHOP-LOOK-1E: the custom form of a `form` block, by its slug (trimmed; blank → no read). One `getFormBySlug` per
        // block (two keyed `GetCommand`s under TENANT#<this tenant>); only this block's attrs gain `_form`, and only when the
        // form exists and is active. No `_form` → the block draws nothing.
        if (block.type === 'form') {
            const slug = typeof block.attrs.formSlug === "string" ? block.attrs.formSlug.trim() : "";
            const form = slug !== "" ? await getFormBySlug(config.id, slug) : null;
            if (form) block.attrs._form = formForBlock(form, slug, resolveLocaleStrings(config).strings.site);
        }

        // NEWSLETTER-1 (docs/slices/newsletter-1.md): the `newsletter` block's visitor texts from the tenant's locale table in
        // the page's language (`resolved`, as the page's other block texts; `newsletterTexts` gives the consent line the
        // backend checks the signup against — the default language's or an extra language's). Only this block's attrs
        // gain `_newsletter`; no read. Never the MailerLite settings: the push runs in the backend.
        if (block.type === 'newsletter') {
            block.attrs._newsletter = newsletterTexts(resolved);
        }

        // GALLERY-1 (docs/slices/gallery-1.md, ruling 2): the `gallery` block's viewer and tile texts from the tenant's locale
        // table in the page's language (`resolved`, as the newsletter). Only this block's attrs gain `_gallery`; no read. The
        // photos stay as stored: the plugin checks each one. A stored block without an attrs object (a tool can write
        // `{ type }` alone) has no photos and draws nothing: it is skipped, so it cannot throw here and fail the page.
        if (block.type === 'gallery' && typeof block.attrs === 'object' && block.attrs !== null) {
            block.attrs._gallery = galleryTexts(resolved);
        }

        // rev-4: a reviews carousel in a DB-backed scope is fed approved System-A reviews here
        // (server-side), REPLACING any authored `items`. Photo assetKeys are resolved to raw
        // asset URLs on the SERVER: the `UPLOADS_CDN_URL` env var and the key→URL resolution stay
        // server-side, while the RESOLVED public URL (base included) ships to the client in the
        // raw `<img src>`, exactly as product `imageLink`s reach the client already-resolved.
        // Both are plain cacheable-route DB reads (getSiteReviews / getProductReviews), NOT
        // dynamic APIs.
        //   • site-reviews          — the tenant's approved SITE-scope (SITEREVIEW#) reviews.
        //   • product-reviews-by-id — a specific product's approved reviews, by `productId` attr.
        if (block.type === 'reviewsCarousel' && block.attrs.scope === 'site-reviews') {
            const { items } = await getSiteReviews(config.id);
            block.attrs.items = toCarouselReviewItems(items, reviewAssetCdnBase());
        }
        if (block.type === 'reviewsCarousel' && block.attrs.scope === 'product-reviews-by-id') {
            const productId = block.attrs.productId;
            const { items } = productId
                ? await getProductReviews(config.id, productId)
                : { items: [] as any[] };
            block.attrs.items = toCarouselReviewItems(items, reviewAssetCdnBase());
        }
    }));
}
