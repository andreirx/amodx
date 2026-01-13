// TO THIS:
import { parseDocument, DomUtils } from "htmlparser2";
import { Element, Text } from "domhandler"; // Ensure you install domhandler if missing

export interface TiptapNode {
    type: string;
    attrs?: Record<string, any>;
    content?: TiptapNode[];
    text?: string;
    marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}

export class HTMLToTiptapConverter {
    private imageUrls: string[] = [];

    convert(html: string): { blocks: TiptapNode[], imageUrls: string[] } {
        const cleanedHtml = this.cleanHTML(html);
        const blocks = this.parseHTML(cleanedHtml);
        return { blocks, imageUrls: this.imageUrls };
    }

    private cleanHTML(html: string): string {
        // Remove WordPress shortcodes (basic pattern)
        let cleaned = html.replace(/\[.*?\]/g, '');

        // Remove Gutenberg block comments
        cleaned = cleaned.replace(/<!-- wp:.*?-->/g, '');
        cleaned = cleaned.replace(/<!-- \/wp:.*?-->/g, '');

        // Clean up excessive whitespace
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        return cleaned;
    }

    private parseHTML(html: string): TiptapNode[] {
        const dom = parseDocument(html);
        const blocks: TiptapNode[] = [];

        // Process each top-level element
        DomUtils.getChildren(dom).forEach(node => {
            if (node.type === 'tag') {
                const element = node as Element;
                this.processElement(element, blocks);
            }
        });

        // If no blocks were created, create a default paragraph
        if (blocks.length === 0) {
            const textContent = DomUtils.textContent(dom).trim();
            if (textContent) {
                blocks.push({
                    type: 'paragraph',
                    content: [{ type: 'text', text: textContent }]
                });
            }
        }

        return blocks;
    }

    private processElement(element: Element, blocks: TiptapNode[]): void {
        const tagName = element.name.toLowerCase();

        switch (tagName) {
            case 'h1':
            case 'h2':
            case 'h3':
            case 'h4':
            case 'h5':
            case 'h6':
                this.processHeading(element, blocks);
                break;

            case 'p':
                this.processParagraph(element, blocks);
                break;

            case 'blockquote':
                this.processBlockquote(element, blocks);
                break;

            case 'ul':
                this.processBulletList(element, blocks);
                break;

            case 'ol':
                this.processOrderedList(element, blocks);
                break;

            case 'img':
                this.processImage(element, blocks);
                break;

            case 'div':
            case 'section':
            case 'article':
                // Process children of container elements
                DomUtils.getChildren(element).forEach(child => {
                    if (child.type === 'tag') {
                        this.processElement(child as Element, blocks);
                    }
                });
                break;

            default:
                // For other elements, try to extract text content
                const text = DomUtils.textContent(element).trim();
                if (text) {
                    blocks.push({
                        type: 'paragraph',
                        content: [{ type: 'text', text }]
                    });
                }
        }
    }

    private processHeading(element: Element, blocks: TiptapNode[]): void {
        const level = parseInt(element.name[1]);
        const text = DomUtils.textContent(element).trim();

        if (text) {
            blocks.push({
                type: 'heading',
                attrs: { level },
                content: [{ type: 'text', text }]
            });
        }
    }

    private processParagraph(element: Element, blocks: TiptapNode[]): void {
        const content = this.processInlineContent(element);

        if (content.length > 0) {
            blocks.push({
                type: 'paragraph',
                content
            });
        }
    }

    private processBlockquote(element: Element, blocks: TiptapNode[]): void {
        const text = DomUtils.textContent(element).trim();

        if (text) {
            blocks.push({
                type: 'blockquote',
                content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text }]
                }]
            });
        }
    }

    private processBulletList(element: Element, blocks: TiptapNode[]): void {
        const items = this.processListItems(element);

        if (items.length > 0) {
            blocks.push({
                type: 'bulletList',
                content: items
            });
        }
    }

    private processOrderedList(element: Element, blocks: TiptapNode[]): void {
        const items = this.processListItems(element);

        if (items.length > 0) {
            blocks.push({
                type: 'orderedList',
                content: items
            });
        }
    }

    private processListItems(listElement: Element): TiptapNode[] {
        const items: TiptapNode[] = [];

        DomUtils.getElementsByTagName('li', listElement).forEach(li => {
            const text = DomUtils.textContent(li).trim();
            if (text) {
                items.push({
                    type: 'listItem',
                    content: [{
                        type: 'paragraph',
                        content: [{ type: 'text', text }]
                    }]
                });
            }
        });

        return items;
    }

    private processImage(element: Element, blocks: TiptapNode[]): void {
        const src = element.attribs?.src;

        if (src) {
            // Store image URL for later download
            this.imageUrls.push(src);

            // Create a paragraph with image URL as text (placeholder)
            // The main handler will download and replace this
            blocks.push({
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: `[Image: ${src}]`
                }]
            });
        }
    }

    // UPDATE THIS METHOD
    private processInlineContent(element: Element): TiptapNode[] {
        const content: TiptapNode[] = [];

        DomUtils.getChildren(element).forEach(node => {
            if (node.type === 'text') {
                const textNode = node as Text;

                // FIX: Do NOT use .trim() here.
                // It merges "Hello " + "<b>World</b>" into "HelloWorld".
                // Instead, normalize newlines/tabs to single spaces, but keep the space if it exists.
                const text = textNode.data.replace(/[\n\t\r]+/g, ' ');

                // Only skip if it's truly empty or just a massive whitespace block that collapses to nothing
                if (text && text.length > 0) {
                    content.push({ type: 'text', text });
                }
            } else if (node.type === 'tag') {
                const childElement = node as Element;
                const tagName = childElement.name.toLowerCase();

                // FIX: Helper to get text without aggressive trimming
                // We normalize internal whitespace but usually keep edges for tags clean
                const getInner = (el: Element) => DomUtils.textContent(el).replace(/[\n\t\r]+/g, ' ');

                // Handle inline formatting
                if (tagName === 'strong' || tagName === 'b') {
                    const text = getInner(childElement);
                    if (text) {
                        content.push({
                            type: 'text',
                            text,
                            marks: [{ type: 'bold' }]
                        });
                    }
                } else if (tagName === 'em' || tagName === 'i') {
                    const text = getInner(childElement);
                    if (text) {
                        content.push({
                            type: 'text',
                            text,
                            marks: [{ type: 'italic' }]
                        });
                    }
                } else if (tagName === 'a') {
                    const text = getInner(childElement);
                    const href = childElement.attribs?.href;
                    if (text && href) {
                        content.push({
                            type: 'text',
                            text,
                            marks: [{ type: 'link', attrs: { href } }]
                        });
                    }
                } else {
                    // For other tags, just extract text
                    const text = getInner(childElement);
                    if (text) {
                        content.push({ type: 'text', text });
                    }
                }
            }
        });

        return content;
    }
}
