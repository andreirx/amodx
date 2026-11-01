import type { CountryPack } from "./types.js";

export const EN_PACK: CountryPack = {
    code: "EN",
    name: "English (Default)",
    currency: {
        code: "USD",
        symbol: "$",
        position: "before",
        decimals: 2,
    },
    locale: "en-US",
    address: {
        regions: [],
        regionLabel: "State / Region",
        postalCodeLabel: "Postal Code",
        phonePrefix: "+1",
        phoneFormat: "(XXX) XXX-XXXX",
    },
};
