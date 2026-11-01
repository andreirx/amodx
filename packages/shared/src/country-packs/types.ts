export interface CountryPackCurrency {
    code: string;           // ISO 4217: "RON", "EUR", "USD"
    symbol: string;         // "lei", "€", "$"
    position: "before" | "after";
    decimals: number;
}

export interface CountryPackRegion {
    code: string;           // "AB", "AR", "B", etc.
    name: string;           // "Alba", "Arad", "București"
}

export interface CountryPackAddress {
    regions: CountryPackRegion[];
    regionLabel: string;        // "County", "State", "Județ"
    postalCodeLabel: string;    // "Postal Code", "ZIP Code", "Cod Poștal"
    postalCodeFormat?: string;  // regex string
    phonePrefix: string;        // "+40", "+49", "+1"
    phoneFormat?: string;       // "07XX XXX XXX"
}

/**
 * The facts of one country: currency, the default locale, regions and address formats. LOCALE-1D
 * (docs/slices/locale-1.md § 3.2 item 2, § 10.2): the text members (the commerce default texts, the cookie banner
 * texts and the legal link labels) were removed — visitor texts live in the language packs (`../language-packs/`),
 * selected by the tenant's `locale`, never by its country. `address.regionLabel` / `postalCodeLabel` are not read by
 * any renderer or admin code (kept: not named by § 10.2).
 */
export interface CountryPack {
    code: string;               // ISO 3166-1 alpha-2: "RO", "DE", "US"
    name: string;               // "Romania", "Germany", "United States"
    currency: CountryPackCurrency;
    locale: string;             // BCP 47: "ro-RO", "de-DE", "en-US"
    address: CountryPackAddress;
}
