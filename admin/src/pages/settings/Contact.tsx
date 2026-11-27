// Settings page: the Contact channels and Notifications cards, and the save rule of the contact attributes.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Mail } from "lucide-react";
import { isCatalogMode } from "@amodx/shared";
import type { SettingsDraft } from "./draft";

// ── CAT-QUOTE-1 (docs/slices/cat-quote-1.md § 3 items 1 and 4): the "Contact channels" card. ──────────────────────

/**
 * The `PUT /settings` body of a save, for the two contact attributes: each channel trimmed, an empty one removed;
 * "a separate address" left empty = the contact e-mail (`null`, which removes the stored address). An attribute the
 * owner did not touch stays as loaded (absent stays absent), so a save without a change sends the same body as before.
 */
export function withContactForSave<T extends SettingsDraft>(config: T): T {
    const next: SettingsDraft = { ...config };
    if (config.contactChannels) {
        const channels: Record<string, string> = {};
        for (const [k, v] of Object.entries(config.contactChannels)) if (typeof v === "string" && v.trim()) channels[k] = v.trim();
        next.contactChannels = channels;
    }
    if (typeof config.interestListEmail === "string") next.interestListEmail = config.interestListEmail.trim() || null;
    return next as T;
}

/**
 * Phone, WhatsApp and e-mail for visitors (every site kind); on a catalog also where interest lists are e-mailed
 * (operator ruling R3: that control is catalog-only — interest lists exist only on catalog sites). "Visitor contact
 * e-mail (default)" sets `interestListEmail: null`, which the route reads as "remove the stored address" (ruling
 * CQ-INTEREST-EMAIL-CLEAR = A).
 */
export function ContactChannelsCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    const channels = config.contactChannels || {};
    const setChannel = (key: "phone" | "whatsapp" | "email", value: string) => setConfig({ ...config, contactChannels: { ...channels, [key]: value } });
    const separate = typeof config.interestListEmail === "string";
    return (
        <Card>
            <CardHeader>
                <CardTitle>Contact channels</CardTitle>
                <CardDescription>How visitors reach you. A catalog product page shows them under &quot;Request a quote&quot;. Also used by the Top Bar, the Commerce Bar and the floating Quick contact when their own value is empty.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label>Phone</Label>
                        <Input value={channels.phone || ""} onChange={e => setChannel("phone", e.target.value)} placeholder="+40 721 000 111" />
                    </div>
                    <div className="space-y-2">
                        <Label>WhatsApp</Label>
                        <Input value={channels.whatsapp || ""} onChange={e => setChannel("whatsapp", e.target.value)} placeholder="+40721000111" />
                    </div>
                    <div className="space-y-2">
                        <Label>E-mail</Label>
                        <Input value={channels.email || ""} onChange={e => setChannel("email", e.target.value)} placeholder="office@client-site.com" />
                    </div>
                </div>
                <p className="text-[10px] text-muted-foreground">Numbers: digits, &quot;+&quot;, spaces and dashes. An empty field is not shown to visitors.</p>
                {isCatalogMode(config) && (
                    <div className="space-y-2">
                        <Label>Send interest lists to</Label>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="radio" name="interest-list-email" checked={!separate} onChange={() => setConfig({ ...config, interestListEmail: null })} />
                            Visitor contact e-mail (default) — Notifications → Contact Email
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="radio" name="interest-list-email" checked={separate} onChange={() => setConfig({ ...config, interestListEmail: "" })} />
                            A separate address
                        </label>
                        {separate && (
                            <Input value={config.interestListEmail || ""} onChange={e => setConfig({ ...config, interestListEmail: e.target.value })} placeholder="lists@client-site.com" />
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/** The "Notifications" card. */
export function NotificationsCard({ config, updateIntegration }: { config: SettingsDraft; updateIntegration: (key: string, val: any) => void }) {
    return (
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
    );
}
