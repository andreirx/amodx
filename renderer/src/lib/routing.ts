"use client";

import { usePathname } from "next/navigation";

export function useTenantUrl() {
    const pathname = usePathname(); // e.g. "/_site/client-123/about" or "/about"

    // Detect if we are in the special preview path
    // Pattern: /_site/[tenantId]/...
    let isPreview = pathname?.startsWith("/_site/");
    let prefix = "";

    if (isPreview) {
        const parts = pathname.split("/");
        // parts[0] = empty, parts[1] = _site, parts[2] = tenantId
        if (parts.length >= 3) {
            prefix = `/${parts[1]}/${parts[2]}`; // "/_site/client-123"
        }
    } else {
        // Check cookie fallback (set by middleware for rewritten preview URLs)
        if (typeof document !== 'undefined') {
            const match = document.cookie.match(/amodx_preview_base=([^;]+)/);
            if (match) {
                prefix = decodeURIComponent(match[1]);
                isPreview = true;
            }
        }
    }

    // Function to rewrite a raw slug to the correct URL
    const getUrl = (slug: string) => {
        if (!slug) return "#";
        if (slug.startsWith("http")) return slug; // External links untouched

        // Ensure slug starts with /
        const cleanSlug = slug.startsWith("/") ? slug : `/${slug}`;

        // Prevent double prefixing if slug already has it (edge case)
        if (cleanSlug.startsWith(prefix)) return cleanSlug;

        return `${prefix}${cleanSlug}`;
    };

    return { getUrl, isPreview, prefix };
}
