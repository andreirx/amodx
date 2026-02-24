import { useEffect, useState } from "react";
import { useTenant } from "@/context/TenantContext";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save } from "lucide-react";
import type { CommerceStrings } from "@amodx/shared";
import { COMMERCE_STRINGS_DEFAULTS } from "@amodx/shared";

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

    const Field = ({ label, field, placeholder }: { label: string; field: keyof CommerceStrings; placeholder?: string }) => (
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

    return (
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
                        <Field label="Description" field="description" />
                        <Field label="Add to Cart" field="addToCart" />
                        <Field label="In Stock" field="inStock" />
                        <Field label="Out of Stock" field="outOfStock" />
                        <Field label="Units (volume pricing)" field="units" />
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
                        <Field label="Shopping Cart" field="shoppingCart" />
                        <Field label="Continue Shopping" field="continueShopping" />
                        <Field label="Order Summary" field="orderSummary" />
                        <Field label="Subtotal" field="subtotal" />
                        <Field label="Shipping" field="shipping" />
                        <Field label="Free Shipping" field="freeShipping" />
                        <Field label="Discount" field="discount" />
                        <Field label="Total" field="total" />
                        <Field label="Apply (coupon)" field="apply" />
                        <Field label="Proceed to Checkout" field="proceedToCheckout" />
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
                        <Field label="Checkout (page title)" field="checkout" />
                        <Field label="Billing Details (section)" field="billingDetails" />
                        <Field label="First Name" field="firstName" />
                        <Field label="Last Name" field="lastName" />
                        <Field label="Email" field="email" />
                        <Field label="Phone" field="phone" />
                        <Field label="Phone placeholder" field="phonePlaceholder" />
                        <Field label="Birthday" field="birthday" />
                        <Field label="Birthday hint" field="birthdayHint" placeholder="For a birthday surprise!" />
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
                        <Field label="Order as Company" field="orderAsCompany" />
                        <Field label="Company Name" field="companyName" />
                        <Field label="Tax ID (e.g. CUI)" field="taxId" />
                        <Field label="Tax ID placeholder" field="taxIdPlaceholder" placeholder="e.g. 12345678" />
                        <Field label="VAT Number" field="vatNumber" />
                        <Field label="VAT placeholder" field="vatNumberPlaceholder" placeholder="e.g. RO12345678" />
                        <Field label="Registration No." field="registrationNumber" />
                        <Field label="Registration placeholder" field="registrationNumberPlaceholder" />
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
                        <Field label="Shipping Address (section)" field="shippingAddress" />
                        <Field label="Street Address" field="streetAddress" />
                        <Field label="City" field="city" />
                        <Field label="County / Region" field="county" />
                        <Field label="Select County..." field="selectCounty" />
                        <Field label="Country" field="country" />
                        <Field label="Select Country..." field="selectCountry" />
                        <Field label="Postal Code" field="postalCode" />
                        <Field label="Delivery Notes" field="deliveryNotes" />
                        <Field label="Delivery Notes placeholder" field="deliveryNotesPlaceholder" placeholder="Apartment, floor, etc." />
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
                        <Field label="Use same for billing" field="useSameAsShipping" />
                        <Field label="Billing Address (section)" field="billingAddress" />
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
                        <Field label="Payment Method" field="paymentMethod" />
                        <Field label="Cash on Delivery" field="cashOnDelivery" />
                        <Field label="COD description" field="cashOnDeliveryDesc" />
                        <Field label="Bank Transfer" field="bankTransfer" />
                        <Field label="Preferred Delivery Date" field="preferredDeliveryDate" />
                        <Field label="Place Order" field="placeOrder" />
                        <Field label="Placing Order..." field="placingOrder" />
                        <Field label="Terms Agreement" field="termsAgreement" />
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
                        <Field label="Search Button" field="searchButton" />
                        <Field label="No Results" field="searchNoResults" />
                        <Field label="Searching..." field="searchSearching" />
                        <Field label="View All Results" field="viewAllResults" />
                        <Field label="Results For (heading)" field="resultsFor" />
                        <Field label="Search Products (heading)" field="searchProducts" />
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
                        <Field label="Sign In" field="signIn" />
                        <Field label="Account" field="accountLabel" />
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
                        <Field label="Order Confirmation" field="orderConfirmation" />
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
    );
}
