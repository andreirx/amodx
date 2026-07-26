// DYNAMIC TWIN of the legacy by-ID product route (slice cache-1).
// Reached only via middleware rewrite: /products/<id> with a query string or a NextAuth
// session cookie, plus all /_site/ and /tenant/ traffic. See the twin at
// [siteId]/%5Fdyn/[[...slug]]/page.tsx for why the directory is `%5Fdyn`.
import { ProductByIdPage, buildProductByIdMetadata } from "@/components/ProductByIdPage";
import { Metadata } from "next";

export const dynamic = "force-dynamic";

type Props = {
    params: Promise<{ siteId: string; productId: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { siteId, productId } = await params;
    return buildProductByIdMetadata({ siteId, productId });
}

export default async function DynamicProductPage({ params, searchParams }: Props) {
    const { siteId, productId } = await params;
    const { preview } = await searchParams;
    return <ProductByIdPage siteId={siteId} productId={productId} preview={Boolean(preview)} cacheable={false} />;
}
