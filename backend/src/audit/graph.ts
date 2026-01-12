import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";

type Handler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// Helper: Normalize URL to slug
function normalizeSlug(url?: string): string | null {
    if (!url) return null;
    let clean = url.split('?')[0].split('#')[0];
    clean = clean.replace(/^https?:\/\/[^\/]+/, '');
    if (!clean.startsWith('/')) clean = '/' + clean;
    if (clean.length > 1 && clean.endsWith('/')) clean = clean.slice(0, -1);
    return clean;
}

// Helper: Fetch ALL items (Handle Pagination)
// FIX: Removed ': any' cast on command to let TS infer QueryCommand output correctly
async function fetchAllContent(tenantId: string) {
    let items: Record<string, any>[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined = undefined;

    do {
        const command = new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "CONTENT#" },
            ProjectionExpression: "SK, nodeId, title, slug, #s, blocks, tags, createdAt",
            ExpressionAttributeNames: { "#s": "status" },
            ExclusiveStartKey: lastEvaluatedKey
        });

        // db.send(QueryCommand) returns QueryCommandOutput, which has Items
        const res = await db.send(command);

        if (res.Items) {
            items.push(...res.Items);
        }
        lastEvaluatedKey = res.LastEvaluatedKey;

    } while (lastEvaluatedKey);

    return items;
}

export const handler: Handler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        if (!tenantId) return { statusCode: 400, body: "Missing Tenant" };
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        // 1. Fetch Config (Nav Links) & Content (Paginated)
        const [items, configRes] = await Promise.all([
            fetchAllContent(tenantId),
            db.send(new GetCommand({
                TableName: TABLE_NAME,
                Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
                ProjectionExpression: "navLinks, footerLinks"
            }))
        ]);

        const config = configRes.Item || {};

        // 2. Build Maps
        const slugMap = new Map<string, string>();
        const nodeMap = new Map<string, any>();
        const publishedPages: any[] = [];

        items.forEach((item: any) => {
            if (item.SK.endsWith("#LATEST")) {
                const cleanSlug = normalizeSlug(item.slug);
                if (cleanSlug) {
                    slugMap.set(cleanSlug, item.nodeId);
                    nodeMap.set(item.nodeId, { ...item, slug: cleanSlug });

                    if (item.status === 'Published') {
                        publishedPages.push({
                            id: item.nodeId,
                            tags: item.tags || [],
                            createdAt: new Date(item.createdAt || 0).getTime()
                        });
                    }
                }
            }
        });

        // Sort by date desc (PostGrid logic)
        publishedPages.sort((a, b) => b.createdAt - a.createdAt);

        const nodes: any[] = [];
        const edges: any[] = [];
        const incomingCounts = new Map<string, number>();
        nodeMap.forEach((_, id) => incomingCounts.set(id, 0));

        // 3a. Global Links (Nav/Footer + System Pages)
        const globalLinks = [ ...(config.navLinks || []), ...(config.footerLinks || []) ];
        globalLinks.push({ href: "/contact" }); // System Page Whitelist
        globalLinks.push({ href: "/" });        // System Page Whitelist

        globalLinks.forEach((link: any) => {
            const slug = normalizeSlug(link.href);
            if (slug) {
                const targetId = slugMap.get(slug);
                if (targetId) incomingCounts.set(targetId, (incomingCounts.get(targetId) || 0) + 1);
            }
        });

        // 3b. Process Content Links (With Error Safety)
        nodeMap.forEach((item) => {
            try {
                nodes.push({
                    id: item.nodeId,
                    label: item.title,
                    slug: item.slug,
                    status: item.status
                });

                const uniqueTargets = new Set<string>();

                // --- TRAVERSAL ---
                const traverse = (node: any) => {
                    if (!node) return;

                    // A. Direct Links
                    if (node.marks) {
                        node.marks.forEach((m: any) => {
                            if (m.type === 'link' && m.attrs?.href) {
                                const t = normalizeSlug(m.attrs.href);
                                if (t && slugMap.has(t)) uniqueTargets.add(slugMap.get(t)!);
                            }
                        });
                    }
                    if (node.attrs) {
                        ['ctaLink', 'buttonLink', 'link'].forEach(attr => {
                            if (node.attrs[attr]) {
                                const t = normalizeSlug(node.attrs[attr]);
                                if (t && slugMap.has(t)) uniqueTargets.add(slugMap.get(t)!);
                            }
                        });
                        // Array attrs
                        ['plans', 'items', 'columns', 'rows'].forEach(listKey => {
                            if (Array.isArray(node.attrs[listKey])) {
                                node.attrs[listKey].forEach((subItem: any) => {
                                    if (subItem?.buttonLink) {
                                        const t = normalizeSlug(subItem.buttonLink);
                                        if (t && slugMap.has(t)) uniqueTargets.add(slugMap.get(t)!);
                                    }
                                    if (subItem?.link) {
                                        const t = normalizeSlug(subItem.link);
                                        if (t && slugMap.has(t)) uniqueTargets.add(slugMap.get(t)!);
                                    }
                                });
                            }
                        });
                    }

                    // B. POST GRID LOGIC (Fixed Limit 0)
                    if (node.type === 'postGrid') {
                        const filterTag = node.attrs?.filterTag;
                        const rawLimit = node.attrs?.limit;

                        // Limit Logic: 0 = Infinity, undefined = 6
                        let limit = 6;
                        if (rawLimit !== undefined && rawLimit !== null && rawLimit !== "") {
                            limit = parseInt(rawLimit);
                        }

                        let matches = publishedPages;
                        if (filterTag && filterTag.trim() !== "") {
                            matches = matches.filter(p => p.tags.includes(filterTag));
                        }

                        // Slice ONLY if limit > 0. If 0, take all.
                        if (limit > 0) {
                            matches = matches.slice(0, limit);
                        }

                        matches.forEach(p => {
                            if (p.id !== item.nodeId) uniqueTargets.add(p.id);
                        });
                    }

                    // Recurse
                    if (node.content && Array.isArray(node.content)) {
                        node.content.forEach(traverse);
                    }
                };

                if (Array.isArray(item.blocks)) item.blocks.forEach(traverse);

                // --- EDGES ---
                uniqueTargets.forEach(targetId => {
                    if (targetId !== item.nodeId) {
                        edges.push({
                            source: item.nodeId,
                            target: targetId,
                            id: `${item.nodeId}-${targetId}`
                        });
                        incomingCounts.set(targetId, (incomingCounts.get(targetId) || 0) + 1);
                    }
                });

            } catch (innerError) {
                console.warn(`Graph processing failed for item ${item.nodeId}`, innerError);
            }
        });

        // 4. Orphans
        const homepageId = slugMap.get('/');
        const orphans = nodes
            .filter(n => n.id !== homepageId && (incomingCounts.get(n.id) || 0) === 0)
            .map(n => ({ id: n.id, title: n.label, slug: n.slug }));

        return {
            statusCode: 200,
            body: JSON.stringify({ nodes, edges, orphans })
        };

    } catch (e: any) {
        console.error("Graph Fatal Error", e);
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};
