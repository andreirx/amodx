import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { writeCatProductItems } from "../lib/catprod.js";
import { publishAudit } from "../lib/events.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

const slugify = (str: string) => {
    return str
        .toLowerCase()
        .trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip diacritics
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};

function parseCSV(csvText: string): Record<string, string>[] {
    const lines = csvText.split('\n');
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCSVLine(line);
        const row: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j].trim()] = (values[j] || '').trim();
        }
        rows.push(row);
    }
    return rows;
}

function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++; // skip escaped quote
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
    }
    result.push(current);
    return result;
}

function mapAvailability(stockQty: string, stockStatus: string): string {
    const lower = stockStatus.toLowerCase();
    if (lower === 'outofstock' || lower === '0') return 'out_of_stock';
    if (lower === 'onbackorder') return 'preorder';
    return 'in_stock';
}

/** Extract attribute columns from a row (Attribute 1 name, Attribute 1 value(s), etc.) */
function extractAttributes(row: Record<string, string>): { key: string; value: string }[] {
    const attrs: { key: string; value: string }[] = [];
    for (const key of Object.keys(row)) {
        if (key.startsWith('Attribute') && key.includes('name')) {
            const idx = key.replace(/\D/g, '');
            const attrName = row[key];
            const attrVal = row[`Attribute ${idx} value(s)`] || row[`Attribute ${idx} values`] || '';
            if (attrName && attrVal) {
                attrs.push({ key: attrName, value: attrVal });
            }
        }
    }
    return attrs;
}

