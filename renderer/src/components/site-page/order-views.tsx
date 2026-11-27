import { URL_PREFIX_DEFAULTS, resolveLocaleStrings, type LocaleStrings } from "@amodx/shared";
import Link from "next/link";
import { FBPurchaseEvent } from "@/components/FBPurchaseEvent";
import { CelebrationWrapper } from "@/components/CelebrationWrapper";
import { interpolateNodes } from "@/components/site-page/locale-strings";

export function ConfirmationPageView({ order, config, prefixes, basePath = "" }: { order: any; config: any; prefixes: any; basePath?: string }) {
    // LOCALE-1D: the confirmation texts (§ 6.2), from the tenant's locale table (pattern D).
    const t = resolveLocaleStrings(config).strings.commerce;
    const bankTransfer = config.integrations?.bankTransfer;
    const pageWidth = config.header?.contentPageMaxWidth || "max-w-4xl";

    if (!order) {
        return (
            <main className={`${pageWidth} mx-auto py-20 px-6 text-center`}>
                <div className="text-6xl mb-6">✅</div>
                <h1 className="text-3xl font-bold mb-4">{t.orderThankYou}</h1>
                <p className="text-muted-foreground mb-8">{t.orderPlacedMessage}</p>
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    {t.continueShopping}
                </Link>
            </main>
        );
    }

    return (
        <main className={`${pageWidth} mx-auto py-12 px-6`}>
            {config.celebrationEnabled && <CelebrationWrapper />}
            <FBPurchaseEvent
                orderId={order.id}
                value={parseFloat(order.total) || 0}
                currency={order.currency || "USD"}
                items={(order.items || []).map((i: any) => ({ id: i.productId, quantity: i.quantity }))}
            />
            <div className="text-center mb-12">
                <div className="text-6xl mb-4">✅</div>
                <h1 className="text-3xl font-bold mb-2">{t.orderConfirmed}</h1>
                <p className="text-lg text-muted-foreground">
                    {interpolateNodes(t.orderNumber, { number: <span className="font-mono font-bold text-foreground">{order.orderNumber}</span> })}
                </p>
            </div>

            {/* Bank Transfer Details */}
            {order.paymentMethod === "bank_transfer" && bankTransfer && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-3">{t.bankTransferDetails}</h2>
                    <p className="text-sm text-muted-foreground mb-4">{t.bankTransferInstruction}</p>
                    <div className="grid sm:grid-cols-2 gap-3 text-sm">
                        <div><span className="text-muted-foreground">{t.bankLabel}</span> <strong>{bankTransfer.bankName}</strong></div>
                        <div><span className="text-muted-foreground">{t.accountHolderLabel}</span> <strong>{bankTransfer.accountHolder}</strong></div>
                        <div className="sm:col-span-2"><span className="text-muted-foreground">{t.ibanLabel}</span> <strong className="font-mono">{bankTransfer.iban}</strong></div>
                        {bankTransfer.swift && <div><span className="text-muted-foreground">{t.swiftLabel}</span> <strong className="font-mono">{bankTransfer.swift}</strong></div>}
                        <div><span className="text-muted-foreground">{t.referenceLabel}</span> <strong>{order.orderNumber}</strong></div>
                        <div><span className="text-muted-foreground">{t.amountLabel}</span> <strong>{order.total} {order.currency}</strong></div>
                    </div>
                </div>
            )}

            {/* Cash on Delivery */}
            {order.paymentMethod === "cash_on_delivery" && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-2">{t.cashOnDelivery}</h2>
                    <p className="text-sm text-muted-foreground">{interpolateNodes(t.codPayOnDelivery, { amount: <strong>{order.total} {order.currency}</strong> })}</p>
                    {order.estimatedDeliveryDate && <p className="text-sm mt-2">{`${t.estimatedDelivery} `}<strong>{order.estimatedDeliveryDate}</strong></p>}
                </div>
            )}

            {/* Order Items */}
            <div className="border rounded-lg p-6 mb-8">
                <h2 className="font-bold text-lg mb-4">{t.orderDetails}</h2>
                <div className="space-y-3">
                    {(order.items || []).map((item: any, i: number) => (
                        <div key={i} className="flex justify-between text-sm py-2 border-b last:border-0">
                            <div>
                                <p className="font-medium">{item.productTitle}</p>
                                <p className="text-muted-foreground">{interpolateNodes(t.quantityLabel, { n: item.quantity })}</p>
                                {item.personalizations?.length > 0 && (
                                    <p className="text-xs text-muted-foreground">{item.personalizations.map((p: any) => `${p.label}: ${p.value}`).join(", ")}</p>
                                )}
                            </div>
                            <span className="font-medium">{item.totalPrice} {order.currency}</span>
                        </div>
                    ))}
                </div>

                <div className="border-t mt-4 pt-4 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.subtotal}</span><span>{order.subtotal} {order.currency}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t.shipping}</span><span>{order.shippingCost === "0" ? t.freeShipping : `${order.shippingCost} ${order.currency}`}</span></div>
                    {parseFloat(order.discount || "0") > 0 && (
                        <div className="flex justify-between text-green-600"><span>{t.discount}</span><span>-{order.discount} {order.currency}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-base border-t pt-2"><span>{t.total}</span><span>{order.total} {order.currency}</span></div>
                </div>
            </div>

            {/* Shipping Address */}
            {order.shippingAddress && (
                <div className="border rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-3">{t.shippingAddress}</h2>
                    <p className="text-sm">{order.customerName}</p>
                    <p className="text-sm text-muted-foreground">{order.shippingAddress.street}</p>
                    <p className="text-sm text-muted-foreground">{order.shippingAddress.city}, {order.shippingAddress.county} {order.shippingAddress.postalCode}</p>
                    {order.customerPhone && <p className="text-sm text-muted-foreground mt-2">{interpolateNodes(t.phoneLine, { phone: order.customerPhone })}</p>}
                </div>
            )}

            <div className="text-center">
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    {t.continueShopping}
                </Link>
            </div>
        </main>
    );
}

