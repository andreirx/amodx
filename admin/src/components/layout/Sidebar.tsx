import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signOut } from 'aws-amplify/auth';
import { useTenant } from "@/context/TenantContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import {Shield, Users} from "lucide-react";
import { ShoppingBag } from "lucide-react";
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
    const [isCreating, setIsCreating] = useState(false);

    const navItems = [
        { name: "Content List", href: "/", icon: LayoutDashboard },
        { name: "Content Graph", href: "/graph", icon: GitGraph },
        { name: "Products", href: "/products", icon: ShoppingBag },
        { name: "Strategy", href: "/strategy", icon: Target },
        { name: "Signals", href: "/signals", icon: Radar },
        { name: "Media", href: "/media", icon: ImageIcon },
        { name: "Leads", href: "/leads", icon: Users },
        { name: "Comments", href: "/comments", icon: MessageSquare },
        { name: "Audit Log", href: "/audit", icon: Activity },
        { name: "Resources", href: "/resources", icon: FileBox },
        { name: "Team", href: "/users", icon: Shield },
        { name: "Settings", href: "/settings", icon: Settings },
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
                body: JSON.stringify({ name: newName, domain: newDomain })
            });
            await refreshTenants();
            setIsCreateOpen(false);
            setNewName("");
            setNewDomain("");
        } catch (e: any) {
            alert("Failed to create site: " + e.message);
        } finally {
            setIsCreating(false);
        }
    }

    return (
        <div className={cn("pb-12 min-h-screen bg-card flex flex-col border-r", className)}>

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
            <div className="space-y-1 p-4 flex-1">
                {navItems.map((item) => {
                    const isActive = location.pathname === item.href || (item.href !== "/" && location.pathname.startsWith(item.href));
                    return (
                        <Link key={item.href} to={item.href} onClick={onNavigate}>
                            <Button variant={isActive ? "secondary" : "ghost"} className="w-full justify-start mb-1">
                                <item.icon className="mr-2 h-4 w-4" />
                                {item.name}
                            </Button>
                        </Link>
                    );
                })}
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
