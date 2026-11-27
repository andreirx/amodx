// Settings page: the Navigation Menu and Footer Links cards, their per-language list rules and the menu-language selector.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { SmartLinkInput } from "@/components/ui/smart-link-input";
import { localeLanguageSubtag, readLanguageSettings } from "@amodx/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SettingsDraft } from "./draft";
import { languageName } from "./Languages";

type LinkField = "navLinks" | "footerLinks";
type SettingsLink = NonNullable<SettingsDraft["navLinks"]>[number];
const BY_LANG = { navLinks: "navLinksByLang", footerLinks: "footerLinksByLang" } as const;

/** The link list being edited: `language` null = the default list (`navLinks` / `footerLinks`, as today); else that
 *  language's own list, or undefined when it has none (it then uses the default list). */
export function linksFor(config: SettingsDraft, field: LinkField, language: string | null): SettingsLink[] | undefined {
    return language === null ? config[field] : config[BY_LANG[field]]?.[language];
}

/** The draft with the edited list replaced; for a language, `undefined` = "Use the default menu" (its key removed). */
export function withLinksFor(config: SettingsDraft, field: LinkField, language: string | null, list: SettingsLink[] | undefined): SettingsDraft {
    if (language === null) return { ...config, [field]: list };
    const map: Record<string, SettingsLink[]> = { ...config[BY_LANG[field]] };
    if (list === undefined) delete map[language];
    else map[language] = list;
    return { ...config, [BY_LANG[field]]: map };
}

/** Navigation Menu and Footer Links card headers, only with extra languages: which list the editor below edits. */
export function MenuLanguageSelect({ config, setConfig, field, language, setLanguage }: {
    config: SettingsDraft; setConfig: (c: SettingsDraft) => void; field: LinkField; language: string | null; setLanguage: (l: string | null) => void;
}) {
    const { languages } = readLanguageSettings(config);
    const own = language === null ? undefined : linksFor(config, field, language);
    return (
        <div className="flex items-center gap-2 pt-2 text-sm">
            <span className="text-muted-foreground">Language</span>
            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={language ?? ""}
                    onChange={e => setLanguage(e.target.value === "" ? null : e.target.value)}>
                <option value="">Default ({localeLanguageSubtag(config.locale)})</option>
                {languages.map(l => <option key={l} value={l}>{languageName(l)} ({l})</option>)}
            </select>
            {language !== null && (own === undefined
                ? <span className="text-xs text-muted-foreground">Uses the default list. Add a link to give {language} its own list.</span>
                : <button type="button" className="text-xs text-destructive hover:underline" onClick={() => setConfig(withLinksFor(config, field, language, undefined))}>Use the default menu</button>)}
        </div>
    );
}

/**
 * The link-list edits of the Footer Links and Navigation Menu cards: the page's closures, moved unchanged (same
 * bodies, same names). Each edits the list of `linkLanguage` (null = `navLinks` / `footerLinks`).
 */
function linkEdits(config: SettingsDraft, setConfig: (c: SettingsDraft) => void, linkLanguage: string | null) {
    // Helper for array fields (Nav Links). LANG-1A: each edits the list of `linkLanguage` (null = `navLinks` /
    // `footerLinks`, exactly as before) through `linksFor` / `withLinksFor`.
    const addLink = (field: 'navLinks' | 'footerLinks') => {
        const current = linksFor(config, field, linkLanguage) || [];
        setConfig(withLinksFor(config, field, linkLanguage, [...current, { label: "New Link", href: "/" }]));
    };

    const updateLink = (field: 'navLinks' | 'footerLinks', index: number, key: 'label' | 'href', val: string) => {
        const current = [...(linksFor(config, field, linkLanguage) || [])];
        current[index] = { ...current[index], [key]: val };
        setConfig(withLinksFor(config, field, linkLanguage, current));
    };

    const removeLink = (field: 'navLinks' | 'footerLinks', index: number) => {
        const current = (linksFor(config, field, linkLanguage) || []).filter((_, i) => i !== index);
        setConfig(withLinksFor(config, field, linkLanguage, current));
    };

    // Convert a simple link to a dropdown menu
    const toggleLinkDropdown = (index: number, isDropdown: boolean) => {
        const current = [...(linksFor(config, 'navLinks', linkLanguage) || [])];
        if (isDropdown) {
            // Convert to dropdown - add empty children array
            current[index] = { ...current[index], children: [] };
        } else {
            // Convert to simple link - remove children
            const { children, ...rest } = current[index] as any;
            current[index] = rest;
        }
        setConfig(withLinksFor(config, 'navLinks', linkLanguage, current));
    };

    // Add a child link to a dropdown menu
    const addChildLink = (parentIndex: number) => {
        const current = [...(linksFor(config, 'navLinks', linkLanguage) || [])];
        const children = current[parentIndex].children || [];
        current[parentIndex] = {
            ...current[parentIndex],
            children: [...children, { label: "Sub-link", href: "/" }]
        };
        setConfig(withLinksFor(config, 'navLinks', linkLanguage, current));
    };

    // Update a child link
    const updateChildLink = (parentIndex: number, childIndex: number, key: 'label' | 'href', val: string) => {
        const current = [...(linksFor(config, 'navLinks', linkLanguage) || [])];
        const children = [...(current[parentIndex].children || [])];
        children[childIndex] = { ...children[childIndex], [key]: val };
        current[parentIndex] = { ...current[parentIndex], children };
        setConfig(withLinksFor(config, 'navLinks', linkLanguage, current));
    };

    // Remove a child link
    const removeChildLink = (parentIndex: number, childIndex: number) => {
        const current = [...(linksFor(config, 'navLinks', linkLanguage) || [])];
        const children = (current[parentIndex].children || []).filter((_, i) => i !== childIndex);
        current[parentIndex] = { ...current[parentIndex], children };
        setConfig(withLinksFor(config, 'navLinks', linkLanguage, current));
    };
    return { addLink, updateLink, removeLink, toggleLinkDropdown, addChildLink, updateChildLink, removeChildLink };
}

