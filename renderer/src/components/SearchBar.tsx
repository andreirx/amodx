"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTenantUrl } from "@/lib/routing";

interface SearchBarProps {
    placeholder?: string;
    searchPrefix?: string;
    productPrefix?: string;
    tenantId?: string;
    apiUrl?: string;
    contentMaxWidth?: string;
}

interface SearchResult {
    id: string;
    title: string;
    slug: string;
    price: string;
    currency: string;
    salePrice?: string;
    imageLink?: string;
}

export function SearchBar({
    placeholder = "Search products...",
    searchPrefix = "/search",
    productPrefix = "/product",
    tenantId,
    apiUrl = "",
    contentMaxWidth = "max-w-7xl",
}: SearchBarProps) {
    const router = useRouter();
    const { getUrl } = useTenantUrl();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Click outside to close
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    const doSearch = useCallback(async (q: string) => {
        if (!q || q.length < 2 || !tenantId) {
            setResults([]);
            setShowDropdown(false);
            return;
        }
        setLoading(true);
        try {
            const res = await fetch(
                `${apiUrl}/public/products?search=${encodeURIComponent(q)}&limit=5`,
                { headers: { "x-tenant-id": tenantId } }
            );
            if (!res.ok) throw new Error();
            const data = await res.json();
            setResults(data.items || []);
            setShowDropdown(true);
        } catch {
            setResults([]);
        } finally {
            setLoading(false);
        }
    }, [apiUrl, tenantId]);

    function handleChange(value: string) {
        setQuery(value);
        if (timerRef.current) clearTimeout(timerRef.current);
        if (!value.trim() || value.trim().length < 2) {
            setResults([]);
            setShowDropdown(false);
            return;
        }
        timerRef.current = setTimeout(() => doSearch(value.trim()), 2000);
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!query.trim()) return;
        setShowDropdown(false);
        router.push(getUrl(`${searchPrefix}?q=${encodeURIComponent(query.trim())}`));
    }

    function handleResultClick(slug: string) {
        setShowDropdown(false);
        setQuery("");
        router.push(getUrl(`${productPrefix}/${slug}`));
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Escape") {
            setShowDropdown(false);
        }
    }

    return (
        <div className="bg-primary w-full">
            <div className={`mx-auto ${contentMaxWidth} px-4 sm:px-6 lg:px-8 py-4`}>
                <div ref={wrapperRef} className="relative max-w-2xl mx-auto">
                    <form onSubmit={handleSubmit} className="flex items-center gap-3">
                        <div className="relative flex-1">
                            {/* Search icon */}
                            <svg
                                className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input
                                type="text"
                                value={query}
                                onChange={e => handleChange(e.target.value)}
                                onKeyDown={handleKeyDown}
                                onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
                                placeholder={placeholder}
                                className="w-full pl-12 pr-10 py-3 text-base border-0 rounded-full bg-background shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-foreground/30 transition-colors"
                            />
                            {/* Clear button */}
                            {query && (
                                <button
                                    type="button"
                                    onClick={() => { setQuery(""); setResults([]); setShowDropdown(false); }}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            )}
                        </div>
                        <button
                            type="submit"
                            className="bg-background text-foreground px-6 py-3 rounded-full text-sm font-semibold hover:bg-background/90 transition-opacity shrink-0 shadow-sm"
                        >
                            Search
                        </button>
                    </form>

                    {/* Preview Dropdown */}
                    {showDropdown && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-50 overflow-hidden">
                            {loading ? (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                    <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                                    Searching...
                                </div>
                            ) : results.length === 0 ? (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                    No products found
                                </div>
                            ) : (
                                <>
                                    {results.map(product => (
                                        <button
                                            key={product.id}
                                            onClick={() => handleResultClick(product.slug)}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left"
                                        >
                                            <div className="h-10 w-10 rounded bg-muted overflow-hidden shrink-0">
                                                {product.imageLink ? (
                                                    <img
                                                        src={product.imageLink}
                                                        alt={product.title}
                                                        className="h-full w-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs">--</div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{product.title}</p>
                                                <p className="text-xs text-primary font-medium">
                                                    {product.salePrice ? (
                                                        <><span className="text-red-600">{product.salePrice} {product.currency}</span> <span className="line-through text-muted-foreground">{product.price}</span></>
                                                    ) : (
                                                        <>{product.price} {product.currency}</>
                                                    )}
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => {
                                            setShowDropdown(false);
                                            router.push(getUrl(`${searchPrefix}?q=${encodeURIComponent(query.trim())}`));
                                        }}
                                        className="w-full px-4 py-2.5 text-center text-sm text-primary font-medium border-t hover:bg-muted transition-colors"
                                    >
                                        View all results
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
