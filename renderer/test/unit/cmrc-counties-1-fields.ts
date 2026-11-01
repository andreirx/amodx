import { fileURLToPath, URL as NodeURL } from "node:url";
import { COMMERCE_STRINGS_DEFAULTS } from "@amodx/shared";

/**
 * CMRC-COUNTIES-1 — shared by the two tests of the slice (the jsdom render test and the node-environment text test).
 * `cmrc-counties-1-before.json` holds the checkout form markup of commit 959f288 (record § 3), per state and view.
 */
// Node's URL: the jsdom test environment replaces the global `URL` with one that does not resolve file: URLs.
export const BEFORE_FILE = fileURLToPath(new NodeURL("./cmrc-counties-1-before.json", import.meta.url));
export type StateName = "ro-regions" | "configured-ro" | "configured-en" | "no-list";
export type Snapshot = { mounted: string; billingShown: string };

/** The free-text county field as jsdom serialises it (shipping and billing render the same element). */
export const FREE_TEXT = '<input required="" class="w-full border rounded-md px-3 py-2 text-sm" value="">';
/** A county <select> of the 959f288 form: the class shared by the form's selects, first option = the placeholder. */
const placeholder = COMMERCE_STRINGS_DEFAULTS.selectCounty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COUNTY_SELECT = new RegExp(`<select required="" class="w-full border rounded-md px-3 py-2 text-sm"><option value="">${placeholder}</option>(?:<option value="[^"]*">[^<]*</option>)*</select>`, "g");

/** The form markup with every county <select> replaced by the free-text input. */
export function withFreeText(html: string): string {
    return html.replace(COUNTY_SELECT, FREE_TEXT);
}