interface ImportResult {
    imported: number;
    skipped: number;
    categoriesCreated: number;
    errors: string[];
}

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        try {
            requireRole(auth, ["TENANT_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing Tenant" }) };
        if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing Body" }) };

        const body = JSON.parse(event.body);
        const { csvContent, currency = "RON", defaultStatus = "active" } = body;

        if (!csvContent) {
            return { statusCode: 400, body: JSON.stringify({ error: "csvContent is required" }) };
        }

        const rows = parseCSV(csvContent);
        if (rows.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: "No data rows found in CSV" }) };
        }

        const result: ImportResult = { imported: 0, skipped: 0, categoriesCreated: 0, errors: [] };
        const categoryCache: Record<string, string> = {}; // name → id

        // === Two-pass approach for variable products + variations ===

        // Pass 1: Separate parents (simple/variable) and variations
        const parents: Record<string, string>[] = [];
        const variationsByParent: Map<string, Record<string, string>[]> = new Map();

        for (const row of rows) {
            const type = (row['Type'] || row['type'] || 'simple').toLowerCase();
            if (type === 'variation') {
                const parentSlug = row['Parent'] || row['parent'] || '';
                if (parentSlug) {
                    const existing = variationsByParent.get(parentSlug) || [];
                    existing.push(row);
                    variationsByParent.set(parentSlug, existing);
                } else {
                    result.skipped++;
                }
            } else {
                parents.push(row);
            }
        }

        // Pass 2: Process parents + merge variations
        for (const row of parents) {
            try {
                const title = row['Name'] || row['name'] || row['post_title'] || '';
                if (!title) {
                    result.skipped++;
                    continue;
                }

                const id = crypto.randomUUID();
                const now = new Date().toISOString();
                const wooSlug = row['Slug'] || row['slug'] || '';
                const productSlug = wooSlug || slugify(title);
                const sku = row['SKU'] || row['sku'] || '';

                // Parse price
                const regularPrice = row['Regular price'] || row['regular_price'] || '0';
                const salePrice = row['Sale price'] || row['sale_price'] || '';

                // Parse categories (WooCommerce format: "Cat1, Cat2 > SubCat")
                const categoryString = row['Categories'] || row['categories'] || '';
                const categoryIds: string[] = [];

                if (categoryString) {
                    const catNames = categoryString.split(',').map((c: string) => c.trim());
                    for (const catPath of catNames) {
                        const parts = catPath.split('>').map((p: string) => p.trim());
                        const leafCat = parts[parts.length - 1];
                        if (!leafCat) continue;

                        if (!categoryCache[leafCat]) {
                            const catSlug = slugify(leafCat);
                            const existingCat = await db.send(new GetCommand({
                                TableName: TABLE_NAME,
                                Key: { PK: `TENANT#${tenantId}`, SK: `CATEGORY#${catSlug}` }
                            }));

                            if (!existingCat.Item) {
                                const catId = catSlug;
                                const parentId = parts.length > 1 ? slugify(parts[parts.length - 2]) : null;

                                await db.send(new PutCommand({
                                    TableName: TABLE_NAME,
                                    Item: {
                                        PK: `TENANT#${tenantId}`,
                                        SK: `CATEGORY#${catId}`,
                                        TenantSlug: `${tenantId}#${catSlug}`,
                                        Type: "Category",
                                        id: catId,
                                        tenantId,
                                        name: leafCat,
                                        slug: catSlug,
                                        parentId,
                                        sortOrder: 0,
                                        status: "active",
                                        productCount: 0,
                                        createdAt: now,
                                        updatedAt: now,
                                    }
                                }));
                                categoryCache[leafCat] = catId;
                                result.categoriesCreated++;
                            } else {
                                categoryCache[leafCat] = existingCat.Item.id || catSlug;
                            }
                        }

                        categoryIds.push(categoryCache[leafCat]);
                    }
                }

                // Parse images
                const mainImage = row['Images'] || row['images'] || row['image'] || '';
                const images = mainImage.split(',').map((img: string) => img.trim()).filter(Boolean);
                const imageLink = images[0] || '';
                const additionalImageLinks = images.slice(1);

                // Parse tags
                const tagsStr = row['Tags'] || row['tags'] || '';
                const tags = tagsStr ? tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

                // Parse description
                const shortDescription = row['Short description'] || row['short_description'] || '';
                const longDescription = row['Description'] || row['description'] || row['post_content'] || '';

                // Parse weight
                const weightStr = row['Weight (kg)'] || row['weight'] || '';
                const weight = weightStr ? Math.round(parseFloat(weightStr) * 1000) : undefined;

                // Parse stock
                const stockStatus = row['In stock?'] || row['stock_status'] || '1';
                const stockQty = row['Stock'] || row['stock_quantity'] || '';
                const availability = mapAvailability(stockQty, stockStatus);

                // Parse attributes from the parent row
                const attributes = extractAttributes(row);

                // === Build variants from variation rows ===
                const type = (row['Type'] || row['type'] || 'simple').toLowerCase();
                const variations = variationsByParent.get(productSlug) || [];
                const variants: any[] = [];

                if (type === 'variable' && variations.length > 0) {
                    // Group by attribute dimensions
                    const dimensionMap: Map<string, Map<string, any>> = new Map();

                    for (const varRow of variations) {
                        const varAttrs = extractAttributes(varRow);
                        for (const attr of varAttrs) {
                            if (!dimensionMap.has(attr.key)) {
                                dimensionMap.set(attr.key, new Map());
                            }
                            const optionMap = dimensionMap.get(attr.key)!;
                            // Split pipe-separated values (WooCommerce uses pipes for multi-value)
                            const values = attr.value.split('|').map(v => v.trim());
                            for (const val of values) {
                                if (!optionMap.has(val)) {
                                    const varPrice = varRow['Regular price'] || varRow['regular_price'] || '';
                                    const varSalePrice = varRow['Sale price'] || varRow['sale_price'] || '';
                                    const varImage = (varRow['Images'] || varRow['images'] || '').split(',')[0]?.trim() || '';
                                    const varStockStatus = varRow['In stock?'] || varRow['stock_status'] || '1';
                                    const varAvailability = mapAvailability('', varStockStatus);

                                    optionMap.set(val, {
                                        value: val,
                                        priceOverride: varSalePrice || varPrice || undefined,
                                        imageLink: varImage || undefined,
                                        availability: varAvailability,
                                    });
                                }
                            }
                        }
                    }

                    for (const [dimName, optionMap] of dimensionMap) {
                        variants.push({
                            id: crypto.randomUUID(),
                            name: dimName,
                            options: [...optionMap.values()],
                        });
                    }
                }

                // Build product item
                const item = {
                    PK: `TENANT#${tenantId}`,
                    SK: `PRODUCT#${id}`,
                    TenantSlug: `${tenantId}#${productSlug}`,
                    Type: "Product",
                    id,
                    tenantId,
                    status: defaultStatus,
                    title,
                    slug: productSlug,
                    sku: sku || undefined,
                    description: shortDescription,
                    longDescription: longDescription || undefined,
                    price: regularPrice || '0',
                    currency,
                    salePrice: salePrice || undefined,
                    availability,
                    inventoryQuantity: stockQty ? parseInt(stockQty) : undefined,
                    brand: row['Brand'] || undefined,
                    categoryIds,
                    tags,
                    attributes,
                    imageLink,
                    additionalImageLinks,
                    weight,
                    seoTitle: row['SEO title'] || row['meta_title'] || undefined,
                    seoDescription: row['SEO description'] || row['meta_description'] || undefined,
                    volumePricing: [],
                    personalizations: [],
                    variants,
                    nutritionalValues: [],
                    sortOrder: 0,
                    condition: "new",
                    createdAt: now,
                    updatedAt: now,
                };

                await db.send(new PutCommand({
                    TableName: TABLE_NAME,
                    Item: item,
                }));

                // Write CATPROD# adjacency items
                if (categoryIds.length > 0) {
                    await writeCatProductItems(tenantId, {
                        id, title, slug: productSlug, price: regularPrice || '0',
                        currency, salePrice: salePrice || undefined,
                        imageLink, availability, sortOrder: 0,
                        tags, volumePricing: [], categoryIds,
                    });
                }

                result.imported++;
            } catch (rowErr: any) {
                result.errors.push(`Row "${row['Name'] || 'unknown'}": ${rowErr.message}`);
            }
        }

        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "WOOCOMMERCE_IMPORT",
            target: { title: `WooCommerce CSV Import`, id: "import" },
            details: {
                imported: result.imported,
                categoriesCreated: result.categoriesCreated,
                skipped: result.skipped,
                errors: result.errors.length > 0 ? result.errors : undefined,
            },
            ip: event.requestContext.http.sourceIp
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Import complete: ${result.imported} products imported, ${result.categoriesCreated} categories created, ${result.skipped} skipped`,
                ...result,
            })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
