import Link from "next/link";

interface LinkItem { label: string; href: string; }

export function Navbar({ siteName, logo, links = [] }: { siteName: string; logo?: string; links?: LinkItem[] }) {
    return (
        <nav className="border-b bg-background/80 backdrop-blur sticky top-0 z-50">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="flex h-16 justify-between items-center">

                    {/* Logo Area */}
                    <div className="flex shrink-0 items-center">
                        <Link href="/" className="flex items-center gap-2">
                            {logo ? (
                                <img src={logo} alt={siteName} className="h-8 w-auto" />
                            ) : (
                                <span className="text-xl font-bold text-foreground tracking-tight">{siteName}</span>
                            )}
                        </Link>
                    </div>

                    {/* Desktop Nav */}
                    <div className="hidden md:flex items-center gap-6">
                        {links.map((link, i) => (
                            <Link key={i} href={link.href} className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                {link.label}
                            </Link>
                        ))}
                    </div>

                    {/* Mobile Menu (Simplified for V1) */}
                    <div className="flex items-center md:hidden">
                        <button className="text-foreground">Menu</button>
                    </div>
                </div>
            </div>
        </nav>
    );
}
