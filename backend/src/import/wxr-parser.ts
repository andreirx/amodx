import { XMLParser } from "fast-xml-parser";

interface WXRPost {
    title: string;
    slug: string;
    content: string;
    status: "publish" | "draft";
    postType: "post" | "page";
    featuredImage?: string;
    publishedAt?: string;
}

interface WXRParseResult {
    posts: WXRPost[];
    pages: WXRPost[];
    images: string[];
}

/**
 * Parses WordPress WXR (XML) export file and extracts posts, pages, and media
 */
export class WXRParser {
    private parser: XMLParser;

    constructor() {
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            parseTagValue: false,
        });
    }

    /**
     * Parse WXR XML content
     */
    parse(xmlContent: string): WXRParseResult {
        const result: WXRParseResult = {
            posts: [],
            pages: [],
            images: [],
        };

        try {
            const parsed = this.parser.parse(xmlContent);
            const channel = parsed?.rss?.channel;

            if (!channel) {
                throw new Error("Invalid WXR format: missing channel element");
            }

            // WordPress exports can have a single item or array of items
            const items = Array.isArray(channel.item) ? channel.item : [channel.item];

            for (const item of items) {
                if (!item) continue;

                // Extract post type (wp:post_type)
                const postType = this.getNestedValue(item, "wp:post_type");
                const status = this.getNestedValue(item, "wp:status");

                // Handle attachments (images)
                if (postType === "attachment") {
                    const imageUrl = this.getNestedValue(item, "wp:attachment_url");
                    if (imageUrl) {
                        result.images.push(imageUrl);
                    }
                    continue;
                }

                // Extract common fields
                const post: WXRPost = {
                    title: this.getNestedValue(item, "title") || "Untitled",
                    slug: this.getNestedValue(item, "wp:post_name") || this.slugify(item.title || "untitled"),
                    content: this.getNestedValue(item, "content:encoded") || "",
                    status: status === "publish" ? "publish" : "draft",
                    postType: postType === "page" ? "page" : "post",
                    publishedAt: this.getNestedValue(item, "wp:post_date") || undefined,
                };

                // Extract featured image if present
                const postmeta = item["wp:postmeta"];
                if (postmeta) {
                    const metaArray = Array.isArray(postmeta) ? postmeta : [postmeta];
                    for (const meta of metaArray) {
                        if (meta["wp:meta_key"] === "_thumbnail_id") {
                            // We would need to cross-reference this ID with attachments
                            // For simplicity, we'll skip this for now
                        }
                    }
                }

                // Categorize into posts or pages
                if (postType === "page") {
                    result.pages.push(post);
                } else if (postType === "post") {
                    result.posts.push(post);
                }
            }

            return result;
        } catch (error: any) {
            throw new Error(`WXR Parse Error: ${error.message}`);
        }
    }

    /**
     * Helper to get nested values from parsed XML
     */
    private getNestedValue(obj: any, key: string): string | undefined {
        if (!obj) return undefined;

        // Handle namespaced keys (e.g., "wp:post_type")
        const parts = key.split(":");
        let current = obj;

        for (const part of parts) {
            if (current[part] !== undefined) {
                current = current[part];
            } else {
                return undefined;
            }
        }

        // Handle text nodes
        if (typeof current === "object" && current["#text"]) {
            return current["#text"];
        }

        return typeof current === "string" ? current : undefined;
    }

    /**
     * Simple slugify function
     */
    private slugify(text: string): string {
        return text
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "");
    }
}
