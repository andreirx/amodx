import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-central-1" });
const docClient = DynamoDBDocumentClient.from(client);

export async function GET(req: NextRequest) {
    const tenantId = req.headers.get("x-tenant-id");
    const { searchParams } = new URL(req.url);
    const tag = searchParams.get("tag");
    const limitParam = searchParams.get("limit");

    // Default to 6, but if 0 is passed, keep it 0 (Infinity)
    const limit = limitParam !== null ? parseInt(limitParam) : 6;

    if (!tenantId || !process.env.TABLE_NAME) {
        return NextResponse.json({ items: [] });
    }

    try {
        // Query only "Content" items (Pages/Posts)
        const params: any = {
            TableName: process.env.TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `TENANT#${tenantId}`,
                ":sk": "CONTENT#",
                ":pub": "Published"
            },
            // Only show published pages
            FilterExpression: "#s = :pub",
            ExpressionAttributeNames: { "#s": "status" }
        };

        // Apply Tag Filter
        if (tag) {
            params.FilterExpression += " AND contains(tags, :tag)";
            params.ExpressionAttributeValues[":tag"] = tag;
        }

        const result = await docClient.send(new QueryCommand(params));
        let items = result.Items || [];

        // 1. FILTER FOR LATEST VERSIONS ONLY
        // With versioning, we have ...#v1, ...#v2, and ...#LATEST.
        // We only want LATEST.
        items = items.filter(item => item.SK.endsWith("#LATEST"));

        // 2. Sort by Date Descending
        items.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // 3. Limit Logic (0 = All)
        if (limit > 0) {
            items = items.slice(0, limit);
        }

        // Map to lightweight format for grid
        const cleanItems = items.map((p: any) => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            featuredImage: p.featuredImage,
            seoDescription: p.seoDescription,
            tags: p.tags,
            createdAt: p.createdAt
        }));

        return NextResponse.json({ items: cleanItems });
    } catch (e) {
        console.error("Posts API Error:", e);
        return NextResponse.json({ items: [] });
    }
}
