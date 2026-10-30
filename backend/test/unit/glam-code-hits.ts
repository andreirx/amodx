/** CAT-IMPORT-1 test helper (not a test file): the § 9 code-removal oracle's search. Used by both glam test files. */
/**
 * Every string field (path included) of `values` that contains one of `codes`, except the image fields the § 9
 * exclusion names (`imageLink`, `additionalImageLinks`, options' `imageLink`).
 */
export function codeHits(values: unknown, codes: readonly string[], at = "$"): string[] {
    if (typeof values === "string") return codes.filter((c) => values.includes(c)).map((c) => `${at} ⊇ ${c}`);
    if (Array.isArray(values)) return values.flatMap((v, i) => codeHits(v, codes, `${at}[${i}]`));
    if (values && typeof values === "object") {
        return Object.entries(values).flatMap(([k, v]) =>
            k === "imageLink" || k === "additionalImageLinks" ? [] : codeHits(v, codes, `${at}.${k}`));
    }
    return [];
}
