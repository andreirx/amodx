// Settings page: the Analytics, Identity (Google OAuth), Newsletter (MailerLite) and Research cards.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Mail, Key } from "lucide-react";
import type { SettingsDraft } from "./draft";

/**
 * NEWSLETTER-1 (ruling 7, ruling 8) — the MailerLite connection as the card edits it: the object form of
 * `integrations.mailerlite` (`groupId`, and `apiToken` only when the owner typed a new one — GET /settings never returns
 * the token), or null when there is none (absent, null, or the retired boolean). Saving `{ groupId }` keeps the stored
 * token; `{ groupId, apiToken }` replaces it; `null` disconnects (backend `mailerLiteSave`).
 */
export function mailerLiteDraft(value: unknown): { groupId: string; apiToken: string } | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    return { groupId: typeof v.groupId === "string" ? v.groupId : "", apiToken: typeof v.apiToken === "string" ? v.apiToken : "" };
}

/**
 * NEWSLETTER-1 — the MailerLite card of the Settings page (admin only). `value`: the loaded or edited
 * `integrations.mailerlite`; `stored`: the loaded record holds a connection (so a token is stored); `onChange`: the new
 * value — `{ groupId, apiToken }` (an empty token keeps the stored one) or null (disconnect on save).
 */
export function MailerLiteCard({ value, stored, onChange }: { value: unknown; stored: boolean; onChange: (next: { groupId: string; apiToken: string } | null) => void }) {
    const ml = mailerLiteDraft(value);
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Newsletter (MailerLite)</CardTitle>
                </div>
                <CardDescription>
                    Newsletter signups (the newsletter block and newsletter popups) are always stored on the Leads page, with
                    the visitor's consent. With a MailerLite group ID and API token, each signup is also added to that group.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Group ID</Label>
                    <Input
                        value={ml?.groupId ?? ""}
                        onChange={e => onChange({ ...(ml ?? { apiToken: "" }), groupId: e.target.value })}
                        placeholder="e.g. 112233445566 (MailerLite → Subscribers → Groups)"
                    />
                </div>
                <div className="space-y-2">
                    <Label>API token</Label>
                    <Input
                        type="password"
                        autoComplete="off"
                        value={ml?.apiToken ?? ""}
                        onChange={e => onChange({ ...(ml ?? { groupId: "" }), apiToken: e.target.value })}
                        placeholder={stored ? "A token is stored. Type a new token to replace it." : "Token from MailerLite → Integrations → API"}
                    />
                    <p className="text-[10px] text-muted-foreground">The token is never shown again after you save it.</p>
                </div>
                {(stored || ml !== null) && (
                    <Button variant="outline" size="sm" onClick={() => onChange(null)}>Disconnect MailerLite</Button>
                )}
                {stored && ml === null && (
                    <p className="text-xs text-muted-foreground">MailerLite will be disconnected when you save.</p>
                )}
            </CardContent>
        </Card>
    );
}

/** The "Analytics" card. */
export function AnalyticsCard({ config, setConfig, updateIntegration }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void; updateIntegration: (key: string, val: any) => void }) {
    return (
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
    );
}

/** The "Identity (Google OAuth)" card (admin only: it holds the client secret). */
export function GoogleOAuthCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
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
    );
}

/** The "Research" card (admin only). */
export function ResearchCard({ config, updateIntegration }: { config: SettingsDraft; updateIntegration: (key: string, val: any) => void }) {
    return (
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
    );
}
