/** Flattened query string. Multi-value params collapse to their first value. */
export type SiteQuery = Record<string, string | undefined>;

/**
 * Everything the page render needs that varies per request.
 * Plain data only — no framework objects cross this boundary.
 */
export type SitePageInput = {
    siteId: string;
    slug?: string[];
    /** Show Draft / non-active items. Always false on the cacheable route. */
    preview: boolean;
    /** URL prefix for generated links, e.g. "/_site/<tenantId>". "" on the cacheable route. */
    basePath: string;
    /** Raw NextAuth JWT from the request cookie. Always null on the cacheable route. */
    sessionToken: string | null;
    /** Resolved query string. Always {} on the cacheable route. */
    query: SiteQuery;
    /**
     * True on the ISR route, false on the dynamic twin. Only affects how a not-found
     * outcome is delivered — see `lib/not-found-handoff.ts`. Not derivable from the
     * other props: a twin request can legitimately arrive with an empty query (session
     * cookie, `/_site/` preview).
     */
    cacheable: boolean;
};
