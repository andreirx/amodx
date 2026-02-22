/**
 * WooCommerce CSV header normalization.
 * Maps non-English (Romanian, etc.) column headers to their English equivalents.
 * Used client-side to detect and confirm header mappings before sending to the backend.
 */

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


function normalizeHeaderDynamic(header: string): string | null {
    // Dynamic attribute columns
    let m = header.match(/^Nume atribut (\d+)$/);
    if (m) return `Attribute ${m[1]} name`;

    m = header.match(/^Valoare \(valori\) atribut (\d+)$/);
    if (m) return `Attribute ${m[1]} value(s)`;

    m = header.match(/^Vizibilitate atribut (\d+)$/);
    if (m) return `Attribute ${m[1]} visible`;

    m = header.match(/^Atribut (\d+) global$/);
    if (m) return `Attribute ${m[1]} global`;

    return null;
}

export interface HeaderMapping {
    original: string;
    mapped: string;
}

/**
 * Detect non-English CSV headers and return the mapping.
 * Returns null if all headers are already English (no confirmation needed).
 * Returns the mapping array if any header needed translation.
 */
export function detectHeaderMappings(csvFirstLine: string): HeaderMapping[] | null {
    // Strip BOM
    let line = csvFirstLine;
    if (line.charCodeAt(0) === 0xFEFF) line = line.slice(1);

    // Simple CSV header parse (first line only, headers shouldn't have commas in values usually)
    const headers = parseCSVLineSimple(line);

    const mappings: HeaderMapping[] = [];
    let hasMismatch = false;

    for (const h of headers) {
        const trimmed = h.trim();
        if (!trimmed) continue;

        // Check static map
        if (COLUMN_MAP[trimmed]) {
            mappings.push({ original: trimmed, mapped: COLUMN_MAP[trimmed] });
            hasMismatch = true;
            continue;
        }

        // Check dynamic attribute patterns
        const dynamic = normalizeHeaderDynamic(trimmed);
        if (dynamic) {
            mappings.push({ original: trimmed, mapped: dynamic });
            hasMismatch = true;
            continue;
        }

        // Check if it starts with "Attribute" (already English attribute)
        if (trimmed.startsWith("Attribute")) {
            mappings.push({ original: trimmed, mapped: trimmed });
            continue;
        }

        // Known English or unknown — pass through
        mappings.push({ original: trimmed, mapped: trimmed });
    }

    return hasMismatch ? mappings : null;
}

function parseCSVLineSimple(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
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
