// Settings page: the site-kind card (Catalog or Commerce) and the commerce cards: Commerce Bar, Product Search, Order Celebration.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Plus, Trash2, ShoppingBag } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SettingsDraft } from "./draft";

/** The Commerce Bar card's description before CAT-QUOTE-1, and the fallback note it gains (the renderer layout uses
 *  Contact channels when the bar's own phone / WhatsApp is empty). One text node: the page's tree shape, hence the ids
 *  React derives from it, stays as captured (Settings.test.ts). */
export const COMMERCE_BAR_DESCRIPTION = "Utility bar above the navbar with phone, social links, cart total, and optional CTA button.";
export const COMMERCE_BAR_FALLBACK_NOTE = "Phone and WhatsApp: defaults from Contact channels when empty.";

/** The "Catalog" card: states the kind of a catalog site; no control. */
export function CatalogCard() {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Catalog</CardTitle>
                </div>
                <CardDescription>A catalog site: products without prices, stock or ordering. Visitors collect an interest list and send it to the address chosen in Contact channels → Send interest lists to (by default the visitor contact e-mail, Notifications → Contact Email).</CardDescription>
            </CardHeader>
        </Card>
    );
}

/** The "Commerce" card: the commerce switch of a non-catalog site. */
export function CommerceCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
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
    );
}

/** The "Commerce Bar" card. */
export function CommerceBarCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                    <CardTitle>Commerce Bar</CardTitle>
                </div>
                <CardDescription>{`${COMMERCE_BAR_DESCRIPTION} ${COMMERCE_BAR_FALLBACK_NOTE}`}</CardDescription>
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
    );
}

/** The "Product Search" card. */
export function ProductSearchCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
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
    );
}

/** The "Order Celebration" card. */
export function OrderCelebrationCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Order Celebration</CardTitle>
                <CardDescription>
                    GPU confetti animation on the order confirmation page.
                    Auto-disabled for users with reduced motion or no WebGPU.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <label className="flex items-center gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={config.celebrationEnabled ?? false}
                        onChange={e => setConfig({ ...config, celebrationEnabled: e.target.checked })}
                        className="rounded border-gray-300 h-5 w-5"
                    />
                    <div>
                        <span className="font-medium text-sm">Enable Confetti Celebration</span>
                        <p className="text-xs text-muted-foreground">Shows a 4-second confetti burst with backdrop darkening when a customer completes an order.</p>
                    </div>
                </label>
            </CardContent>
        </Card>
    );
}
