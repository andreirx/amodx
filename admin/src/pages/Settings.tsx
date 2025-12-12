import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import type { TenantConfig } from "@amodx/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Loader2, ExternalLink, Copy, Palette, Type, MousePointerClick, AlertCircle, Mail } from "lucide-react";

// Get Renderer URL from Env (Injected by CDK)
const RENDERER_URL = (import.meta.env.VITE_RENDERER_URL || "").replace(/\/$/, "");

export default function SettingsPage() {
    const { currentTenant } = useTenant();
    const [config, setConfig] = useState<Partial<TenantConfig>>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    if (!currentTenant) {
        return (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] text-muted-foreground">
                <Palette className="h-10 w-10 mb-4 opacity-20" />
                <p>Select a site to configure settings.</p>
            </div>
        );
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

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

    const previewUrl = `${RENDERER_URL}/_site/${config.id}`;

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

                    {/* 1. IDENTITY */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Site Identity</CardTitle>
                            <CardDescription>Technical details and domains</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Site Name</Label>
                                    <Input value={config.name || ""} onChange={e => setConfig({ ...config, name: e.target.value })} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Tenant ID</Label>
                                    <div className="flex gap-2">
                                        <Input value={config.id || ""} disabled className="bg-muted font-mono" />
                                        <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(config.id!)}>
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Production Domain</Label>
                                <Input
                                    value={config.domain || ""}
                                    onChange={e => setConfig({ ...config, domain: e.target.value })}
                                    placeholder="client.com"
                                />
                            </div>
                            <div className="p-3 bg-secondary/50 rounded-md flex items-center justify-between">
                                <div className="text-xs font-mono text-muted-foreground truncate max-w-md">{previewUrl}</div>
                                <Button variant="ghost" size="sm" asChild className="h-8">
                                    <a href={previewUrl} target="_blank" rel="noreferrer">Open <ExternalLink className="ml-2 h-3 w-3" /></a>
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 2. NOTIFICATIONS (NEW) */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-2">
                                <Mail className="h-5 w-5 text-muted-foreground" />
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

                    {/* 3. TYPOGRAPHY */}
                    <Card>
                        <CardHeader className="pb-4">
                            <div className="flex items-center gap-2">
                                <Type className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Typography</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Heading Font (Google Fonts)</Label>
                                    <Input placeholder="Inter" value={config.theme?.fontHeading || ""} onChange={e => updateTheme("fontHeading", e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Body Font (Google Fonts)</Label>
                                    <Input placeholder="Inter" value={config.theme?.fontBody || ""} onChange={e => updateTheme("fontBody", e.target.value)} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 4. INTERFACE */}
                    <Card>
                        <CardHeader className="pb-4">
                            <div className="flex items-center gap-2">
                                <MousePointerClick className="h-5 w-5 text-muted-foreground" />
                                <CardTitle>Interface</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Border Radius</Label>
                                    <div className="flex items-center gap-4">
                                        <Input className="max-w-[100px]" value={config.theme?.radius || "0.5rem"} onChange={e => updateTheme("radius", e.target.value)} />
                                        <div className="h-8 w-16 border-2 border-primary bg-secondary" style={{ borderRadius: config.theme?.radius }} />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Mode</Label>
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
                            <ColorInput label="Primary" desc="Buttons, Highlights" value={config.theme?.primaryColor} onChange={v => updateTheme("primaryColor", v)} />
                            <ColorInput label="Secondary" desc="Accents, Muted" value={config.theme?.secondaryColor} onChange={v => updateTheme("secondaryColor", v)} />
                            <div className="h-px bg-border" />
                            <ColorInput label="Background" desc="Page Background" value={config.theme?.backgroundColor} onChange={v => updateTheme("backgroundColor", v)} />
                            <ColorInput label="Surface" desc="Cards, Sidebars" value={config.theme?.surfaceColor} onChange={v => updateTheme("surfaceColor", v)} />
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
