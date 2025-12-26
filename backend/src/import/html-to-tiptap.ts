/**
 * Converts WordPress HTML content to Tiptap JSON blocks
 * This is a simplified converter that handles common HTML elements
 */

interface TiptapNode {
    type: string;
    attrs?: Record<string, any>;
    content?: TiptapNode[];
    text?: string;
}

export class HTMLToTiptapConverter {
    /**
     * Convert HTML string to Tiptap JSON blocks array
     */
    convert(html: string): TiptapNode[] {
        if (!html || html.trim() === "") {
            return [];
        }

        // Basic HTML cleanup
        const cleaned = this.cleanHTML(html);

        // Parse HTML into blocks
        return this.parseHTML(cleaned);
    }

    /**
     * Clean and normalize HTML
     */
    private cleanHTML(html: string): string {
        return html
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .trim();
    }

    /**
     * Parse HTML into Tiptap blocks
     * This is a simplified parser - a production version would use a proper HTML parser
     */
    private parseHTML(html: string): TiptapNode[] {
        const blocks: TiptapNode[] = [];

        // Split by block-level elements
        const blockRegex = /<(h[1-6]|p|blockquote|ul|ol|pre|div)([^>]*)>(.*?)<\/\1>/gs;
        const imageRegex = /<img([^>]+)>/g;

        let lastIndex = 0;
        let match;

        // Process block elements
        while ((match = blockRegex.exec(html)) !== null) {
            const [fullMatch, tag, attrs, content] = match;
            const index = match.index;

            // Process any text before this block
            if (index > lastIndex) {
                const beforeText = html.substring(lastIndex, index).trim();
                if (beforeText) {
                    this.processTextContent(beforeText, blocks);
                }
            }

            // Process the block
            this.processBlockElement(tag, content, blocks);

            lastIndex = index + fullMatch.length;
        }

        // Process any remaining text
        if (lastIndex < html.length) {
            const remainingText = html.substring(lastIndex).trim();
            if (remainingText) {
                this.processTextContent(remainingText, blocks);
            }
        }

        // If no blocks were created, create a simple paragraph
        if (blocks.length === 0 && html.trim()) {
            blocks.push({
                type: "paragraph",
                content: [{ type: "text", text: this.stripHTML(html) }],
            });
        }

        return blocks;
    }

    /**
     * Process block-level HTML elements
     */
    private processBlockElement(tag: string, content: string, blocks: TiptapNode[]): void {
        // Handle headings
        if (tag.match(/^h[1-6]$/)) {
            const level = parseInt(tag[1]);
            blocks.push({
                type: "heading",
                attrs: { level },
                content: [{ type: "text", text: this.stripHTML(content) }],
            });
            return;
        }

        // Handle paragraphs
        if (tag === "p") {
            const text = this.stripHTML(content).trim();
            if (text) {
                blocks.push({
                    type: "paragraph",
                    content: [{ type: "text", text }],
                });
            }
            return;
        }

        // Handle blockquotes
        if (tag === "blockquote") {
            blocks.push({
                type: "blockquote",
                content: [
                    {
                        type: "paragraph",
                        content: [{ type: "text", text: this.stripHTML(content) }],
                    },
                ],
            });
            return;
        }

        // Handle lists
        if (tag === "ul" || tag === "ol") {
            const listType = tag === "ul" ? "bulletList" : "orderedList";
            const items = this.extractListItems(content);
            blocks.push({
                type: listType,
                content: items.map((item) => ({
                    type: "listItem",
                    content: [
                        {
                            type: "paragraph",
                            content: [{ type: "text", text: this.stripHTML(item) }],
                        },
                    ],
                })),
            });
            return;
        }

        // Handle code blocks
        if (tag === "pre") {
            blocks.push({
                type: "codeBlock",
                content: [{ type: "text", text: this.stripHTML(content) }],
            });
            return;
        }

        // Default: treat as paragraph
        const text = this.stripHTML(content).trim();
        if (text) {
            blocks.push({
                type: "paragraph",
                content: [{ type: "text", text }],
            });
        }
    }

    /**
     * Process text content (may contain inline elements)
     */
    private processTextContent(text: string, blocks: TiptapNode[]): void {
        const stripped = this.stripHTML(text).trim();
        if (stripped) {
            blocks.push({
                type: "paragraph",
                content: [{ type: "text", text: stripped }],
            });
        }
    }

    /**
     * Extract list items from HTML
     */
    private extractListItems(html: string): string[] {
        const items: string[] = [];
        const itemRegex = /<li>(.*?)<\/li>/gs;
        let match;

        while ((match = itemRegex.exec(html)) !== null) {
            items.push(match[1]);
        }

        return items;
    }

    /**
     * Strip HTML tags from content
     */
    private stripHTML(html: string): string {
        return html
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .trim();
    }
}
