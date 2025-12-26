import { XMLParser } from "fast-xml-parser";

export interface WordPressPost {
    title: string;
    slug: string;
    content: string; // HTML
    status: 'publish' | 'draft' | 'private';
    postType: 'post' | 'page';
    featuredImage?: string; // URL
    publishedAt?: string; // ISO date
}

export async function parseWXR(xmlContent: string): Promise<WordPressPost[]> {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        parseAttributeValue: true,
        trimValues: true
    });

    const parsed = parser.parse(xmlContent);

    // Navigate to items array
    const channel = parsed?.rss?.channel;
    if (!channel) {
        throw new Error("Invalid WXR format: missing RSS channel");
    }

    let items = channel.item;
    if (!items) {
        return []; // No items
    }

    // Ensure items is an array (single item might not be an array)
    if (!Array.isArray(items)) {
        items = [items];
    }

    const posts: WordPressPost[] = [];

    for (const item of items) {
        // Extract WordPress-specific fields
        const postType = item['wp:post_type'] || 'post';

        // Skip attachments
        if (postType === 'attachment') {
            continue;
        }

        // Only process posts and pages
        if (postType !== 'post' && postType !== 'page') {
            continue;
        }

        const title = item.title || 'Untitled';
        const slug = item['wp:post_name'] || generateSlugFromTitle(title);
        const content = item['content:encoded'] || '';
        const status = mapWordPressStatus(item['wp:status'] || 'draft');
        const publishedAt = item.pubDate || item['wp:post_date'];

        // Try to extract featured image from post meta
        let featuredImage: string | undefined;
        const postMeta = item['wp:postmeta'];
        if (postMeta) {
            const metaArray = Array.isArray(postMeta) ? postMeta : [postMeta];
            const thumbnailMeta = metaArray.find((meta: any) =>
                meta['wp:meta_key'] === '_thumbnail_id'
            );

            if (thumbnailMeta) {
                const thumbnailId = thumbnailMeta['wp:meta_value'];
                // Try to find the attachment URL
                // Note: This requires a second pass through items to resolve attachment URLs
                // For MVP, we'll skip this complex resolution
                // TODO: Implement attachment resolution in v2
            }
        }

        posts.push({
            title,
            slug,
            content,
            status,
            postType,
            featuredImage,
            publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined
        });
    }

    return posts;
}

function generateSlugFromTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function mapWordPressStatus(wpStatus: string): 'publish' | 'draft' | 'private' {
    if (wpStatus === 'publish') return 'publish';
    if (wpStatus === 'private') return 'private';
    return 'draft';
}
