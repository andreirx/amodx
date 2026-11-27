// Settings page: the Cookie Consent (GDPR) and Bot Protection (reCAPTCHA v3) cards.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { ExternalLink, ShieldCheck } from "lucide-react";
import type { SettingsDraft } from "./draft";

/** The "Cookie Consent (GDPR)" card. */
export function CookieConsentCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
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

                <p className="text-xs text-muted-foreground">The banner texts are edited in Labels → Cookie banner & legal links.</p>

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
    );
}

/** The "Bot Protection (reCAPTCHA v3)" card; the custom keys for an admin only. */
export function BotProtectionCard({ config, setConfig, isAdmin }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void; isAdmin: boolean }) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Bot Protection (reCAPTCHA v3)</CardTitle>
                </div>
                <CardDescription>
                    Bot protection is active for all public forms (Contact, Lead Magnets, Dynamic Forms, Checkout, Coupons).
                    Deployment-level keys are used by default. Override below to use your own reCAPTCHA project.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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

                {isAdmin && (
                <div className="pt-4 border-t space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Custom reCAPTCHA Keys (optional — overrides deployment default)</p>
                    <div className="space-y-2">
                        <Label>Site Key (Public)</Label>
                        <Input
                            value={config.recaptcha?.siteKey || ""}
                            onChange={e => setConfig({
                                ...config,
                                recaptcha: { ...config.recaptcha!, siteKey: e.target.value }
                            })}
                            placeholder="Leave blank to use deployment default"
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
                            placeholder="Leave blank to use deployment default"
                        />
                    </div>
                </div>
                )}

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
    );
}
