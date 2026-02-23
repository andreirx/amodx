import { parseDocument, DomUtils } from "htmlparser2";
import { Element, Text } from "domhandler";

export interface TiptapNode {
    type: string;
    attrs?: Record<string, any>;
    content?: TiptapNode[];
    text?: string;
    marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}

interface WPBlockMatch {
    type: string;
    attrs: Record<string, any>;
    innerHtml: string;
}

export class HTMLToTiptapConverter {
    private imageUrls: string[] = [];
    private mediaMap: Map<string, string>;

    constructor(mediaMap?: Map<string, string>) {
        this.mediaMap = mediaMap || new Map();
    }

    convert(html: string): { blocks: TiptapNode[], imageUrls: string[] } {
        // First, try to parse WordPress Gutenberg blocks
        const wpBlocks = this.parseWPBlocks(html);

        if (wpBlocks.length > 0) {
            // Process WordPress blocks
            const blocks = this.convertWPBlocks(wpBlocks);
            return { blocks, imageUrls: this.imageUrls };
        }

        // Fallback: parse as plain HTML
        const cleanedHtml = this.cleanHTML(html);
        const blocks = this.parseHTML(cleanedHtml);
        return { blocks, imageUrls: this.imageUrls };
    }

    /** Parse WordPress Gutenberg block comments */
    private parseWPBlocks(html: string): WPBlockMatch[] {
        const blocks: WPBlockMatch[] = [];

        // Match WordPress block pattern: <!-- wp:blocktype {"attrs"} --> content <!-- /wp:blocktype -->
        // Also handles self-closing blocks: <!-- wp:blocktype {"attrs"} /-->
        const blockPattern = /<!-- wp:(\w+(?:\/\w+)?)\s*(\{[^}]*\})?\s*(\/)?-->([\s\S]*?)(?:<!-- \/wp:\1 -->)?/g;

        let match;
        while ((match = blockPattern.exec(html)) !== null) {
            const [, blockType, attrsJson, selfClosing, innerHtml] = match;

            let attrs: Record<string, any> = {};
            if (attrsJson) {
                try {
                    attrs = JSON.parse(attrsJson);
                } catch (e) {
                    // Ignore JSON parse errors
                }
            }

            blocks.push({
                type: blockType,
                attrs,
                innerHtml: selfClosing ? '' : (innerHtml || '').trim()
            });
        }

