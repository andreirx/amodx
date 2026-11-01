import type { CatalogStrings, CommerceStrings, PluralTexts, SiteStrings } from "../index.js";

/**
 * LOCALE-1 (docs/slices/locale-1.md § 2.3, § 3.2) — the texts of one language, per part of the locale table.
 * A pack holds texts only; country facts (currency, regions, phone prefix) stay in `country-packs/`.
 * A pack may lack a key: the resolver then uses the English value (§ 3.3, ruling LOCALE1-LANGUAGE = A).
 * A count key holds the texts of the pack language's plural categories (`pluralCategoriesOf`), `other` included.
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

/** A complete part: every text key holds a string; every count key its texts with `other` present (§ 16.2 item 6). */
export type CompletePart<T> = { [K in keyof T]-?: NonNullable<T[K]> extends string ? string : PluralTexts & { other: string } };

/** The English pack: complete by type, so the compiler refuses a key without an English value (§ 2.3). */
export interface CompleteLanguagePack extends LanguagePack {
    commerce: CompletePart<CommerceStrings>;
    catalog: CompletePart<CatalogStrings>;
    site: CompletePart<SiteStrings>;
}
