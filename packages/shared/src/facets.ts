// CAT-FACETS-1 — storefront filters of a catalog site (spec docs/slices/cat-facets-1.md §§ 2, 4, 5.1, amended by
// § 12 and § 13 "CF1-FACET-SET-2"). PURE: no I/O, no React, no Next. Moved from `renderer/src/lib/facets.ts` to this
// package by CAT-IMPORT-PROFILE-1B (ruling CIP1-PREVIEW = A) so the admin's import preview (slice 1c) builds the panel
// with the same function as the site. Users: the catalog category and shop branches of
// `renderer/src/components/SitePage.tsx`; tests `test/facets.test.ts`, `test/facet-modes.test.ts` and the 1b golden.
//
// What this module decides, from the base set (the page's products before any facet filter) and the raw `f` string:
//   - the facet set (§ 13): the producer (`brand`), the variant option values, then every `attributes` key that passes
//     the repeat rule — a data-driven list, rebuilt per base set; no registry, no fixed table of keys;
//   - the URL identity of each facet (operator ruling 2 on review-0): `producator` and `varianta` name the two fixed
//     facets; attribute key `k` is ALWAYS written `a.k`. No attribute key can be read as a fixed facet, and every
//     attribute key — `producator` and `varianta` included — is a facet of its own;
//   - the selection (§ 4.4, total parse) and its canonical URL form (§ 5.1). A selected attribute key is applied and
//     shown whether or not it is offered on this base set (operator ruling 1 on review-0: § 13 governs only which keys
//     are OFFERED; § 2.3 / § 4.3 keep every selection visible and removable);
//   - the filtered list (§ 4.1: OR within a facet, AND across facets), the disjunctive counts, which facets are shown
//     (§ 2.3) and which values are links, disabled, or blocked by the URL budget (§ 5.1);
//   - every href the filter panel emits, each measured in UTF-8 bytes on its final string (§ 5.1 invariant);
//   - the filter modes a product carries (`facetModes`, written by the importer from the producer's import profile;
//     docs/slices/cat-import-profile-1.md § 2.6, ruling CIP1-FILTER-PRECEDENCE = S-A with N2). See `modesOf` and
//     `facetDefs`. A base set in which no product carries `facetModes` gives exactly the pre-1b result (1b golden).

/** The URL inner key of the producer facet (`brand`). */
export const PRODUCER_FACET = "producator";
/** The URL inner key of the variant-values facet (`variants[].options[].value`). */
export const VARIANT_FACET = "varianta";
/** The URL inner key of attribute `k` is this prefix + `k` (`a.colecție`). Neither fixed id starts with it. */
export const ATTRIBUTE_FACET_PREFIX = "a.";

/** The facet id (URL inner key) of the `attributes` key `key`. */
export function attributeFacetId(key: string): string {
    return ATTRIBUTE_FACET_PREFIX + key;
}

/** The `attributes` key an attribute facet id names, or `null` when `id` is not an attribute facet id. */
function attributeKeyOf(id: string): string | null {
    return id.startsWith(ATTRIBUTE_FACET_PREFIX) && id.length > ATTRIBUTE_FACET_PREFIX.length ? id.slice(ATTRIBUTE_FACET_PREFIX.length) : null;
}

/** § 4.4 step 3: the facet ids — the two fixed ids and every `a.<non-empty key>`. Independent of the base set. */
export function isFacetId(id: string): boolean {
    return id === PRODUCER_FACET || id === VARIANT_FACET || attributeKeyOf(id) !== null;
}

/** § 5.1: no emitted href is longer than this, in UTF-8 bytes. */
export const HREF_BUDGET = 6144;
/** § 5.1: the bytes kept free for a pager suffix (`&page=` + up to 10 digits). */
export const PAGE_RESERVE = 16;
/** § 13 repeat rule (iii): an attribute key with more distinct values than this is not a facet. */
export const MAX_ATTRIBUTE_VALUES = 40;
/** § 13 repeat rule (i) and (ii): the minimum number of products that hold the key, and its most frequent value. */
export const MIN_HOLDERS = 2;

const PRODUCER_LABEL = "Producător";
const DEFAULT_VARIANT_LABEL = "Variantă";

/** The fields of a product item this module reads. Anything else on the item is passed through untouched. */
export type FacetProduct = {
    brand?: unknown;
    attributes?: unknown;
    variants?: unknown;
    /** `FacetModesSchema` as stored; read tolerantly (`modesOf`): anything this module does not know = automatic. */
    facetModes?: unknown;
};

/** Facet id → the selected values. A key with an empty set is not a selection. */
export type Selection = Map<string, Set<string>>;

