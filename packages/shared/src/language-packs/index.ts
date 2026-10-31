export type { LanguagePack, CompleteLanguagePack } from "./types.js";
export { EN_LANGUAGE_PACK } from "./en.js";
export { RO_LANGUAGE_PACK } from "./ro.js";

import { EN_LANGUAGE_PACK } from "./en.js";
import { RO_LANGUAGE_PACK } from "./ro.js";
import type { LanguagePack } from "./types.js";

/**
 * LOCALE-1 — the registry of language packs, keyed by primary language subtag (docs/slices/locale-1.md § 3.3).
 * Adding a language = one pack file + one entry here (ruling LOCALE1-LANGUAGE = A, § 16.2 item 3); the resolver and
 * the admin "Site language" select read this object and need no other change. A language without an entry gets
 * English texts. `en` must stay: it is layer 1 of every resolution.
 */
export const LANGUAGE_PACKS: Record<string, LanguagePack> = {
    en: EN_LANGUAGE_PACK,
    ro: RO_LANGUAGE_PACK,
};
