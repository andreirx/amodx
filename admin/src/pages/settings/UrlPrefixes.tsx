// Settings page: the URL Prefixes card.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { isCatalogMode } from "@amodx/shared";
import type { Dispatch, SetStateAction } from "react";
import type { SettingsDraft } from "./draft";

/** The "URL Prefixes" card. */
export function UrlPrefixesCard({ config, setConfig }: { config: SettingsDraft; setConfig: Dispatch<SetStateAction<SettingsDraft>> }) {
    const updateUrlPrefix = (key: string, val: string) => {
        setConfig(prev => ({
            ...prev,
            urlPrefixes: { ...prev.urlPrefixes!, [key]: val }
        }));
    };
    return (
        <Card>
            <CardHeader>
                <CardTitle>URL Prefixes</CardTitle>
                <CardDescription>{isCatalogMode(config)
                    ? 'Configure URL paths for catalog pages. Must start with "/" (e.g. "/product").'
                    : 'Configure URL paths for commerce pages. Must start with "/" (e.g. "/product").'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Product</Label>
                        <Input
                            value={config.urlPrefixes?.product || ""}
                            onChange={e => updateUrlPrefix("product", e.target.value)}
                            placeholder="/product"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Category</Label>
                        <Input
                            value={config.urlPrefixes?.category || ""}
                            onChange={e => updateUrlPrefix("category", e.target.value)}
                            placeholder="/category"
                        />
                    </div>
                    {!isCatalogMode(config) && (
                        <div className="space-y-2">
                            <Label>Cart</Label>
                            <Input
                                value={config.urlPrefixes?.cart || ""}
                                onChange={e => updateUrlPrefix("cart", e.target.value)}
                                placeholder="/cart"
                            />
                        </div>
                    )}
                    {!isCatalogMode(config) && (
                        <div className="space-y-2">
                            <Label>Checkout</Label>
                            <Input
                                value={config.urlPrefixes?.checkout || ""}
                                onChange={e => updateUrlPrefix("checkout", e.target.value)}
                                placeholder="/checkout"
                            />
                        </div>
                    )}
                    {/* CDL-2 (§ 14 item 2): the order-confirmation segment, appended to the checkout path. Same
                        condition as Cart and Checkout. */}
                    {!isCatalogMode(config) && (
                        <div className="space-y-2">
                            <Label>Confirmation (after Checkout)</Label>
                            <Input
                                value={config.urlPrefixes?.checkoutConfirmation || ""}
                                onChange={e => updateUrlPrefix("checkoutConfirmation", e.target.value)}
                                placeholder="/confirmation"
                            />
                        </div>
                    )}
                    <div className="space-y-2">
                        <Label>Shop</Label>
                        <Input
                            value={config.urlPrefixes?.shop || ""}
                            onChange={e => updateUrlPrefix("shop", e.target.value)}
                            placeholder="/shop"
                        />
                    </div>
                    {!isCatalogMode(config) && (
                        <div className="space-y-2">
                            <Label>Account</Label>
                            <Input
                                value={config.urlPrefixes?.account || ""}
                                onChange={e => updateUrlPrefix("account", e.target.value)}
                                placeholder="/account"
                            />
                        </div>
                    )}
                    <div className="space-y-2">
                        <Label>Search</Label>
                        <Input
                            value={config.urlPrefixes?.search || ""}
                            onChange={e => updateUrlPrefix("search", e.target.value)}
                            placeholder="/search"
                        />
                    </div>
                    {isCatalogMode(config) && (
                        <div className="space-y-2">
                            <Label>Interest list</Label>
                            <Input
                                value={config.urlPrefixes?.interest || ""}
                                onChange={e => updateUrlPrefix("interest", e.target.value)}
                                placeholder="/my-list"
                            />
                        </div>
                    )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                    {isCatalogMode(config)
                        ? "Changing these will update how catalog URLs are generated and resolved. Existing links using old prefixes will stop working."
                        : "Changing these will update how commerce URLs are generated and resolved. Existing links using old prefixes will stop working."}
                </p>
            </CardContent>
        </Card>
    );
}
