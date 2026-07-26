// DYNAMIC TWIN of the public page route (slice cache-1).
//
// Directory name note: the URL segment is the literal `_dyn`, but a directory literally
// named `_dyn` would be a Next.js *private folder* and excluded from routing entirely
// (measured). `%5F` is the percent-encoding of `_`, which Next decodes back into a
// routable literal segment. Same `_`-prefix convention as `/_site` and `/_next`.
//
// This URL is an internal rewrite target only. `middleware.ts` rejects `/_dyn/...`
// arriving from the wire, so the segment is not externally reachable and cannot be used
// to bypass the cache or to serve tenant content at a second URL.
//
// Everything that cannot live on the cacheable route is served here:
//   - any request with a query string (pagination, search, filters, ?preview=,
//     checkout-confirm ?id&email, checkout-track ?email, utm/ref attribution)
//   - any request carrying a NextAuth session cookie (access-gated pages, account UI)
//   - `/_site/` preview traffic and `/tenant/` test-mode traffic
//
// `force-dynamic` makes every response `Cache-Control: private, no-store`, so neither
// CloudFront nor the OpenNext S3 ISR cache retains per-visitor output.
import { SitePage, buildSitePageMetadata, toSiteQuery } from "@/components/SitePage";
import { getPreviewBase } from "@/lib/routing-server";
import { cookies } from "next/headers";
import { Metadata } from "next";

export const dynamic = "force-dynamic";

type Props = {
    params: Promise<{ siteId: string; slug?: string[] }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/** Raw NextAuth JWT cookie, or null. Both the plain and __Secure- names are in use. */
async function readSessionToken(): Promise<string | null> {
    const jar = await cookies();
    return jar.get("next-auth.session-token")?.value
        || jar.get("__Secure-next-auth.session-token")?.value
        || null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
    const { siteId, slug } = await params;
    return buildSitePageMetadata({ siteId, slug, query: toSiteQuery(await searchParams) });
}

export default async function DynamicPage({ params, searchParams }: Props) {
    const { siteId, slug } = await params;
    const query = toSiteQuery(await searchParams);

    return (
        <SitePage
            siteId={siteId}
            slug={slug}
            // Unchanged semantics: admin "Preview" links append ?preview=true, on the
            // tenant's real domain as well as on the /_site/ fallback.
            preview={Boolean(query.preview)}
            basePath={await getPreviewBase()}
            sessionToken={await readSessionToken()}
            query={query}
            // force-dynamic: a 404 rendered here is already `no-store`, so it is answered
            // directly instead of being handed off.
            cacheable={false}
        />
    );
}
