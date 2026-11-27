// Settings page: the Navbar & Layout card: header and page widths, heights, the header and footer controls.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SettingsDraft } from "./draft";
import { ColorInput } from "./ColorInput";

/** The width choices of the header and of the footer (the footer adds "Same as header"); 1440 and 1600 added by
 *  CAT-THEME-1 (1920 was already offered). The renderer compiles the three wide classes (`renderer/src/lib/widths.ts`). */
export const HEADER_WIDTH_OPTIONS: [string, string][] = [
    ["max-w-5xl", "5xl (1024px)"], ["max-w-6xl", "6xl (1152px)"], ["max-w-7xl", "7xl (1280px)"],
    ["max-w-screen-xl", "Screen XL (1280px)"], ["max-w-[1440px]", "1440px"], ["max-w-screen-2xl", "Screen 2XL (1536px)"],
    ["max-w-[1600px]", "1600px"], ["max-w-[1700px]", "Custom 1700px"], ["max-w-[1920px]", "Full HD (1920px)"], ["max-w-full", "Full Width"],
];
/** The content-page width choices; 1440, 1600 and 1920 added by CAT-THEME-1. */
export const PAGE_WIDTH_OPTIONS: [string, string][] = [
    ["max-w-2xl", "2xl (672px)"], ["max-w-3xl", "3xl (768px)"], ["max-w-4xl", "4xl (896px)"], ["max-w-5xl", "5xl (1024px)"],
    ["max-w-6xl", "6xl (1152px)"], ["max-w-7xl", "7xl (1280px)"], ["max-w-[1440px]", "1440px"], ["max-w-[1600px]", "1600px"], ["max-w-[1920px]", "1920px"],
];

/** SHOP-LOOK-1A: a value the settings store; "" and an empty list mean "remove the key" (never stored as "" or []). */
const isStored = (value: unknown) => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
type FooterDraft = NonNullable<SettingsDraft["footer"]>;

/**
 * The draft's `footer` with one key set, or removed when `value` is empty ("" or, SHOP-LOOK-1A, an empty list); the other
 * footer keys are kept (BULK-PURGE-FOOTER-1: the width and the two colours share the `footer` attribute; SHOP-LOOK-1A:
 * the brand text and the named columns too).
 */
export function withFooterKey<K extends "contentMaxWidth" | "backgroundColor" | "textColor" | "brandText" | "columns">(config: SettingsDraft, key: K, value: FooterDraft[K] | ""): SettingsDraft {
    const footer: FooterDraft = { ...config.footer };
    if (isStored(value)) footer[key] = value as FooterDraft[K];
    else delete footer[key];
    return { ...config, footer };
}

