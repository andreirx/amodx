import { useState, useEffect, useRef } from "react";
import { Input } from "./input";
import { Link as LinkIcon, FileText, Globe, ShoppingBag, FolderTree } from "lucide-react";
import { cn } from "@/lib/utils";

interface SmartLinkInputProps {
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    className?: string;
}

export function SmartLinkInput({ value, onChange, placeholder, className }: SmartLinkInputProps) {
    const [isFocused, setIsFocused] = useState(false);
    const [suggestions, setSuggestions] = useState<{ title: string, slug: string }[]>([]);
    const [filtered, setFiltered] = useState<{ title: string, slug: string }[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    // Load suggestions from Global DOM (injected by AdminLayout)
    useEffect(() => {
        if (isFocused) {
            const dataList = document.getElementById('amodx-links') as HTMLDataListElement;
            if (dataList) {
                const opts = Array.from(dataList.options).map(opt => ({
                    slug: opt.value,
                    title: opt.label || opt.text
                }));
                setSuggestions(opts);
                setFiltered(opts);
            }
        }
    }, [isFocused]);

    // Filter as you type
    useEffect(() => {
        if (!value) {
            setFiltered(suggestions);
            return;
        }
        const lower = value.toLowerCase();
        setFiltered(suggestions.filter(s =>
            s.title.toLowerCase().includes(lower) ||
            s.slug.toLowerCase().includes(lower)
        ));
    }, [value, suggestions]);

    // Click outside handler
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsFocused(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelect = (slug: string) => {
        onChange(slug);
        setIsFocused(false);
    };

    return (
        <div className={cn("relative w-full", className)} ref={containerRef}>
            <div className="relative">
                <div className="absolute left-2.5 top-2.5 text-muted-foreground">
                    <LinkIcon className="h-4 w-4" />
                </div>
                <Input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    placeholder={placeholder || "/path or https://..."}
                    className="pl-9"
                    autoComplete="off"
                />
            </div>

            {/* DROPDOWN */}
            {isFocused && (
                <div className="absolute top-full left-0 w-full mt-1 bg-popover border shadow-lg rounded-md max-h-60 overflow-y-auto z-50 animate-in fade-in slide-in-from-top-1">
                    {filtered.length > 0 ? (
                        filtered.map((page) => {
                            // Determine icon based on slug pattern
                            const isProduct = page.slug.startsWith('/product/');
                            const isCategory = page.slug.startsWith('/category/');
                            const IconComponent = isProduct ? ShoppingBag : isCategory ? FolderTree : FileText;

                            return (
                                <button
                                    key={page.slug}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 group border-b border-border/50 last:border-0"
                                    onClick={() => handleSelect(page.slug)}
                                >
                                    <IconComponent className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate font-medium">{page.title}</div>
                                        <div className="text-xs text-muted-foreground font-mono truncate">{page.slug}</div>
                                    </div>
                                </button>
                            );
                        })
                    ) : (
                        <div className="px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
                            <Globe className="h-3 w-3" />
                            <span>External URL. Click outside to confirm.</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
