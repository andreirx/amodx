import { createContext, useContext, useEffect, useState } from "react";
import { useTenant } from "@/context/TenantContext";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save } from "lucide-react";
import type { CommerceStrings } from "@amodx/shared";
import { COMMERCE_STRINGS_DEFAULTS } from "@amodx/shared";

// Context so F can live outside the component (stable identity = no focus loss)
const LabelsCtx = createContext<{
    strings: Partial<CommerceStrings>;
    update: (key: keyof CommerceStrings, value: string) => void;
}>({ strings: {}, update: () => {} });

function F({ label, field, placeholder }: { label: string; field: keyof CommerceStrings; placeholder?: string }) {
    const { strings, update } = useContext(LabelsCtx);
    return (
        <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            <Input
                value={strings[field] || ""}
                onChange={e => update(field, e.target.value)}
                placeholder={placeholder || COMMERCE_STRINGS_DEFAULTS[field] || ""}
                className="h-9"
            />
        </div>
    );
}

export default function Labels() {
    const { currentTenant } = useTenant();
    const [strings, setStrings] = useState<Partial<CommerceStrings>>({});
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant?.id) {
            loadConfig();
        }
    }, [currentTenant?.id]);

    async function loadConfig() {
        if (!currentTenant?.id) return;
        setLoading(true);
        try {
            const config = await apiRequest("/settings");
            setStrings(config.commerceStrings || {});
        } catch (err) {
            console.error("Failed to load config", err);
        } finally {
            setLoading(false);
        }
    }

    const update = (key: keyof CommerceStrings, value: string) => {
        setStrings(prev => ({ ...prev, [key]: value || undefined }));
    };

    const handleSave = async () => {
        if (!currentTenant) return;
        setSaving(true);
        try {
            await apiRequest("/settings", {
                method: "PUT",
                body: JSON.stringify({ commerceStrings: strings }),
            });
        } catch (err) {
            console.error("Failed to save labels", err);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <LabelsCtx.Provider value={{ strings, update }}>
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Commerce Labels</h1>
                    <p className="text-muted-foreground text-sm">
                        Customize the labels shown on product pages, cart, and checkout. Leave blank to use defaults.
                    </p>
                </div>
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save Changes
                </Button>
            </div>

            {/* Product Page */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Product Page</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Description" field="description" />
                        <F label="Add to Cart" field="addToCart" />
                        <F label="In Stock" field="inStock" />
                        <F label="Out of Stock" field="outOfStock" />
                        <F label="Units (volume pricing)" field="units" />
                    </div>
                </CardContent>
            </Card>

            {/* Cart */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Shopping Cart</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Shopping Cart" field="shoppingCart" />
                        <F label="Continue Shopping" field="continueShopping" />
                        <F label="Order Summary" field="orderSummary" />
                        <F label="Subtotal" field="subtotal" />
                        <F label="Shipping" field="shipping" />
                        <F label="Free Shipping" field="freeShipping" />
                        <F label="Discount" field="discount" />
                        <F label="Total" field="total" />
                        <F label="Apply (coupon)" field="apply" />
                        <F label="Proceed to Checkout" field="proceedToCheckout" />
                    </div>
                </CardContent>
            </Card>

            {/* Checkout - Contact */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Contact Information</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Checkout (page title)" field="checkout" />
                        <F label="Billing Details (section)" field="billingDetails" />
                        <F label="First Name" field="firstName" />
                        <F label="Last Name" field="lastName" />
                        <F label="Email" field="email" />
                        <F label="Phone" field="phone" />
                        <F label="Phone placeholder" field="phonePlaceholder" />
                        <F label="Birthday" field="birthday" />
                        <F label="Birthday hint" field="birthdayHint" placeholder="For a birthday surprise!" />
                    </div>
                </CardContent>
            </Card>

            {/* Checkout - Company / B2B */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Company / B2B</CardTitle>
                    <CardDescription>Labels for business customers ordering with invoice</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Order as Company" field="orderAsCompany" />
                        <F label="Company Name" field="companyName" />
                        <F label="Tax ID (e.g. CUI)" field="taxId" />
                        <F label="Tax ID placeholder" field="taxIdPlaceholder" placeholder="e.g. 12345678" />
                        <F label="VAT Number" field="vatNumber" />
                        <F label="VAT placeholder" field="vatNumberPlaceholder" placeholder="e.g. RO12345678" />
                        <F label="Registration No." field="registrationNumber" />
                        <F label="Registration placeholder" field="registrationNumberPlaceholder" />
                    </div>
                </CardContent>
            </Card>

            {/* Checkout - Shipping Address */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Shipping Address</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Shipping Address (section)" field="shippingAddress" />
                        <F label="Street Address" field="streetAddress" />
                        <F label="City" field="city" />
                        <F label="County / Region" field="county" />
                        <F label="Select County..." field="selectCounty" />
                        <F label="Country" field="country" />
                        <F label="Select Country..." field="selectCountry" />
                        <F label="Postal Code" field="postalCode" />
                        <F label="Delivery Notes" field="deliveryNotes" />
                        <F label="Delivery Notes placeholder" field="deliveryNotesPlaceholder" placeholder="Apartment, floor, etc." />
                    </div>
                </CardContent>
            </Card>

            {/* Checkout - Billing Address */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Billing Address</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Use same for billing" field="useSameAsShipping" />
                        <F label="Billing Address (section)" field="billingAddress" />
                    </div>
                </CardContent>
            </Card>

            {/* Checkout - Payment & Submit */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Checkout - Payment & Submit</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Payment Method" field="paymentMethod" />
                        <F label="Cash on Delivery" field="cashOnDelivery" />
                        <F label="COD description" field="cashOnDeliveryDesc" />
                        <F label="Bank Transfer" field="bankTransfer" />
                        <F label="Preferred Delivery Date" field="preferredDeliveryDate" />
                        <F label="Place Order" field="placeOrder" />
                        <F label="Placing Order..." field="placingOrder" />
                        <F label="Terms Agreement" field="termsAgreement" />
                    </div>
                </CardContent>
            </Card>

            {/* Search */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Search</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Search Button" field="searchButton" />
                        <F label="No Results" field="searchNoResults" />
                        <F label="Searching..." field="searchSearching" />
                        <F label="View All Results" field="viewAllResults" />
                        <F label="Results For (heading)" field="resultsFor" />
                        <F label="Search Products (heading)" field="searchProducts" />
                    </div>
                </CardContent>
            </Card>

            {/* Account / Auth */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Account / Authentication</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Sign In" field="signIn" />
                        <F label="Account" field="accountLabel" />
                    </div>
                </CardContent>
            </Card>

            {/* Confirmation */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Order Confirmation</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <F label="Order Confirmation" field="orderConfirmation" />
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end pb-8">
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save Changes
                </Button>
            </div>
        </div>
        </LabelsCtx.Provider>
    );
}
