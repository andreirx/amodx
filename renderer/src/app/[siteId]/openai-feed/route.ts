import { getTenantConfig } from "@/lib/dynamo";
import { getMasterKey } from "@/lib/api-client";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ siteId: string }> }
) {
    const { siteId } = await params;
    const config = await getTenantConfig(siteId);

    if (!config) return new NextResponse("Site not found", { status: 404 });

    const apiKey = await getMasterKey();
    const apiUrl = process.env.API_URL;

    const res = await fetch(`${apiUrl}/products`, {
        headers: {
            "x-tenant-id": config.id,
            "x-api-key": apiKey || "",
            "Authorization": "Bearer robot"
        }
    });

    if (!res.ok) return new NextResponse("Error fetching products", { status: 500 });

    const { items } = await res.json();
    const baseUrl = `https://${config.domain}`;

    // FILTER & TRANSFORM
    const products = items
        .filter((p: any) => p.status === 'active') // <--- STRICT FILTER
        .map((p: any) => ({
            id: p.id,
            title: p.title,
            description: p.description,
            link: `${baseUrl}/products/${p.id}`,
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
