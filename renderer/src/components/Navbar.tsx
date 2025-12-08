import Link from "next/link";

export function Navbar({ siteName }: { siteName: string }) {
    return (
        <nav className="border-b bg-white sticky top-0 z-50">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="flex h-16 justify-between items-center">
                    <div className="flex shrink-0 items-center">
                        {/* The Site Name should be colored */}
                        <Link href="/" className="text-2xl font-bold text-primary tracking-tight">
                            {siteName}
                        </Link>
                    </div>

                    <div className="flex items-center">
                        {/* The Button should be colored */}
                        <button className="bg-primary text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity">
                            Contact
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    );
}