/**
 * One value row of a shown facet. Exclusive states:
 *   - `selected`: the value is selected; `href` removes it (`null` only if the measured guard refused the link — it
 *     cannot happen on an accepted selection, § 5.1 "Consequence for an accepted selection");
 *   - `link`: selecting it is possible; `href` adds it;
 *   - `zero`: no product would match (disabled, "(0)");
 *   - `too-long`: the selection it leads to does not fit the URL budget (disabled, with the hint).
 */
export type FacetValueView =
    | { state: "selected"; value: string; count: number; href: string | null }
    | { state: "link"; value: string; count: number; href: string }
    | { state: "zero"; value: string; count: 0 }
    | { state: "too-long"; value: string; count: number };

export type FacetView = { id: string; label: string; values: FacetValueView[] };

/** A removable selection chip above the facets. */
export type SelectionChip = { facetLabel: string; value: string; href: string | null };

export type FacetListing<P> = {
    /** The base set after the applied selection, in base order (not paginated). */
    items: P[];
    /** The selection that was applied (every facet id of the parse, offered or not); empty when `tooLong`. */
    selection: Selection;
    /** True when the incoming selection did not fit the URL budget and was NOT applied (§ 5.1 acceptance rule). */
    tooLong: boolean;
    /** The shown facets, in § 13 order. */
    facets: FacetView[];
    chips: SelectionChip[];
    /** The bare path ("Șterge filtrele"); `null` only if the path alone exceeds the budget. */
    clearHref: string | null;
    /** True when some value is disabled because of the URL budget (the panel shows the hint once). */
    budgetHint: boolean;
};

// ── value order (§ 2.3) ─────────────────────────────────────────────────────────────────────────────────────────

// `new Intl.Collator("ro", { numeric: true }).compare` is what `a.localeCompare(b, "ro", { numeric: true })`
// computes (ECMA-402: localeCompare with locales/options behaves as a Collator built from them); built once here.
const collator = new Intl.Collator("ro", { numeric: true });

/** § 2.3: a total order. Numeric-aware Romanian collation, ties broken by UTF-16 code-unit order. */
export function compareValues(a: string, b: string): number {
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

// ── values of one product ──────────────────────────────────────────────────────────────────────────────────────

/**
 * § 2.3 amended (§ 12 amendment 1): a label of the FORM `#<digits>` is not a facet value. A check of the form only —
 * the stored item does not record whether the importer generated the label or read it from the file.
 */
export function matchesGeneratedLabelForm(value: string): boolean {
    return /^#\d+$/.test(value);
}

function nonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v !== "";
}

function attributesOf(p: FacetProduct): { key: string; value: string }[] {
    if (!Array.isArray(p.attributes)) return [];
    const out: { key: string; value: string }[] = [];
    for (const a of p.attributes) {
        if (a && typeof a === "object" && nonEmptyString((a as any).key) && nonEmptyString((a as any).value)) {
            out.push({ key: (a as any).key, value: (a as any).value });
        }
    }
    return out;
}

/** The variant groups that have at least one option, as stored. */
function optionGroupsOf(p: FacetProduct): { name: unknown; values: string[] }[] {
    if (!Array.isArray(p.variants)) return [];
    const out: { name: unknown; values: string[] }[] = [];
    for (const g of p.variants) {
        const options = g && typeof g === "object" && Array.isArray((g as any).options) ? (g as any).options : [];
        if (options.length === 0) continue;
        out.push({ name: (g as any).name, values: options.map((o: any) => o?.value).filter(nonEmptyString) });
    }
    return out;
}

/**
 * Every facet value of one product: facet id → its set of values. The producer and variant facets always appear
 * as keys (possibly with an empty set); an attribute facet `a.<key>` appears only when the product holds a non-empty
 * value for `key`. Every attribute key counts, whatever its name.
 */
export function facetValuesOf(p: FacetProduct): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    out.set(PRODUCER_FACET, new Set(nonEmptyString(p.brand) ? [p.brand] : []));
    const variant = new Set<string>();
    for (const g of optionGroupsOf(p)) for (const v of g.values) if (!matchesGeneratedLabelForm(v)) variant.add(v);
    out.set(VARIANT_FACET, variant);
    for (const { key, value } of attributesOf(p)) {
        const id = attributeFacetId(key);
        let set = out.get(id);
        if (!set) out.set(id, (set = new Set()));
        set.add(value);
    }
    return out;
}

// ── filter modes of one product (cat-import-profile-1 § 2.6, ruling S-A with N2) ─────────────────────────────────

