/**
 * `normalizeEmail` — the platform's ONE canonical email normalizer (slice `fnd-1`).
 *
 * PD-001 makes `tenantId + normalizedEmail` the canonical customer identity key. Every
 * surface that keys on an email — commerce `CUSTOMER#` / `CUSTORDER#` / `EMAILLIMIT#`
 * items, the Cognito public-pool username `<tenantId>#<sha256hex(normalizedEmail)>`,
 * customer profile writes, appointments — MUST derive that key through this function.
 * Two normalizers that disagree by one code point silently fork one human being into
 * two accounts, and DynamoDB will never complain: the fork looks exactly like two
 * different customers. That is the failure class this module retires.
 *
 * Pure, deterministic, zero dependencies, no I/O, no environment read, no locale read.
 * It is safe in every workspace (backend Lambda, renderer server + browser bundle, admin
 * SPA, plugins, MCP) — which is the reason it lives in `@amodx/shared` and not next to
 * one consumer. Compare `cognitoUsername()`, which is deliberately renderer-server-only
 * because it needs Node `crypto` (`docs/plan-public-pool-customer-auth.md`
 * § Helper placement).
 *
 * ---------------------------------------------------------------------------------
 * ORDER OF OPERATIONS — NFKC, then trim, then lowercase. The order is load-bearing.
 * ---------------------------------------------------------------------------------
 *
 * 1. `normalize("NFKC")` — Unicode compatibility composition. This is what collapses the
 *    duplicate-identity class: composed `é` (U+00E9) and decomposed `é` (U+0065 U+0301)
 *    are different byte strings that render identically, so without NFKC they produce two
 *    `CUSTOMER#` records for one visual address. NFKC also folds fullwidth forms
 *    (`＠` U+FF20 -> `@`) and ligatures (`ﬁ` U+FB01 -> `fi`).
 *
 * 2. `trim()` — AFTER NFKC, and there is deliberately no second `trim()` before it.
 *    NFKC can *introduce* leading whitespace: the compatibility decomposition of a
 *    spacing diacritic is SPACE + combining mark (NFKC("¨" U+00A8) = U+0020 U+0308).
 *    50 code points behave this way. So `trim -> NFKC -> lowercase` — the intuitive
 *    order, and the one PD-001 and the fnd-1 slice text named before both were amended
 *    on 2026-07-28 (see PD-001 § Amendment record) — is NOT idempotent: a leading
 *    `¨` survives the trim, becomes a space, and a second pass through the function
 *    would strip it and return a different string. Idempotence is not cosmetic here; a
 *    key that changes when re-normalized is a key that can be written under one value
 *    and looked up under another. Trimming after NFKC is idempotent, and a pre-trim
 *    would be dead code: NFKC never converts a JS-whitespace code point into a
 *    non-whitespace one, so nothing that the pre-trim would remove survives the
 *    post-trim. (Both claims verified by exhaustive sweep over every code point
 *    U+0000..U+2FFFF in three positions — see the slice doc's build run.)
 *
 * 3. `toLowerCase()` — Unicode default case mapping, NOT `toLocaleLowerCase()`. Locale
 *    mapping would make the identity key depend on the ambient locale of whichever
 *    Lambda, browser or build box happened to compute it; under `tr`, ASCII `I` maps to
 *    `ı` (U+0131) and the same address would key differently per environment. Case
 *    mapping cannot reintroduce edge whitespace, so it is safe last.
 *
 * DOCUMENTED CONSEQUENCE (Turkish dotted capital I): `İ` (U+0130) lowercases under the
 * default mapping to `i` + COMBINING DOT ABOVE (U+0069 U+0307), which is NOT ASCII `i`.
 * `İSMAIL@x.com` and `ismail@x.com` are therefore DIFFERENT identities. This is accepted,
 * not a bug: the alternative is locale-dependent, and non-determinism in an identity key
 * is the worse failure. Pinned by test.
 *
 * ---------------------------------------------------------------------------------
 * ORDERING RULE FOR VALIDATION — validate the NORMALIZED form (PD-001, amended)
 * ---------------------------------------------------------------------------------
 *
 * Any email-format check (today: the `z.string().email()` fields in `OrderInputSchema`,
 * `OrderSchema`, `CustomerSchema`, `LeadSchema`, `CommentSchema.authorEmail`) MUST run on
 * the output of this function, never on the raw input. Validating raw and storing
 * normalized means the value actually persisted was never validated in the form it was
 * persisted in — and the two verdicts genuinely differ: `user＠example.com` (fullwidth
 * U+FF20) fails `.email()` raw and passes after NFKC. Pinned by test.
 *
 * Call sites are NOT yet in this order — see the migration note below. This module states
 * the rule; `fnd-2` enforces it.
 *
 * ---------------------------------------------------------------------------------
 * MIGRATION NOTE — this slice adds the primitive and migrates NOTHING (fnd-1 non-scope)
 * ---------------------------------------------------------------------------------
 *
 * The estate currently normalizes email keys inline and inconsistently: 11 lines across
 * 5 files call `.toLowerCase()` on a customer email with no `trim()` and no NFKC, and 3
 * more lines across 2 files build a `CUSTOMER#` / `CUSTORDER#` key from a completely raw
 * email (`backend/src/customers/get.ts`, `update.ts`). Nothing in this slice changes them —
 * zero call-site edits by construction, so this file cannot alter any existing key.
 * The full inventory (file:line, OBSERVED) is the input to `fnd-2` and lives in
 * `docs/slices/fnd-1-normalize-email.md` § Call-site inventory.
 *
 * WHEN fnd-2 RUNS, IT IS A KEY MIGRATION, NOT A REFACTOR: any already-persisted
 * `CUSTOMER#<email>` whose stored form differs from `normalizeEmail(email)` becomes
 * unreachable the moment its readers switch. fnd-2 must plan expand-before-contract
 * (dual-read, backfill, then contract) per `docs/VISION.md`.
 */

/**
 * Canonicalize an email address for use as an identity key.
 *
 * @param raw - Email address as supplied by a user, a session, or a stored record.
 * @returns The canonical form: NFKC-composed, whitespace-trimmed, lowercased.
 *          Idempotent: `normalizeEmail(normalizeEmail(x)) === normalizeEmail(x)`.
 *
 * This is normalization ONLY. It does not validate, and it never throws or rejects —
 * garbage in, canonical garbage out. Format checking is the caller's Zod schema, run
 * on this function's OUTPUT (see the ordering rule above).
 */
export function normalizeEmail(raw: string): string {
    return raw.normalize("NFKC").trim().toLowerCase();
}
