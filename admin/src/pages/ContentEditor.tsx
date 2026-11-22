import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useBlocker } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, ArrowLeft, Loader2, Palette, X, RotateCcw, History, Settings as SettingsIcon, Lock } from "lucide-react";
import { Tag } from "lucide-react";
import { BlockEditor } from "@/components/editor/BlockEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { MediaPicker } from "@/components/MediaPicker";
import { TagInput } from "@/components/ui/tag-input";

import { THEME_PRESETS, normalizeSlug, needsSlugReview, pageLanguageOf, languageTagOf, localeLanguageSubtag, readLanguageSettings, type PageLanguage } from "@amodx/shared";
import { extractText, findImage } from "@/lib/seoExtract";

// IMPROVED COLOR COMPONENT
function ColorOverride({ label, value, onChange, onReset }: { label: string, value?: string, onChange: (v: string) => void, onReset: () => void }) {
    const isSet = value !== undefined && value !== "";
    return (
        <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</Label>
            <div className="flex gap-2 items-center h-9">
                {isSet ? (
                    <>
                        <div className="relative flex-1 h-full border rounded-md overflow-hidden">
                            <input
                                type="color"
                                className="absolute inset-0 w-[150%] h-[150%] -translate-x-[25%] -translate-y-[25%] cursor-pointer p-0 border-0"
                                value={value}
                                onChange={e => onChange(e.target.value)}
                            />
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                            onClick={onReset}
                            title="Remove Override"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </>
                ) : (
                    <Button
                        variant="outline"
                        className="w-full h-full text-xs text-muted-foreground font-normal border-dashed"
                        onClick={() => onChange("#7f7f7f")}
                        title="Click to override"
                    >
                        Inherited
                    </Button>
                )}
            </div>
        </div>
    );
}

// ── LANG-1A (docs/slices/lang-1.md § 6.2, § 10): the page's language and its translation set. Pure, so
// ContentEditor.test.ts pins them. The language is the address prefix (the stored data is the address). The set is read
// from the content list (content/list.ts): `translationKey` on each LATEST and, for a page that holds a key,
// `hasTranslationItem` (its membership item exists). The backend repeats every check (rules C2, C3).
// Rule for every decision on a sum type here (`PageLanguage`, `TranslationChoice`; review R-L1A-03): a `switch` whose
// every arm returns, in a function whose return type excludes `undefined`, no default arm. ──────────────────────────

/** A page of the content list. `hasTranslationItem` is present only when the page holds a set key. */
export type ListedPage = { nodeId: string; title?: string; slug?: unknown; status?: string; translationKey?: unknown; hasTranslationItem?: boolean };
/** The tenant's languages as the editor needs them: the extra languages (read rule) and the default subtag. */
export type SiteLanguages = { languages: string[]; defaultSubtag: string };

/** The English name of a language subtag; the subtag itself when the runtime has no name. */
function languageName(subtag: string): string {
    try { return new Intl.DisplayNames(["en"], { type: "language" }).of(subtag) ?? subtag; } catch { return subtag; }
}

/** The tenant settings → the editor's language view (`readLanguageSettings`, the one read rule). */
export function siteLanguagesOf(settings: unknown): SiteLanguages {
    const locale = settings !== null && typeof settings === "object" ? (settings as { locale?: unknown }).locale : undefined;
    return { languages: readLanguageSettings(settings).languages, defaultSubtag: localeLanguageSubtag(locale) };
}

/** `path` (with a leading `/`) without its language prefix: a default-language address is returned whole. */
function addressWithoutLanguage(path: string, language: PageLanguage): string {
    switch (language.kind) {
        case "default": return path;
        case "extra": return path.slice(1 + language.subtag.length);
    }
}

