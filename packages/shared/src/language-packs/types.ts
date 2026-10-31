import type { CatalogStrings, CommerceStrings, SiteStrings } from "../index.js";

/**
 * LOCALE-1 (docs/slices/locale-1.md § 2.3, § 3.2) — the texts of one language, per part of the locale table.
 * A pack holds texts only; country facts (currency, regions, phone prefix) stay in `country-packs/`.
 * A pack may lack a key: the resolver then uses the English value (§ 3.3, ruling LOCALE1-LANGUAGE = A).
 */
export interface LanguagePack {
    /** The primary language subtag this pack serves (`"en"`, `"ro"`): the key of `LANGUAGE_PACKS`. */
    language: string;
    /** English name shown in the admin "Site language" select (the admin stays English). */
    name: string;
    /** The `locale` the admin writes when an owner selects this language (§ 3.5). */
    defaultLocale: string;
    commerce: Partial<CommerceStrings>;
    catalog: Partial<CatalogStrings>;
    site: Partial<SiteStrings>;
}

/** The English pack: complete by type, so the compiler refuses a key without an English value (§ 2.3). */
export interface CompleteLanguagePack extends LanguagePack {
    commerce: Required<CommerceStrings>;
    catalog: Required<CatalogStrings>;
    site: Required<SiteStrings>;
}
