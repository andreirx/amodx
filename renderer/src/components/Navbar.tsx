"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useTenantUrl } from "@/lib/routing";
import { CartWidget } from "./CartWidget";

interface LinkItem {
    label: string;
    href: string;
}

export function Navbar({
                           siteName,
                           logo,
                           links = [],
                           showLogo = true,
                           showTitle = true
                       }: {
    siteName: string;
    logo?: string;
    links?: LinkItem[];
    showLogo?: boolean;
    showTitle?: boolean;
}) {
    const { getUrl } = useTenantUrl();
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    return (
        <nav className="border-b bg-background/80 backdrop-blur sticky top-0 z-50">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="flex h-16 justify-between items-center">

                    {/* --- LOGO AREA --- */}
                    <div className="flex shrink-0 items-center">
                        <Link href={getUrl("/")} className="flex items-center gap-2">
                            {showLogo && logo && (
                                <img src={logo} alt={siteName} className="h-12 w-auto object-contain"/>
                            )}
                            {showTitle && (
                                <span className="text-xl font-bold text-foreground tracking-tight">{siteName}</span>
                            )}
                        </Link>
                    </div>

                    {/* --- DESKTOP NAV --- */}
                    <div className="hidden md:flex items-center gap-8">
                        {links.map((link, i) => (
                            <Link
                                key={i}
                                href={getUrl(link.href)}
                                className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
                            >
                                {link.label}
                            </Link>
                        ))}
                        <CartWidget />
                        <Link
                            href={getUrl("/contact")}
                            className="bg-primary text-primary-foreground px-5 py-2 rounded-full text-sm font-medium hover:opacity-90 transition-opacity shadow-sm"
                        >
                            Contact
                        </Link>
                    </div>

                    {/* --- MOBILE TOGGLE --- */}
                    <div className="flex items-center md:hidden">
                        <button
                            onClick={() => setIsMobileOpen(!isMobileOpen)}
                            className="text-foreground p-2 -mr-2"
                            aria-label="Toggle menu"
                        >
                            {isMobileOpen ? <X className="h-6 w-6"/> : <Menu className="h-6 w-6"/>}
                        </button>
                    </div>
                </div>
            </div>

            {/* --- MOBILE MENU (Dropdown) --- */}
            {isMobileOpen && (
                <div
                    className="md:hidden absolute top-16 left-0 w-full bg-background border-b shadow-xl animate-in slide-in-from-top-2 fade-in-20">
                    <div className="space-y-1 px-4 pb-6 pt-2">
                        {links.map((link, i) => (
                            <Link
                                key={i}
                                href={link.href}
                                className="block py-3 text-base font-medium text-muted-foreground hover:text-primary hover:bg-muted/50 px-3 rounded-md transition-colors"
                                onClick={() => setIsMobileOpen(false)}
                            >
                                {link.label}
                            </Link>
                        ))}
                        <div className="pt-4 mt-2 border-t border-border">
                            <Link
                                href="/contact"
                                className="block w-full text-center bg-primary text-primary-foreground px-4 py-3 rounded-md text-base font-medium hover:opacity-90"
                                onClick={() => setIsMobileOpen(false)}
                            >
                                Contact Us
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
}