/** The "Footer Links" card. */
export function FooterLinksCard({ config, setConfig, extraLanguages, linkLanguage, setLinkLanguage }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void; extraLanguages: string[]; linkLanguage: string | null; setLinkLanguage: (l: string | null) => void }) {
    const { addLink, updateLink, removeLink } = linkEdits(config, setConfig, linkLanguage);
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Footer Links</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => addLink('footerLinks')}>
                        <Plus className="h-4 w-4 mr-2"/> Add Link
                    </Button>
                </div>
                {extraLanguages.length > 0 && <MenuLanguageSelect config={config} setConfig={setConfig} field="footerLinks" language={linkLanguage} setLanguage={setLinkLanguage} />}
            </CardHeader>
            <CardContent className="space-y-3">
                {(linksFor(config, 'footerLinks', linkLanguage) || []).map((link, i) => (
                    <div key={i} className="flex gap-2">
                        <Input value={link.label}
                            onChange={e => updateLink('footerLinks', i, 'label', e.target.value)}
                            placeholder="Label"
                            className="flex-1"
                        />
                        <SmartLinkInput
                            value={link.href}
                            onChange={val => updateLink('footerLinks', i, 'href', val)}
                            placeholder="URL"
                            className="flex-1"
                        />
                        <Button variant="ghost" size="icon"
                            onClick={() => removeLink('footerLinks', i)}><Trash2
                        className="h-4 w-4 text-destructive"/></Button>
                    </div>
                ))}
                {(linksFor(config, 'footerLinks', linkLanguage)?.length === 0) &&
                    <p className="text-sm text-muted-foreground italic">No footer links added.</p>}
            </CardContent>
        </Card>
    );
}

/** The "Navigation Menu" card. */
export function NavigationMenuCard({ config, setConfig, extraLanguages, linkLanguage, setLinkLanguage }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void; extraLanguages: string[]; linkLanguage: string | null; setLinkLanguage: (l: string | null) => void }) {
    const { addLink, updateLink, removeLink, toggleLinkDropdown, addChildLink, updateChildLink, removeChildLink } = linkEdits(config, setConfig, linkLanguage);
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Navigation Menu</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => addLink('navLinks')}>
                        <Plus className="h-4 w-4 mr-2"/> Add Link
                    </Button>
                </div>
                <CardDescription>
                    Create simple links or dropdown menus. Dropdown menus show sub-links on hover/click.
                </CardDescription>
                {extraLanguages.length > 0 && <MenuLanguageSelect config={config} setConfig={setConfig} field="navLinks" language={linkLanguage} setLanguage={setLinkLanguage} />}
            </CardHeader>
            <CardContent className="space-y-4">
                {(linksFor(config, 'navLinks', linkLanguage) || []).map((link, i) => {
                    const hasChildren = Array.isArray(link.children);
                    return (
                        <div key={i} className="border rounded-lg p-3 space-y-3">
                            {/* Main link row */}
                            <div className="flex gap-2 items-center">
                                <Input
                                    value={link.label}
                                    onChange={e => updateLink('navLinks', i, 'label', e.target.value)}
                                    placeholder="Label"
                                    className="flex-1"
                                />
                                <div className="flex-1">
                                    <SmartLinkInput
                                        value={link.href}
                                        onChange={val => updateLink('navLinks', i, 'href', val)}
                                        placeholder={hasChildren ? "/optional-parent-link" : "/path"}
                                    />
                                </div>
                                <Select
                                    value={hasChildren ? "dropdown" : "link"}
                                    onValueChange={v => toggleLinkDropdown(i, v === "dropdown")}
                                >
                                    <SelectTrigger className="w-[120px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="link">Link</SelectItem>
                                        <SelectItem value="dropdown">Dropdown</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeLink('navLinks', i)}
                                >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>

                            {/* Children (sub-links) for dropdowns */}
                            {hasChildren && (
                                <div className="ml-6 pl-4 border-l-2 border-muted space-y-2">
                                    {(link.children || []).map((child, j) => (
                                        <div key={j} className="flex gap-2 items-center">
                                            <Input
                                                value={child.label}
                                                onChange={e => updateChildLink(i, j, 'label', e.target.value)}
                                                placeholder="Sub-link label"
                                                className="flex-1"
                                            />
                                            <div className="flex-1">
                                                <SmartLinkInput
                                                    value={child.href}
                                                    onChange={val => updateChildLink(i, j, 'href', val)}
                                                    placeholder="/path"
                                                />
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => removeChildLink(i, j)}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    ))}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => addChildLink(i)}
                                        className="mt-2"
                                    >
                                        <Plus className="h-3 w-3 mr-1" /> Add Sub-link
                                    </Button>
                                </div>
                            )}
                        </div>
                    );
                })}
                {(linksFor(config, 'navLinks', linkLanguage)?.length === 0) &&
                    <p className="text-sm text-muted-foreground italic">No links added.</p>}
            </CardContent>
        </Card>
    );
}