/** The mode one product gives one attribute key. Absent = automatic (the repeat rule decides). */
type AttributeMode = "always" | "never";

/**
 * The filter modes one product carries, read from its stored `facetModes`:
 *   - `silentVariant`: `variant` is exactly "never";
 *   - `attributes`: attribute key → its mode, for the FIRST entry of each key (the importer writes each key once,
 *     `checkProfile`); an entry whose mode is not "always" / "never" is automatic (§ 3.3 item 6: a value written by a
 *     newer importer is treated as absent), and so is everything that is not the stored shape.
 * The failure direction of every tolerance here is presentation only: a facet may be offered that the profile hid.
 */
function modesOf(p: FacetProduct): { silentVariant: boolean; attributes: Map<string, AttributeMode> } {
    const attributes = new Map<string, AttributeMode>();
    const fm = p.facetModes;
    if (!fm || typeof fm !== "object") return { silentVariant: false, attributes };
    const entries = (fm as any).attributes;
    if (Array.isArray(entries)) {
        const seen = new Set<string>();
        for (const e of entries) {
            const key = e && typeof e === "object" ? (e as any).key : undefined;
            if (!nonEmptyString(key) || seen.has(key)) continue;
            seen.add(key);
            const mode = (e as any).mode;
            if (mode === "always" || mode === "never") attributes.set(key, mode);
        }
    }
    return { silentVariant: (fm as any).variant === "never", attributes };
}

type Modes = ReturnType<typeof modesOf>;

/**
 * A SILENT holder of facet `id` (§ 2.6): a product that marks the facet `never` — attribute `k` with mode "never", or
 * the variant facet with `variant: "never"`. The producer facet has no mode. Under N2 a silent holder's values do not
 * count toward the offer and are not listed; they still match a selection and still count in the listed values.
 */
function isSilent(modes: Modes, id: string): boolean {
    if (id === VARIANT_FACET) return modes.silentVariant;
    const key = attributeKeyOf(id);
    return key !== null && modes.attributes.get(key) === "never";
}

// ── the facet set (§ 13) ───────────────────────────────────────────────────────────────────────────────────────

/** § 4.5: the variant heading — the one group name every product with options shares, else "Variantă". */
function variantLabel(base: FacetProduct[]): string {
    const names = new Set<unknown>();
    for (const p of base) for (const g of optionGroupsOf(p)) names.add(g.name);
    const [only] = names;
    return names.size === 1 && nonEmptyString(only) ? only : DEFAULT_VARIANT_LABEL;
}

/**
 * One facet the panel may render. `offered` = its values may be ADDED to the selection: always true for the producer
 * and variant facets; for an attribute key, true when it is offered on this base set (`facetDefs`). A selected
 * attribute key that is not offered is still rendered, with its selected values only (operator ruling 1).
 */
type FacetDef = { id: string; label: string; offered: boolean };

/**
 * The facets of this base set and selection, in § 13 order: producer, variant values, then the attribute facets —
 * every OFFERED key and every selected attribute key — by number of holders (descending; EVERY holder, silent ones
 * included — the modes do not change the order), ties by `compareValues` on the key. Label of an attribute facet =
 * the key as stored.
 *
 * Attribute key `k` is OFFERED (cat-import-profile-1 § 2.6, N2) when, counting only the products that do not mark `k`
 * "never" (its non-silent holders):
 *   - some of them marks `k` "always" — whatever the repeat rule gives; or
 *   - `k` passes the § 13 repeat rule: (i) ≥ 2 of them hold it, (ii) its most frequent value is held by ≥ 2 of them,
 *     (iii) it has ≤ 40 distinct values among them.
 * The modes change only what § 2.6 names — the offer and the listed values; everything else (order, labels, matching,
 * counts) is computed over every product, as before. With no `facetModes` on any product, every holder is non-silent
 * and nothing is "always": the pre-1b rule.
 */
