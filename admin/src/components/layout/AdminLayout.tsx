import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetTrigger,
    SheetTitle,
    SheetDescription
} from "@/components/ui/sheet";
import { apiRequest } from "@/lib/api";
import { useEffect, useState, useCallback } from "react";
import { useTenant } from "@/context/TenantContext";

interface LinkSuggestion {
    title: string;
    slug: string;
    type: 'page' | 'product' | 'category';
}

export default function AdminLayout() {
    const { currentTenant } = useTenant();
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [links, setLinks] = useState<LinkSuggestion[]>([]);

    // Define fetch function - fetches pages, and products/categories if commerce is enabled
    const fetchLinks = useCallback(async () => {
        try {
            const allLinks: LinkSuggestion[] = [];

            // Fetch content pages
            const contentRes = await apiRequest("/content");
            if (contentRes.items) {
                const pages = contentRes.items.map((p: any) => ({
                    title: p.title,
                    slug: p.slug,
                    type: 'page' as const
                }));
                allLinks.push(...pages);
            }

            // Fetch products and categories if commerce is enabled
            if (currentTenant?.commerceEnabled) {
                try {
                    const [productsRes, categoriesRes] = await Promise.all([
                        apiRequest("/products"),
                        apiRequest("/categories")
                    ]);

                    if (productsRes.items) {
                        const products = productsRes.items.map((p: any) => ({
                            title: `[Product] ${p.title}`,
                            slug: `/product/${p.slug}`,
                            type: 'product' as const
                        }));
                        allLinks.push(...products);
                    }

                    if (categoriesRes.items) {
                        const categories = categoriesRes.items.map((c: any) => ({
                            title: `[Category] ${c.name}`,
                            slug: `/category/${c.slug}`,
                            type: 'category' as const
                        }));
                        allLinks.push(...categories);
                    }
                } catch (e) {
                    console.warn("Commerce links fetch failed", e);
                }
            }

            // Sort by title for easier searching
            allLinks.sort((a, b) => a.title.localeCompare(b.title));
            setLinks(allLinks);
        } catch (e) {
            console.warn("Autolink fetch failed", e);
        }
    }, [currentTenant?.commerceEnabled]);

    // Initial Load + Event Listener
    useEffect(() => {
        fetchLinks(); // Initial load

        // Listen for updates (e.g., when content is edited)
        const handleRefresh = (e: Event) => {
            // Check if the event carries data (CustomEvent)
            const detail = (e as CustomEvent).detail;

            if (detail && Array.isArray(detail)) {
                // OPTIMIZATION: Use the data passed by ContentList for pages
                // But we still need to refetch to get products/categories
                fetchLinks();
            } else {
                // Fallback: Fetch from API if no data provided
                fetchLinks();
            }
        };

        window.addEventListener("amodx:refresh-links", handleRefresh as EventListener);
        return () => window.removeEventListener("amodx:refresh-links", handleRefresh as EventListener);
    }, [fetchLinks]);

    return (
        <div className="flex min-h-screen bg-background">
            {/* 3. INJECT DATALIST GLOBALLY */}
            <datalist id="amodx-links">
                {links.map((link) => (
                    <option key={link.slug} value={link.slug}>
                        {link.title}
                    </option>
                ))}
            </datalist>

            {/* 1. DESKTOP SIDEBAR (Hidden on mobile) */}
            <div className="hidden md:block w-64 fixed inset-y-0 border-r bg-card z-20">
                <Sidebar />
            </div>

            {/* 2. MAIN CONTENT AREA */}
            <main className="flex-1 md:ml-64 flex flex-col min-h-screen">

                {/* MOBILE HEADER (Visible only on mobile) */}
                <header className="md:hidden border-b p-4 flex items-center gap-4 bg-card sticky top-0 z-30">
                    <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon">
                                <Menu className="h-6 w-6" />
                                <span className="sr-only">Toggle Menu</span>
                            </Button>
                        </SheetTrigger>

                        {/* The Drawer Content */}
                        <SheetContent side="left" className="p-0 w-64">
                            {/* Accessibility Requirements for Radix/Shadcn Sheet */}
                            <div className="sr-only">
                                <SheetTitle>Navigation Menu</SheetTitle>
                                <SheetDescription>Main navigation for AMODX admin panel</SheetDescription>
                            </div>

                            <Sidebar onNavigate={() => setIsMobileOpen(false)} />
                        </SheetContent>
                    </Sheet>

                    <span className="font-bold text-lg">AMODX</span>
                </header>

                {/* Page Content */}
                <div className="flex-1 h-full">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
