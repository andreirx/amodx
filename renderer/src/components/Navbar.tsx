"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, User } from "lucide-react";
import { useSession } from "next-auth/react";
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
                           showTitle = true,
                           commerceEnabled = false,
                           hideContactButton = false,
                           accountPrefix,
                       }: {
    siteName: string;
    logo?: string;
    links?: LinkItem[];
    showLogo?: boolean;
    showTitle?: boolean;
    commerceEnabled?: boolean;
    hideContactButton?: boolean;
    accountPrefix?: string;
}) {
    const { getUrl } = useTenantUrl();
    const { data: session } = useSession();
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    return (
        <nav className="border-b bg-background/80 backdrop-blur">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className={`flex justify-between items-center transition-all duration-300 ${scrolled ? "h-12" : "h-16"}`}>

                    {/* --- LOGO AREA --- */}
                    <div className="flex shrink-0 items-center">
                        <Link href={getUrl("/")} className="flex items-center gap-2">
                            {showLogo && logo && (
                                <img
                                    src={logo}
                                    alt={siteName}
                                    className={`w-auto object-contain transition-all duration-300 ${scrolled ? "h-8" : "h-12"}`}
                                />
                            )}
                            {showTitle && (
                                <span className={`font-bold text-foreground tracking-tight transition-all duration-300 ${scrolled ? "text-lg" : "text-xl"}`}>
                                    {siteName}
                                </span>
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
                        {commerceEnabled && (
                            session ? (
                                <Link href={getUrl(accountPrefix || "/account")} className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                                    <User className="h-4 w-4" />
                                    {session.user?.name?.split(" ")[0] || "Account"}
                                </Link>
                            ) : (
                                <a href="/api/auth/signin" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                                    <User className="h-4 w-4" />
                                    Sign In
                                </a>
                            )
                        )}
                        {commerceEnabled && !hideContactButton && <CartWidget />}
                        {!hideContactButton && (
                            <Link
                                href={getUrl("/contact")}
                                className="bg-primary text-primary-foreground px-5 py-2 rounded-full text-sm font-medium hover:opacity-90 transition-opacity shadow-sm"
                            >
                                Contact
                            </Link>
                        )}
                    </div>

                    {/* --- MOBILE TOGGLE + CART --- */}
                    <div className="flex items-center gap-2 md:hidden">
                        {commerceEnabled && <CartWidget />}
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
                    className={`md:hidden absolute left-0 w-full bg-background border-b shadow-xl animate-in slide-in-from-top-2 fade-in-20 ${scrolled ? "top-12" : "top-16"}`}>
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
                        {commerceEnabled && (
                            <div className="pt-2 border-t border-border">
                                {session ? (
                                    <Link
                                        href={getUrl(accountPrefix || "/account")}
                                        className="block py-3 text-base font-medium text-muted-foreground hover:text-primary px-3 rounded-md transition-colors"
                                        onClick={() => setIsMobileOpen(false)}
                                    >
                                        My Account
                                    </Link>
                                ) : (
                                    <a
                                        href="/api/auth/signin"
                                        className="block py-3 text-base font-medium text-muted-foreground hover:text-primary px-3 rounded-md transition-colors"
                                        onClick={() => setIsMobileOpen(false)}
                                    >
                                        Sign In
                                    </a>
                                )}
                            </div>
                        )}
                        {!hideContactButton && (
                            <div className="pt-4 mt-2 border-t border-border">
                                <Link
                                    href="/contact"
                                    className="block w-full text-center bg-primary text-primary-foreground px-4 py-3 rounded-md text-base font-medium hover:opacity-90"
                                    onClick={() => setIsMobileOpen(false)}
                                >
                                    Contact Us
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </nav>
    );
}
