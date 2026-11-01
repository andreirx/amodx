import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signOut } from 'aws-amplify/auth';
import { useTenant } from "@/context/TenantContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import {Shield, Users, ArrowRightLeft} from "lucide-react";
import { ShoppingBag, FolderTree, Package, Truck, Ticket, Star, Megaphone, ClipboardList, Mail, BarChart3, Languages, Heart, Upload } from "lucide-react";
import { INTEREST_FORM_ID, isCatalogMode } from "@amodx/shared";
import {
    LayoutDashboard, Target, Settings, LogOut, ChevronsUpDown, Plus, Globe, Loader2, Activity, FileBox, MessageSquare, GitGraph, Radar
} from "lucide-react";
import { Image as ImageIcon } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";

interface SidebarProps { className?: string; onNavigate?: () => void; }

export function Sidebar({ className, onNavigate }: SidebarProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const { tenants, currentTenant, selectTenant, refreshTenants } = useTenant();

    // Create Site State
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newDomain, setNewDomain] = useState("");
    const [newCatalogMode, setNewCatalogMode] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    const isCommerce = currentTenant?.commerceEnabled ?? false;
    const isCatalog = isCatalogMode(currentTenant);

    const navSections = [
        {
            label: "Content",
            items: [
                { name: "Pages", href: "/", icon: LayoutDashboard },
                { name: "Content Graph", href: "/graph", icon: GitGraph },
                { name: "Media", href: "/media", icon: ImageIcon },
            ]
        },
        // CAT-ADMIN-1 (docs/slices/cat-admin-1.md § 4.2, CA-L1): one group for the site kind, named by the kind. A catalog
        // adds its pricelist import and its interest lists (submissions of the system form, which the forms list omits).
        {
            label: isCatalog ? "Catalog" : "Commerce",
            items: [
                { name: "Products", href: "/products", icon: ShoppingBag },
                { name: "Categories", href: "/categories", icon: FolderTree },
                ...(isCatalog ? [
                    { name: "Pricelist import", href: "/catalog-import", icon: Upload },
                    { name: "Interest lists", href: `/forms/${INTEREST_FORM_ID}/submissions`, icon: Heart },
                ] : []),
                ...(isCommerce ? [
                    { name: "Reports", href: "/reports", icon: BarChart3 },
                    { name: "Orders", href: "/orders", icon: Package },
                    { name: "Customers", href: "/customers", icon: Users },
                    { name: "Coupons", href: "/coupons", icon: Ticket },
                    { name: "Reviews", href: "/reviews", icon: Star },
                    { name: "Delivery", href: "/delivery", icon: Truck },
                    { name: "Email Templates", href: "/order-emails", icon: Mail },
                ] : []),
            ]
        },
        // CAT-ADMIN-1 (CA-D1 = A): Paddle digital sales are a mode of their own, unrelated to the site kind — every site.
        {
            label: "Digital sales",
            items: [
                { name: "Digital Products", href: "/digital-products", icon: FileBox },
            ]
        },
        {
            label: "Growth",
            items: [
                { name: "Strategy", href: "/strategy", icon: Target },
                { name: "Signals", href: "/signals", icon: Radar },
                { name: "Leads", href: "/leads", icon: Users },
            ]
        },
        {
            label: "Engagement",
            items: [
                { name: "Popups", href: "/popups", icon: Megaphone },
                { name: "Forms", href: "/forms", icon: ClipboardList },
            ]
        },
        {
            label: "System",
            items: [
                { name: "Comments", href: "/comments", icon: MessageSquare },
                { name: "Audit Log", href: "/audit", icon: Activity },
                { name: "Resources", href: "/resources", icon: FileBox },
                { name: "Team", href: "/users", icon: Shield },
                { name: "WP Migration", href: "/migration", icon: ArrowRightLeft },
                { name: "Email DNS", href: "/email", icon: Mail },
                // LOCALE-1A (docs/slices/locale-1.md § 7.1): the locale table is general, so every tenant has Labels.
                { name: "Labels", href: "/labels", icon: Languages },
                { name: "Settings", href: "/settings", icon: Settings },
            ]
        },
    ];

    async function handleLogout() {
        try {
            await signOut();
            navigate("/login"); // <--- Now properly used
        } catch (e) {
            console.error("Error signing out:", e);
        }
    }

    async function handleCreateSite() {
        if (!newName) return;
        setIsCreating(true);
        try {
            await apiRequest("/tenants", {
                method: "POST",
                body: JSON.stringify({ name: newName, domain: newDomain, catalogMode: newCatalogMode })
            });
            await refreshTenants();
            setIsCreateOpen(false);
            setNewName("");
            setNewDomain("");
            setNewCatalogMode(false);
        } catch (e: any) {
            alert("Failed to create site: " + e.message);
        } finally {
            setIsCreating(false);
        }
    }

    return (
        <div className={cn("h-screen bg-card flex flex-col border-r", className)}>

            {/* SITE SWITCHER / HEADER */}
            <div className="p-4 border-b">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between h-12">
                            <div className="flex flex-col items-start truncate text-left">
                                <span className="text-xs text-muted-foreground font-normal">Current Site</span>
                                <span className="font-bold truncate w-full">
                                    {currentTenant ? currentTenant.name : "Select Site..."}
                                </span>
                            </div>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[220px]">
                        <DropdownMenuLabel>My Sites</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {tenants.map((t) => (
                            <DropdownMenuItem key={t.id} onClick={() => selectTenant(t.id)}>
                                {t.name}
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                            <DialogTrigger asChild>
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Create New Site
                                </DropdownMenuItem>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader><DialogTitle>Create New Site</DialogTitle></DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Site Name</Label>
                                        <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="My Agency Client" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Domain (Optional)</Label>
                                        <Input value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="client.com" />
                                    </div>
                                    {/* CATALOG-MODE-1 (CM-D11): the kind is chosen here and cannot be changed later.
                                        CAT-ADMIN-1 (§ 4.1): a choice between the two kinds, one sentence each; the payload is unchanged. */}
                                    <div role="radiogroup" aria-label="Site kind" className="space-y-3">
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="site-kind"
                                                checked={!newCatalogMode}
                                                onChange={() => setNewCatalogMode(false)}
                                                className="border-input h-4 w-4 mt-0.5"
                                            />
                                            <p className="text-sm">
                                                <span className="font-medium">Shop or content site</span>
                                                <span className="text-muted-foreground"> — products with prices; commerce (cart, checkout, orders) can be switched on later in Settings.</span>
                                            </p>
                                        </label>
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="site-kind"
                                                checked={newCatalogMode}
                                                onChange={() => setNewCatalogMode(true)}
                                                className="border-input h-4 w-4 mt-0.5"
                                            />
                                            <p className="text-sm">
                                                <span className="font-medium">Catalog site</span>
                                                <span className="text-muted-foreground"> — products without prices or ordering; visitors collect an interest list and send it to you. This choice is fixed for the life of the site.</span>
                                            </p>
                                        </label>
                                    </div>
                                    <Button onClick={handleCreateSite} disabled={isCreating} className="w-full">
                                        {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        {isCreating ? "Creating..." : "Launch Site"}
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* NAVIGATION */}
            <div className="p-4 flex-1 space-y-4 overflow-y-auto">
                {navSections.map((section) => (
                    <div key={section.label}>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1">{section.label}</p>
                        <div className="space-y-0.5">
                            {section.items.map((item) => {
                                const isActive = location.pathname === item.href || (item.href !== "/" && location.pathname.startsWith(item.href));
                                return (
                                    <Link key={item.href} to={item.href} onClick={onNavigate}>
                                        <Button variant={isActive ? "secondary" : "ghost"} className="w-full justify-start h-9">
                                            <item.icon className="mr-2 h-4 w-4" />
                                            {item.name}
                                        </Button>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* FOOTER */}
            <div className="p-4 border-t bg-muted/20">
                {currentTenant && (
                    <div className="mb-4 text-xs text-muted-foreground flex items-center gap-2 px-2 bg-background p-2 rounded border">
                        <Globe className="h-3 w-3 text-primary" />
                        <span className="truncate">{currentTenant.domain}</span>
                    </div>
                )}
                <Button variant="ghost" className="w-full justify-start text-red-500 hover:bg-red-50 hover:text-red-600" onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" /> Logout
                </Button>
            </div>
        </div>
    );
}
