import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { writeCatProductItems, deleteCatProductItems } from "../lib/catprod.js";
import { publishAudit } from "../lib/events.js";
import { loadMediaMap } from "../lib/media-map.js";

/** Look up existing product by slug using GSI_Slug */
async function findProductBySlug(tenantId: string, slug: string): Promise<any | null> {
    const result = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI_Slug",
        KeyConditionExpression: "TenantSlug = :ts",
        ExpressionAttributeValues: { ":ts": `${tenantId}#${slug}` },
    }));
    return result.Items?.find((item: any) => item.SK?.startsWith("PRODUCT#")) || null;
}

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

/** Clean up description text: convert literal \n to actual newlines, strip excessive whitespace */
const cleanDescription = (str: string) => {
    if (!str) return '';
    return str
        .replace(/\\n/g, '\n')           // literal \n → actual newline
        .replace(/\\r/g, '')             // remove \r
        .replace(/\\t/g, '  ')           // literal \t → spaces
        .replace(/\n{3,}/g, '\n\n')      // collapse 3+ newlines to 2
        .trim();
};

// ===================== ROMANIAN → ENGLISH COLUMN MAP =====================
const COLUMN_MAP: Record<string, string> = {
    "Tip": "Type",
    "Nume": "Name",
    "Publicat": "Published",
    "Este reprezentativ?": "Is featured?",
    "Vizibilitate în catalog": "Catalog visibility",
    "Descriere scurtă": "Short description",
    "Descriere": "Description",
    "Dată începere promoție": "Date sale price starts",
    "Dată încheiere promoție": "Date sale price ends",
    "Stare taxă": "Tax status",
    "Clasă de impozitare": "Tax class",
    "În stoc?": "In stock?",
    "Stoc": "Stock",
    "Cantitate mică în stoc": "Low stock amount",
    "Precomenzile sunt permise?": "Backorders allowed?",
    "Vândut individual?": "Sold individually?",
    "Greutate (g)": "Weight (g)",
    "Lungime (cm)": "Length (cm)",
    "Lățime (cm)": "Width (cm)",
    "Înălțime (cm)": "Height (cm)",
    "Permiți recenzii de la clienți?": "Reviews allowed?",
    "Notă de cumpărare": "Purchase note",
    "Preț promoțional": "Sale price",
    "Preț obișnuit": "Regular price",
    "Categorii": "Categories",
    "Etichete": "Tags",
    "Clasă de livrare": "Shipping class",
    "Imagini": "Images",
    "Limită de descărcări": "Download limit",
    "Zile de expirare descărcare": "Download expiry days",
    "Părinte": "Parent",
    "Produse grupate": "Grouped products",
    "Upsells": "Upsells",
    "Vânzări încrucișate": "Cross-sells",
    "URL extern": "External URL",
    "Text buton": "Button text",
    "Poziție": "Position",
    "Branduri": "Brand",
    "GTIN, UPC, EAN sau ISBN": "GTIN, UPC, EAN, or ISBN",
};

/** Map a single header to English. Handles both static map and dynamic attribute patterns. */
function normalizeHeader(header: string): string {
    // Static lookup first
    if (COLUMN_MAP[header]) return COLUMN_MAP[header];

    // Dynamic attribute columns: "Nume atribut N" → "Attribute N name"
    let m = header.match(/^Nume atribut (\d+)$/);
    if (m) return `Attribute ${m[1]} name`;

    m = header.match(/^Valoare \(valori\) atribut (\d+)$/);
    if (m) return `Attribute ${m[1]} value(s)`;

    m = header.match(/^Vizibilitate atribut (\d+)$/);
    if (m) return `Attribute ${m[1]} visible`;

    m = header.match(/^Atribut (\d+) global$/);
    if (m) return `Attribute ${m[1]} global`;

    // Already English or unknown — pass through
    return header;
}

function parseCSV(csvText: string): { rows: Record<string, string>[]; weightInGrams: boolean } {
    // Strip UTF-8 BOM
    if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);

    const lines = csvText.split('\n');
    if (lines.length < 2) return { rows: [], weightInGrams: false };

    const rawHeaders = parseCSVLine(lines[0]);
    const headers = rawHeaders.map(h => normalizeHeader(h.trim()));

    // Detect weight unit from header
    const weightInGrams = rawHeaders.some(h => h.includes('(g)'));

    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCSVLine(line);
        const row: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = (values[j] || '').trim();
        }
        rows.push(row);
    }
    return { rows, weightInGrams };
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
    if (lower === 'onbackorder' || lower === 'backorder') return 'preorder';
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

/** Rewrite a URL using the media map. Returns original if not found. */
function rewriteUrl(url: string, mediaMap: Map<string, string>): string {
    return mediaMap.get(url) || url;
}

interface ImportResult {
    imported: number;
    updated: number;
    skipped: number;
    drafts: number;
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

        const { rows, weightInGrams } = parseCSV(csvContent);
        if (rows.length === 0) {
            return { statusCode: 400, body: JSON.stringify({ error: "No data rows found in CSV" }) };
        }

        // Load media URL map (from prior media import step)
        const mediaMap = await loadMediaMap(tenantId);
        console.log(`Loaded ${mediaMap.size} media URL mappings`);

