// Settings page: the "Language & Country" card, its pure rules, the extra-languages controls and the Country apply dialog.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { COUNTRY_PACKS, getCountryPack, LANGUAGE_PACKS, resolveLocaleStrings, localeLanguageSubtag, languageSettingsProblem } from "@amodx/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Dispatch, SetStateAction } from "react";
import type { SettingsDraft } from "./draft";

// ── LOCALE-1A (docs/slices/locale-1.md § 3.5, § 7.2): the "Language & Country" card's rules, pure so that
// Settings.test.ts pins them (the admin unit config has no DOM). ───────────────────────────────────────────────

/** True when `value` is itself a spelling of en-US (after the trim and `_` → `-` steps of normalizeLocale). */
function spellsEnUs(value: string): boolean {
    try { return new Intl.Locale(value.trim().replace(/_/g, "-")).baseName === "en-US"; } catch { return false; }
}

/**
 * What the stored `locale` means for visitors: the date locale, the text language, and whether the value FELL BACK to
 * en-US. The warning is for a value that is present (a string, also "" or blanks) but is not a locale, so en-US is
 * used in its place; an absent value is the documented default and shows no warning.
 */
export function localeStatus(stored: unknown): { dates: string; language: string; languageName: string; fallbackWarning: boolean } {
    const resolved = resolveLocaleStrings({ locale: stored });
    return {
        dates: resolved.locale,
        language: resolved.language,
        languageName: LANGUAGE_PACKS[resolved.language].name,
        fallbackWarning: typeof stored === "string" && resolved.locale === "en-US" && !spellsEnUs(stored),
    };
}

/** "Site language": writes the language pack's default locale (§ 3.5); nothing else. */
export function withSiteLanguage<T extends object>(config: T, language: string): T & { locale: string } {
    return { ...config, locale: LANGUAGE_PACKS[language].defaultLocale };
}

/** "Apply" of the country (§ 7.2): writes `countryCode` and `currency` only — never `locale` or any text. */
export function withCountry<T extends object>(config: T, code: string): T & { countryCode: string; currency: string } {
    return { ...config, countryCode: code, currency: getCountryPack(code).currency.code };
}

// ── LANG-1A (docs/slices/lang-1.md § 10): extra languages, and a menu and footer list per language. ─────────────────
// Native elements and `Input` only (no React `useId`); the Languages controls are the LAST child of the "Language &
// Country" card's content (2 → 3 children keeps the width of React's tree ids, so the captured Radix ids stay); the
// menu-language selector is in the two link cards' headers, where no control derives an id. The rules are the shared
// `languageSettingsProblem` (the same function PUT /settings runs) and `readLanguageSettings`.

/** The English name of a language subtag (`"ro"` → "Romanian"); the subtag itself when the runtime has no name. */
export function languageName(subtag: string): string {
    try { return new Intl.DisplayNames(["en"], { type: "language" }).of(subtag) ?? subtag; } catch { return subtag; }
}

/** The stored extra languages as the form shows them: the raw list when it is an array (bad entries visible, so they can be removed). */
export function draftLanguages(config: SettingsDraft): unknown[] {
    return Array.isArray(config.languages) ? config.languages : [];
}

/** The draft with `subtag` appended to `languages`. */
export function withLanguageAdded(config: SettingsDraft, subtag: string): SettingsDraft {
    return { ...config, languages: [...draftLanguages(config), subtag] as string[] };
}

/**
 * The draft without `entry` in `languages`, and without its menu and footer lists (rule V5). The list and the maps are
 * SENT even when empty (`[]`, `{}`): PUT /settings merges the top level, so an omitted attribute would keep the stored
 * value and its removed language. A map that was never stored stays absent.
 */
export function withLanguageRemoved(config: SettingsDraft, entry: unknown): SettingsDraft {
    const next: SettingsDraft = { ...config, languages: draftLanguages(config).filter((l) => l !== entry) as string[] };
    for (const map of ["navLinksByLang", "footerLinksByLang"] as const) {
        const stored = config[map];
        if (stored === undefined || stored === null || typeof stored !== "object") continue;
        const copy = { ...stored };
        if (typeof entry === "string") delete copy[entry];
        next[map] = copy;
    }
    return next;
}