        return blocks;
    }

    /** Convert WordPress blocks to Tiptap nodes */
    private convertWPBlocks(wpBlocks: WPBlockMatch[]): TiptapNode[] {
        const blocks: TiptapNode[] = [];

        for (const wpBlock of wpBlocks) {
            const converted = this.convertWPBlock(wpBlock);
            if (converted) {
                blocks.push(converted);
            }
        }

        return blocks;
    }

    /** Convert a single WordPress block to Tiptap node */
    private convertWPBlock(wpBlock: WPBlockMatch): TiptapNode | null {
        const { type, attrs, innerHtml } = wpBlock;

        switch (type) {
            case 'paragraph':
            case 'core/paragraph':
                return this.wpParagraph(innerHtml);

            case 'heading':
            case 'core/heading':
                return this.wpHeading(attrs, innerHtml);

            case 'image':
            case 'core/image':
                return this.wpImage(attrs, innerHtml);

            case 'gallery':
            case 'core/gallery':
                return this.wpGallery(attrs, innerHtml);

            case 'video':
            case 'core/video':
                return this.wpVideo(attrs, innerHtml);

            case 'embed':
            case 'core/embed':
            case 'core-embed/youtube':
            case 'core-embed/vimeo':
                return this.wpEmbed(attrs, innerHtml);

            case 'quote':
            case 'core/quote':
                return this.wpQuote(innerHtml);

            case 'list':
            case 'core/list':
                return this.wpList(attrs, innerHtml);

            case 'code':
            case 'core/code':
                return this.wpCode(attrs, innerHtml);

            case 'preformatted':
            case 'core/preformatted':
                return this.wpCode(attrs, innerHtml);

            case 'html':
            case 'core/html':
                return this.wpHtml(innerHtml);

            case 'table':
            case 'core/table':
                return this.wpTable(innerHtml);

            case 'separator':
            case 'core/separator':
                return { type: 'horizontalRule' };

            case 'spacer':
            case 'core/spacer':
                // Skip spacers
                return null;

            case 'columns':
            case 'core/columns':
                return this.wpColumns(attrs, innerHtml);

            case 'group':
            case 'core/group':
            case 'cover':
            case 'core/cover':
                // Process inner content
                const innerBlocks = this.parseWPBlocks(innerHtml);
                if (innerBlocks.length > 0) {
                    return {
                        type: 'html',
                        attrs: {
                            content: innerHtml,
                            blockWidth: 'content'
                        }
                    };
                }
                return null;

            default:
                // For unknown blocks, try to parse inner HTML
                if (innerHtml) {
                    const parsed = this.parseHTML(innerHtml);
                    if (parsed.length === 1) {
                        return parsed[0];
                    } else if (parsed.length > 1) {
                        // Wrap in HTML block
                        return {
                            type: 'html',
                            attrs: {
                                content: innerHtml,
                                blockWidth: 'content'
                            }
                        };
                    }
                }
                return null;
        }
    }

    private wpParagraph(innerHtml: string): TiptapNode | null {
        const text = this.stripTags(innerHtml).trim();
        if (!text) return null;

        return {
            type: 'paragraph',
            content: this.parseInlineHtml(innerHtml)
        };
    }

    private wpHeading(attrs: Record<string, any>, innerHtml: string): TiptapNode | null {
        const level = attrs.level || 2;
        const text = this.stripTags(innerHtml).trim();
        if (!text) return null;

        return {
            type: 'heading',
            attrs: { level },
            content: [{ type: 'text', text }]
        };
    }

    private wpImage(attrs: Record<string, any>, innerHtml: string): TiptapNode | null {
        // Extract image URL from attrs or inner HTML
        let src = attrs.url || '';
        let alt = attrs.alt || '';
        let caption = '';

        // Try to extract from inner HTML if not in attrs
        if (!src && innerHtml) {
            const imgMatch = innerHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch) src = imgMatch[1];

            const altMatch = innerHtml.match(/<img[^>]+alt=["']([^"']*)["']/i);
            if (altMatch) alt = altMatch[1];

            const captionMatch = innerHtml.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
            if (captionMatch) caption = this.stripTags(captionMatch[1]).trim();
        }

        if (!src) return null;

        // Rewrite URL using media map
        const rewrittenSrc = this.rewriteImageUrl(src);
        this.imageUrls.push(src);

        return {
            type: 'image',
            attrs: {
                src: rewrittenSrc,
                alt,
                caption,
                width: 'full',
                aspectRatio: 'auto',
                blockWidth: 'content'
            }
        };
    }

    private wpGallery(attrs: Record<string, any>, innerHtml: string): TiptapNode | null {
        // Extract all images from gallery
        const images: { src: string; alt: string }[] = [];

        const imgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?/gi;
        let match;
        while ((match = imgPattern.exec(innerHtml)) !== null) {
            const src = this.rewriteImageUrl(match[1]);
            const alt = match[2] || '';
            images.push({ src, alt });
            this.imageUrls.push(match[1]);
        }

        if (images.length === 0) return null;

        // Convert to carousel block
        return {
            type: 'carousel',
            attrs: {
                images: images.map(img => ({
                    src: img.src,
                    alt: img.alt,
                    caption: ''
                })),
                autoplay: false,
                interval: 5000,
                showDots: true,
                showArrows: true,
                blockWidth: 'wide'
            }
        };
    }

    private wpVideo(attrs: Record<string, any>, innerHtml: string): TiptapNode | null {
        let url = attrs.src || '';

        if (!url && innerHtml) {
            const srcMatch = innerHtml.match(/src=["']([^"']+)["']/i);
            if (srcMatch) url = srcMatch[1];
        }

        if (!url) return null;

        return {
            type: 'video',
            attrs: {
                url: this.rewriteImageUrl(url),
                caption: '',
                width: 'centered',
                autoplay: false,
                blockWidth: 'content'
            }
        };
    }

    private wpEmbed(attrs: Record<string, any>, innerHtml: string): TiptapNode | null {
        const url = attrs.url || '';
        if (!url) return null;

        // Check if it's a YouTube or Vimeo URL
        if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('vimeo.com')) {
            return {
                type: 'video',
                attrs: {
                    url,
                    caption: '',
                    width: 'centered',
                    autoplay: false,
                    blockWidth: 'content'
                }
            };
        }

        // For other embeds, use HTML block
        return {
            type: 'html',
            attrs: {
                content: `<iframe src="${url}" frameborder="0" allowfullscreen></iframe>`,
                blockWidth: 'content'
            }
        };
    }

    private wpQuote(innerHtml: string): TiptapNode | null {
        const text = this.stripTags(innerHtml).trim();
        if (!text) return null;

        return {
            type: 'blockquote',
            content: [{
                type: 'paragraph',
                content: [{ type: 'text', text }]
            }]
        };
    }

    private wpList(attrs: Record<string, any>, innerHtml: string): TiptapNode | null {
        const ordered = attrs.ordered || innerHtml.trim().startsWith('<ol');
        const items = this.extractListItems(innerHtml);

        if (items.length === 0) return null;

        return {
            type: ordered ? 'orderedList' : 'bulletList',
            content: items.map(item => ({
                type: 'listItem',
                content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: item }]
                }]
            }))
        };
    }

    private wpCode(attrs: Record<string, any>, innerHtml: string): TiptapNode | null {
        // Extract code content
        let code = innerHtml;
        const codeMatch = innerHtml.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
        if (codeMatch) code = codeMatch[1];

        // Decode HTML entities
        code = this.decodeHtmlEntities(code).trim();
        if (!code) return null;

        return {
            type: 'codeBlock',
            attrs: {
                code,
                language: attrs.language || 'plaintext',
                filename: '',
                showLineNumbers: true
            }
        };
    }

    private wpHtml(innerHtml: string): TiptapNode | null {
        if (!innerHtml.trim()) return null;

        // Rewrite any image URLs in the HTML
        let rewrittenHtml = innerHtml;
        for (const [oldUrl, newUrl] of this.mediaMap) {
            rewrittenHtml = rewrittenHtml.split(oldUrl).join(newUrl);
        }

        return {
            type: 'html',
            attrs: {
                content: rewrittenHtml,
                blockWidth: 'content'
            }
        };
    }

    private wpTable(innerHtml: string): TiptapNode | null {
        // For now, use HTML block for tables
        // TODO: Parse table structure properly
        if (!innerHtml.trim()) return null;

        return {
            type: 'html',
            attrs: {
                content: innerHtml,
                blockWidth: 'content'
            }
        };
    }

    private wpColumns(attrs: Record<string, any>, innerHtml: string): TiptapNode | null {
        // For columns, use our columns plugin or fallback to HTML
        // TODO: Parse column structure properly
        if (!innerHtml.trim()) return null;

        return {
            type: 'html',
            attrs: {
                content: innerHtml,
                blockWidth: 'wide'
            }
        };
    }

    /** Rewrite image URL using media map */
    private rewriteImageUrl(url: string): string {
        // Direct match
        if (this.mediaMap.has(url)) {
            return this.mediaMap.get(url)!;
        }

        // Try without size suffix (-NNNxNNN)
        const baseUrl = url.replace(/-\d+x\d+(\.\w+)$/, '$1');
        if (this.mediaMap.has(baseUrl)) {
            return this.mediaMap.get(baseUrl)!;
        }

        // Try matching by filename
        const filename = url.split('/').pop();
        if (filename) {
            for (const [oldUrl, newUrl] of this.mediaMap) {
                if (oldUrl.endsWith(filename) || oldUrl.includes(filename.replace(/-\d+x\d+/, ''))) {
                    return newUrl;
                }
            }
        }

        return url;
    }

    private extractListItems(html: string): string[] {
        const items: string[] = [];
        const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
        let match;
        while ((match = liPattern.exec(html)) !== null) {
            const text = this.stripTags(match[1]).trim();
            if (text) items.push(text);
        }
        return items;
    }

    private stripTags(html: string): string {
        return html.replace(/<[^>]+>/g, '');
    }

    private decodeHtmlEntities(html: string): string {
        return html
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&nbsp;/g, ' ');
    }

    private parseInlineHtml(html: string): TiptapNode[] {
        const content: TiptapNode[] = [];

        // Simple inline parsing - handle bold, italic, links
        const dom = parseDocument(html);
        this.extractInlineContent(dom, content);

        return content.length > 0 ? content : [{ type: 'text', text: this.stripTags(html) }];
    }

    private extractInlineContent(parent: any, content: TiptapNode[]): void {
        DomUtils.getChildren(parent).forEach(node => {
            if (node.type === 'text') {
                const text = (node as Text).data.replace(/[\n\t\r]+/g, ' ');
                if (text) {
                    content.push({ type: 'text', text });
                }
            } else if (node.type === 'tag') {
                const element = node as Element;
                const tagName = element.name.toLowerCase();
                const innerText = DomUtils.textContent(element).replace(/[\n\t\r]+/g, ' ');

                if (!innerText) return;

                if (tagName === 'strong' || tagName === 'b') {
                    content.push({ type: 'text', text: innerText, marks: [{ type: 'bold' }] });
                } else if (tagName === 'em' || tagName === 'i') {
                    content.push({ type: 'text', text: innerText, marks: [{ type: 'italic' }] });
                } else if (tagName === 'a') {
                    const href = element.attribs?.href;
                    if (href) {
                        content.push({ type: 'text', text: innerText, marks: [{ type: 'link', attrs: { href } }] });
                    } else {
                        content.push({ type: 'text', text: innerText });
                    }
                } else if (tagName === 'img') {
                    // Skip images in inline content
                } else {
                    content.push({ type: 'text', text: innerText });
                }
            }
        });
    }

    // ========== Fallback HTML parsing (for non-Gutenberg content) ==========

    private cleanHTML(html: string): string {
        // Remove WordPress shortcodes
        let cleaned = html.replace(/\[.*?\]/g, '');

        // Remove Gutenberg block comments (already processed or not parseable)
        cleaned = cleaned.replace(/<!-- wp:.*?-->/g, '');
        cleaned = cleaned.replace(/<!-- \/wp:.*?-->/g, '');

        // Clean up excessive whitespace
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        return cleaned;
    }

    private parseHTML(html: string): TiptapNode[] {
        const dom = parseDocument(html);
        const blocks: TiptapNode[] = [];

        DomUtils.getChildren(dom).forEach(node => {
            if (node.type === 'tag') {
                const element = node as Element;
                this.processElement(element, blocks);
            }
        });

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

            case 'figure':
                this.processFigure(element, blocks);
                break;

            case 'hr':
                blocks.push({ type: 'horizontalRule' });
                break;

            case 'pre':
                this.processPreformatted(element, blocks);
                break;

            case 'div':
            case 'section':
            case 'article':
                DomUtils.getChildren(element).forEach(child => {
                    if (child.type === 'tag') {
                        this.processElement(child as Element, blocks);
                    }
                });
                break;

            default:
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
        const alt = element.attribs?.alt || '';

        if (src) {
            this.imageUrls.push(src);
            const rewrittenSrc = this.rewriteImageUrl(src);

            blocks.push({
                type: 'image',
                attrs: {
                    src: rewrittenSrc,
                    alt,
                    caption: '',
                    width: 'full',
                    aspectRatio: 'auto',
                    blockWidth: 'content'
                }
            });
        }
    }

    private processFigure(element: Element, blocks: TiptapNode[]): void {
        const img = DomUtils.getElementsByTagName('img', element)[0];
        const figcaption = DomUtils.getElementsByTagName('figcaption', element)[0];

        if (img) {
            const src = img.attribs?.src || '';
            const alt = img.attribs?.alt || '';
            const caption = figcaption ? DomUtils.textContent(figcaption).trim() : '';

            if (src) {
                this.imageUrls.push(src);
                const rewrittenSrc = this.rewriteImageUrl(src);

                blocks.push({
                    type: 'image',
                    attrs: {
                        src: rewrittenSrc,
                        alt,
                        caption,
                        width: 'full',
                        aspectRatio: 'auto',
                        blockWidth: 'content'
                    }
                });
            }
        }
    }

    private processPreformatted(element: Element, blocks: TiptapNode[]): void {
        const code = DomUtils.textContent(element);

        if (code) {
            blocks.push({
                type: 'codeBlock',
                attrs: {
                    code,
                    language: 'plaintext',
                    filename: '',
                    showLineNumbers: true
                }
            });
        }
    }

    private processInlineContent(element: Element): TiptapNode[] {
        const content: TiptapNode[] = [];

        DomUtils.getChildren(element).forEach(node => {
            if (node.type === 'text') {
                const textNode = node as Text;
                const text = textNode.data.replace(/[\n\t\r]+/g, ' ');
                if (text && text.length > 0) {
                    content.push({ type: 'text', text });
                }
            } else if (node.type === 'tag') {
                const childElement = node as Element;
                const tagName = childElement.name.toLowerCase();
                const getInner = (el: Element) => DomUtils.textContent(el).replace(/[\n\t\r]+/g, ' ');

                if (tagName === 'strong' || tagName === 'b') {
                    const text = getInner(childElement);
                    if (text) {
                        content.push({ type: 'text', text, marks: [{ type: 'bold' }] });
                    }
                } else if (tagName === 'em' || tagName === 'i') {
                    const text = getInner(childElement);
                    if (text) {
                        content.push({ type: 'text', text, marks: [{ type: 'italic' }] });
                    }
                } else if (tagName === 'a') {
                    const text = getInner(childElement);
                    const href = childElement.attribs?.href;
                    if (text && href) {
                        content.push({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] });
                    }
                } else if (tagName === 'img') {
                    // Handle inline images
                    const src = childElement.attribs?.src;
                    if (src) {
                        this.imageUrls.push(src);
                    }
                } else {
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
