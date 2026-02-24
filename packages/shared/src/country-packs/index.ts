export type { CountryPack, CountryPackCurrency, CountryPackRegion, CountryPackAddress, CountryPackLegal } from "./types.js";
export { RO_PACK } from "./ro.js";

import { RO_PACK } from "./ro.js";
import type { CountryPack } from "./types.js";

const COUNTRY_PACKS: Record<string, CountryPack> = {
    RO: RO_PACK,
};

export function getCountryPack(code: string): CountryPack {
    return COUNTRY_PACKS[code.toUpperCase()] || COUNTRY_PACKS.RO;
}

export { COUNTRY_PACKS };
