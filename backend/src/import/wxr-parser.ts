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
    // IMPORT-PATHS-1 (docs/slices/import-paths-1.md scope 1, 4). Optional: an item without them (an export without the
    // element, or a post built by hand) is imported as before.
    link?: string;            // `<link>` as exported: the item's public address on the old site (absolute URL)
    wpId?: string;            // `wp:post_id`
    parentId?: string;        // `wp:post_parent`, absent when 0 (no parent)
    sourceHost?: string;      // the export's site host (channel `<link>`, else `wp:base_site_url`), lower case
    featuredImageId?: string; // `_thumbnail_id`
    // The URL of the attachment item `featuredImageId` names, when the export holds it. Deliberately NOT `featuredImage`:
    // the option-off import reads `featuredImage` and must stay today's import (ruling 3), which never had one.
    featuredImageAttachmentUrl?: string;
}

/**
 * IMPORT-PATHS-1 scope 5: a WooCommerce product of the export. Not imported as a page (products come from the
 * WooCommerce CSV); read only for its old address, so the import can redirect it to the site's product page.
 */
export interface WordPressProduct {
    postType: 'product';
    title: string;
    slug: string;
    link?: string;
    wpId?: string;
    sourceHost?: string;
}

/** An item of the export the importer reads: a post or page (imported as a page) or a product (address only). */
export type WordPressItem = WordPressPost | WordPressProduct;

export async function parseWXR(xmlContent: string): Promise<WordPressItem[]> {
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

    const posts: WordPressItem[] = [];
    const sourceHost = hostOf(channel.link) ?? hostOf(channel['wp:base_site_url']);

    // IMPORT-PATHS-1 scope 4: the attachments of the export, by id → URL — the items the media import reads
    // (media.ts `parseAttachments`: `wp:post_type` = attachment, `wp:attachment_url`).
    const attachmentUrls = new Map<string, string>();
    for (const item of items) {
        if (item['wp:post_type'] === 'attachment' && item['wp:attachment_url'] && item['wp:post_id'] !== undefined) {
            attachmentUrls.set(String(item['wp:post_id']), String(item['wp:attachment_url']));
        }
    }

    for (const item of items) {
        // Extract WordPress-specific fields
        const postType = item['wp:post_type'] || 'post';
        const status = mapWordPressStatus(item['wp:status']) || 'draft';

        if (postType === 'product' && status !== 'trash') {
            const title = item.title || 'Untitled';
            const slug = item['wp:post_name'] || generateSlugFromTitle(title);
            if (String(slug).includes('__trashed')) continue;
            posts.push({ postType: 'product', title, slug, ...addressFields(item), ...(sourceHost ? { sourceHost } : {}) });
            continue;
        }
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
        let featuredImageId: string | undefined;
        let featuredImageAttachmentUrl: string | undefined;
        const postMeta = item['wp:postmeta'];
        if (postMeta) {
            const metaArray = Array.isArray(postMeta) ? postMeta : [postMeta];
            const thumbnailMeta = metaArray.find((meta: any) => meta['wp:meta_key'] === '_thumbnail_id');
            // IMPORT-PATHS-1 scope 4: the thumbnail id resolved through the export's attachment items. An id without
            // its attachment in this file (a pages-only export) leaves no image; the import lists it.
            if (thumbnailMeta && thumbnailMeta['wp:meta_value'] !== undefined && thumbnailMeta['wp:meta_value'] !== '') {
                featuredImageId = String(thumbnailMeta['wp:meta_value']);
                featuredImageAttachmentUrl = attachmentUrls.get(featuredImageId);
            }
        }

        posts.push({
            title,
            slug,
            content,
            status,
            postType,
            featuredImage,
            publishedAt: publishedAt ? new Date(publishedAt).toISOString() : undefined,
            comments,
            ...addressFields(item),
            ...(sourceHost ? { sourceHost } : {}),
            ...(featuredImageId !== undefined ? { featuredImageId } : {}),
            ...(featuredImageAttachmentUrl !== undefined ? { featuredImageAttachmentUrl } : {}),
        });
    }

    return posts;
}

/** IMPORT-PATHS-1: the lower-case host of an absolute URL, or undefined. */
function hostOf(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    try {
        const host = new URL(value.trim()).hostname.toLowerCase();
        return host === '' ? undefined : host;
    } catch {
        return undefined;
    }
}

/** IMPORT-PATHS-1: `<link>`, `wp:post_id` and a non-zero `wp:post_parent` of an item, each only when present. */
function addressFields(item: any): { link?: string; wpId?: string; parentId?: string } {
    const link = typeof item.link === 'string' && item.link.trim() !== '' ? item.link.trim() : undefined;
    const wpId = item['wp:post_id'] !== undefined && item['wp:post_id'] !== '' ? String(item['wp:post_id']) : undefined;
    const parent = item['wp:post_parent'];
    const parentId = parent !== undefined && parent !== '' && String(parent) !== '0' ? String(parent) : undefined;
    return { ...(link ? { link } : {}), ...(wpId ? { wpId } : {}), ...(parentId ? { parentId } : {}) };
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