        const result: ImportResult = { imported: 0, updated: 0, skipped: 0, drafts: 0, categoriesCreated: 0, errors: [] };
        const categoryCache: Record<string, string> = {}; // name → id

        // === Two-pass approach for variable products + variations ===

        // Build WooCommerce ID → slug map for parent-by-ID lookups
        const wooIdToSlug: Map<string, string> = new Map();

        // Pass 1: Separate parents (simple/variable) and variations
        const parents: Record<string, string>[] = [];
        const variationsByParent: Map<string, Record<string, string>[]> = new Map();

        for (const row of rows) {
            const type = (row['Type'] || row['type'] || 'simple').toLowerCase();

            // Build ID→slug map for all non-variation rows
            if (type !== 'variation') {
                const wooId = row['ID'] || '';
                const title = row['Name'] || row['name'] || row['post_title'] || '';
                const wooSlug = row['Slug'] || row['slug'] || '';
                const slug = wooSlug || slugify(title);
                if (wooId && slug) wooIdToSlug.set(wooId, slug);
                parents.push(row);
            } else {
                // Variation — resolve parent reference
                let parentRef = row['Parent'] || row['parent'] || '';

                // Handle "id:XXXX" format
                if (parentRef.startsWith('id:')) {
                    const wooId = parentRef.slice(3);
                    parentRef = wooIdToSlug.get(wooId) || parentRef;
                }

                if (parentRef) {
                    const existing = variationsByParent.get(parentRef) || [];
                    existing.push(row);
                    variationsByParent.set(parentRef, existing);
                } else {
                    result.skipped++;
                }
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

                const now = new Date().toISOString();
                const wooSlug = row['Slug'] || row['slug'] || '';
                const productSlug = wooSlug || slugify(title);
                const sku = row['SKU'] || row['sku'] || '';

                // Check for existing product by slug
                const existingProduct = await findProductBySlug(tenantId, productSlug);
                const id = existingProduct?.id || crypto.randomUUID();
                const isUpdate = !!existingProduct;
                const oldCategoryIds: string[] = existingProduct?.categoryIds || [];

                // Determine status from Published column
                const published = row['Published'] || '';
                let status = defaultStatus;
                if (published === '-1' || published === '0') {
                    status = 'draft';
                    result.drafts++;
                }

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

                // Parse images — rewrite URLs via media map
                const mainImage = row['Images'] || row['images'] || row['image'] || '';
                const images = mainImage.split(',').map((img: string) => img.trim()).filter(Boolean);
                const imageLink = rewriteUrl(images[0] || '', mediaMap);
                const additionalImageLinks = images.slice(1).map(url => rewriteUrl(url, mediaMap));

                // Parse tags
                const tagsStr = row['Tags'] || row['tags'] || '';
                const tags = tagsStr ? tagsStr.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

                // Parse description — clean up literal \n escape sequences
                const shortDescription = cleanDescription(row['Short description'] || row['short_description'] || '');
                const longDescription = cleanDescription(row['Description'] || row['description'] || row['post_content'] || '');

                // Parse weight — detect grams vs kg
                const weightStr = row['Weight (g)'] || row['Weight (kg)'] || row['weight'] || '';
                let weight: number | undefined;
                if (weightStr) {
                    const parsed = parseFloat(weightStr);
                    if (!isNaN(parsed)) {
                        weight = weightInGrams ? Math.round(parsed) : Math.round(parsed * 1000);
                    }
                }

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
                            // Split pipe-separated or comma-separated values
                            const values = attr.value.split(/[|,]/).map(v => v.trim());
                            for (const val of values) {
                                if (!optionMap.has(val)) {
                                    const varPrice = varRow['Regular price'] || varRow['regular_price'] || '';
                                    const varSalePrice = varRow['Sale price'] || varRow['sale_price'] || '';
                                    const varImageRaw = (varRow['Images'] || varRow['images'] || '').split(',')[0]?.trim() || '';
                                    const varImage = rewriteUrl(varImageRaw, mediaMap);
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
                    status,
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
                    sortOrder: existingProduct?.sortOrder || 0,
                    productType: "physical",
                    condition: "new",
                    createdAt: existingProduct?.createdAt || now,
                    updatedAt: now,
                };

                await db.send(new PutCommand({
                    TableName: TABLE_NAME,
                    Item: item,
                }));

                // Update CATPROD# adjacency items (delete old, write new)
                if (isUpdate && oldCategoryIds.length > 0) {
                    await deleteCatProductItems(tenantId, id, oldCategoryIds);
                }
                if (categoryIds.length > 0) {
                    await writeCatProductItems(tenantId, {
                        id, title, slug: productSlug, price: regularPrice || '0',
                        currency, salePrice: salePrice || undefined,
                        imageLink, availability, status, sortOrder: 0,
                        tags, volumePricing: [], categoryIds,
                    });
                }

                if (isUpdate) {
                    result.updated = (result.updated || 0) + 1;
                } else {
                    result.imported++;
                }
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
                drafts: result.drafts,
                mediaMapUsed: mediaMap.size,
                errors: result.errors.length > 0 ? result.errors.slice(0, 20) : undefined,
            },
            ip: event.requestContext.http.sourceIp
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Import complete: ${result.imported} products imported, ${result.categoriesCreated} categories created, ${result.skipped} skipped, ${result.drafts} drafts`,
                ...result,
            })
        };
    } catch (e: any) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