/** LOCALE-1D (§ 6.2): each timeline step identifier → its label key. The step list itself is unchanged (F-LOCALE-STEPS). */
const ORDER_STEP_KEYS = {
    pending: "orderStepPending", confirmed: "orderStepConfirmed", processing: "orderStepProcessing",
    shipped: "orderStepShipped", delivered: "orderStepDelivered", completed: "orderStepCompleted",
} as const satisfies Record<string, keyof LocaleStrings["commerce"]>;
/** LOCALE-1D (§ 6.2): each stored history status → its label key. A status without a key renders as stored, as before. */
const ORDER_HISTORY_KEYS: Record<string, keyof LocaleStrings["commerce"]> = {
    placed: "orderHistoryPlaced", confirmed: "orderHistoryConfirmed", prepared: "orderHistoryPrepared", shipped: "orderHistoryShipped",
    delivered: "orderHistoryDelivered", cancelled: "orderHistoryCancelled", annulled: "orderHistoryAnnulled",
};

export function OrderTrackingView({ order, config, prefixes, basePath = "" }: { order: any; config: any; prefixes: any; basePath?: string }) {
    // LOCALE-1D: the tracking texts (§ 6.2), from the tenant's locale table (pattern D).
    const t = resolveLocaleStrings(config).strings.commerce;
    const pageWidth = config.header?.contentPageMaxWidth || "max-w-4xl";

    if (!order) {
        return (
            <main className={`${pageWidth} mx-auto py-20 px-6 text-center`}>
                <h1 className="text-3xl font-bold mb-4">{t.orderNotFound}</h1>
                <p className="text-muted-foreground mb-8">{t.orderNotFoundMessage}</p>
                <Link href={`${basePath}${prefixes.shop || URL_PREFIX_DEFAULTS.shop}`} className="inline-flex items-center bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium hover:opacity-90 transition-opacity">
                    {t.continueShopping}
                </Link>
            </main>
        );
    }

    const statusSteps = Object.keys(ORDER_STEP_KEYS) as (keyof typeof ORDER_STEP_KEYS)[];
    const currentStepIndex = statusSteps.indexOf(order.status);

    return (
        <main className={`${pageWidth} mx-auto py-12 px-6`}>
            <h1 className="text-3xl font-bold tracking-tight mb-2">{interpolateNodes(t.orderNumber, { number: order.orderNumber })}</h1>
            <p className="text-muted-foreground mb-8">{interpolateNodes(t.placedOn, { date: new Date(order.createdAt).toLocaleDateString(config.locale || "en-US") })}</p>

            {/* Status Timeline */}
            <div className="mb-12">
                <div className="flex items-center justify-between">
                    {statusSteps.map((step, i) => (
                        <div key={step} className="flex flex-col items-center flex-1">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                                i <= currentStepIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                            }`}>
                                {i <= currentStepIndex ? "✓" : i + 1}
                            </div>
                            <span className={`text-xs mt-1 capitalize ${i <= currentStepIndex ? "text-primary font-medium" : "text-muted-foreground"}`}>
                                {t[ORDER_STEP_KEYS[step]]}
                            </span>
                        </div>
                    ))}
                </div>
                <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${((currentStepIndex + 1) / statusSteps.length) * 100}%` }} />
                </div>
            </div>

            {/* Status History */}
            {order.statusHistory?.length > 0 && (
                <div className="border rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-4">{t.statusHistory}</h2>
                    <div className="space-y-3">
                        {order.statusHistory.map((entry: any, i: number) => (
                            <div key={i} className="flex gap-3 text-sm">
                                <span className="text-muted-foreground whitespace-nowrap">{new Date(entry.timestamp).toLocaleString(config.locale || "en-US")}</span>
                                <span className="capitalize font-medium">{Object.hasOwn(ORDER_HISTORY_KEYS, entry.status) ? t[ORDER_HISTORY_KEYS[entry.status]] : entry.status}</span>
                                {entry.note && <span className="text-muted-foreground">- {entry.note}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Tracking Number */}
            {order.trackingNumber && (
                <div className="border rounded-lg p-6 mb-8">
                    <h2 className="font-bold text-lg mb-2">{t.tracking}</h2>
                    <p className="text-sm">{`${t.trackingNumber} `}<span className="font-mono font-bold">{order.trackingNumber}</span></p>
                </div>
            )}

            {/* Order Items Summary */}
            <div className="border rounded-lg p-6">
                <h2 className="font-bold text-lg mb-4">{t.items}</h2>
                {(order.items || []).map((item: any, i: number) => (
                    <div key={i} className="flex justify-between text-sm py-2 border-b last:border-0">
                        <span>{item.productTitle} x{item.quantity}</span>
                        <span className="font-medium">{item.totalPrice} {order.currency}</span>
                    </div>
                ))}
                <div className="border-t mt-3 pt-3 flex justify-between font-bold">
                    <span>{t.total}</span>
                    <span>{order.total} {order.currency}</span>
                </div>
            </div>
        </main>
    );
}
