import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { isCatalogMode } from "@amodx/shared";
import { db, TABLE_NAME } from "./db.js";

/**
 * CATALOG-MODE-1 — the product write boundary for the tenant mode (spec docs/slices/catalog-mode-1.md § 3.1,
 * § 4 CM-D1 implementation note, CM-D7, CM-D8; § 3.4 "Variants" for imported products).
 *
 * Users: `products/create.ts` and `products/update.ts` (`readTenantMode` + `checkProductWrite`),
 * `import/woocommerce.ts` (`readTenantMode`). CAT-IMPORT-1 will call `checkProductWrite`'s derivation rule too.
 */

/**
 * The authoritative mode read (CM-D11 accepted refinement). Strongly consistent: a just-created catalog tenant is
 * never read as "not catalog". `null` = the tenant record does not exist — the caller answers 404 and writes
 * nothing; a miss is never defaulted to "not catalog". `SK` is projected so an existing record without the
 * `catalogMode` attribute (every tenant created before the flag) still returns an item.
 */
export async function readTenantMode(tenantId: string): Promise<{ catalogMode: boolean } | null> {
    const result = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
        ConsistentRead: true,
        ProjectionExpression: "SK, catalogMode",
    }));
    if (!result.Item) return null;
    return { catalogMode: isCatalogMode(result.Item) };
}

/** The outcome of the write-boundary check: the item to write, or the reason the write is refused (400). */
export type ProductWriteCheck =
    | { kind: "accepted"; item: Record<string, any> }
    | { kind: "refused"; error: string };

/**
 * The § 3.4 key normalisation, used here to compare variant labels: trim → collapse whitespace → lower-case →
 * Unicode NFC last (diacritics kept; canonically equivalent input gives one form).
 */
function normalizeLabel(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase().normalize("NFC");
}

const UrlSchema = z.string().url();

/**
 * The write rule for one product, applied to exactly what will be stored: the parsed input on create, the merged
 * item on update. Pure.
 *
 * - Catalog tenant (CM-D1 b, CM-D8 = A + accepted refinement): no monetary field may be stored. A PRESENT key is
 *   refused even when its value is "" — authoring paths omit the key. Refused, never dropped.
 * - Any other tenant (CM-D1 refinement, CM-D7 a): `price` and `imageLink` are required, as before this slice.
 * - Catalog product carrying `importSource` (cycle 11, C10-3): exactly one variant group, option labels unique in
 *   normalised form, an option image is a URL when present, and `imageLink` / `additionalImageLinks` are DERIVED
 *   from the option images, replacing whatever the request sent.
 */
export function checkProductWrite(product: Record<string, any>, catalogMode: boolean): ProductWriteCheck {
    if (!catalogMode) {
        if (product.price === undefined) return refused("price is required.");
        if (product.imageLink === undefined) return refused("imageLink is required.");
        return { kind: "accepted", item: product };
    }

    const monetary = monetaryFieldOf(product);
    if (monetary) return refused(`A catalog site stores no prices: remove ${monetary}.`);

    if (typeof product.importSource !== "string") return { kind: "accepted", item: product };

    const variants: any[] = product.variants ?? [];
    if (variants.length !== 1) {
        return refused(`An imported product has exactly one variant group (found ${variants.length}).`);
    }
    const options: any[] = variants[0].options ?? [];
    const seen = new Set<string>();
    for (const option of options) {
        const label = normalizeLabel(String(option.value ?? ""));
        if (seen.has(label)) return refused(`Two variant options have the same label "${option.value}".`);
        seen.add(label);
        if (option.imageLink !== undefined && !UrlSchema.safeParse(option.imageLink).success) {
            return refused(
                option.imageLink === ""
                    ? `Variant option "${option.value}" has an empty image: omit imageLink when there is no image.`
                    : `Variant option "${option.value}" has an image that is not a URL.`,
            );
        }
    }
    return { kind: "accepted", item: withDerivedGallery(product, options) };
}

/** The first monetary field present on a catalog product, named for the refusal message; `null` when none. */
function monetaryFieldOf(product: Record<string, any>): string | null {
    if (product.price !== undefined) return "price";
    if (product.salePrice !== undefined) return "salePrice";
    if ((product.volumePricing ?? []).length > 0) return "volumePricing";
    for (const group of product.variants ?? []) {
        for (const option of group.options ?? []) {
            if (option.priceOverride !== undefined) return "the variant option priceOverride";
        }
    }
    // The whole array: every personalization carries `addedCost` (schema default "0"), a monetary value.
    if ((product.personalizations ?? []).length > 0) return "personalizations";
    return null;
}

/**
 * The § 3.4 derivation rule: `imageLink` = the image of the first option that has one; `additionalImageLinks` = the
 * other distinct option images, in option order. No option image → the product has no image (key absent, CM-D7).
 */
function withDerivedGallery(product: Record<string, any>, options: any[]): Record<string, any> {
    const images: string[] = [];
    for (const option of options) {
        if (option.imageLink !== undefined && !images.includes(option.imageLink)) images.push(option.imageLink);
    }
    const rest = { ...product };
    delete rest.imageLink;
    return images.length > 0
        ? { ...rest, imageLink: images[0], additionalImageLinks: images.slice(1) }
        : { ...rest, additionalImageLinks: [] };
}

function refused(error: string): ProductWriteCheck {
    return { kind: "refused", error };
}
