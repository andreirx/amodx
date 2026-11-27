// Settings page: the Digital Sales (Paddle), Payment Methods and Bank Transfer Details cards.
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import type { SettingsDraft } from "./draft";

/** The "Digital Sales (Paddle)" card. */
export function DigitalSalesCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Digital Sales (Paddle)</CardTitle>
                <CardDescription>Configure Paddle for selling digital products. Currency, geofencing, and pricing are managed in your Paddle dashboard.</CardDescription>
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
    );
}

/** The "Payment Methods" card. */
export function PaymentMethodsCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>Select which payment methods are available at checkout. At least one must be enabled.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <label className="flex items-center gap-3 p-3 border rounded-md hover:bg-muted/50 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={(config.enabledPaymentMethods || ["cash_on_delivery"]).includes("cash_on_delivery")}
                        onChange={e => {
                            const current = config.enabledPaymentMethods || ["cash_on_delivery"];
                            const next = e.target.checked
                                ? [...new Set([...current, "cash_on_delivery"])]
                                : current.filter(m => m !== "cash_on_delivery");
                            if (next.length > 0) setConfig({ ...config, enabledPaymentMethods: next as any });
                        }}
                        className="rounded"
                    />
                    <div>
                        <p className="font-medium text-sm">Cash on Delivery (COD)</p>
                        <p className="text-xs text-muted-foreground">Customer pays when the order is delivered.</p>
                    </div>
                </label>
                <label className="flex items-center gap-3 p-3 border rounded-md hover:bg-muted/50 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={(config.enabledPaymentMethods || ["cash_on_delivery"]).includes("bank_transfer")}
                        onChange={e => {
                            const current = config.enabledPaymentMethods || ["cash_on_delivery"];
                            const next = e.target.checked
                                ? [...new Set([...current, "bank_transfer"])]
                                : current.filter(m => m !== "bank_transfer");
                            if (next.length > 0) setConfig({ ...config, enabledPaymentMethods: next as any });
                        }}
                        className="rounded"
                    />
                    <div>
                        <p className="font-medium text-sm">Bank Transfer</p>
                        <p className="text-xs text-muted-foreground">Customer pays via bank transfer. Configure details below.</p>
                    </div>
                </label>
            </CardContent>
        </Card>
    );
}

/** The "Bank Transfer Details" card. */
export function BankTransferCard({ config, setConfig }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Bank Transfer Details</CardTitle>
                <CardDescription>These details are included in order confirmation emails for bank transfer payments.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Bank Name</Label>
                        <Input
                            value={config.integrations?.bankTransfer?.bankName || ""}
                            onChange={e => setConfig({
                                ...config,
                                integrations: {
                                    ...config.integrations!,
                                    bankTransfer: { ...config.integrations?.bankTransfer, bankName: e.target.value }
                                }
                            })}
                            placeholder="ING Bank"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Account Holder</Label>
                        <Input
                            value={config.integrations?.bankTransfer?.accountHolder || ""}
                            onChange={e => setConfig({
                                ...config,
                                integrations: {
                                    ...config.integrations!,
                                    bankTransfer: { ...config.integrations?.bankTransfer, accountHolder: e.target.value }
                                }
                            })}
                            placeholder="SC Company SRL"
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label>IBAN</Label>
                    <Input
                        value={config.integrations?.bankTransfer?.iban || ""}
                        onChange={e => setConfig({
                            ...config,
                            integrations: {
                                ...config.integrations!,
                                bankTransfer: { ...config.integrations?.bankTransfer, iban: e.target.value }
                            }
                        })}
                        placeholder="RO49AAAA1B31007593840000"
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>SWIFT/BIC (optional)</Label>
                        <Input
                            value={config.integrations?.bankTransfer?.swift || ""}
                            onChange={e => setConfig({
                                ...config,
                                integrations: {
                                    ...config.integrations!,
                                    bankTransfer: { ...config.integrations?.bankTransfer, swift: e.target.value }
                                }
                            })}
                            placeholder="INGBROBU"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Reference Prefix (optional)</Label>
                        <Input
                            value={config.integrations?.bankTransfer?.referencePrefix || ""}
                            onChange={e => setConfig({
                                ...config,
                                integrations: {
                                    ...config.integrations!,
                                    bankTransfer: { ...config.integrations?.bankTransfer, referencePrefix: e.target.value }
                                }
                            })}
                            placeholder="PPB"
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
