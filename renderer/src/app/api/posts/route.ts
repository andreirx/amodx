// Client fallback for the `postGrid` block (packages/plugins/src/post-grid/PostGridRender.tsx)
// when the server did not prefetch. It is a READ path, so it obeys the same rule as
// `lib/dynamo.ts`: `{ items: [] }` means the query succeeded and matched nothing. A missing
// `TABLE_NAME` or a DynamoDB failure is an error and answers 5xx (human decision CACHE-1-D4,
// widened to this route by review-1, 2026-07-26 — the rule is repo-wide and has no
// "uncached routes may lie" carve-out). PostGridRender already renders an error state for a
// non-2xx response, so the failure is visible instead of looking like "this site has no posts".
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

    // Caller error: without a tenant there is no question to answer, and answering "no posts"
    // would be a guess. 400, not an empty 200.
    if (!tenantId) {
        return NextResponse.json({ error: "x-tenant-id header is required" }, { status: 400 });
    }
    // Deployment error, same reasoning as `requireTableName()` in lib/dynamo.ts.
    const tableName = process.env.TABLE_NAME;
    if (!tableName) {
        console.error("Posts API: TABLE_NAME is not set");
        return NextResponse.json({ error: "Posts are unavailable" }, { status: 500 });
    }

    try {
        // Query only "Content" items (Pages/Posts)
        const params: any = {
            TableName: tableName,
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
        // Log and answer 500. Returning `{ items: [] }` here would tell the block "this site
        // has no posts", which is the same fabricated absence D4 removed from lib/dynamo.ts.
        console.error("Posts API Error:", e);
        return NextResponse.json({ error: "Posts are unavailable" }, { status: 500 });
    }
}
