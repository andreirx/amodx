/**
 * The content-slug normaliser shared by create and update (BACKEND-CONTRACT-1 D3).
 * Moved from `backend/src/lib/slug.ts` to `@amodx/shared` by IMPORT-POLICY-1 D2, so that the admin
 * review warning and the API apply the same rule.
 *
 * Guarantee (and only this): a slug SUPPLIED to create, and a slug supplied to update that DIFFERS
 * from the stored one, is stored in normalised form — lowercase, `[a-z0-9-/]` only, a leading `/`.
 * Before D3, update only prepended `/`, so a renamed page could be stored as `/OPN1-…` while the
 * renderer served `/opn1-…` → 404 (docs/slices/opennext-1b.md § 18).
 *
 * NOT guaranteed — stored slugs can still be non-normal:
 *  - update keeps a slug that is absent or resent unchanged (legacy pages are not renamed by an
 *    unrelated save);
 *  - the WordPress importer (import/wordpress.ts) stores raw `/${wp:post_name}` slugs and does not
 *    call this function: kept raw by decision (human, 2026-10-16, IMPORT-POLICY-1): the page keeps
 *    the URL `/<wp:post_name>` exactly as WordPress had the post name (the permalink's folder
 *    structure is not kept — ruling IP1-WARNING-TRUTH); the admin marks such slugs in red for review.
 *  - repeated leading slashes are kept (`//a` → `//a`): unchanged behaviour, ratified as is.
 *
 * Steps, in order (the order matters: whitespace becomes `-` BEFORE invalid characters are
 * stripped, so "My Page" → "my-page", not "mypage"):
 *   lowercase + trim → `[\s_]+` → `-` → strip `[^a-z0-9-/]` → collapse `-+` → strip trailing `-`
 *   → ensure leading `/`.
 *
 * Pure: no I/O. Behaviour is the former `cleanSlug` in content/create.ts, unchanged.
 */
export function normalizeSlug(raw: string): string {
    const cleaned = raw.toLowerCase().trim()
        .replace(/[\s_]+/g, '-')       // spaces & underscores → dashes FIRST
        .replace(/[^a-z0-9-\/]/g, '')  // then strip invalid chars
        .replace(/-+/g, '-')           // collapse multiple dashes
        .replace(/-+$/g, '');          // strip trailing dash
    return cleaned.startsWith('/') ? cleaned : '/' + cleaned;
}

/**
 * True when `slug` is not in the form `normalizeSlug` produces, i.e. the URL does not follow the
 * site's slug rules. A text rule only: it does not know where the slug came from (one known source
 * is the WordPress importer, which stores raw slugs). The admin marks such slugs REVIEW SLUG
 * (IMPORT-POLICY-1 D3, ruling IP1-WARNING-TRUTH). Pure.
 */
export function needsSlugReview(slug: string): boolean {
    return slug !== normalizeSlug(slug);
}
