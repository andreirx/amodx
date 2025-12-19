import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import type { TenantConfig } from "@amodx/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import {Loader2, ExternalLink, Palette, Type, MousePointerClick, AlertCircle, Mail, Key} from "lucide-react";
import { uploadFile } from "@/lib/upload";
import { Plus, Trash2, Upload } from "lucide-react";

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

    const updateTheme = (key: string, val: string) => {
        setConfig(prev => ({
            ...prev,
            theme: { ...prev.theme!, [key]: val }
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
                                    <Input value={link.href}
                                           onChange={e => updateLink('navLinks', i, 'href', e.target.value)}
                                           placeholder="/path" className="flex-1"/>
                                    <Button variant="ghost" size="icon" onClick={() => removeLink('navLinks', i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                </div>
                            ))}
                            {(config.navLinks?.length === 0) && <p className="text-sm text-muted-foreground italic">No links added.</p>}
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
                                    <Input placeholder="Inter" value={config.theme?.fontHeading || ""}
                                           onChange={e => updateTheme("fontHeading", e.target.value)}/>
                                </div>
                                <div className="space-y-2">
                                    <Label>Body Font (Google Fonts)</Label>
                                    <Input placeholder="Inter" value={config.theme?.fontBody || ""} onChange={e => updateTheme("fontBody", e.target.value)} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* RIGHT COLUMN: Colors */}
                    <div className="lg:col-span-1">
                        <Card className="h-full">
                            <CardHeader className="pb-4">
                                <div className="flex items-center gap-2">
                                    <Palette className="h-5 w-5 text-muted-foreground" />
                                    <CardTitle>Colors</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-6">

                                {/* Primary Group */}
                                <div className="space-y-2">
                                    <Label className="text-xs uppercase text-muted-foreground font-bold tracking-wider">Primary</Label>
                                    <ColorInput label="Background" desc="Buttons" value={config.theme?.primaryColor} onChange={v => updateTheme("primaryColor", v)} />
                                    <ColorInput label="Text" desc="On Buttons" value={config.theme?.primaryForeground} onChange={v => updateTheme("primaryForeground", v)} />
                                </div>

                                <div className="h-px bg-border" />

                                {/* Secondary Group */}
                                <div className="space-y-2">
                                    <Label className="text-xs uppercase text-muted-foreground font-bold tracking-wider">Secondary</Label>
                                    <ColorInput label="Background" desc="Accents" value={config.theme?.secondaryColor} onChange={v => updateTheme("secondaryColor", v)} />
                                    <ColorInput label="Text" desc="On Accents" value={config.theme?.secondaryForeground} onChange={v => updateTheme("secondaryForeground", v)} />
                                </div>

                                <div className="h-px bg-border" />

                                {/* Base Group */}
                                <div className="space-y-2">
                                    <Label className="text-xs uppercase text-muted-foreground font-bold tracking-wider">Base</Label>
                                    <ColorInput label="Page Background" desc="" value={config.theme?.backgroundColor} onChange={v => updateTheme("backgroundColor", v)} />
                                    <ColorInput label="Body Text" desc="Default Text" value={config.theme?.textColor} onChange={v => updateTheme("textColor", v)} />
                                    <ColorInput label="Surface" desc="Cards" value={config.theme?.surfaceColor} onChange={v => updateTheme("surfaceColor", v)} />
                                </div>

                            </CardContent>
                        </Card>
                    </div>

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

function ColorInput({ label, desc, value, onChange }: { label: string, desc: string, value?: string, onChange: (v: string) => void }) {
    return (
        <div className="space-y-2">
            <div className="flex justify-between">
                <Label>{label}</Label>
                <span className="text-[10px] text-muted-foreground uppercase">{desc}</span>
            </div>
            <div className="flex gap-2">
                <Input type="color" className="w-12 h-10 p-1 cursor-pointer" value={value || "#000000"} onChange={e => onChange(e.target.value)} />
                <Input value={value || ""} onChange={e => onChange(e.target.value)} className="font-mono text-xs uppercase" />
            </div>
        </div>
    );
}
