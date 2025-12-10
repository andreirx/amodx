import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import type { TenantConfig } from "@amodx/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Loader2, ExternalLink, Copy } from "lucide-react";

// HELPER: Get Config at Runtime (Fixes the crash)
const getRendererUrl = () => {
    // @ts-ignore
    const url = import.meta.env.VITE_RENDERER_URL || window.AMODX_CONFIG?.VITE_RENDERER_URL || "";
    return url.replace(/\/$/, "");
};

export default function SettingsPage() {
    const { currentTenant } = useTenant();
    const [config, setConfig] = useState<Partial<TenantConfig>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Read URL safely
    const rendererUrl = getRendererUrl();

    useEffect(() => {
        if (currentTenant?.id) {
            loadSettings();
        }
    }, [currentTenant?.id]);

    async function loadSettings() {
        try {
            setLoading(true);
            const data = await apiRequest("/settings");
            setConfig(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function save() {
        try {
            setSaving(true);
            await apiRequest("/settings", {
                method: "PUT",
                body: JSON.stringify(config)
            });
            // Force refresh of the tenant context context if name/domain changed
            window.location.reload();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    const updateTheme = (key: string, val: string) => {
        setConfig(prev => ({
            ...prev,
            theme: { ...prev.theme!, [key]: val }
        }));
    };

    // Construct Preview URL safely
    const previewLink = rendererUrl && config.id ? `${rendererUrl}/_site/${config.id}` : "#";

    return (
        <div className="p-8 max-w-4xl space-y-8 pb-20">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold">Settings</h1>
                <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Site Identity</CardTitle>
                    <CardDescription>Technical details and domains</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Site Name</Label>
                            <Input
                                value={config.name || ""}
                                onChange={e => setConfig({ ...config, name: e.target.value })}
                            />
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
                            placeholder="example.com"
                        />
                    </div>

                    <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-lg flex items-center justify-between">
                        <div className="space-y-1">
                            <div className="text-sm font-medium text-blue-900">Preview URL</div>
                            <div className="text-xs text-blue-700 font-mono truncate max-w-md">
                                {previewLink}
                            </div>
                        </div>
                        <Button variant="secondary" size="sm" asChild disabled={!rendererUrl}>
                            <a href={previewLink} target="_blank" rel="noreferrer">
                                Open Preview <ExternalLink className="ml-2 h-3 w-3" />
                            </a>
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Theme</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Heading Font</Label>
                            <Input value={config.theme?.fontHeading || "Inter"} onChange={e => updateTheme("fontHeading", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Body Font</Label>
                            <Input value={config.theme?.fontBody || "Inter"} onChange={e => updateTheme("fontBody", e.target.value)} />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Primary Color</Label>
                        <div className="flex gap-2">
                            <div className="w-10 h-10 rounded border" style={{ backgroundColor: config.theme?.primaryColor }} />
                            <Input value={config.theme?.primaryColor || ""} onChange={e => updateTheme("primaryColor", e.target.value)} />
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