function facetDefs(base: FacetProduct[], valuesOf: Map<string, Set<string>>[], modes: Modes[], selection: Selection): FacetDef[] {
    const holders = new Map<string, number>();              // every holder: the § 13 order
    const offerHolders = new Map<string, number>();         // non-silent holders: the offer
    const valueHolders = new Map<string, Map<string, number>>();   // non-silent holders per value: the offer
    const always = new Set<string>();
    valuesOf.forEach((values, i) => {
        for (const [id, set] of values) {
            const key = attributeKeyOf(id);
            if (key === null || set.size === 0) continue;
            holders.set(id, (holders.get(id) ?? 0) + 1);
            if (isSilent(modes[i], id)) continue;
            if (modes[i].attributes.get(key) === "always") always.add(id);
            offerHolders.set(id, (offerHolders.get(id) ?? 0) + 1);
            let byValue = valueHolders.get(id);
            if (!byValue) valueHolders.set(id, (byValue = new Map()));
            for (const v of set) byValue.set(v, (byValue.get(v) ?? 0) + 1);
        }
    });
    const passesRepeatRule = (id: string) => {
        const byValue = valueHolders.get(id);
        if (!byValue) return false;
        // (i) is implied by (ii) — a value held by ≥ 2 products means ≥ 2 holders; kept so the code reads as the rule.
        return offerHolders.get(id)! >= MIN_HOLDERS
            && Math.max(...byValue.values()) >= MIN_HOLDERS
            && byValue.size <= MAX_ATTRIBUTE_VALUES;
    };
    const isOffered = (id: string) => always.has(id) || passesRepeatRule(id);
    const ids = new Set([...holders.keys()].filter(isOffered));
    for (const id of selection.keys()) if (attributeKeyOf(id) !== null) ids.add(id);
    const attributeIds = [...ids].sort((a, b) => (holders.get(b) ?? 0) - (holders.get(a) ?? 0) || compareValues(attributeKeyOf(a)!, attributeKeyOf(b)!));
    return [
        { id: PRODUCER_FACET, label: PRODUCER_LABEL, offered: true },
        { id: VARIANT_FACET, label: variantLabel(base), offered: true },
        ...attributeIds.map((id) => ({ id, label: attributeKeyOf(id)!, offered: isOffered(id) })),
    ];
}

// ── the URL form (§ 4.4, § 5.1) ────────────────────────────────────────────────────────────────────────────────

/**
 * § 4.4, total: defined for every string, never throws. WHATWG form decoding (`URLSearchParams`); a pair whose key is
 * not a facet id (`isFacetId`: `producator`, `varianta`, `a.<key>`) is dropped — this covers `""`, `"%zz"` and every
 * unknown key; a pair with an empty value is dropped; repeated pairs collapse.
 */
export function parseSelection(f: string | undefined): Selection {
    const sel: Selection = new Map();
    if (!f) return sel;
    for (const [key, value] of new URLSearchParams(f)) {
        if (!isFacetId(key) || value === "") continue;
        let set = sel.get(key);
        if (!set) sel.set(key, (set = new Set()));
        set.add(value);
    }
    return sel;
}

/** The canonical key order: producer, variant, then the attribute ids by `compareValues`. Independent of the base set. */
function compareFacetIds(a: string, b: string): number {
    const rank = (id: string) => (id === PRODUCER_FACET ? 0 : id === VARIANT_FACET ? 1 : 2);
    return rank(a) - rank(b) || compareValues(a, b);
}

/** § 5.1 canonical form: keys in canonical order, values by `compareValues`, each pair once; "" for no selection. */
export function formatSelection(sel: Selection): string {
    const out = new URLSearchParams();
    for (const key of [...sel.keys()].sort(compareFacetIds)) {
        for (const value of [...sel.get(key)!].sort(compareValues)) out.append(key, value);
    }
    return out.toString();
}

export function utf8Bytes(s: string): number {
    return new TextEncoder().encode(s).length;
}

/** § 5.1 `href(p, s, n)`: the path, `?f=<canonical>` when `s` is not empty, then `page=<n>` when `n > 1`. */
export function listingHref(path: string, sel: Selection, page = 1): string {
    const inner = formatSelection(sel);
    const base = inner ? `${path}?f=${encodeURIComponent(inner)}` : path;
    return page > 1 ? `${base}${inner ? "&" : "?"}page=${page}` : base;
}

/** § 5.1: a selection FITS on `path` when its page-1 href plus the pager reserve is within the budget. */
export function selectionFits(path: string, sel: Selection): boolean {
    return utf8Bytes(listingHref(path, sel)) + PAGE_RESERVE <= HREF_BUDGET;
}

/** The measured guard: the href when it is within the budget, else `null`. */
function withinBudget(href: string): string | null {
    return utf8Bytes(href) <= HREF_BUDGET ? href : null;
}

function withValue(sel: Selection, id: string, value: string): Selection {
    const next: Selection = new Map([...sel].map(([k, v]) => [k, new Set(v)]));
    let set = next.get(id);
    if (!set) next.set(id, (set = new Set()));
    set.add(value);
    return next;
}

function withoutValue(sel: Selection, id: string, value: string): Selection {
    const next: Selection = new Map();
    for (const [k, v] of sel) {
        const set = new Set(v);
        if (k === id) set.delete(value);
        if (set.size > 0) next.set(k, set);
    }
    return next;
}

