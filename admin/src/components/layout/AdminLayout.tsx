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
import { useEffect, useState } from "react";

export default function AdminLayout() {
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [links, setLinks] = useState<{ title: string, slug: string }[]>([]);

    // 2. FETCH LINKS ON MOUNT
    useEffect(() => {
        const fetchLinks = async () => {
            try {
                // Fetch pages to populate the autocomplete
                const res = await apiRequest("/content");
                if (res.items) {
                    const pages = res.items.map((p: any) => ({
                        title: p.title,
                        slug: p.slug
                    }));
                    setLinks(pages);
                }
            } catch (e) {
                console.warn("Autolink fetch failed", e);
            }
        };
        fetchLinks();
    }, []);

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
