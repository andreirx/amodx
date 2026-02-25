import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import type { TenantConfig } from "@amodx/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import {
    Loader2,
    ExternalLink,
    Palette,
    Type,
    MousePointerClick,
    AlertCircle,
    Mail,
    Key,
    Sun,
    Moon,
    Save
} from "lucide-react";
import { uploadFile } from "@/lib/upload";
import { Plus, Trash2, Upload, ShoppingBag } from "lucide-react";
import { ShieldCheck } from "lucide-react";
import { SmartLinkInput } from "@/components/ui/smart-link-input";
import { THEME_PRESETS, COUNTRY_PACKS, getCountryPack } from "@amodx/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";

// HELPER: Get Config at Runtime (Fixes the "Relative Link" bug)
const getRendererUrl = () => {
    // @ts-ignore
    const url = window.AMODX_CONFIG?.VITE_RENDERER_URL || import.meta.env.VITE_RENDERER_URL || "";
    return url.replace(/\/$/, "");
};

export default function SettingsPage() {
    const { currentTenant } = useTenant();
    const [config, setConfig] = useState<Partial<TenantConfig>>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Country pack apply dialog
    const [pendingPackCode, setPendingPackCode] = useState<string | null>(null);

    // Theme Engine State
    const [activeTab, setActiveTab] = useState<'light' | 'dark'>('light');
    const [customThemes, setCustomThemes] = useState<any[]>([]);
    const [isSaveThemeOpen, setIsSaveThemeOpen] = useState(false);
    const [newThemeName, setNewThemeName] = useState("");

    // Get the URL dynamically so it works in Prod and Local
    const rendererUrl = getRendererUrl();

    useEffect(() => {
        if (currentTenant) {
            loadSettings();
        }
    }, [currentTenant?.id]);

    async function loadSettings() {
        setLoading(true);
        setError(null);
        try {
            const data = await apiRequest("/settings");
            setConfig(data);
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to load settings");
        } finally {
            setLoading(false);
        }
    }

    async function loadCustomThemes() {
        try {
            const res = await apiRequest("/themes");
            setCustomThemes(res.items || []);
        } catch (e) {
            console.warn("Failed to load themes", e);
        }
    }

    async function save() {
        setSaving(true);
        setError(null);
        try {
            await apiRequest("/settings", {
                method: "PUT",
                body: JSON.stringify(config)
            });
            window.location.reload();
        } catch (e: any) {
            setError(e.message || "Failed to save settings");
        } finally {
            setSaving(false);
        }
    }

    async function saveCurrentTheme() {
        if (!newThemeName) return;
        try {
            // Save whichever tab is active
            const themeToSave = activeTab === 'light' ? config.theme : config.darkTheme;
            await apiRequest("/themes", {
                method: "POST",
                body: JSON.stringify({ name: newThemeName, theme: themeToSave })
            });
            setIsSaveThemeOpen(false);
            setNewThemeName("");
            loadCustomThemes();
        } catch (e: any) {
            alert(e.message);
        }
    }

    async function deleteTheme(id: string) {
        if (!confirm("Delete this theme?")) return;
        await apiRequest(`/themes/${id}`, { method: "DELETE" });
        loadCustomThemes();
    }

    // Helper for array fields (Nav Links)
    const addLink = (field: 'navLinks' | 'footerLinks') => {
        const current = config[field] || [];
        setConfig({ ...config, [field]: [...current, { label: "New Link", href: "/" }] });
    };

    const updateLink = (field: 'navLinks' | 'footerLinks', index: number, key: 'label' | 'href', val: string) => {
        const current = [...(config[field] || [])];
        current[index] = { ...current[index], [key]: val };
        setConfig({ ...config, [field]: current });
    };

    const removeLink = (field: 'navLinks' | 'footerLinks', index: number) => {
        const current = (config[field] || []).filter((_, i) => i !== index);
        setConfig({ ...config, [field]: current });
    };

    // Convert a simple link to a dropdown menu
    const toggleLinkDropdown = (index: number, isDropdown: boolean) => {
        const current = [...(config.navLinks || [])];
        if (isDropdown) {
            // Convert to dropdown - add empty children array
            current[index] = { ...current[index], children: [] };
        } else {
            // Convert to simple link - remove children
            const { children, ...rest } = current[index] as any;
            current[index] = rest;
        }
        setConfig({ ...config, navLinks: current });
    };

    // Add a child link to a dropdown menu
    const addChildLink = (parentIndex: number) => {
        const current = [...(config.navLinks || [])];
        const children = current[parentIndex].children || [];
        current[parentIndex] = {
            ...current[parentIndex],
            children: [...children, { label: "Sub-link", href: "/" }]
        };
        setConfig({ ...config, navLinks: current });
    };

    // Update a child link
    const updateChildLink = (parentIndex: number, childIndex: number, key: 'label' | 'href', val: string) => {
        const current = [...(config.navLinks || [])];
        const children = [...(current[parentIndex].children || [])];
        children[childIndex] = { ...children[childIndex], [key]: val };
        current[parentIndex] = { ...current[parentIndex], children };
        setConfig({ ...config, navLinks: current });
    };

    // Remove a child link
    const removeChildLink = (parentIndex: number, childIndex: number) => {
        const current = [...(config.navLinks || [])];
        const children = (current[parentIndex].children || []).filter((_, i) => i !== childIndex);
        current[parentIndex] = { ...current[parentIndex], children };
        setConfig({ ...config, navLinks: current });
    };

// Smart Theme Updater (Targeting correct tab)
    const updateTheme = (key: string, val: string) => {
        if (activeTab === 'light') {
            setConfig(prev => {
                const currentTheme = prev.theme || {};
                return {
                    ...prev,
                    theme: { ...currentTheme, [key]: val } as any // Force cast to satisfy Zod/TS mismatch
                };
            });
        } else {
            setConfig(prev => {
                const currentTheme = prev.theme || {};
                const currentDark = prev.darkTheme || { ...currentTheme };
                return {
                    ...prev,
                    darkTheme: { ...currentDark, [key]: val } as any
                };
            });
        }
    };

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

    const updateUrlPrefix = (key: string, val: string) => {
        setConfig(prev => ({
            ...prev,
            urlPrefixes: { ...prev.urlPrefixes!, [key]: val }
        }));
    };

    const updateIntegration = (key: string, val: any) => {
        setConfig(prev => ({
            ...prev,
            integrations: { ...prev.integrations!, [key]: val }
        }));
    };

    const updateHeader = (key: string, val: boolean | string) => {
        setConfig(prev => ({
            ...prev,
            header: { ...prev.header!, [key]: val }
        }));
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            setLoading(true);
            try {
                const url = await uploadFile(e.target.files[0]);
                setConfig({ ...config, logo: url });
            } catch (err) {
                alert("Upload failed");
            } finally {
                setLoading(false);
            }
        }
    };

    // Guard Clause
    if (!currentTenant) {
        return (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] text-muted-foreground">
                <Palette className="h-10 w-10 mb-4 opacity-20" />
                <p>Select a site to configure settings.</p>
            </div>
        );
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    const previewUrl = rendererUrl && config.id ? `${rendererUrl}/_site/${config.id}` : "#";

    // Helper for active theme config
    const activeConfig = activeTab === 'light' ? config.theme : (config.darkTheme || config.theme);

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-8 pb-20">
            <div className="flex justify-between items-center border-b pb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
                    <p className="text-muted-foreground mt-1">Manage identity and appearance for <span className="font-semibold text-foreground">{config.name}</span></p>
                </div>
                <Button onClick={save} disabled={saving} size="lg">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* LEFT COLUMN */}
                <div className="lg:col-span-2 space-y-8">

                    {/* IDENTITY & LOGO */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Site Identity</CardTitle>
                            <CardDescription>Technical details and domains</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex gap-6 items-start">
                                {/* Logo Upload */}
                                <div className="space-y-2">
                                    <Label>Logo</Label>
                                    <div
                                        className="relative w-32 h-32 bg-muted/30 border-2 border-dashed border-muted-foreground/20 rounded-lg flex flex-col items-center justify-center hover:bg-muted/50 transition-colors overflow-hidden group">
                                        {config.logo ? (
                                            <>
                                                <img src={config.logo} alt="Logo"
                                                     className="w-full h-full object-contain p-2"/>
                                                <div
                                                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                    <label
                                                        className="cursor-pointer text-white text-xs font-medium p-2">
                                                        Change
                                                        <input type="file" className="hidden" accept="image/*"
                                                               onChange={handleLogoUpload}/>
                                                    </label>
                                                </div>
                                            </>
                                        ) : (
                                            <label
                                                className="cursor-pointer flex flex-col items-center justify-center w-full h-full">
                                                <Upload className="h-6 w-6 text-muted-foreground mb-2"/>
                                                <span className="text-xs text-muted-foreground">Upload</span>
                                                <input type="file" className="hidden" accept="image/*"
                                                       onChange={handleLogoUpload}/>
                                            </label>
                                        )}
                                    </div>
                                    {/* NEW: Header Toggles */}
                                    <div className="flex flex-col gap-2 mt-2">
                                        <label
                                            className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={config.header?.showLogo ?? true}
                                                onChange={e => updateHeader('showLogo', e.target.checked)}
                                                className="rounded border-gray-300"
                                            />
                                            Show in Header
                                        </label>
                                    </div>
                                </div>

                                <div className="flex-1 space-y-4">
                                    <div className="space-y-2">
                                        <Label>Site Name</Label>
                                        <Input value={config.name || ""}
                                               onChange={e => setConfig({...config, name: e.target.value})}/>
                                        <label
                                            className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={config.header?.showTitle ?? true}
                                                onChange={e => updateHeader('showTitle', e.target.checked)}
                                                className="rounded border-gray-300"
                                            />
                                            Show Name in Header
                                        </label>
                                    </div>

                                    {/* NEW: Description */}
                                    <div className="space-y-2">
                                        <Label>Site Description</Label>
                                        <textarea
                                            className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                            value={config.description || ""}
                                            onChange={e => setConfig({...config, description: e.target.value})}
                                            placeholder="Used for SEO meta tags and AI crawlers (llms.txt)."
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>SEO Entity Type (Schema.org)</Label>
                                        <Select
                                            value={config.schemaType || "Organization"}
                                            onValueChange={v => setConfig({...config, schemaType: v as any})}
                                        >
                                            <SelectTrigger><SelectValue/></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Organization">Organization (Standard)</SelectItem>
                                                <SelectItem value="Corporation">Corporation</SelectItem>
                                                <SelectItem value="LocalBusiness">Local Business</SelectItem>
                                                <SelectItem value="SoftwareApplication">Software Application
                                                    (SaaS)</SelectItem>
                                                <SelectItem value="Person">Person (Portfolio)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-muted-foreground">
                                            Defines what this site "is" to Google.
                                            Use 'SoftwareApplication' for AMODX.
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Production Domain</Label>
                                <Input
                                    value={config.domain || ""}
                                    onChange={e => setConfig({...config, domain: e.target.value})}
                                    placeholder="client.com"
                                />
                            </div>

                            <div className="p-3 bg-secondary/50 rounded-md flex items-center justify-between">
                                <div className="space-y-0.5">
                                    <div className="text-xs text-muted-foreground">Preview Link</div>
                                    <div className="text-xs font-mono truncate max-w-md select-all">{previewUrl}</div>
                                </div>
                                <Button variant="ghost" size="sm" asChild className="h-8">
                                    <a href={previewUrl} target="_blank" rel="noreferrer">Open <ExternalLink
                                        className="ml-2 h-3 w-3"/></a>
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* NAVBAR & LAYOUT SIZES */}
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
                                            <SelectItem value="max-w-5xl">5xl (1024px)</SelectItem>
                                            <SelectItem value="max-w-6xl">6xl (1152px)</SelectItem>
                                            <SelectItem value="max-w-7xl">7xl (1280px)</SelectItem>
                                            <SelectItem value="max-w-screen-xl">Screen XL (1280px)</SelectItem>
                                            <SelectItem value="max-w-screen-2xl">Screen 2XL (1536px)</SelectItem>
                                            <SelectItem value="max-w-[1700px]">Custom 1700px</SelectItem>
                                            <SelectItem value="max-w-[1920px]">Full HD (1920px)</SelectItem>
                                            <SelectItem value="max-w-full">Full Width</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-[10px] text-muted-foreground">Navbar, top bar, commerce bar, footer, product/shop pages.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label>Content Page Width</Label>
                                    <Select value={config.header?.contentPageMaxWidth || "max-w-4xl"} onValueChange={v => updateHeader("contentPageMaxWidth", v)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="max-w-2xl">2xl (672px)</SelectItem>
                                            <SelectItem value="max-w-3xl">3xl (768px)</SelectItem>
                                            <SelectItem value="max-w-4xl">4xl (896px)</SelectItem>
                                            <SelectItem value="max-w-5xl">5xl (1024px)</SelectItem>
                                            <SelectItem value="max-w-6xl">6xl (1152px)</SelectItem>
                                            <SelectItem value="max-w-7xl">7xl (1280px)</SelectItem>
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
                        </CardContent>
                    </Card>

                    {/* COMMERCE TOGGLE */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Commerce</CardTitle>
                            </div>
                            <CardDescription>Enable the full e-commerce flow: cart, checkout, orders, delivery, and coupons. Products, categories, and Paddle purchases work without this.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.commerceEnabled ?? false}
                                    onChange={e => setConfig({ ...config, commerceEnabled: e.target.checked })}
                                    className="rounded border-gray-300 h-5 w-5"
                                />
                                <div>
                                    <span className="font-medium text-sm">Enable Commerce</span>
                                    <p className="text-xs text-muted-foreground">Shows cart in navbar, enables checkout flow, orders management, delivery settings, and coupons.</p>
                                </div>
                            </label>
                        </CardContent>
                    </Card>

                    {/* DIGITAL SALES (PADDLE) */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Digital Sales (Paddle)</CardTitle>
                            <CardDescription>Configure Paddle for selling digital products. Currency, geofencing, and pricing are managed in your Paddle dashboard.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Environment</Label>
                                <select
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                                    value={config.integrations?.paddle?.environment || "sandbox"}
                                    onChange={e => setConfig({
                                        ...config,
                                        integrations: {
                                            ...config.integrations!,
                                            paddle: {
                                                ...config.integrations?.paddle,
                                                environment: e.target.value as "sandbox" | "production"
                                            }
                                        }
                                    })}
                                >
                                    <option value="sandbox">Sandbox (Testing)</option>
                                    <option value="production">Production (Live)</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label>Client Token</Label>
                                <Input
                                    value={config.integrations?.paddle?.clientToken || ""}
                                    onChange={e => setConfig({
                                        ...config,
                                        integrations: {
                                            ...config.integrations!,
                                            paddle: {
                                                environment: config.integrations?.paddle?.environment || "sandbox",
                                                ...config.integrations?.paddle,
                                                clientToken: e.target.value
                                            }
                                        }
                                    })}
                                    placeholder="test_..."
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* COMMERCE BAR */}
                    {config.commerceEnabled && (
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Commerce Bar</CardTitle>
                            </div>
                            <CardDescription>Utility bar above the navbar with phone, social links, cart total, and optional CTA button.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.commerceBar?.enabled ?? false}
                                    onChange={e => setConfig({ ...config, commerceBar: { ...config.commerceBar, enabled: e.target.checked } as any })}
                                    className="rounded border-gray-300 h-5 w-5"
                                />
                                <div>
                                    <span className="font-medium text-sm">Enable Commerce Bar</span>
                                    <p className="text-xs text-muted-foreground">Shows a utility row above the navbar on desktop.</p>
                                </div>
                            </label>

                            {config.commerceBar?.enabled && (<>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label>Bar Height</Label>
                                    <select
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        value={config.commerceBar?.height || "h-10"}
                                        onChange={e => setConfig({ ...config, commerceBar: { ...config.commerceBar, height: e.target.value } as any })}
                                    >
                                        <option value="h-8">32px</option>
                                        <option value="h-10">40px (default)</option>
                                        <option value="h-12">48px</option>
                                        <option value="h-14">56px</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Font Size</Label>
                                    <select
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        value={config.commerceBar?.fontSize || "text-sm"}
                                        onChange={e => setConfig({ ...config, commerceBar: { ...config.commerceBar, fontSize: e.target.value } as any })}
                                    >
                                        <option value="text-xs">12px</option>
                                        <option value="text-sm">14px (default)</option>
                                        <option value="text-base">16px</option>
                                        <option value="text-lg">18px</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Icon Size</Label>
                                    <select
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        value={config.commerceBar?.iconSize || "h-5 w-5"}
                                        onChange={e => setConfig({ ...config, commerceBar: { ...config.commerceBar, iconSize: e.target.value } as any })}
                                    >
                                        <option value="h-4 w-4">16px</option>
                                        <option value="h-5 w-5">20px (default)</option>
                                        <option value="h-6 w-6">24px</option>
                                        <option value="h-7 w-7">28px</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Phone Number</Label>
                                    <Input
                                        value={config.commerceBar?.phone || ""}
                                        onChange={e => setConfig({ ...config, commerceBar: { ...config.commerceBar, phone: e.target.value } as any })}
                                        placeholder="0762 271 715"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>WhatsApp Number</Label>
                                    <Input
                                        value={config.commerceBar?.whatsappNumber || ""}
                                        onChange={e => setConfig({ ...config, commerceBar: { ...config.commerceBar, whatsappNumber: e.target.value } as any })}
                                        placeholder="+40762271715"
                                    />
                                </div>
                            </div>

                            {/* Social Links */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>Social Links</Label>
                                    <Button variant="outline" size="sm" onClick={() => {
                                        const links = [...(config.commerceBar?.socialLinks || []), { platform: "facebook" as const, url: "" }];
                                        setConfig({ ...config, commerceBar: { ...config.commerceBar, socialLinks: links } as any });
                                    }}>
                                        <Plus className="h-4 w-4 mr-1" /> Add
                                    </Button>
                                </div>
                                {(config.commerceBar?.socialLinks || []).map((link: any, i: number) => (
                                    <div key={i} className="flex gap-2 items-center">
                                        <Select
                                            value={link.platform}
                                            onValueChange={(val) => {
                                                const links = [...(config.commerceBar?.socialLinks || [])];
                                                links[i] = { ...links[i], platform: val as any };
                                                setConfig({ ...config, commerceBar: { ...config.commerceBar, socialLinks: links } as any });
                                            }}
                                        >
                                            <SelectTrigger className="w-36">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="facebook">Facebook</SelectItem>
                                                <SelectItem value="instagram">Instagram</SelectItem>
                                                <SelectItem value="tiktok">TikTok</SelectItem>
                                                <SelectItem value="youtube">YouTube</SelectItem>
                                                <SelectItem value="twitter">Twitter/X</SelectItem>
                                                <SelectItem value="linkedin">LinkedIn</SelectItem>
                                                <SelectItem value="pinterest">Pinterest</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Input
                                            value={link.url}
                                            onChange={e => {
                                                const links = [...(config.commerceBar?.socialLinks || [])];
                                                links[i] = { ...links[i], url: e.target.value };
                                                setConfig({ ...config, commerceBar: { ...config.commerceBar, socialLinks: links } as any });
                                            }}
                                            placeholder="https://facebook.com/..."
                                            className="flex-1"
                                        />
                                        <Button variant="ghost" size="icon" onClick={() => {
                                            const links = (config.commerceBar?.socialLinks || []).filter((_: any, j: number) => j !== i);
                                            setConfig({ ...config, commerceBar: { ...config.commerceBar, socialLinks: links } as any });
                                        }}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </div>
                                ))}
                            </div>

                            {/* CTA Button */}
                            <div className="space-y-2">
                                <Label>CTA Button (optional)</Label>
                                <p className="text-xs text-muted-foreground">Prominent button on the right side of the commerce bar (e.g. seasonal promotions).</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <Input
                                        value={config.commerceBar?.ctaButton?.text || ""}
                                        onChange={e => {
                                            const cta = { text: e.target.value, url: config.commerceBar?.ctaButton?.url || "" };
                                            setConfig({ ...config, commerceBar: { ...config.commerceBar, ctaButton: cta.text ? cta : undefined } as any });
                                        }}
                                        placeholder="Button text"
                                    />
                                    <Input
                                        value={config.commerceBar?.ctaButton?.url || ""}
                                        onChange={e => {
                                            const cta = { text: config.commerceBar?.ctaButton?.text || "", url: e.target.value };
                                            setConfig({ ...config, commerceBar: { ...config.commerceBar, ctaButton: cta.text ? cta : undefined } as any });
                                        }}
                                        placeholder="/seasonal-page"
                                    />
                                </div>
                            </div>
                            </>)}
                        </CardContent>
                    </Card>
                    )}

                    {/* PRODUCT SEARCH BAR */}
                    {config.commerceEnabled && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Product Search</CardTitle>
                            <CardDescription>A dedicated search bar below the navbar for finding products.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.searchBar?.enabled ?? false}
                                    onChange={e => setConfig({ ...config, searchBar: { ...config.searchBar, enabled: e.target.checked } as any })}
                                    className="rounded border-gray-300 h-5 w-5"
                                />
                                <div>
                                    <span className="font-medium text-sm">Enable Search Bar</span>
                                    <p className="text-xs text-muted-foreground">Shows a full-width search input below the navbar on all pages.</p>
                                </div>
                            </label>
                            {config.searchBar?.enabled && (
                                <div className="space-y-2">
                                    <Label>Placeholder Text</Label>
                                    <Input
                                        value={config.searchBar?.placeholder || ""}
                                        onChange={e => setConfig({ ...config, searchBar: { ...config.searchBar, placeholder: e.target.value } as any })}
                                        placeholder="Search products..."
                                    />
                                </div>
                            )}
                        </CardContent>
                    </Card>
                    )}

                    {/* COUNTRY, LOCALE & CURRENCY — moved to general section (before GDPR) */}

                    {/* PAYMENT METHODS */}
                    {config.commerceEnabled && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Payment Methods</CardTitle>
                            <CardDescription>Select which payment methods are available at checkout. At least one must be enabled.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <label className="flex items-center gap-3 p-3 border rounded-md hover:bg-muted/50 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={(config.enabledPaymentMethods || ["cash_on_delivery"]).includes("cash_on_delivery")}
                                    onChange={e => {
                                        const current = config.enabledPaymentMethods || ["cash_on_delivery"];
                                        const next = e.target.checked
                                            ? [...new Set([...current, "cash_on_delivery"])]
                                            : current.filter(m => m !== "cash_on_delivery");
                                        if (next.length > 0) setConfig({ ...config, enabledPaymentMethods: next as any });
                                    }}
                                    className="rounded"
                                />
                                <div>
                                    <p className="font-medium text-sm">Cash on Delivery (COD)</p>
                                    <p className="text-xs text-muted-foreground">Customer pays when the order is delivered.</p>
                                </div>
                            </label>
                            <label className="flex items-center gap-3 p-3 border rounded-md hover:bg-muted/50 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={(config.enabledPaymentMethods || ["cash_on_delivery"]).includes("bank_transfer")}
                                    onChange={e => {
                                        const current = config.enabledPaymentMethods || ["cash_on_delivery"];
                                        const next = e.target.checked
                                            ? [...new Set([...current, "bank_transfer"])]
                                            : current.filter(m => m !== "bank_transfer");
                                        if (next.length > 0) setConfig({ ...config, enabledPaymentMethods: next as any });
                                    }}
                                    className="rounded"
                                />
                                <div>
                                    <p className="font-medium text-sm">Bank Transfer</p>
                                    <p className="text-xs text-muted-foreground">Customer pays via bank transfer. Configure details below.</p>
                                </div>
                            </label>
                        </CardContent>
                    </Card>
                    )}

                    {/* BANK TRANSFER DETAILS */}
                    {config.commerceEnabled && (config.enabledPaymentMethods || []).includes("bank_transfer") && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Bank Transfer Details</CardTitle>
                            <CardDescription>These details are included in order confirmation emails for bank transfer payments.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Bank Name</Label>
                                    <Input
                                        value={config.integrations?.bankTransfer?.bankName || ""}
                                        onChange={e => setConfig({
                                            ...config,
                                            integrations: {
                                                ...config.integrations!,
                                                bankTransfer: { ...config.integrations?.bankTransfer, bankName: e.target.value }
                                            }
                                        })}
                                        placeholder="ING Bank"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Account Holder</Label>
                                    <Input
                                        value={config.integrations?.bankTransfer?.accountHolder || ""}
                                        onChange={e => setConfig({
                                            ...config,
                                            integrations: {
                                                ...config.integrations!,
                                                bankTransfer: { ...config.integrations?.bankTransfer, accountHolder: e.target.value }
                                            }
                                        })}
                                        placeholder="SC Company SRL"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>IBAN</Label>
                                <Input
                                    value={config.integrations?.bankTransfer?.iban || ""}
                                    onChange={e => setConfig({
                                        ...config,
                                        integrations: {
                                            ...config.integrations!,
                                            bankTransfer: { ...config.integrations?.bankTransfer, iban: e.target.value }
                                        }
                                    })}
                                    placeholder="RO49AAAA1B31007593840000"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>SWIFT/BIC (optional)</Label>
                                    <Input
                                        value={config.integrations?.bankTransfer?.swift || ""}
                                        onChange={e => setConfig({
                                            ...config,
                                            integrations: {
                                                ...config.integrations!,
                                                bankTransfer: { ...config.integrations?.bankTransfer, swift: e.target.value }
                                            }
                                        })}
                                        placeholder="INGBROBU"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Reference Prefix (optional)</Label>
                                    <Input
                                        value={config.integrations?.bankTransfer?.referencePrefix || ""}
                                        onChange={e => setConfig({
                                            ...config,
                                            integrations: {
                                                ...config.integrations!,
                                                bankTransfer: { ...config.integrations?.bankTransfer, referencePrefix: e.target.value }
                                            }
                                        })}
                                        placeholder="PPB"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    )}

                    {/* COMPANY DETAILS */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Company Details</CardTitle>
                            <CardDescription>Used in the footer and for legal compliance.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Legal Name</Label>
                                    <Input
                                        value={config.companyDetails?.legalName || ""}
                                        onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, legalName: e.target.value } })}
                                        placeholder="SC Company Name SRL"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>CUI / CIF</Label>
                                    <Input
                                        value={config.companyDetails?.cui || ""}
                                        onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, cui: e.target.value } })}
                                        placeholder="RO12345678"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Trade Register</Label>
                                    <Input
                                        value={config.companyDetails?.tradeRegister || ""}
                                        onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, tradeRegister: e.target.value } })}
                                        placeholder="J40/1234/2020"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Phone</Label>
                                    <Input
                                        value={config.companyDetails?.phone || ""}
                                        onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, phone: e.target.value } })}
                                        placeholder="+40 700 000 000"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Address</Label>
                                <Input
                                    value={config.companyDetails?.address || ""}
                                    onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, address: e.target.value } })}
                                    placeholder="Str. Example nr. 1, București"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Email</Label>
                                <Input
                                    value={config.companyDetails?.email || ""}
                                    onChange={e => setConfig({ ...config, companyDetails: { ...config.companyDetails, email: e.target.value } })}
                                    placeholder="contact@company.ro"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* FOOTER LINKS */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>Footer Links</CardTitle>
                                <Button variant="outline" size="sm" onClick={() => addLink('footerLinks')}>
                                    <Plus className="h-4 w-4 mr-2"/> Add Link
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {(config.footerLinks || []).map((link, i) => (
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
                            {(config.footerLinks?.length === 0) &&
                                <p className="text-sm text-muted-foreground italic">No footer links added.</p>}
                        </CardContent>
                    </Card>

                    {/* LEGAL LINKS */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Legal Links</CardTitle>
                            <CardDescription>Shown in the footer. Labels default to the country pack language.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Terms & Conditions URL</Label>
                                    <SmartLinkInput
                                        value={config.legalLinks?.termsUrl || ""}
                                        onChange={val => setConfig({ ...config, legalLinks: { ...config.legalLinks, termsUrl: val } })}
                                        placeholder="/termeni-si-conditii"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Terms Label (footer)</Label>
                                    <Input
                                        value={config.legalLinks?.termsLabel || ""}
                                        onChange={e => setConfig({ ...config, legalLinks: { ...config.legalLinks, termsLabel: e.target.value } })}
                                        placeholder="Auto from country pack"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Privacy Policy URL</Label>
                                    <SmartLinkInput
                                        value={config.legalLinks?.privacyUrl || ""}
                                        onChange={val => setConfig({ ...config, legalLinks: { ...config.legalLinks, privacyUrl: val } })}
                                        placeholder="/politica-confidentialitate"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Privacy Label (footer)</Label>
                                    <Input
                                        value={config.legalLinks?.privacyLabel || ""}
                                        onChange={e => setConfig({ ...config, legalLinks: { ...config.legalLinks, privacyLabel: e.target.value } })}
                                        placeholder="Auto from country pack"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Consumer Protection URL</Label>
                                    <Input
                                        value={config.legalLinks?.anpcUrl || ""}
                                        onChange={e => setConfig({ ...config, legalLinks: { ...config.legalLinks, anpcUrl: e.target.value } })}
                                        placeholder="https://anpc.ro/..."
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Consumer Protection Label</Label>
                                    <Input
                                        value={config.legalLinks?.anpcLabel || ""}
                                        onChange={e => setConfig({ ...config, legalLinks: { ...config.legalLinks, anpcLabel: e.target.value } })}
                                        placeholder="Auto from country pack"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Dispute Resolution URL</Label>
                                    <Input
                                        value={config.legalLinks?.anpcSalUrl || ""}
                                        onChange={e => setConfig({ ...config, legalLinks: { ...config.legalLinks, anpcSalUrl: e.target.value } })}
                                        placeholder="https://ec.europa.eu/consumers/odr"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Dispute Resolution Label</Label>
                                    <Input
                                        value={config.legalLinks?.anpcSalLabel || ""}
                                        onChange={e => setConfig({ ...config, legalLinks: { ...config.legalLinks, anpcSalLabel: e.target.value } })}
                                        placeholder="Auto from country pack"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* NOTIFICATIONS */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Mail className="h-5 w-5 text-muted-foreground"/>
                                <CardTitle>Notifications</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2">
                                <Label>Contact Email</Label>
                                <Input
                                    value={config.integrations?.contactEmail || ""}
                                    onChange={e => updateIntegration("contactEmail", e.target.value)}
                                    placeholder="owner@client-site.com"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Form submissions and order notifications will be sent here. If empty, they go to the agency admin.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label>Order Processing Email</Label>
                                <Input
                                    value={config.integrations?.orderProcessingEmail || ""}
                                    onChange={e => updateIntegration("orderProcessingEmail", e.target.value)}
                                    placeholder="orders@client-site.com"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Fulfillment team receives new order notifications here. Can be the same as contact email or a separate address.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* NAVIGATION */}
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
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {(config.navLinks || []).map((link, i) => {
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
                            {(config.navLinks?.length === 0) &&
                                <p className="text-sm text-muted-foreground italic">No links added.</p>}
                        </CardContent>
                    </Card>

                    {/* URL PREFIXES (Commerce Routing) */}
                    <Card>
                        <CardHeader>
                            <CardTitle>URL Prefixes</CardTitle>
                            <CardDescription>Configure URL paths for commerce pages. Must start with "/" (e.g. "/produs" or "/product").</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Product</Label>
                                    <Input
                                        value={config.urlPrefixes?.product || ""}
                                        onChange={e => updateUrlPrefix("product", e.target.value)}
                                        placeholder="/produs"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Category</Label>
                                    <Input
                                        value={config.urlPrefixes?.category || ""}
                                        onChange={e => updateUrlPrefix("category", e.target.value)}
                                        placeholder="/categorie"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Cart</Label>
                                    <Input
                                        value={config.urlPrefixes?.cart || ""}
                                        onChange={e => updateUrlPrefix("cart", e.target.value)}
                                        placeholder="/cos"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Checkout</Label>
                                    <Input
                                        value={config.urlPrefixes?.checkout || ""}
                                        onChange={e => updateUrlPrefix("checkout", e.target.value)}
                                        placeholder="/comanda"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Shop</Label>
                                    <Input
                                        value={config.urlPrefixes?.shop || ""}
                                        onChange={e => updateUrlPrefix("shop", e.target.value)}
                                        placeholder="/magazin"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Account</Label>
                                    <Input
                                        value={config.urlPrefixes?.account || ""}
                                        onChange={e => updateUrlPrefix("account", e.target.value)}
                                        placeholder="/account"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Search</Label>
                                    <Input
                                        value={config.urlPrefixes?.search || ""}
                                        onChange={e => updateUrlPrefix("search", e.target.value)}
                                        placeholder="/search"
                                    />
                                </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                                Changing these will update how commerce URLs are generated and resolved. Existing links using old prefixes will stop working.
                            </p>
                        </CardContent>
                    </Card>

                    {/* ANALYTICS CARD */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Analytics</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">

                            {/* Google */}
                            <div className="space-y-2">
                                <Label>Google Analytics ID (G-XXXX)</Label>
                                <Input
                                    value={config.integrations?.googleAnalyticsId || ""}
                                    onChange={e => updateIntegration("googleAnalyticsId", e.target.value)}
                                    placeholder="G-..."
                                />
                            </div>

                            <div className="h-px bg-border my-4" />

                            {/* Alternative Provider */}
                            <div className="space-y-2">
                                <Label>Privacy-First Analytics</Label>
                                <select
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                                    value={config.integrations?.analytics?.provider || "none"}
                                    onChange={e => setConfig({
                                        ...config,
                                        integrations: {
                                            ...config.integrations!,
                                            analytics: { ...config.integrations?.analytics, provider: e.target.value as any }
                                        }
                                    })}
                                >
                                    <option value="none">None</option>
                                    <option value="umami">Umami (Self-Hosted/Cloud)</option>
                                    <option value="plausible">Plausible</option>
                                </select>
                            </div>

                            {config.integrations?.analytics?.provider === 'umami' && (
                                <div className="grid grid-cols-2 gap-4 animate-in fade-in">
                                    <div className="space-y-2">
                                        <Label>Script URL</Label>
                                        <Input
                                            placeholder="https://stats.agency.com/script.js"
                                            value={config.integrations?.analytics?.url || ""}
                                            onChange={e => setConfig({
                                                ...config,
                                                integrations: {
                                                    ...config.integrations!,
                                                    analytics: { ...config.integrations?.analytics!, url: e.target.value }
                                                }
                                            })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Website ID (UUID)</Label>
                                        <Input
                                            placeholder="xxxxx-xxxx-xxxx"
                                            value={config.integrations?.analytics?.websiteId || ""}
                                            onChange={e => setConfig({
                                                ...config,
                                                integrations: {
                                                    ...config.integrations!,
                                                    analytics: { ...config.integrations?.analytics!, websiteId: e.target.value }
                                                }
                                            })}
                                        />
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* IDENTITY PROVIDERS */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Key className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Identity (Google OAuth)</CardTitle>
                            </div>
                            <CardDescription>Enable login for comments and gated content.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="p-3 bg-blue-50 border border-blue-100 rounded-md text-xs text-blue-800">
                                <strong>Callback URL:</strong> <span className="font-mono select-all">{`https://${config.domain}/api/auth/callback/google`}</span>
                            </div>
                            <div className="space-y-2">
                                <Label>Client ID</Label>
                                <Input
                                    value={config.integrations?.google?.clientId || ""}
                                    onChange={e => setConfig({
                                        ...config,
                                        integrations: {
                                            ...config.integrations!,
                                            google: { ...config.integrations?.google, clientId: e.target.value }
                                        }
                                    })}
                                    placeholder="...apps.googleusercontent.com"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Client Secret</Label>
                                <Input
                                    type="password"
                                    value={config.integrations?.google?.clientSecret || ""}
                                    onChange={e => setConfig({
                                        ...config,
                                        integrations: {
                                            ...config.integrations!,
                                            google: { ...config.integrations?.google, clientSecret: e.target.value }
                                        }
                                    })}
                                    placeholder="GOCSPX-..."
                                />
                            </div>
                        </CardContent>
                    </Card>


                    {/* COUNTRY, LOCALE & CURRENCY — always visible (drives GDPR texts, date formats, etc.) */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Country & Locale</CardTitle>
                            <CardDescription>Selecting a country pack auto-fills locale, currency, GDPR texts, legal labels, and commerce translations.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label>Country Pack</Label>
                                    <div className="flex gap-2">
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
                                            className="shrink-0 self-center"
                                            onClick={() => setPendingPackCode(config.countryCode || "EN")}
                                        >
                                            Apply
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Locale</Label>
                                    <Input
                                        value={config.locale || "en-US"}
                                        onChange={e => setConfig({ ...config, locale: e.target.value })}
                                        placeholder="en-US"
                                    />
                                    <p className="text-xs text-muted-foreground">Auto-filled from pack. Override if needed.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label>Currency</Label>
                                    <Input
                                        value={config.currency || "USD"}
                                        onChange={e => setConfig({ ...config, currency: e.target.value })}
                                        placeholder="USD"
                                    />
                                    <p className="text-xs text-muted-foreground">Auto-filled from pack. Override if needed.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* GDPR / PRIVACY */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Cookie Consent (GDPR)</CardTitle>
                            </div>
                            <CardDescription>Configure the consent banner for EU visitors.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="gdpr-enabled"
                                    className="rounded border-gray-300"
                                    checked={config.gdpr?.enabled ?? true}
                                    onChange={e => setConfig({
                                        ...config,
                                        gdpr: { ...config.gdpr!, enabled: e.target.checked }
                                    })}
                                />
                                <Label htmlFor="gdpr-enabled">Enable Cookie Banner</Label>
                            </div>

                            <div className="space-y-2">
                                <Label>Headline</Label>
                                <Input
                                    value={config.gdpr?.headline || ""}
                                    onChange={e => setConfig({
                                        ...config,
                                        gdpr: { ...config.gdpr!, headline: e.target.value }
                                    })}
                                    placeholder="We value your privacy"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Description Text</Label>
                                <textarea
                                    className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                    value={config.gdpr?.description || ""}
                                    onChange={e => setConfig({
                                        ...config,
                                        gdpr: { ...config.gdpr!, description: e.target.value }
                                    })}
                                    placeholder="We use cookies to improve your experience..."
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label>Deny All Button</Label>
                                    <Input
                                        value={config.gdpr?.denyAll || ""}
                                        onChange={e => setConfig({
                                            ...config,
                                            gdpr: { ...config.gdpr!, denyAll: e.target.value }
                                        })}
                                        placeholder="Deny All"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Necessary Only Button</Label>
                                    <Input
                                        value={config.gdpr?.necessaryOnly || ""}
                                        onChange={e => setConfig({
                                            ...config,
                                            gdpr: { ...config.gdpr!, necessaryOnly: e.target.value }
                                        })}
                                        placeholder="Necessary Only"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Accept All Button</Label>
                                    <Input
                                        value={config.gdpr?.acceptAll || ""}
                                        onChange={e => setConfig({
                                            ...config,
                                            gdpr: { ...config.gdpr!, acceptAll: e.target.value }
                                        })}
                                        placeholder="Accept All"
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">Leave blank to use defaults from country pack.</p>

                            <div className="space-y-2">
                                <Label>Position</Label>
                                <select
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                                    value={config.gdpr?.position || "bottom"}
                                    onChange={e => setConfig({
                                        ...config,
                                        gdpr: { ...config.gdpr!, position: e.target.value as "bottom" | "top" }
                                    })}
                                >
                                    <option value="bottom">Bottom</option>
                                    <option value="top">Top</option>
                                </select>
                            </div>
                        </CardContent>
                    </Card>

                    {/* BOT PROTECTION (reCAPTCHA v3) */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Bot Protection (reCAPTCHA v3)</CardTitle>
                            </div>
                            <CardDescription>Invisible bot protection for public forms (Contact, Lead Magnets, Dynamic Forms).</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="recaptcha-enabled"
                                    className="rounded border-gray-300"
                                    checked={config.recaptcha?.enabled ?? false}
                                    onChange={e => setConfig({
                                        ...config,
                                        recaptcha: { ...config.recaptcha!, enabled: e.target.checked }
                                    })}
                                />
                                <Label htmlFor="recaptcha-enabled">Enable reCAPTCHA</Label>
                            </div>

                            <div className="space-y-2">
                                <Label>Site Key (Public)</Label>
                                <Input
                                    value={config.recaptcha?.siteKey || ""}
                                    onChange={e => setConfig({
                                        ...config,
                                        recaptcha: { ...config.recaptcha!, siteKey: e.target.value }
                                    })}
                                    placeholder="6Le..."
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Secret Key (Private)</Label>
                                <Input
                                    type="password"
                                    value={config.recaptcha?.secretKey || ""}
                                    onChange={e => setConfig({
                                        ...config,
                                        recaptcha: { ...config.recaptcha!, secretKey: e.target.value }
                                    })}
                                    placeholder="6Le..."
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Score Threshold (0.0 - 1.0)</Label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.1"
                                        className="flex-1"
                                        value={config.recaptcha?.threshold ?? 0.5}
                                        onChange={e => setConfig({
                                            ...config,
                                            recaptcha: { ...config.recaptcha!, threshold: parseFloat(e.target.value) }
                                        })}
                                    />
                                    <span className="text-sm font-mono w-10 text-center">{config.recaptcha?.threshold ?? 0.5}</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                    Lower = more lenient, Higher = stricter. Default is 0.5. Scores below this block the form submission.
                                </p>
                            </div>

                            <div className="pt-2 border-t">
                                <a
                                    href="https://www.google.com/recaptcha/admin"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary hover:underline flex items-center gap-1"
                                >
                                    <ExternalLink className="h-3 w-3" />
                                    Get keys from Google reCAPTCHA Console
                                </a>
                            </div>
                        </CardContent>
                    </Card>

                    {/* RESEARCH */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Key className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Research</CardTitle>
                            </div>
                            <CardDescription>API keys for local research stack.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>Brave Search API Key</Label>
                                <Input
                                    type="password"
                                    value={config.integrations?.braveApiKey || ""}
                                    onChange={e => updateIntegration("braveApiKey", e.target.value)}
                                    placeholder="API key from search.brave.com"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Used for web search when finding outbound signals.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* RIGHT COLUMN: Colors */}
                <div className="lg:col-span-1">
                    {/* TYPOGRAPHY */}
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
                                    <Input placeholder="Prata" value={config.theme?.fontHeading || ""}
                                           onChange={e => updateTheme("fontHeading", e.target.value)}/>
                                </div>
                                <div className="space-y-2">
                                    <Label>Body Font (Google Fonts)</Label>
                                    <Input placeholder="Lato" value={config.theme?.fontBody || ""} onChange={e => updateTheme("fontBody", e.target.value)} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* THEME SWITCHER TAB */}
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
                            </div>

                            {/* FONTS (Only show on Light tab to avoid confusion, or allow override?) */}
                            {activeTab === 'light' && (
                                <div className="space-y-2 pt-2">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase">Typography</Label>
                                    <Input className="h-8 text-xs" placeholder="Headings (Google Font)" value={activeConfig?.fontHeading} onChange={e => updateTheme("fontHeading", e.target.value)} />
                                    <Input className="h-8 text-xs" placeholder="Body (Google Font)" value={activeConfig?.fontBody} onChange={e => updateTheme("fontBody", e.target.value)} />
                                </div>
                            )}
                        </CardContent>
                    </Card>


                    {/* INTERFACE */}
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
                                        <Input className="max-w-[100px]" value={config.theme?.radius || "0.5rem"} onChange={e => updateTheme("radius", e.target.value)} />
                                        <div className="h-8 w-16 border-2 border-primary bg-secondary" style={{ borderRadius: config.theme?.radius }} />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Mode (TODO: implement it)</Label>
                                    <select
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                                        value={config.theme?.mode || "light"}
                                        onChange={e => updateTheme("mode", e.target.value)}
                                    >
                                        <option value="light">Light</option>
                                        <option value="dark">Dark</option>
                                    </select>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Country Pack Apply Confirmation Dialog */}
            <Dialog open={pendingPackCode !== null} onOpenChange={open => { if (!open) setPendingPackCode(null); }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Apply Country Pack: {pendingPackCode ? getCountryPack(pendingPackCode).name : ""}</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        This will update locale and currency. Do you also want to overwrite your existing commerce labels, GDPR texts, and legal link labels with the country pack defaults?
                    </p>
                    <div className="flex flex-col gap-2 pt-2">
                        <Button
                            variant="outline"
                            onClick={() => {
                                if (!pendingPackCode) return;
                                const pack = getCountryPack(pendingPackCode);
                                setConfig(prev => ({
                                    ...prev,
                                    countryCode: pendingPackCode,
                                    locale: pack.locale,
                                    currency: pack.currency.code,
                                }));
                                setPendingPackCode(null);
                            }}
                        >
                            Locale & Currency Only
                        </Button>
                        <Button
                            onClick={() => {
                                if (!pendingPackCode) return;
                                const pack = getCountryPack(pendingPackCode);
                                setConfig(prev => ({
                                    ...prev,
                                    countryCode: pendingPackCode,
                                    locale: pack.locale,
                                    currency: pack.currency.code,
                                    commerceStrings: pack.defaultStrings as any,
                                    gdpr: {
                                        ...prev.gdpr!,
                                        headline: pack.gdpr.headline,
                                        description: pack.gdpr.description,
                                        denyAll: pack.gdpr.denyAll,
                                        necessaryOnly: pack.gdpr.necessaryOnly,
                                        acceptAll: pack.gdpr.acceptAll,
                                    },
                                    legalLinks: {
                                        ...prev.legalLinks,
                                        termsLabel: pack.legal.termsLabel,
                                        privacyLabel: pack.legal.privacyLabel,
                                        anpcLabel: pack.legal.consumerProtectionLabel || "",
                                        anpcSalLabel: pack.legal.disputeResolutionLabel || "",
                                    },
                                }));
                                setPendingPackCode(null);
                            }}
                        >
                            Overwrite All Texts
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ColorInput({ label, value, onChange }: { label: string, value?: string, onChange: (v: string) => void }) {
    return (
        <div className="flex items-center gap-2">
            <div className="relative w-8 h-8 rounded-full overflow-hidden border shadow-sm shrink-0">
                <input type="color" className="absolute inset-0 w-[150%] h-[150%] -translate-x-1/4 -translate-y-1/4 cursor-pointer p-0 border-0" value={value || "#ffffff"} onChange={e => onChange(e.target.value)} />
            </div>
            <div className="flex-1">
                <Input className="h-8 text-xs font-mono uppercase" value={value || ""} onChange={e => onChange(e.target.value)} />
            </div>
            <span className="text-[10px] text-muted-foreground w-16 text-right truncate">{label}</span>
        </div>
    );
}
