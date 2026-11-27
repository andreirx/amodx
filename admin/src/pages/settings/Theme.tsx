// Settings page: the theme cards: Typography, the light/dark tab switch, the theme card, Interface, Page Background Effect.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Type, MousePointerClick, Sun, Moon, Save, Trash2, Sparkles } from "lucide-react";
import { EffectControls } from "@amodx/plugins/common/EffectControls";
import { THEME_PRESETS } from "@amodx/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Dispatch, SetStateAction } from "react";
import type { TenantConfig } from "@amodx/shared";
import type { SettingsDraft } from "./draft";
import { ColorInput } from "./ColorInput";

// ── CAT-THEME-1 (docs/slices/cat-theme-1.md § 3; record docs/slices/cat-theme-1-impl.md § 3): the theme details. ──────
// Every control here is a native element or an `Input` (no React `useId`), and each group is the LAST child of its
// parent in the page: the page's other markup, and the ids React derives from the tree, stay as captured
// (Settings.test.ts removes exactly these groups' own renders). Clearing a control removes its key (`undefined`, which
// the JSON body omits), so an untouched or cleared field is absent — the renderer's "today" for every field.

/** Sets one theme key on the tab being edited; `undefined` removes it. (The page's `updateTheme`.) */
export type ThemeKeySetter = (key: string, value: unknown) => void;

/**
 * The page's theme write, unchanged in behaviour (moved out of `updateTheme` so a test can drive it): the light tab
 * writes `theme`; the dark tab writes `darkTheme`, which starts as a copy of `theme` when absent. Review-0 R-CT-3: every
 * theme control READS the theme this function writes — the page's `activeConfig` (`darkTheme || theme` on the dark tab).
 */
export function withThemeKey<T extends Pick<SettingsDraft, "theme" | "darkTheme">>(config: T, tab: "light" | "dark", key: string, value: unknown): T {
    if (tab === "light") return { ...config, theme: { ...(config.theme || {}), [key]: value } as any };   // Zod/TS mismatch
    const dark = config.darkTheme || { ...(config.theme || {}) };
    return { ...config, darkTheme: { ...dark, [key]: value } as any };
}
type ThemeDraft = Partial<TenantConfig["theme"]> | undefined;

/** The weights a theme may add to the always-requested 400 and 700 (CT-D2 = B). */
export const EXTRA_FONT_WEIGHTS = [100, 200, 300, 500, 600, 800, 900] as const;

