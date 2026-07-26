// CACHEABLE legacy by-ID product route (slice cache-1).
// Same two conditions as [siteId]/[[...slug]]/page.tsx: `generateStaticParams()` must
// exist for the route to be in full-route cache mode, and no reachable code path may
// call a Next.js dynamic API. `?preview=` is served by the twin at
// [siteId]/%5Fdyn/products/[productId].
import { ProductByIdPage, buildProductByIdMetadata } from "@/components/ProductByIdPage";
import { Metadata } from "next";

export const revalidate = false; // On-demand revalidation only — no time-based ISR

export function generateStaticParams() {
    return [];
}

type Props = {
    params: Promise<{ siteId: string; productId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId, productId } = await params;
    return buildProductByIdMetadata({ siteId, productId });
}

export default async function ProductPage({ params }: Props) {
    const { siteId, productId } = await params;
    return <ProductByIdPage siteId={siteId} productId={productId} preview={false} cacheable={true} />;
}