/** Language & Country card, last: the default language (read only) and the extra languages, with the save rule's message. */
export function LanguageListControls({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    const [candidate, setCandidate] = useState("");
    const defaultSubtag = localeLanguageSubtag(config.locale);
    const entries = draftLanguages(config);
    const trimmed = candidate.trim().toLowerCase();
    const addProblem = trimmed === "" ? null : languageSettingsProblem(withLanguageAdded(config, trimmed));
    const problem = languageSettingsProblem(config);
    return (
        <div className="pt-4 border-t space-y-3">
            <Label>Languages</Label>
            <p className="text-xs text-muted-foreground">Default language: {languageName(defaultSubtag)} ({defaultSubtag}), from the site language and locale above. Its pages have no language prefix.</p>
            {entries.length > 0 && (
                <ul className="space-y-1">
                    {entries.map((entry, i) => (
                        <li key={i} className="flex items-center justify-between text-sm">
                            <span>{typeof entry === "string" ? `${languageName(entry)} (${entry}) — pages under /${entry}/` : JSON.stringify(entry)}</span>
                            <button type="button" className="text-xs text-destructive hover:underline" onClick={() => setConfig(withLanguageRemoved(config, entry))}>Remove</button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex gap-2">
                <Input value={candidate} onChange={e => setCandidate(e.target.value)} placeholder="Language code, e.g. ro" className="w-48" />
                <button type="button" className="rounded-md border px-3 text-sm disabled:opacity-50" disabled={trimmed === "" || addProblem !== null}
                        onClick={() => { setConfig(withLanguageAdded(config, trimmed)); setCandidate(""); }}>Add language</button>
            </div>
            {addProblem !== null && <p className="text-xs text-destructive">{addProblem}</p>}
            {problem !== null && <p className="text-xs text-destructive">{problem}</p>}
            <p className="text-xs text-muted-foreground">A page whose address starts with /&lt;code&gt; (for example /ro/about) is in that language; every other page is in the default language. Adding a language makes the existing pages under its prefix pages of that language. Each language can have its own menu and footer links (Navigation Menu, Footer Links).</p>
            <p className="text-xs text-muted-foreground">A change to the language list can take a few minutes to show on every page.</p>
        </div>
    );
}

/** The "Language & Country" card. */
export function LanguageCountryCard({ config, setConfig, setPendingPackCode }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void; setPendingPackCode: (code: string | null) => void }) {
    const status = localeStatus(config.locale);
    return (
        <Card>
            <CardHeader>
                <CardTitle>Language & Country</CardTitle>
                <CardDescription>The site language selects the texts visitors see; the country selects country facts such as the currency.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label>Site language</Label>
                        <Select
                            value={status.language}
                            onValueChange={language => setConfig(withSiteLanguage(config, language))}
                        >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {Object.values(LANGUAGE_PACKS).map(pack => (
                                    <SelectItem key={pack.language} value={pack.language}>
                                        {pack.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">The language of every text visitors see. Edit single texts in Labels.</p>
                    </div>
                    <div className="space-y-2">
                        <Label>Locale (advanced)</Label>
                        <Input
                            value={config.locale ?? ""}
                            onChange={e => setConfig({ ...config, locale: e.target.value })}
                            placeholder="en-US"
                        />
                        <p className="text-xs text-muted-foreground">
                            Dates: {status.dates}. Texts: {status.languageName}.
                        </p>
                        {status.fallbackWarning && (
                            <p className="text-xs text-destructive">Not a valid locale; en-US is used.</p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label>Country</Label>
                        <Select
                            value={config.countryCode || "EN"}
                            onValueChange={code => setPendingPackCode(code)}
                        >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {Object.values(COUNTRY_PACKS).map(pack => (
                                    <SelectItem key={pack.code} value={pack.code}>
                                        {pack.name} ({pack.code})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => setPendingPackCode(config.countryCode || "EN")}
                        >
                            Apply Country
                        </Button>
                        <p className="text-xs text-muted-foreground">Sets the country and its currency.</p>
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label>Currency</Label>
                        <Input
                            value={config.currency || "USD"}
                            onChange={e => setConfig({ ...config, currency: e.target.value })}
                            placeholder="USD"
                        />
                        <p className="text-xs text-muted-foreground">Auto-filled from the country. Override if needed.</p>
                    </div>
                </div>
                {/* LANG-1A: the third child of this card's content (React's id width unchanged; see the helpers). */}
                <LanguageListControls config={config} setConfig={setConfig} />
            </CardContent>
        </Card>
    );
}

/** The confirmation dialog of the Country "Apply" (opened by the "Language & Country" card). */
export function CountryApplyDialog({ pendingPackCode, setPendingPackCode, setConfig }: { pendingPackCode: string | null; setPendingPackCode: (code: string | null) => void; setConfig: Dispatch<SetStateAction<SettingsDraft>> }) {
    return (
        <Dialog open={pendingPackCode !== null} onOpenChange={open => { if (!open) setPendingPackCode(null); }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Apply Country: {pendingPackCode ? getCountryPack(pendingPackCode).name : ""}</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                    This sets the country and its currency. The site language and the texts do not change.
                </p>
                <div className="flex flex-col gap-2 pt-2">
                    <Button
                        onClick={() => {
                            if (!pendingPackCode) return;
                            setConfig(prev => withCountry(prev, pendingPackCode));
                            setPendingPackCode(null);
                        }}
                    >
                        Apply
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