/** Typography card: the nav font, the additional weights, the heading weight. */
export function TypographyDetails({ theme, onChange }: { theme: ThemeDraft; onChange: ThemeKeySetter }) {
    const weights = theme?.fontWeights ?? [];
    const toggleWeight = (w: number, on: boolean) => {
        const next = (on ? [...weights, w] : weights.filter((x) => x !== w)).sort((a, b) => a - b);
        onChange("fontWeights", next.length ? next : undefined);
    };
    return (
        <>
            <div className="space-y-2">
                <Label>Nav Font (Google Fonts)</Label>
                <Input placeholder="Leave empty to keep the body font" value={theme?.fontNav || ""} onChange={e => onChange("fontNav", e.target.value || undefined)} />
            </div>
            <div className="space-y-2">
                <Label>Additional Weights</Label>
                <div className="flex flex-wrap gap-3 text-sm">
                    {EXTRA_FONT_WEIGHTS.map((w) => (
                        <label key={w} className="flex items-center gap-1">
                            <input type="checkbox" checked={weights.includes(w)} onChange={e => toggleWeight(w, e.target.checked)} />{w}
                        </label>
                    ))}
                </div>
                <p className="text-[10px] text-muted-foreground">400 and 700 are always loaded, for every theme font.</p>
            </div>
            <div className="space-y-2">
                <Label>Heading Weight</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={theme?.headingWeight ?? ""}
                        onChange={e => onChange("headingWeight", e.target.value ? Number(e.target.value) : undefined)}>
                    <option value="">Default (as today)</option>
                    {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
                <p className="text-[10px] text-muted-foreground">Tick the same weight above if it is not 400 or 700.</p>
            </div>
        </>
    );
}

/** Theme card, Palette: the muted-text and hairline colours (absent: #64748b and #e2e8f0, as today). */
export function ThemeColorDetails({ theme, onChange }: { theme: ThemeDraft; onChange: ThemeKeySetter }) {
    return (
        <>
            <ColorInput label="Muted Text" value={theme?.mutedColor} onChange={v => onChange("mutedColor", v || undefined)} />
            <ColorInput label="Hairlines" value={theme?.borderColor} onChange={v => onChange("borderColor", v || undefined)} />
        </>
    );
}

/** Theme card (light tab): the shape preset and the Cards group. */
export function ShapeAndCards({ theme, onChange }: { theme: ThemeDraft; onChange: ThemeKeySetter }) {
    const select = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm";
    return (
        <div className="space-y-2 pt-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Shape</Label>
            <select className={select} value={theme?.shape || "default"} onChange={e => onChange("shape", e.target.value === "default" ? undefined : e.target.value)}>
                <option value="default">Default</option>
                <option value="editorial">Editorial: no shadows, hairlines, wider spacing, ↗ after links</option>
            </select>
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Cards</Label>
            <select className={select} value={theme?.cardImage || "square"} onChange={e => onChange("cardImage", e.target.value === "square" ? undefined : e.target.value)}>
                <option value="square">Square image</option>
                <option value="landscape">Landscape image (245px)</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={theme?.cardCategoryLine === true} onChange={e => onChange("cardCategoryLine", e.target.checked || undefined)} />
                Show the first category under the title
            </label>
        </div>
    );
}

/** The "Typography" card; it reads the theme of the selected tab. */
export function TypographyCard({ activeConfig, updateTheme }: { activeConfig: ThemeDraft; updateTheme: ThemeKeySetter }) {
    return (
        <Card className="space-y-6">
            <CardHeader className="pb-4">
                <div className="flex items-center gap-2">
                    <Type className="h-5 w-5 text-muted-foreground"/>
                    <CardTitle>Typography</CardTitle>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex-1 space-y-4">
                    <div className="space-y-2">
                        <Label>Heading Font (Google Fonts)</Label>
                        <Input placeholder="Prata" value={activeConfig?.fontHeading || ""}
                               onChange={e => updateTheme("fontHeading", e.target.value)}/>
                    </div>
                    <div className="space-y-2">
                        <Label>Body Font (Google Fonts)</Label>
                        <Input placeholder="Lato" value={activeConfig?.fontBody || ""} onChange={e => updateTheme("fontBody", e.target.value)} />
                    </div>
                    <TypographyDetails theme={activeConfig} onChange={updateTheme} />
                </div>
            </CardContent>
        </Card>
    );
}

/** The Light Mode / Dark Mode switch of the theme cards. */
export function ThemeTabSwitch({ activeTab, setActiveTab }: { activeTab: "light" | "dark"; setActiveTab: (tab: "light" | "dark") => void }) {
    return (
        <div className="flex bg-muted p-1 rounded-lg">
            <button
                onClick={() => setActiveTab('light')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'light' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
                <Sun className="w-4 h-4" /> Light Mode
            </button>
            <button
                onClick={() => setActiveTab('dark')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'dark' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
                <Moon className="w-4 h-4" /> Dark Mode
            </button>
        </div>
    );
}

/** The theme card ("Standard Theme" / "Dark Mode Overrides"): presets, custom themes, palette, shape. */
export function ThemeCard({ activeTab, activeConfig, updateTheme, setConfig, customThemes, deleteTheme, isSaveThemeOpen, setIsSaveThemeOpen, newThemeName, setNewThemeName, saveCurrentTheme }: { activeTab: "light" | "dark"; activeConfig: ThemeDraft; updateTheme: ThemeKeySetter; setConfig: Dispatch<SetStateAction<SettingsDraft>>; customThemes: any[]; deleteTheme: (id: string) => void; isSaveThemeOpen: boolean; setIsSaveThemeOpen: (open: boolean) => void; newThemeName: string; setNewThemeName: (name: string) => void; saveCurrentTheme: () => void }) {
    const applyPreset = (presetTheme: any) => {
        if (activeTab === 'light') {
            setConfig(prev => ({
                ...prev,
                theme: { ...(prev.theme || {}), ...presetTheme } as any
            }));
        } else {
            setConfig(prev => {
                const base = prev.darkTheme || prev.theme || {};
                return {
                    ...prev,
                    darkTheme: { ...base, ...presetTheme } as any
                };
            });
        }
    };
    return (
        <Card className={activeTab === 'dark' ? "border-indigo-200 bg-slate-50" : ""}>
            <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{activeTab === 'light' ? 'Standard Theme' : 'Dark Mode Overrides'}</CardTitle>

                    <Dialog open={isSaveThemeOpen} onOpenChange={setIsSaveThemeOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="icon" title="Save current styles as Theme">
                                <Save className="h-4 w-4" />
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader><DialogTitle>Save Custom Theme</DialogTitle></DialogHeader>
                            <div className="space-y-4 py-4">
                                <Label>Theme Name</Label>
                                <Input value={newThemeName} onChange={e => setNewThemeName(e.target.value)} placeholder="e.g. Winter Sale 2025" />
                                <Button onClick={saveCurrentTheme} className="w-full">Save Theme</Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
                <CardDescription>
                    {activeTab === 'light' ? "Default appearance for all visitors." : "Applied when user system preference is Dark."}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">

                {/* PRESETS */}
                <div className="space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase">Load Preset</Label>
                    <div className="grid grid-cols-2 gap-2">
                        {/* Built-in Presets */}
                        {Object.keys(THEME_PRESETS).map(key => (
                            <Button key={key} variant="outline" size="sm" className="justify-start h-8 text-xs capitalize" onClick={() => applyPreset(THEME_PRESETS[key])}>
                                <div className="w-2 h-2 rounded-full mr-2 border shrink-0" style={{ backgroundColor: THEME_PRESETS[key].primaryColor }} />
                                {key}
                            </Button>
                        ))}
                        {/* Custom Themes */}
                        {customThemes.map(t => (
                            <div key={t.id} className="group relative">
                                <Button variant="outline" size="sm" className="w-full justify-start h-8 text-xs" onClick={() => applyPreset(t.theme)}>
                                    <div className="w-2 h-2 rounded-full mr-2 border shrink-0" style={{ backgroundColor: t.theme.primaryColor }} />
                                    <span className="truncate">{t.name}</span>
                                </Button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); deleteTheme(t.id); }}
                                    className="absolute right-1 top-1 p-1 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="h-px bg-border" />

                {/* COLORS */}
                <div className="space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase">Palette</Label>
                    <ColorInput label="Background" value={activeConfig?.backgroundColor} onChange={v => updateTheme("backgroundColor", v)} />
                    <ColorInput label="Text Color" value={activeConfig?.textColor} onChange={v => updateTheme("textColor", v)} />
                    <ColorInput label="Primary" value={activeConfig?.primaryColor} onChange={v => updateTheme("primaryColor", v)} />
                    <ColorInput label="Primary Text" value={activeConfig?.primaryForeground} onChange={v => updateTheme("primaryForeground", v)} />
                    <ColorInput label="Secondary" value={activeConfig?.secondaryColor} onChange={v => updateTheme("secondaryColor", v)} />
                    <ColorInput label="Surface" value={activeConfig?.surfaceColor} onChange={v => updateTheme("surfaceColor", v)} />
                    <ThemeColorDetails theme={activeConfig} onChange={updateTheme} />
                </div>

                {/* SETTINGS-FINDINGS-1 (F-RS1-DUP-FONT-FIELDS): the heading and body fonts are edited in the Typography card
                    only (this card repeated the two fields: same value, same setter). */}
                {activeTab === 'light' && <ShapeAndCards theme={activeConfig} onChange={updateTheme} />}
            </CardContent>
        </Card>
    );
}

/**
 * The "Interface" card. SETTINGS-FINDINGS-1 (F-RS1-INTERFACE-READS-LIGHT): the renderer reads the radius from `theme`
 * only and reads no `darkTheme` (renderer/src/components/ThemeInjector.tsx, `theme.radius`), so the field reads and
 * writes `theme.radius` on both tabs: it shows the value it writes, and it never stores a dark-theme radius.
 * F-RS1-MODE-TODO: the card had a "Mode" select (`theme.mode`); nothing reads `theme.mode` (no renderer, backend, MCP
 * or plugin read), so the control is removed. A stored `theme.mode` stays in the draft and Save sends it back; the
 * schema keeps the field.
 */
export function InterfaceCard({ config, setConfig }: { config: SettingsDraft; setConfig: Dispatch<SetStateAction<SettingsDraft>> }) {
    return (
        <Card className="space-y-6">
            <CardHeader className="pb-4">
                <div className="flex items-center gap-2">
                    <MousePointerClick className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Interface</CardTitle>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="gap-4">
                    <div className="space-y-2">
                        <Label>Border Radius</Label>
                        <div className="flex items-center gap-4">
                            <Input className="max-w-[100px]" value={config.theme?.radius || "0.5rem"} onChange={e => setConfig(prev => withThemeKey(prev, "light", "radius", e.target.value))} />
                            <div className="h-8 w-16 border-2 border-primary bg-secondary" style={{ borderRadius: config.theme?.radius }} />
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

/** The "Page Background Effect" card. */
export function PageEffectCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Page Background Effect</CardTitle>
                </div>
                <CardDescription>
                    Ambient GPU-accelerated background effect applied site-wide behind all content.
                    Automatically disabled on devices with reduced motion or no WebGPU support.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <EffectControls
                    effect={config.pageEffect as any}
                    onChange={eff => setConfig({ ...config, pageEffect: eff as any })}
                    scope="background"
                    label="Page Effect"
                />
            </CardContent>
        </Card>
    );
}