/** The address with its language prefix replaced: `/about` → `ro` → `/ro/about`; `/ro/about` → default → `/about`. */
export function slugInLanguage(slug: string, languages: readonly string[], target: string | null): string {
    const path = "/" + slug.replace(/^\//, "");
    const rest = addressWithoutLanguage(path, pageLanguageOf(path, languages));
    if (target === null) return rest === "" ? "/" : rest;
    return `/${target}${rest === "/" ? "" : rest}`;
}

/** The Language select's value for a page language: "" = the default language, else the subtag. */
export function languageSelectValue(language: PageLanguage): string {
    switch (language.kind) {
        case "default": return "";
        case "extra": return language.subtag;
    }
}

/** The language tag of an address (`hreflang` value): an extra language's subtag, else the default subtag. */
export function languageTagOfSlug(slug: unknown, site: SiteLanguages): string {
    return languageTagOf(pageLanguageOf(typeof slug === "string" ? "/" + slug.replace(/^\//, "") : "", site.languages), site.defaultSubtag);
}

const isSetKey = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * Member of set `key` by the conditions of § 6.2 that do not depend on publication: the page holds `key` now, its
 * membership item exists (`hasTranslationItem`), and its address is a string. This is what the backend's rule C3
 * counts (`otherSetMembers`, content/update.ts): a Draft or Archived member counts, it can be published again.
 */
export function isSetMember(page: ListedPage, key: unknown): boolean {
    return isSetKey(key) && page.translationKey === key && page.hasTranslationItem === true && typeof page.slug === "string";
}

/**
 * The pages the "Translation of" picker offers for page `self` (its address as being edited): exactly the targets for
 * which PUT /content/{id} would JOIN (`planTranslation`, content/update.ts), in its order of checks — not the page
 * itself (400); not a page of the page's own set (the backend's no-op); not a page in this page's language (C3); not a
 * page whose set has another member (`isSetMember`) in this page's language (C3). A page without an address is not
 * offered. The page's own key comes from its list entry.
 */
export function translationChoices(pages: readonly ListedPage[], self: { nodeId: string; slug: string }, site: SiteLanguages): ListedPage[] {
    const selfKey = pages.find((p) => p.nodeId === self.nodeId)?.translationKey;
    const selfTag = languageTagOfSlug(self.slug, site);
    const setHasLanguage = (key: unknown) => isSetKey(key) && pages.some((q) =>
        q.nodeId !== self.nodeId && isSetMember(q, key) && languageTagOfSlug(q.slug, site) === selfTag);
    return pages.filter((p) => p.nodeId !== self.nodeId && typeof p.slug === "string"
        && !(isSetKey(p.translationKey) && p.translationKey === selfKey)
        && languageTagOfSlug(p.slug, site) !== selfTag && !setHasLanguage(p.translationKey));
}

/**
 * One member of the page's set: its language tag, the page, and `published` = its status is Published (§ 6.2 condition
 * 2). A published member is listed for search engines only when no other published member shares its language (§ 5.3,
 * `sharedTags`); an unpublished member is never listed.
 */
export type SetMemberView = { tag: string; page: ListedPage; published: boolean };

/**
 * The page's set (§ 6.2) as language → page: every `isSetMember` of the page's key, the page itself with its address and
 * status as being edited; `published` = status Published. `sharedTags` = language tags that two or more PUBLISHED
 * members share: search engines get neither of them (§ 5.3). A Draft or Archived member is shown, not listed, and
 * causes no such warning. Empty when the page is not a member itself (no key, or no membership item).
 */
export function translationSetView(pages: readonly ListedPage[], self: { nodeId: string; slug: string; status: string }, site: SiteLanguages): { members: SetMemberView[]; sharedTags: string[] } {
    const entry = pages.find((p) => p.nodeId === self.nodeId);
    const edited = (p: ListedPage): ListedPage => (p.nodeId === self.nodeId ? { ...p, slug: self.slug, status: self.status } : p);
    const key = entry?.translationKey;
    if (entry === undefined || !isSetMember(edited(entry), key)) return { members: [], sharedTags: [] };
    const members = pages.map(edited).filter((p) => isSetMember(p, key))
        .map((page) => ({ tag: languageTagOfSlug(page.slug, site), page, published: page.status === "Published" }));
    const counts = new Map<string, number>();
    for (const m of members) if (m.published) counts.set(m.tag, (counts.get(m.tag) ?? 0) + 1);
    return { members, sharedTags: [...counts].filter(([, n]) => n > 1).map(([tag]) => tag) };
}

/** The "Translation of" choice: absent = no change (nothing sent); null = leave the set; a nodeId = join that page's set. */
export type TranslationChoice = { kind: "unchanged" } | { kind: "leave" } | { kind: "join"; nodeId: string };

const LEAVE_VALUE = "__leave";
/** The "Translation of" select's value for a choice; `choiceFromSelectValue` is its inverse. */
export function choiceSelectValue(choice: TranslationChoice): string {
    switch (choice.kind) {
        case "unchanged": return "";
        case "leave": return LEAVE_VALUE;
        case "join": return choice.nodeId;
    }
}
export function choiceFromSelectValue(value: string): TranslationChoice {
    if (value === "") return { kind: "unchanged" };
    if (value === LEAVE_VALUE) return { kind: "leave" };
    return { kind: "join", nodeId: value };
}

/** True when the choice changes the page's set (the editor is then dirty: Save sends `translationOf`). */
export function choiceChangesSet(choice: TranslationChoice): boolean {
    switch (choice.kind) {
        case "unchanged": return false;
        case "leave": return true;
        case "join": return true;
    }
}

/** The `PUT /content/{id}` body with the choice applied: `translationOf` is sent only for a choice the editor made. */
export function withTranslationChoice<T extends object>(payload: T, choice: TranslationChoice): T & { translationOf?: string | null } {
    switch (choice.kind) {
        case "unchanged": return payload;
        case "leave": return { ...payload, translationOf: null };
        case "join": return { ...payload, translationOf: choice.nodeId };
    }
}

// ... [Keep DEFAULT_STATE] ...
const DEFAULT_STATE = {
    title: "",
    slug: "",
    status: "Draft",
    commentsMode: "Hidden",
    accessPolicy: { type: 'Public' } as any,
    blocks: [] as any[],
    seoTitle: "",
    seoDescription: "",
    seoKeywords: "",
    featuredImage: "",
    tags: [] as string[],
    hideNav: false,
    hideFooter: false,
    hideSharing: false,
    themeOverride: {} as Record<string, string>,
    schemaType: undefined as string | undefined
};

export default function ContentEditor() {
    const { id } = useParams();
    const navigate = useNavigate();

    // NEW: History State
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [history, setHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);


    // NEW: Load History
    async function loadHistory() {
        if (!id) return;
        setLoadingHistory(true);
        try {
            const res = await apiRequest(`/content/${id}/versions`);
            setHistory(res.versions || []);
        } catch (e) {
            console.error("Failed to load history", e);
        } finally {
            setLoadingHistory(false);
        }
    }

    // NEW: Handle Restore
    async function handleRestore(version: number) {
        if (!confirm(`Are you sure you want to revert to Version ${version}? Current unsaved changes will be lost.`)) return;

        try {
            setLoading(true);
            const res = await apiRequest(`/content/${id}/restore`, {
                method: 'POST',
                body: JSON.stringify({ version })
            });

            alert(`Restored to Version ${res.version}`);
            setIsHistoryOpen(false);

            // Reload the editor with new data
            await loadContent(id!);
        } catch (e: any) {
            alert("Restore failed: " + e.message);
            setLoading(false);
        }
    }

    const [mediaPickerOpen, setMediaPickerOpen] = useState(false);

    // LANG-1A: the tenant's languages (null until loaded, or when the site has none → no language controls), the
    // content list (the picker and the set display; it holds this page's key and membership too), and the editor's set
    // choice (sent on save only when made).
    const [siteLanguages, setSiteLanguages] = useState<SiteLanguages | null>(null);
    const [listedPages, setListedPages] = useState<ListedPage[]>([]);
    const [translationChoice, setTranslationChoice] = useState<TranslationChoice>({ kind: "unchanged" });

    // Store the CLEAN state (from server)
    const [serverState, setServerState] = useState<typeof DEFAULT_STATE | null>(null);

    // Store the DIRTY state (current edits)
    const [form, setForm] = useState(DEFAULT_STATE);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [manualSeo, setManualSeo] = useState(false);

    // dirty state management
    const isDirty = useMemo(() => {
        if (!serverState) return false;
        return JSON.stringify(serverState) !== JSON.stringify(form) || choiceChangesSet(translationChoice);
    }, [serverState, form, translationChoice]);

    // IMPORT-POLICY-1: the URL field hides the slug's leading "/" and, once edited, stores the value
    // without it. Only the decision to SHOW the red review line uses the slug with the slash, so a
    // normal edit ("about-us") is not flagged. Every claim in the line is computed from form.slug,
    // the exact value save() sends: content/update.ts keeps the stored slug only when the sent value
    // equals it, and otherwise stores normalizeSlug(sent value).
    const slugWithLeadingSlash = "/" + form.slug.replace(/^\//, "");

    // 1. Browser Navigation Protection (Close Tab / Refresh)
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = "You have unsaved changes.";
            }
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [isDirty]);

    // 2. Client Router Protection (React Router)
    // NOTE: Requires data router (createBrowserRouter) usually, but basic blocker works in newer v6
    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname
    );

    // Store all unique tags found in the system for autocomplete
    const [availableTags, setAvailableTags] = useState<string[]>([]);

    useEffect(() => {
        if (id) loadContent(id);
        fetchAvailableTags();
        loadSiteLanguages();
    }, [id]);

    // LANG-1A: the language controls show only for a site with extra languages.
    async function loadSiteLanguages() {
        try {
            const site = siteLanguagesOf(await apiRequest("/settings"));
            setSiteLanguages(site.languages.length > 0 ? site : null);
        } catch (e) {
            console.warn("Failed to load the site languages", e);
        }
    }

    async function fetchAvailableTags() {
        try {
            // We fetch all content to derive tags.
            // Optimization: Later, make a dedicated endpoint GET /tags
            const res = await apiRequest("/content");
            setListedPages(res.items);   // LANG-1A: the "Translation of" picker reads the same list
            const allTags = new Set<string>();
            res.items.forEach((item: any) => {
                if (Array.isArray(item.tags)) {
                    item.tags.forEach((t: string) => allTags.add(t));
                }
            });
            setAvailableTags(Array.from(allTags).sort());
        } catch (e) {
            console.warn("Failed to fetch tags", e);
        }
    }

    async function loadContent(nodeId: string) {
        try {
            const data = await apiRequest(`/content/${nodeId}`);

            // Map API response to Form State
            const state = {
                title: data.title || "",
                slug: data.slug || "",
                status: data.status || "Draft",
                commentsMode: data.commentsMode || "Hidden",
                accessPolicy: data.accessPolicy || { type: 'Public' },
                blocks: data.blocks || [],
                seoTitle: data.seoTitle || "",
                seoDescription: data.seoDescription || "",
                seoKeywords: data.seoKeywords || "",
                featuredImage: data.featuredImage || "",
                tags: data.tags || [],
                hideNav: data.hideNav || false,
                hideFooter: data.hideFooter || false,
                hideSharing: data.hideSharing || false,
                themeOverride: data.themeOverride || {},
                schemaType: data.schemaType || undefined
            };
            setForm(state);
            setServerState(state);
            setTranslationChoice({ kind: "unchanged" });
            if (data.seoTitle || data.seoDescription) setManualSeo(true);
        } catch (err) {
            console.error(err);
            alert("Failed to load content");
        } finally {
            setLoading(false);
        }
    }

    async function save() {
        if (!id) return;
        let finalSeoTitle = form.seoTitle;
        let finalSeoDesc = form.seoDescription;
        let finalImg = form.featuredImage;

        if (!manualSeo) {
            if (!finalSeoTitle) finalSeoTitle = form.title;
            if (!finalSeoDesc) finalSeoDesc = extractText(form.blocks);
            if (!finalImg) finalImg = findImage(form.blocks);
        }

        try {
            setSaving(true);
            const payload = {
                ...form,
                seoTitle: finalSeoTitle,
                seoDescription: finalSeoDesc,
                featuredImage: finalImg,
            };
            await apiRequest(`/content/${id}`, { method: "PUT", body: JSON.stringify(withTranslationChoice(payload, translationChoice)) });
            setServerState(payload);
            // Re-fetch to ensure sync (e.g. if slug changed backend side)
            await loadContent(id);
            fetchAvailableTags();   // LANG-1A: the list holds the sets the picker shows
            window.dispatchEvent(new Event("amodx:refresh-links"));
        } catch (err: any) {
            alert("Failed to save: " + err.message);
        } finally {
            setSaving(false);
        }
    }

    // --- Helpers ---
    const update = (key: keyof typeof DEFAULT_STATE, val: any) => {
        setForm(prev => ({ ...prev, [key]: val }));
    };

    const updateTheme = (key: string, val: string) => {
        setForm(prev => ({
            ...prev,
            themeOverride: { ...prev.themeOverride, [key]: val }
        }));
    };

    const resetThemeKey = (key: string) => {
        const newTheme = { ...form.themeOverride };
        delete newTheme[key];
        update("themeOverride", newTheme);
    };

    const resetAllDesign = () => {
        if (confirm("Remove all design overrides?")) {
            setForm(prev => ({ ...prev, themeOverride: {}, hideNav: false, hideFooter: false, hideSharing: false }));
        }
    };

    // --- Apply Preset ---
    const applyPreset = (presetName: string) => {
        const preset = THEME_PRESETS[presetName];
        if (preset) {
            setForm(prev => ({
                ...prev,
                themeOverride: {
                    ...prev.themeOverride,
                    ...preset
                }
            }));
        }
    };

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

            {/* Blocker Dialog */}
            {blocker.state === "blocked" && (
                <Dialog open={true} onOpenChange={() => blocker.reset()}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Unsaved Changes</DialogTitle>
                            <DialogDescription>You have unsaved changes. Are you sure you want to leave?</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => blocker.reset()}>Cancel</Button>
                            <Button variant="destructive" onClick={() => blocker.proceed()}>Discard & Leave</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {/* Header */}
            <header className="flex-none flex items-center justify-between px-6 py-3 border-b bg-card z-20">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
                        <ArrowLeft className="h-4 w-4"/>
                    </Button>
                    <div className="flex flex-col">
                        <Select value={form.status} onValueChange={v => update("status", v)}>
                            <SelectTrigger className={`h-8 w-[140px] font-medium ${form.status === 'Published' ? 'text-green-600 bg-green-50 border-green-200' : 'text-muted-foreground'}`}>
                                <SelectValue/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Draft">Draft</SelectItem>
                                <SelectItem value="Published">Published</SelectItem>
                                <SelectItem value="Archived">Archived</SelectItem>
                            </SelectContent>
                        </Select>
                        {isDirty ? (
                            <span className="text-[10px] font-bold text-amber-600 animate-pulse">● Unsaved Changes</span>
                        ) : (
                            <span className="text-[10px] text-muted-foreground">All changes saved</span>
                        )}
                    </div>
                    {/* Comments Toggle */}
                    <Select value={form.commentsMode} onValueChange={v => update("commentsMode", v)}>
                        <SelectTrigger className="h-8 w-[110px] text-xs">
                            <SelectValue placeholder="Comments"/>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Enabled">Comments On</SelectItem>
                            <SelectItem value="Locked">Locked (Read)</SelectItem>
                            <SelectItem value="Hidden">Disabled</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-2">
                    {/* --- NEW: HISTORY BUTTON --- */}
                    <Sheet open={isHistoryOpen} onOpenChange={(open) => {
                        setIsHistoryOpen(open);
                        if(open) loadHistory();
                    }}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="sm" title="Version History">
                                <History className="w-4 h-4 text-muted-foreground" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent>
                            <SheetHeader>
                                <SheetTitle>Version History</SheetTitle>
                                <SheetDescription>Restore a previous version of this page.</SheetDescription>
                            </SheetHeader>
                            <div className="mt-6 space-y-4 overflow-y-auto max-h-[80vh] pr-2">
                                {loadingHistory ? (
                                    <div className="flex justify-center py-4"><Loader2 className="animate-spin" /></div>
                                ) : (
                                    history.length === 0 ? (
                                        <p className="text-sm text-muted-foreground text-center">No history yet.</p>
                                    ) : (
                                        history.map((ver: any) => (
                                            <div key={ver.version} className="flex flex-col gap-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                                                <div className="flex justify-between items-start">
                                                    <span className="font-bold text-sm">Version {ver.version}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ver.status === 'Published' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                                                        {ver.status}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {new Date(ver.updatedAt).toLocaleString()}
                                                </div>
                                                <div className="text-xs text-muted-foreground truncate">
                                                    By: {ver.updatedBy || "Unknown"}
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full mt-2 h-7 text-xs"
                                                    onClick={() => handleRestore(ver.version)}
                                                >
                                                    <RotateCcw className="w-3 h-3 mr-2" /> Restore
                                                </Button>
                                            </div>
                                        ))
                                    )
                                )}
                            </div>
                        </SheetContent>
                    </Sheet>
                    {/* Design & SEO SHEET */}
                    <Sheet>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm">
                                <SettingsIcon className="mr-2 h-4 w-4"/> Settings
                            </Button>
                        </SheetTrigger>
                        <SheetContent>
                            <SheetHeader><SheetTitle>Page Configuration</SheetTitle></SheetHeader>
                            <div className="space-y-6 py-6 overflow-y-auto h-full pb-20">

                                <div className="space-y-2">
                                    <Tag className="w-3 h-3" /><Label>Categorization</Label>
                                    <TagInput
                                        value={form.tags}
                                        onChange={(tags) => update("tags", tags)}
                                        availableTags={availableTags}
                                        placeholder="e.g. Blog, Case Study"
                                    />
                                    <p className="text-[10px] text-muted-foreground">Used for filtering Post Grids.</p>
                                </div>

                                {/* 1. DESIGN OVERRIDES */}
                                <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
                                    <div className="flex items-center justify-between border-b pb-2">
                                        <h4 className="text-sm font-semibold flex items-center gap-2">
                                            <Palette className="w-4 h-4 text-primary"/> Design
                                        </h4>
                                        {(Object.keys(form.themeOverride).length > 0 || form.hideNav || form.hideFooter || form.hideSharing) && (
                                            <Button variant="ghost" size="sm" onClick={resetAllDesign}
                                                    className="h-6 text-[10px] text-red-500">
                                                <RotateCcw className="w-3 h-3 mr-1"/> Reset
                                            </Button>
                                        )}
                                    </div>

                                    {/* PRESETS BUTTONS */}
                                    <div className="space-y-2">
                                        <Label className="text-xs font-semibold">Quick Presets</Label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {Object.keys(THEME_PRESETS).map(key => (
                                                <Button
                                                    key={key}
                                                    variant="outline"
                                                    size="sm"
                                                    className="justify-start h-8 text-xs capitalize"
                                                    onClick={() => applyPreset(key)}
                                                >
                                                    <div
                                                        className="w-2 h-2 rounded-full mr-2 border shrink-0"
                                                        style={{backgroundColor: THEME_PRESETS[key].primaryColor}}
                                                    />
                                                    {key}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="h-px bg-border/50 my-2"/>

                                    {/* MODE SELECTOR */}
                                    <div className="space-y-2">
                                        <Label className="text-xs font-semibold">Mode</Label>
                                        <Select
                                            value={form.themeOverride.mode || "light"}
                                            onValueChange={v => updateTheme("mode", v)}
                                        >
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue/>
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="light">Light</SelectItem>
                                                <SelectItem value="dark">Dark</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-muted-foreground">Applies CSS class `.dark` if
                                            selected.</p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                                            <input type="checkbox" checked={form.hideNav}
                                                   onChange={e => update("hideNav", e.target.checked)}
                                                   className="rounded"/>
                                            Hide Navbar
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                                            <input type="checkbox" checked={form.hideFooter}
                                                   onChange={e => update("hideFooter", e.target.checked)}
                                                   className="rounded"/>
                                            Hide Footer
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                                            <input type="checkbox" checked={form.hideSharing}
                                                   onChange={e => update("hideSharing", e.target.checked)}
                                                   className="rounded"/>
                                            Hide Share Buttons
                                        </label>
                                    </div>

                                    <div className="space-y-3">
                                        <Label className="text-xs font-semibold">Colors</Label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <ColorOverride label="Primary" value={form.themeOverride.primaryColor}
                                                           onChange={v => updateTheme("primaryColor", v)}
                                                           onReset={() => resetThemeKey("primaryColor")}/>
                                            <ColorOverride label="Background" value={form.themeOverride.backgroundColor}
                                                           onChange={v => updateTheme("backgroundColor", v)}
                                                           onReset={() => resetThemeKey("backgroundColor")}/>
                                            <ColorOverride label="Text" value={form.themeOverride.textColor}
                                                           onChange={v => updateTheme("textColor", v)}
                                                           onReset={() => resetThemeKey("textColor")}/>
                                            <ColorOverride label="Surface" value={form.themeOverride.surfaceColor}
                                                           onChange={v => updateTheme("surfaceColor", v)}
                                                           onReset={() => resetThemeKey("surfaceColor")}/>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <Label className="text-xs font-semibold">Typography</Label>
                                        <div className="space-y-2">
                                            <Input className="h-8 text-xs" placeholder="Headings Font (e.g. Inter)"
                                                   value={form.themeOverride.fontHeading || ""}
                                                   onChange={e => updateTheme("fontHeading", e.target.value)}/>
                                            <Input className="h-8 text-xs" placeholder="Body Font (e.g. Lato)"
                                                   value={form.themeOverride.fontBody || ""}
                                                   onChange={e => updateTheme("fontBody", e.target.value)}/>
                                        </div>
                                    </div>
                                </div>

                                {/* 2. SEO SECTION */}
                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold border-b pb-1">SEO</h4>
                                    <div className="space-y-2">
                                        <Label>Keywords</Label>
                                        <Input value={form.seoKeywords}
                                               onChange={e => update("seoKeywords", e.target.value)}/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>SEO Title</Label>
                                        <Input value={form.seoTitle} onChange={e => {
                                            update("seoTitle", e.target.value);
                                            setManualSeo(true);
                                        }} placeholder={form.title}/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Description</Label>
                                        <Textarea value={form.seoDescription} onChange={e => {
                                            update("seoDescription", e.target.value);
                                            setManualSeo(true);
                                        }} rows={4}/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Featured Image</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                value={form.featuredImage}
                                                onChange={e => {
                                                    update("featuredImage", e.target.value);
                                                    setManualSeo(true);
                                                }}
                                                placeholder="https://..."
                                            />
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                onClick={() => setMediaPickerOpen(true)}
                                                title="Select from Library"
                                            >
                                                <Palette className="h-4 w-4"/> {/* Or ImageIcon */}
                                            </Button>
                                        </div>
                                        {form.featuredImage && (
                                            <div
                                                className="mt-2 relative aspect-video rounded-md overflow-hidden border">
                                                <img src={form.featuredImage} className="w-full h-full object-cover"
                                                     alt="Featured"/>
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Schema Override</Label>
                                        <Select
                                            value={form.schemaType || "Default"}
                                            onValueChange={v => update("schemaType", v === "Default" ? undefined : v)}
                                        >
                                            <SelectTrigger><SelectValue
                                                placeholder="Default (Inherit)"/></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Default">Default (Inherit)</SelectItem>
                                                <SelectItem value="WebPage">WebPage (Standard)</SelectItem>
                                                <SelectItem value="Article">Article (Blog Post)</SelectItem>
                                                <SelectItem value="SoftwareApplication">Software App
                                                    (Landing)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* 3. ACCESS CONTROL */}
                                <div className="space-y-4 rounded-xl border bg-amber-50/50 p-4 shadow-sm">
                                    <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                                        <h4 className="text-sm font-semibold flex items-center gap-2 text-amber-900">
                                            <Lock className="w-4 h-4 text-amber-600"/> Access
                                        </h4>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Visibility</Label>
                                        <Select
                                            value={form.accessPolicy?.type || "Public"}
                                            onValueChange={v => update("accessPolicy", { ...form.accessPolicy, type: v })}
                                        >
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Public">Public (Everyone)</SelectItem>
                                                <SelectItem value="LoginRequired">Login Required (Members)</SelectItem>
                                                {/* <SelectItem value="Purchase">Purchase Required (Product)</SelectItem> */}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-muted-foreground">
                                            {form.accessPolicy?.type === 'LoginRequired'
                                                ? "Visitors must sign in with Google to view this page."
                                                : "Page is visible to the world."}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>

                    <Button onClick={save} disabled={saving || !isDirty}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                        Save
                    </Button>
                </div>
            </header>

            <main className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-4xl mx-auto w-full p-8 pb-32">
                        {/* Title & Slug Inputs */}
                        <div className="space-y-6 mb-8">
                            <div className="space-y-2">
                                <Label className="text-muted-foreground">Page Title</Label>
                                <Input
                                    value={form.title}
                                    onChange={(e) => update("title", e.target.value)}
                                    className="text-4xl font-black h-auto py-2 border-transparent hover:border-input focus:border-input px-0 bg-transparent shadow-none rounded-none border-b focus-visible:ring-0"
                                    placeholder="Untitled Page"
                                />
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>URL:</span>
                                <span className="font-mono bg-muted/50 px-2 py-0.5 rounded">/</span>
                                <Input
                                    value={form.slug.replace(/^\//, '')}
                                    onChange={(e) => update("slug", e.target.value)}
                                    className="font-mono h-auto py-0.5 px-1 w-auto min-w-[200px] border-transparent hover:border-input focus:border-input bg-transparent shadow-none"
                                />
                            </div>
                            {needsSlugReview(slugWithLeadingSlash) && (
                                <p className="text-xs text-red-600">
                                    {form.slug === serverState?.slug
                                        ? `This URL does not follow the site's slug rules and is served exactly as shown. If you change it, it is saved as ${normalizeSlug(form.slug)} and the old URL redirects to the new one.`
                                        : `Will be saved as ${normalizeSlug(form.slug)}.`}
                                </p>
                            )}
                            {siteLanguages && id && (() => {
                                const site = siteLanguages;
                                const self = { nodeId: id, slug: slugWithLeadingSlash, status: form.status };
                                const choices = translationChoices(listedPages, self, site);
                                const set = translationSetView(listedPages, self, site);
                                return (
                                    <div className="space-y-2 text-sm text-muted-foreground">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span>Language:</span>
                                            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                                                    value={languageSelectValue(pageLanguageOf(slugWithLeadingSlash, site.languages))}
                                                    onChange={e => update("slug", slugInLanguage(form.slug, site.languages, e.target.value === "" ? null : e.target.value))}>
                                                <option value="">{languageName(site.defaultSubtag)} ({site.defaultSubtag}, default)</option>
                                                {site.languages.map(l => <option key={l} value={l}>{languageName(l)} ({l})</option>)}
                                            </select>
                                            <span>Translation of:</span>
                                            <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm max-w-[360px]" value={choiceSelectValue(translationChoice)}
                                                    onChange={e => setTranslationChoice(choiceFromSelectValue(e.target.value))}>
                                                <option value={choiceSelectValue({ kind: "unchanged" })}>{set.members.length > 0 ? "Keep the current set" : "No change"}</option>
                                                <option value={choiceSelectValue({ kind: "leave" })}>Not a translation</option>
                                                {choices.map(p => (
                                                    <option key={p.nodeId} value={p.nodeId}>{`${p.title || "Untitled"} — ${String(p.slug)} (${languageTagOfSlug(p.slug, site)})`}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {set.members.length > 0 && (
                                            <ul className="text-xs space-y-0.5">
                                                {set.members.map(m => (
                                                    <li key={m.page.nodeId}>
                                                        {languageName(m.tag)} ({m.tag}) → {String(m.page.slug)}{m.page.nodeId === id ? " (this page)" : ""}{m.published ? "" : ` — ${m.page.status || "not published"}, not listed for search engines`}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {set.sharedTags.map(tag => (
                                            <p key={tag} className="text-xs text-destructive">Two pages in {languageName(tag)}: neither is listed for search engines. Change the address or the set of one of them.</p>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Editor */}
                        <BlockEditor
                            key={id}
                            initialContent={serverState?.blocks}
                            onChange={(newBlocks) => update("blocks", newBlocks)}
                        />
                    </div>
                </div>
            </main>
            <MediaPicker
                open={mediaPickerOpen}
                onOpenChange={setMediaPickerOpen}
                onSelect={(url) => {
                    update("featuredImage", url);
                    setManualSeo(true);
                }}
            />
        </div>
    );
}
