import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { TenantConfig } from "@amodx/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Save, Loader2 } from "lucide-react";

export default function SettingsPage() {
    const [config, setConfig] = useState<Partial<TenantConfig>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadSettings();
    }, []);

    async function loadSettings() {
        try {
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
            alert("Settings Saved!");
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-8">Loading...</div>;

    return (
        <div className="p-8 max-w-4xl space-y-8">
            <h1 className="text-3xl font-bold">Site Settings</h1>

            <Card>
                <CardHeader>
                    <CardTitle>General Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Site Name</Label>
                        <Input
                            value={config.name || ""}
                            onChange={e => setConfig({ ...config, name: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Domain</Label>
                        <Input
                            value={config.domain || ""}
                            onChange={e => setConfig({ ...config, domain: e.target.value })}
                            placeholder="example.com"
                        />
                        <p className="text-xs text-muted-foreground">
                            Changing this requires DNS reconfiguration.
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Theme</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Primary Color</Label>
                        <div className="flex gap-2">
                            <Input
                                type="color"
                                className="w-12 h-10 p-1"
                                value={config.theme?.primaryColor || "#000000"}
                                onChange={e => setConfig({
                                    ...config,
                                    theme: { ...config.theme!, primaryColor: e.target.value }
                                })}
                            />
                            <Input
                                value={config.theme?.primaryColor || ""}
                                onChange={e => setConfig({
                                    ...config,
                                    theme: { ...config.theme!, primaryColor: e.target.value }
                                })}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Configuration
            </Button>
        </div>
    );
}
