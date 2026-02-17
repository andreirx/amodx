/**
 * Check if a product is currently available based on its date window.
 * Products with no dates set are always available.
 * Products with only availableFrom are available from that date onward.
 * Products with only availableUntil are available until that date.
 * Products with both are available within the window (inclusive).
 */
export function isProductAvailable(product: { availableFrom?: string; availableUntil?: string }): boolean {
    if (!product.availableFrom && !product.availableUntil) return true;

    const now = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    if (product.availableFrom && now < product.availableFrom) return false;
    if (product.availableUntil && now > product.availableUntil) return false;

    return true;
}
