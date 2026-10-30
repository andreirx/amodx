import { useEffect, useState } from "react";
import { ServiceKeyScope, type ServiceKeyView } from "@amodx/shared";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { KeyRound, Loader2, Copy, Check } from "lucide-react";

/**
 * SERVICE-ACCOUNT-1 — Settings → "Integration keys" (TENANT_ADMIN / GLOBAL_ADMIN; mounted behind `isAdmin`).
 * Lists, creates and revokes the tenant's service keys through GET/POST /service-keys and
 * POST /service-keys/{id}/revoke. The secret exists in this component's state only between a successful
 * create and "Done": the API returns it once and never again.
 */

const SCOPE_LABELS: Record<ServiceKeyScope, string> = {
    "catalog:read": "Read products",
    "leads:read": "Read leads",
    "catalog:write": "Import pricelists (replaces a sheet's products)",
};

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "Never");

export function ServiceKeys() {
    const { currentTenant } = useTenant();
    const [keys, setKeys] = useState<ServiceKeyView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [scopes, setScopes] = useState<ServiceKeyScope[]>([]);
    const [creating, setCreating] = useState(false);
    const [newSecret, setNewSecret] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiRequest("/service-keys");
            setKeys(res.items || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setNewSecret(null);
        load();
    }, [currentTenant?.id]);

    const toggleScope = (scope: ServiceKeyScope) =>
        setScopes((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));

    const create = async () => {
        setCreating(true);
        setError(null);
        try {
            const res = await apiRequest("/service-keys", {
                method: "POST",
                body: JSON.stringify({ name, scopes }),
            });
            setNewSecret(res.secret);
            setCopied(false);
            setName("");
            setScopes([]);
            await load();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setCreating(false);
        }
    };

    const revoke = async (key: ServiceKeyView) => {
        if (!confirm(`Revoke "${key.name}"? Any system using this key loses access immediately. This cannot be undone.`)) return;
        setRevokingId(key.id);
        setError(null);
        try {
            await apiRequest(`/service-keys/${encodeURIComponent(key.id)}/revoke`, { method: "POST" });
            await load();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setRevokingId(null);
        }
    };

    const copySecret = async () => {
        if (!newSecret) return;
        await navigator.clipboard.writeText(newSecret);
        setCopied(true);
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Integration keys</CardTitle>
                </div>
                <CardDescription>
                    Keys that let another system (for example your CRM) read this site's data without a login.
                    Each key works only for this site and only for what you allow.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {error && <p className="text-sm text-destructive">{error}</p>}

                {newSecret && (
                    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
                        <p className="text-sm font-medium">Copy it now — it will not be shown again.</p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs select-all">{newSecret}</code>
                            <Button type="button" variant="outline" size="sm" onClick={copySecret}>
                                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
                            </Button>
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setNewSecret(null)}>Done</Button>
                    </div>
                )}

                {/* Existing keys */}
                {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading keys…
                    </div>
                ) : keys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No integration keys yet.</p>
                ) : (
                    <ul className="divide-y rounded-md border">
                        {keys.map((key) => (
                            <li key={key.id} className="flex items-start justify-between gap-4 p-3">
                                <div className="space-y-1">
                                    <div className="font-medium">{key.name}</div>
                                    <div className="flex flex-wrap gap-1">
                                        {key.scopes.map((s) => (
                                            <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                                {SCOPE_LABELS[s] ?? s}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Created {formatDate(key.createdAt)} · Last used {formatDate(key.lastUsedAt)}
                                    </div>
                                </div>
                                {key.revokedAt ? (
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">Revoked {formatDate(key.revokedAt)}</span>
                                ) : (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={revokingId === key.id}
                                        onClick={() => revoke(key)}
                                    >
                                        {revokingId === key.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke"}
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}

                {/* Create */}
                <div className="space-y-3 border-t pt-4">
                    <div className="space-y-2">
                        <Label htmlFor="service-key-name">New key name</Label>
                        <Input
                            id="service-key-name"
                            value={name}
                            maxLength={80}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. CRM sync"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Allowed actions</Label>
                        {ServiceKeyScope.options.map((scope) => (
                            <label key={scope} className="flex items-center gap-2 text-sm">
                                <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                                {SCOPE_LABELS[scope]}
                            </label>
                        ))}
                    </div>
                    <Button type="button" onClick={create} disabled={creating || !name.trim() || scopes.length === 0}>
                        {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create key
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