// ── filtering, counts, visibility (§ 2.3, § 4.1) ───────────────────────────────────────────────────────────────

function holdsAny(values: Map<string, Set<string>>, id: string, wanted: Set<string>): boolean {
    const held = values.get(id);
    if (!held) return false;
    for (const v of wanted) if (held.has(v)) return true;
    return false;
}

/** True when the product matches every facet selection except the one of `exceptId` (OR within, AND across). */
function matches(values: Map<string, Set<string>>, sel: Selection, exceptId: string | null): boolean {
    for (const [id, wanted] of sel) {
        if (id !== exceptId && !holdsAny(values, id, wanted)) return false;
    }
    return true;
}

/**
 * Everything the filter panel and the listing need, from the base set, the raw `f` and the page path (`path` is the
 * path every href starts with, including any `basePath`).
 *
 * Counts are disjunctive (§ 4.1): count(F, v) = products of the base set that match every active selection of the
 * OTHER facets and hold v. A facet is shown iff it has a selection, or some LISTED value is held by at least one but
 * not all products of the base set (§ 2.3). A selected value is always listed (a stale one with count 0, § 4.3).
 *
 * Filter modes (cat-import-profile-1 § 2.6, N2): an offered facet lists the values of its NON-SILENT holders (plus the
 * selected values); a silent holder's values are not listed, but every product — silent or not — matches a selection
 * and counts in the listed values' counts. So a selected value lists every product that shows it on its page.
 */
export function buildFacetListing<P extends FacetProduct>(base: P[], f: string | undefined, path: string): FacetListing<P> {
    const valuesOf = base.map(facetValuesOf);
    const modes = base.map(modesOf);

    // Every facet id of the parse is kept, offered on this base set or not (operator ruling 1 on review-0).
    let selection = parseSelection(f);
    // § 5.1 acceptance rule: judged on the CANONICAL href of the selection, never on the incoming URL.
    const tooLong = selection.size > 0 && !selectionFits(path, selection);
    if (tooLong) selection = new Map();

    const items: P[] = [];
    base.forEach((p, i) => { if (matches(valuesOf[i], selection, null)) items.push(p); });

    const defs = facetDefs(base, valuesOf, modes, selection);
    const labelOf = new Map(defs.map((d) => [d.id, d.label]));
    let budgetHint = false;
    const facets: FacetView[] = [];
    for (const def of defs) {
        const baseHolders = new Map<string, number>();
        const counts = new Map<string, number>();
        const nonSilentValues = new Set<string>();     // the values an offer lists: those of the non-silent holders
        valuesOf.forEach((values, i) => {
            const held = values.get(def.id);
            if (!held) return;
            const counted = matches(valuesOf[i], selection, def.id);
            const silent = isSilent(modes[i], def.id);
            for (const v of held) {
                baseHolders.set(v, (baseHolders.get(v) ?? 0) + 1);
                if (counted) counts.set(v, (counts.get(v) ?? 0) + 1);
                if (!silent) nonSilentValues.add(v);
            }
        });
        const selected = selection.get(def.id) ?? new Set<string>();
        // § 2.3 over the listed values: selecting v lists every holder of v, silent ones included (N2).
        const narrows = [...nonSilentValues].some((v) => baseHolders.get(v)! < base.length);
        if (selected.size === 0 && !narrows) continue;

        // A facet that is not offered lists only its selected values: nothing can be added to it.
        const listed = def.offered ? [...new Set([...nonSilentValues, ...selected])] : [...selected];
        const values: FacetValueView[] = listed.sort(compareValues).map((value) => {
            const count = counts.get(value) ?? 0;
            if (selected.has(value)) return { state: "selected", value, count, href: withinBudget(listingHref(path, withoutValue(selection, def.id, value))) };
            if (count === 0) return { state: "zero", value, count: 0 };
            const next = withValue(selection, def.id, value);
            if (!selectionFits(path, next)) {
                budgetHint = true;
                return { state: "too-long", value, count };
            }
            return { state: "link", value, count, href: listingHref(path, next) };
        });
        facets.push({ id: def.id, label: def.label, values });
    }

    const chips: SelectionChip[] = [];
    for (const id of [...selection.keys()].sort(compareFacetIds)) {
        for (const value of [...selection.get(id)!].sort(compareValues)) {
            chips.push({ facetLabel: labelOf.get(id)!, value, href: withinBudget(listingHref(path, withoutValue(selection, id, value))) });
        }
    }

    return { items, selection, tooLong, facets, chips, clearHref: withinBudget(path), budgetHint };
}