/** Navbar & Layout card: the footer's own width (`footer.contentMaxWidth`); "Same as header" removes it. */
export function FooterWidthControl({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <div className="pt-4 border-t space-y-2">
            <Label>Footer Width</Label>
            <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={config.footer?.contentMaxWidth || ""}
                    onChange={e => setConfig(withFooterKey(config, "contentMaxWidth", e.target.value))}>
                <option value="">Same as header</option>
                {HEADER_WIDTH_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
        </div>
    );
}

/**
 * BULK-PURGE-FOOTER-1 — Navbar & Layout card, after the footer width: the footer's background and text colour
 * (`footer.backgroundColor`, `footer.textColor`), the palette's colour input; empty = the theme's colours. One value for
 * the light and the dark theme. The renderer applies them to the footer only (`app/[siteId]/layout.tsx`).
 */
export function FooterColorControls({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <div className="space-y-2">
            <Label>Footer Colours</Label>
            <ColorInput label="Background" value={config.footer?.backgroundColor} onChange={v => setConfig(withFooterKey(config, "backgroundColor", v))} />
            <ColorInput label="Text" value={config.footer?.textColor} onChange={v => setConfig(withFooterKey(config, "textColor", v))} />
            <p className="text-[10px] text-muted-foreground">Empty = theme default (light and dark).</p>
        </div>
    );
}

/**
 * The draft's `header` with one key set, or removed when `value` is empty ("" or an empty list); the other header keys are
 * kept. HEADER-COLOURS-1: the two colours; SHOP-LOOK-1A: `tagline` and `categoryBarIds`. Beside `withFooterKey` rather
 * than shared with it: one generic helper would mean renaming that export and its tests for four lines of logic.
 */
export function withHeaderKey<K extends "backgroundColor" | "textColor" | "tagline" | "categoryBarIds">(config: SettingsDraft, key: K, value: NonNullable<SettingsDraft["header"]>[K] | ""): SettingsDraft {
    const header: Partial<NonNullable<SettingsDraft["header"]>> = { ...config.header };
    if (isStored(value)) header[key] = value as NonNullable<SettingsDraft["header"]>[K];
    else delete header[key];
    // A tenant record that never stored a `header` gives a header with only this key, as `updateHeader` already does for
    // its keys; the renderer reads each absent key as the Navbar's default (`showLogo` true, `navHeight` "h-16", …).
    return { ...config, header: header as NonNullable<SettingsDraft["header"]> };
}

/**
 * HEADER-COLOURS-1 — Navbar & Layout card, before the footer groups: the navbar's background and text colour
 * (`header.backgroundColor`, `header.textColor`), the palette's colour input; empty = the theme's colours. One value for
 * the light and the dark theme. The renderer applies them to the navbar and its dropdown and mobile panels only, not to
 * the Top Bar, the Commerce Bar or the Search Bar (`app/[siteId]/layout.tsx#headerColorStyle`).
 */
export function HeaderColorControls({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <div className="pt-4 border-t space-y-2">
            <Label>Header Colours</Label>
            <ColorInput label="Background" value={config.header?.backgroundColor} onChange={v => setConfig(withHeaderKey(config, "backgroundColor", v))} />
            <ColorInput label="Text" value={config.header?.textColor} onChange={v => setConfig(withHeaderKey(config, "textColor", v))} />
            <p className="text-[10px] text-muted-foreground">Empty = theme default (light and dark).</p>
        </div>
    );
}

/** SHOP-LOOK-1A: one category as GET /categories lists it, for the category bar picker. */
export type CategoryOption = { id: string; name: string; status?: string };

/**
 * SHOP-LOOK-1A (docs/slices/shop-look-1.md § 3 rows "1 row 1" and "1 row 2"; SHOPLOOK-CATBAR = C) — Navbar & Layout card,
 * first in the header and footer slot: the tagline (`header.tagline`) and the category bar (`header.categoryBarIds`:
 * pick, order, remove; up to 12). `categories` = the tenant's categories (GET /categories), `null` until they are loaded;
 * a stored id is then shown as is. The renderer reads each category's name and slug at render time and skips a hidden or
 * missing one. Clearing the tagline or removing the last category removes the key. Native elements, `Input` and `Button`
 * only (no React `useId`), so the card's other ids are unchanged.
 */
export function HeaderTaglineAndCategoryBarControls({ config, setConfig, categories }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void; categories: CategoryOption[] | null }) {
    const ids = config.header?.categoryBarIds ?? [];
    const byId = new Map((categories ?? []).map((c) => [c.id, c]));
    const available = (categories ?? []).filter((c) => !ids.includes(c.id));
    const setIds = (next: string[]) => setConfig(withHeaderKey(config, "categoryBarIds", next));
    const swap = (i: number, j: number) => { const next = [...ids]; [next[i], next[j]] = [next[j], next[i]]; setIds(next); };
    const nameOf = (id: string) => {
        const category = byId.get(id);
        if (category) return category.status === "hidden" ? `${category.name} (hidden: skipped on the site)` : category.name;
        return categories ? `${id} (not found: skipped on the site)` : id;
    };
    return (
        <div className="pt-4 border-t space-y-2">
            <Label>Tagline</Label>
            <Input value={config.header?.tagline || ""} maxLength={60} placeholder="e.g. Since 1998"
                   onChange={e => setConfig(withHeaderKey(config, "tagline", e.target.value.trim() ? e.target.value : ""))} />
            <p className="text-[10px] text-muted-foreground">A short text beside the logo or site name, up to 60 characters. Hidden on phones. Empty = none.</p>
            <Label>Category Bar</Label>
            {ids.map((id, i) => (
                <div key={id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{nameOf(id)}</span>
                    <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => swap(i, i - 1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === ids.length - 1} onClick={() => swap(i, i + 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setIds(ids.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
            ))}
            <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value=""
                    disabled={categories === null || ids.length >= 12 || available.length === 0}
                    onChange={e => { if (e.target.value) setIds([...ids, e.target.value]); }}>
                <option value="">{categories === null ? "Categories not loaded" : ids.length >= 12 ? "12 categories is the limit" : available.length === 0 ? "No other category" : "Add a category…"}</option>
                {available.map(c => <option key={c.id} value={c.id}>{c.status === "hidden" ? `${c.name} (hidden)` : c.name}</option>)}
            </select>
            <p className="text-[10px] text-muted-foreground">A second header row of category links, in this order, up to 12. A hidden or deleted category is skipped. Empty = no second row.</p>
        </div>
    );
}

/**
 * SHOP-LOOK-1A (docs/slices/shop-look-1.md § 3 row 10) — Navbar & Layout card, last in the header and footer slot: the
 * footer's brand text (`footer.brandText`, up to 400 characters) and its named link columns (`footer.columns`: up to 4,
 * each a heading and up to 12 links). The renderer shows them before the footer's other columns. Clearing the text or
 * removing the last column removes the key. Native elements, `Input` and `Button` only (no React `useId`).
 */
export function FooterBrandAndColumnsControls({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    const columns = config.footer?.columns ?? [];
    type Column = (typeof columns)[number];
    const setColumns = (next: Column[]) => setConfig(withFooterKey(config, "columns", next));
    const setColumn = (i: number, column: Column) => setColumns(columns.map((c, j) => (j === i ? column : c)));
    const setLink = (i: number, j: number, field: "label" | "href", value: string) =>
        setColumn(i, { ...columns[i], links: columns[i].links.map((l, k) => (k === j ? { ...l, [field]: value } : l)) });
    return (
        <div className="pt-4 border-t space-y-2">
            <Label>Footer Brand Text</Label>
            <textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm" maxLength={400}
                      value={config.footer?.brandText || ""}
                      onChange={e => setConfig(withFooterKey(config, "brandText", e.target.value.trim() ? e.target.value : ""))} />
            <p className="text-[10px] text-muted-foreground">Shown in the first footer column, up to 400 characters. Empty = none.</p>
            <div className="flex items-center justify-between">
                <Label>Footer Columns</Label>
                <Button variant="outline" size="sm" disabled={columns.length >= 4} onClick={() => setColumns([...columns, { heading: "", links: [] }])}>
                    <Plus className="h-4 w-4 mr-2" /> Add Column
                </Button>
            </div>
            {columns.map((column, i) => (
                <div key={i} className="space-y-2 rounded-md border p-3">
                    <div className="flex gap-2">
                        <Input value={column.heading} maxLength={40} placeholder="Heading (e.g. Explore)" className="flex-1"
                               onChange={e => setColumn(i, { ...column, heading: e.target.value })} />
                        <Button variant="ghost" size="icon" aria-label="Remove column" onClick={() => setColumns(columns.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    {column.links.map((link, j) => (
                        <div key={j} className="flex gap-2">
                            <Input value={link.label} maxLength={60} placeholder="Label" className="flex-1" onChange={e => setLink(i, j, "label", e.target.value)} />
                            <Input value={link.href} placeholder="URL (e.g. /about)" className="flex-1" onChange={e => setLink(i, j, "href", e.target.value)} />
                            <Button variant="ghost" size="icon" aria-label="Remove link" onClick={() => setColumn(i, { ...column, links: column.links.filter((_, k) => k !== j) })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                    ))}
                    <Button variant="ghost" size="sm" disabled={column.links.length >= 12} onClick={() => setColumn(i, { ...column, links: [...column.links, { label: "", href: "" }] })}>
                        <Plus className="h-4 w-4 mr-2" /> Add Link
                    </Button>
                </div>
            ))}
            <p className="text-[10px] text-muted-foreground">Up to 4 named link columns, up to 12 links each, shown before the other footer columns. Each heading, label and URL is required.</p>
        </div>
    );
}

/** The "Navbar & Layout" card. */
export function NavbarLayoutCard({ config, setConfig, updateHeader, categories }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void; updateHeader: (key: string, val: boolean | string) => void; categories: CategoryOption[] | null }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Navbar & Layout</CardTitle>
                <CardDescription>Control the navbar height, logo size, title size, and content width. "Full" is the default state; "Scrolled" is after the user scrolls down.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Site Width */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Site Width (Header/Footer)</Label>
                        <Select value={config.header?.contentMaxWidth || "max-w-7xl"} onValueChange={v => updateHeader("contentMaxWidth", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {HEADER_WIDTH_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground">Navbar, top bar, commerce bar, footer, product/shop pages.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Content Page Width</Label>
                        <Select value={config.header?.contentPageMaxWidth || "max-w-4xl"} onValueChange={v => updateHeader("contentPageMaxWidth", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {PAGE_WIDTH_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground">Paragraphs, headings, lists, comments. Full-bleed blocks ignore this.</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Navbar Height (full)</Label>
                        <Select value={config.header?.navHeight || "h-16"} onValueChange={v => updateHeader("navHeight", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="h-12">48px</SelectItem>
                                <SelectItem value="h-14">56px</SelectItem>
                                <SelectItem value="h-16">64px</SelectItem>
                                <SelectItem value="h-20">80px</SelectItem>
                                <SelectItem value="h-24">96px</SelectItem>
                                <SelectItem value="h-28">112px</SelectItem>
                                <SelectItem value="h-32">128px</SelectItem>
                                <SelectItem value="h-36">144px</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Navbar Height (scrolled)</Label>
                        <Select value={config.header?.navHeightScrolled || "h-12"} onValueChange={v => updateHeader("navHeightScrolled", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="h-10">40px</SelectItem>
                                <SelectItem value="h-12">48px</SelectItem>
                                <SelectItem value="h-14">56px</SelectItem>
                                <SelectItem value="h-16">64px</SelectItem>
                                <SelectItem value="h-20">80px</SelectItem>
                                <SelectItem value="h-24">96px</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Logo Height (full)</Label>
                        <Select value={config.header?.logoHeight || "h-12"} onValueChange={v => updateHeader("logoHeight", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="h-8">32px</SelectItem>
                                <SelectItem value="h-10">40px</SelectItem>
                                <SelectItem value="h-12">48px</SelectItem>
                                <SelectItem value="h-14">56px</SelectItem>
                                <SelectItem value="h-16">64px</SelectItem>
                                <SelectItem value="h-20">80px</SelectItem>
                                <SelectItem value="h-24">96px</SelectItem>
                                <SelectItem value="h-28">112px</SelectItem>
                                <SelectItem value="h-32">128px</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Logo Height (scrolled)</Label>
                        <Select value={config.header?.logoHeightScrolled || "h-8"} onValueChange={v => updateHeader("logoHeightScrolled", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="h-6">24px</SelectItem>
                                <SelectItem value="h-8">32px</SelectItem>
                                <SelectItem value="h-10">40px</SelectItem>
                                <SelectItem value="h-12">48px</SelectItem>
                                <SelectItem value="h-14">56px</SelectItem>
                                <SelectItem value="h-16">64px</SelectItem>
                                <SelectItem value="h-20">80px</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Title Size (full)</Label>
                        <Select value={config.header?.titleSize || "text-xl"} onValueChange={v => updateHeader("titleSize", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="text-sm">14px</SelectItem>
                                <SelectItem value="text-base">16px</SelectItem>
                                <SelectItem value="text-lg">18px</SelectItem>
                                <SelectItem value="text-xl">20px</SelectItem>
                                <SelectItem value="text-2xl">24px</SelectItem>
                                <SelectItem value="text-3xl">30px</SelectItem>
                                <SelectItem value="text-4xl">36px</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Title Size (scrolled)</Label>
                        <Select value={config.header?.titleSizeScrolled || "text-lg"} onValueChange={v => updateHeader("titleSizeScrolled", v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="text-xs">12px</SelectItem>
                                <SelectItem value="text-sm">14px</SelectItem>
                                <SelectItem value="text-base">16px</SelectItem>
                                <SelectItem value="text-lg">18px</SelectItem>
                                <SelectItem value="text-xl">20px</SelectItem>
                                <SelectItem value="text-2xl">24px</SelectItem>
                                <SelectItem value="text-3xl">30px</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Social Sharing */}
                <div className="pt-4 border-t">
                    <label className="flex items-center gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.hideSocialSharing ?? false}
                            onChange={e => setConfig({ ...config, hideSocialSharing: e.target.checked })}
                            className="rounded border-gray-300 h-5 w-5"
                        />
                        <div>
                            <span className="font-medium text-sm">Hide Social Sharing</span>
                            <p className="text-xs text-muted-foreground">Disable share buttons (Twitter, Facebook, LinkedIn, etc.) on all pages. Individual pages can still override this setting.</p>
                        </div>
                    </label>
                </div>

                {/* Home Page Slug */}
                <div className="pt-4 border-t space-y-2">
                    <Label>Home Page Slug</Label>
                    <Input
                        value={config.homePageSlug || ""}
                        onChange={e => setConfig({ ...config, homePageSlug: e.target.value || undefined })}
                        placeholder="/home"
                    />
                    <p className="text-xs text-muted-foreground">
                        Map the root URL (/) to a different page. Enter the slug including the leading slash (e.g., "/home"). Leave empty to use the default / page.
                    </p>
                </div>
                {/* BULK-PURGE-FOOTER-1: one child slot for both footer groups. React's `useId` encodes a child's
                    index in a width set by the parent's CHILD COUNT, so a new sibling here re-numbered the
                    Radix Select ids earlier in this card (OBSERVED: `_R_962b_` → `_R_i62b_`); a fragment keeps
                    the count, the fragment adds no element. HEADER-COLOURS-1: the header colours share the
                    same slot, for the same reason. SHOP-LOOK-1A: the tagline and category bar first, the footer
                    brand text and columns last, in the same slot. */}
                <>
                    <HeaderTaglineAndCategoryBarControls config={config} setConfig={setConfig} categories={categories} />
                    <HeaderColorControls config={config} setConfig={setConfig} />
                    <FooterWidthControl config={config} setConfig={setConfig} />
                    <FooterColorControls config={config} setConfig={setConfig} />
                    <FooterBrandAndColumnsControls config={config} setConfig={setConfig} />
                </>
            </CardContent>
        </Card>
    );
}
