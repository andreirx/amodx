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
import { Plus, Trash2, Upload } from "lucide-react";
import { ShieldCheck } from "lucide-react";
import { SmartLinkInput } from "@/components/ui/smart-link-input";
import { THEME_PRESETS } from "@amodx/shared";
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

    const updateHeader = (key: string, val: boolean) => {
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
                                    Form submissions will be sent here. If empty, they go to the agency admin.
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
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {(config.navLinks || []).map((link, i) => (
                                <div key={i} className="flex gap-2">
                                    <Input value={link.label}
                                           onChange={e => updateLink('navLinks', i, 'label', e.target.value)}
                                           placeholder="Label" className="flex-1"/>
                                    <div className="flex-1">
                                        <SmartLinkInput
                                            value={link.href}
                                            onChange={val => updateLink('navLinks', i, 'href', val)}
                                            placeholder="/path"
                                        />
                                    </div>
                                    <Button variant="ghost" size="icon"
                                            onClick={() => removeLink('navLinks', i)}><Trash2
                                        className="h-4 w-4 text-destructive"/></Button>
                                </div>
                            ))}
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

                    {/* MERCHANT settings (paddle) */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Payments (Paddle)</CardTitle>
                            <CardDescription>Merchant of Record configuration.</CardDescription>
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
                                                // FIX: Ensure environment exists by defaulting it explicitly
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
