"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function useTenantUrl() {
    const pathname = usePathname(); // e.g. "/_site/client-123/about" or "/about"
    const [cookiePrefix, setCookiePrefix] = useState("");
    useEffect(() => {
        // A preview pathname is authoritative. Do not read or decode an unused cookie.
        if (pathname?.startsWith("/_site/")) return;
        const match = document.cookie.match(/amodx_preview_base=([^;]+)/);
        setCookiePrefix(match ? decodeURIComponent(match[1]) : "");
    }, [pathname]);

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
        // The cookie fallback is browser-only state, read after hydration.
        if (cookiePrefix) {
            prefix = cookiePrefix;
            isPreview = true;
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
