import { XMLParser } from "fast-xml-parser";

export interface WordPressComment {
    author: string;
    email: string;
    date: string;
    content: string;
    approved: boolean;
}

export interface WordPressPost {
    title: string;
    slug: string;
    content: string; // HTML
    status: 'publish' | 'draft' | 'private';
    postType: 'post' | 'page';
    featuredImage?: string; // URL
    publishedAt?: string; // ISO date
    comments: WordPressComment[]; // <--- NEW
}

export async function parseWXR(xmlContent: string): Promise<WordPressPost[]> {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text",
        parseAttributeValue: true,
        trimValues: true,
        // Ensure comments are always arrays
        isArray: (name) => name === "wp:comment" || name === "item"
    });

    const parsed = parser.parse(xmlContent);

    // Navigate to items array
    const channel = parsed?.rss?.channel;
    if (!channel) throw new Error("Invalid WXR format");

    let items = channel.item || [];
    if (!Array.isArray(items)) items = [items];

    const posts: WordPressPost[] = [];

    for (const item of items) {
        // Extract WordPress-specific fields
        const postType = item['wp:post_type'] || 'post';
        const status = mapWordPressStatus(item['wp:status']) || 'draft';

        if (postType !== 'post' && postType !== 'page') continue;
        if (status === 'trash') continue;

        const title = item.title || 'Untitled';
        // FIX: Ignore __trashed suffix in slug if it leaked through
        let slug = item['wp:post_name'] || generateSlugFromTitle(title);
        if (slug.includes('__trashed')) continue;

        const content = item['content:encoded'] || '';
        const publishedAt = item.pubDate || item['wp:post_date'];

        // --- EXTRACT COMMENTS ---
        const rawComments = item['wp:comment'] || [];
        const comments: WordPressComment[] = rawComments.map((c: any) => ({
            author: c['wp:comment_author'],
            email: c['wp:comment_author_email'],
            date: c['wp:comment_date'],
            content: c['wp:comment_content'],
            approved: c['wp:comment_approved'] == 1 || c['wp:comment_approved'] === '1'
        }));

        // --- EXTRACT IMAGE ---
        let featuredImage: string | undefined;
        const postMeta = item['wp:postmeta'];
        if (postMeta) {
            const metaArray = Array.isArray(postMeta) ? postMeta : [postMeta];
            const thumbnailMeta = metaArray.find((meta: any) => meta['wp:meta_key'] === '_thumbnail_id');
            // Advanced resolution logic skipped for brevity, relies on direct URLs usually in WXR 1.2
        }

        posts.push({
            title,
            slug,
            content,
            status,
            postType,
            featuredImage,
            publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined,
            comments
        });
    }

    return posts;
}

function generateSlugFromTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function mapWordPressStatus(wpStatus: string): 'publish' | 'draft' | 'private' | 'trash' {
    if (wpStatus === 'publish') return 'publish';
    if (wpStatus === 'private') return 'private';
    if (wpStatus === 'trash') return 'trash';
    return 'draft';
}
