// CACHEABLE public page route (slice cache-1).
//
// This route must stay in Next's full-route (ISR) cache mode. Two conditions, both
// measured on next@16.2.9 — see docs/caching-architecture.md § "Measured serving behaviour":
//
//   1. `generateStaticParams()` must exist. Returning [] is enough: it opts the route
//      into the full-route cache and prerenders nothing at build time (no build-time
//      DynamoDB access). Without it, a route with an un-enumerated dynamic segment is
//      rendered dynamically and answers `Cache-Control: no-store` — both cache layers
//      stay empty even with `revalidate = false`.
//   2. NO code path reachable from here — this file, `generateMetadata`, the shared
//      `[siteId]/layout.tsx`, or any server component below — may call a Next.js dynamic
//      API (`cookies()`, `headers()`, `await searchParams`, `connection()`). In ISR mode
//      such a call is an HTTP 500 for that request, not a per-request dynamic render.
//
// Per-request traffic (query strings, NextAuth session, `/_site/` preview, `/tenant/`
// test mode) is rewritten by `middleware.ts` to the force-dynamic twin at
// `[siteId]/%5Fdyn/[[...slug]]`, which renders the same `SitePage` body with real values.
import { SitePage, buildSitePageMetadata } from "@/components/SitePage";
import { Metadata } from "next";

export const revalidate = false; // On-demand revalidation only — no time-based ISR

// Opt into the full-route cache. Deliberately empty: nothing is prerendered at build
// time; entries are populated on first request and reused until invalidated.
export function generateStaticParams() {
    return [];
}

type Props = {
    params: Promise<{ siteId: string; slug?: string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId, slug } = await params;
    return buildSitePageMetadata({ siteId, slug, query: {} });
}

export default async function Page({ params }: Props) {
    const { siteId, slug } = await params;
    return (
        <SitePage
            siteId={siteId}
            slug={slug}
            preview={false}
            basePath=""
            sessionToken={null}
            query={{}}
            // A not-found outcome here would be cached with the page's own s-maxage, so
            // this route hands 404s to the twin instead — see lib/not-found-handoff.ts.
            cacheable={true}
        />
    );
}
