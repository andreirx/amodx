export type { CountryPack, CountryPackCurrency, CountryPackRegion, CountryPackAddress, CountryPackLegal, CountryPackGdpr } from "./types.js";
export { EN_PACK } from "./en.js";
export { RO_PACK } from "./ro.js";

import { EN_PACK } from "./en.js";
import { RO_PACK } from "./ro.js";
import type { CountryPack } from "./types.js";

const COUNTRY_PACKS: Record<string, CountryPack> = {
    EN: EN_PACK,
    RO: RO_PACK,
};

export function getCountryPack(code: string): CountryPack {
    return COUNTRY_PACKS[code.toUpperCase()] || COUNTRY_PACKS.RO;
}

export { COUNTRY_PACKS };
