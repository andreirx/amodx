import { getTenantConfig, getProductsForFeed } from "@/lib/dynamo";
import { NextResponse } from "next/server";
import { isCatalogMode } from "@amodx/shared";

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);

    if (!config) return new NextResponse("Site not found", { status: 404 });

    // CATALOG-MODE-1 (§ 3.3, S3 ruling: withhold): the feed format requires price and availability, which a catalog
    // site does not have; an entry without them is malformed or invites a consumer to fill a fabricated price.
    if (isCatalogMode(config)) return new NextResponse("Not found", { status: 404 });

    // Phase 2.4: Direct DynamoDB reads instead of API calls with master key
    const items = await getProductsForFeed(config.id);
    const baseUrl = `https://${config.domain}`;
    const productPrefix = config.urlPrefixes?.product || '/product';

    // Transform to OpenAI/Google product feed format
    const products = items.map((p: any) => ({
            id: p.id,
            title: p.title,
            description: p.description,
            link: `${baseUrl}${productPrefix}/${p.slug}`,
            image_link: p.imageLink,
            additional_image_links: p.additionalImageLinks,
            price: `${p.price} ${p.currency}`,
            sale_price: p.salePrice ? `${p.salePrice} ${p.currency}` : undefined,
            brand: p.brand || config.name,
            availability: p.availability,
            condition: p.condition,
            seller_name: config.name,
            seller_url: baseUrl
        }));

    return NextResponse.json(products, {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, s-maxage=900"
        }
    });
}
