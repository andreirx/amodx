import type { CommerceStrings } from "../index.js";

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

export interface CountryPackLegal {
    termsLabel: string;
    privacyLabel: string;
    consumerProtectionLabel?: string;
    disputeResolutionLabel?: string;
}

export interface CountryPack {
    code: string;               // ISO 3166-1 alpha-2: "RO", "DE", "US"
    name: string;               // "Romania", "Germany", "United States"
    currency: CountryPackCurrency;
    locale: string;             // BCP 47: "ro-RO", "de-DE", "en-US"
    address: CountryPackAddress;
    legal: CountryPackLegal;
    defaultStrings: Partial<CommerceStrings>;
}
