import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

// Storage directory for browser auth states
const STORAGE_DIR = path.join(import.meta.dirname, "../.storage");

dotenv.config();

const API_KEY = process.env.AMODX_API_KEY;
const API_URL = process.env.AMODX_API_URL;

if (!API_URL || !API_KEY) {
    console.error("Error: AMODX_API_URL or AMODX_API_KEY is missing in .env");
    process.exit(1);
}

// HELPER: Standard Headers
const getHeaders = (tenantId?: string) => {
    const h: any = {
        'x-api-key': API_KEY,
        'Authorization': 'Bearer robot',
    };
    if (tenantId) h['x-tenant-id'] = tenantId;
    return h;
};

// --- COMPLETE BLOCK DEFINITIONS FOR AI ---
// Synced with packages/plugins — 18 custom blocks + 2 Tiptap builtins
const BLOCK_SCHEMAS = {
    hero: {
        description: "A large banner with headline, subheadline, CTA button, and optional background image. Supports 3 layout styles.",
        attrs: {
            headline: "string (e.g., 'Welcome to AMODX')",
            subheadline: "string (optional)",
            ctaText: "string (e.g., 'Get Started')",
            ctaLink: "string (e.g., '/contact' or '#pricing')",
            style: "'center' | 'split' | 'minimal'",
            imageSrc: "string (optional, image URL)"
        },
        example: {
            type: "hero",
            attrs: {
                headline: "Build Better Websites",
                subheadline: "Fast, secure, and AI-native",
                ctaText: "Start Free",
                ctaLink: "/signup",
                style: "center",
                imageSrc: null
            }
        }
    },
    pricing: {
        description: "A flexible pricing table with multiple plan cards. Supports highlighting featured plans and custom button links.",
        attrs: {
            headline: "string (e.g., 'Simple Pricing')",
            subheadline: "string (optional)",
            plans: "array of plan objects (see example)"
        },
        planStructure: {
            id: "string (uuid, use crypto.randomUUID())",
            title: "string (e.g., 'Pro')",
            price: "string (e.g., '$99')",
            interval: "string (e.g., 'mo' or 'yr')",
            features: "string (newline-separated list, e.g., 'Unlimited sites\\nPriority support\\nAdvanced analytics')",
            buttonText: "string (e.g., 'Get Started')",
            buttonLink: "string (optional, defaults to '#')",
            highlight: "boolean (true for featured plan)"
        },
        example: {
            type: "pricing",
            attrs: {
                headline: "Choose Your Plan",
                subheadline: "All plans include 14-day trial",
                plans: [
                    {
                        id: "uuid-here",
                        title: "Starter",
                        price: "$29",
                        interval: "mo",
                        features: "5 sites\\n10GB storage\\nEmail support",
                        buttonText: "Start",
                        buttonLink: "/signup?plan=starter",
                        highlight: false
                    },
                    {
                        id: "uuid-here",
                        title: "Pro",
                        price: "$99",
                        interval: "mo",
                        features: "Unlimited sites\\n100GB storage\\nPriority support\\nCustom domains",
                        buttonText: "Go Pro",
                        buttonLink: "/signup?plan=pro",
                        highlight: true
                    }
                ]
            }
        }
    },
    contact: {
        description: "A contact form that emails submissions to the tenant's configured email. Supports custom fields and CRM tagging.",
        attrs: {
            headline: "string (e.g., 'Get In Touch')",
            description: "string (optional subtext)",
            buttonText: "string (e.g., 'Send Message')",
            successMessage: "string (e.g., 'Thanks! We'll reply within 24 hours.')",
            tags: "string (optional, comma-separated CRM tags for segmentation)"
        },
        example: {
            type: "contact",
            attrs: {
                headline: "Contact Us",
                description: "We'd love to hear from you",
                buttonText: "Send",
                successMessage: "Thanks for reaching out!",
                tags: "website-inquiry, lead"
            }
        }
    },
    image: {
        description: "A standalone image block with caption, width control, and aspect ratio.",
        attrs: {
            src: "string (image URL, required)",
            alt: "string (accessibility description)",
            title: "string (optional, tooltip text)",
            caption: "string (optional, displayed below image)",
            width: "'full' | 'wide' | 'centered' (controls max-width)",
            aspectRatio: "string (e.g., 'auto', '16/9', '4/3', default 'auto')"
        },
        example: {
            type: "image",
            attrs: {
                src: "https://example.com/image.jpg",
                alt: "Product screenshot",
                caption: "Our dashboard in action",
                width: "wide",
                aspectRatio: "auto"
            }
        }
    },
    video: {
        description: "Embedded video player supporting YouTube, Vimeo, or direct MP4 links.",
        attrs: {
            url: "string (video URL, required)",
            caption: "string (optional, displayed below)",
            width: "'centered' | 'wide' | 'full' (default 'centered')",
            autoplay: "boolean (default false)"
        },
        example: {
            type: "video",
            attrs: {
                url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                caption: "Product demo video",
                width: "centered",
                autoplay: false
            }
        }
    },
    leadMagnet: {
        description: "Email capture form offering a downloadable resource (PDF, ebook, etc). User gets download link after providing email.",
        attrs: {
            headline: "string (e.g., 'Download Free Guide')",
            description: "string (what they'll get)",
            buttonText: "string (e.g., 'Get Free Guide')",
            resourceId: "string (ID of private resource from Resources page)",
            fileName: "string (display name, e.g., 'SEO Checklist.pdf')",
            tags: "string (optional, CRM tags)"
        },
        example: {
            type: "leadMagnet",
            attrs: {
                headline: "Get Our Free SEO Guide",
                description: "50-page comprehensive checklist",
                buttonText: "Download Now",
                resourceId: "resource-uuid-here",
                fileName: "SEO-Guide-2025.pdf",
                tags: "lead-magnet, seo-interest"
            }
        }
    },
    features: {
        description: "Grid of feature cards with icons, headlines, and descriptions. Perfect for product features or service offerings.",
        attrs: {
            headline: "string (section title)",
            subheadline: "string (optional)",
            items: "array of feature objects (see example)",
            columns: "'2' | '3' | '4' (default '3')"
        },
        featureStructure: {
            id: "string (uuid)",
            icon: "string (lucide-react icon name, e.g., 'Zap', 'Shield', 'Rocket')",
            title: "string (feature name)",
            description: "string (feature description)"
        },
        example: {
            type: "features",
            attrs: {
                headline: "Why Choose Us",
                subheadline: "Everything you need to succeed",
                columns: "3",
                items: [
                    {
                        id: "uuid-here",
                        icon: "Zap",
                        title: "Lightning Fast",
                        description: "Pages load in under 100ms worldwide"
                    },
                    {
                        id: "uuid-here",
                        icon: "Shield",
                        title: "Secure by Default",
                        description: "Bank-grade encryption and DDoS protection"
                    },
                    {
                        id: "uuid-here",
                        icon: "Rocket",
                        title: "Scales Automatically",
                        description: "From 10 to 10 million users with zero config"
                    }
                ]
            }
        }
    },
    cta: {
        description: "Call-to-action banner with headline, supporting text, and button. Use for conversions or important announcements.",
        attrs: {
            headline: "string (attention-grabbing text)",
            subheadline: "string (supporting text)",
            buttonText: "string (action verb)",
            buttonLink: "string (destination URL)",
            style: "'simple' | 'card' | 'band' (layout variant)"
        },
        example: {
            type: "cta",
            attrs: {
                headline: "Ready to Get Started?",
                subheadline: "Join 10,000+ agencies already using AMODX",
                buttonText: "Start Free Trial",
                buttonLink: "/signup",
                style: "simple"
            }
        }
    },
    testimonials: {
        description: "Customer testimonial carousel or grid. Social proof section with quotes, names, and photos.",
        attrs: {
            headline: "string (section title)",
            subheadline: "string (optional)",
            items: "array of testimonial objects (see example)",
            style: "'grid' | 'slider' | 'minimal' (default 'grid')"
        },
        testimonialStructure: {
            id: "string (uuid)",
            quote: "string (the testimonial text)",
            author: "string (person's name)",
            role: "string (e.g., 'CEO at TechCorp')",
            avatar: "string (optional, avatar URL)"
        },
        example: {
            type: "testimonials",
            attrs: {
                headline: "What Our Clients Say",
                subheadline: "Don't just take our word for it",
                style: "grid",
                items: [
                    {
                        id: "uuid-here",
                        quote: "AMODX cut our development time by 80%. Game changer.",
                        author: "Sarah Johnson",
                        role: "Founder, DesignCo",
                        avatar: "https://example.com/sarah.jpg"
                    }
                ]
            }
        }
    },
    columns: {
        description: "Multi-column layout for side-by-side content. Supports 2-4 columns with flexible widths. Auto-stacks on mobile.",
        attrs: {
            columnCount: "'2' | '3' | '4' (number of columns)",
            gap: "'sm' | 'md' | 'lg' (spacing between columns)",
            columns: "array of column objects (see example)"
        },
        columnStructure: {
            id: "string (uuid)",
            width: "'1/4' | '1/3' | '1/2' | '2/3' | '3/4' | 'full' (column width as fraction)",
            content: "string (text content, supports multiple paragraphs separated by newlines)"
        },
        example: {
            type: "columns",
            attrs: {
                columnCount: "2",
                gap: "md",
                columns: [
                    {
                        id: "uuid-here",
                        width: "1/2",
                        content: "This is the left column content.\\n\\nSupports multiple paragraphs."
                    },
                    {
                        id: "uuid-here",
                        width: "1/2",
                        content: "This is the right column content.\\n\\nAlso with multiple paragraphs."
                    }
                ]
            }
        },
        notes: "Column widths should sum logically (e.g., two 1/2 columns, or 1/3 + 2/3). System will render them responsively."
    },
    table: {
        description: "Data table with customizable rows and columns. Perfect for pricing comparisons, specifications, or structured data.",
        attrs: {
            headers: "array of strings (column headers)",
            rows: "array of row objects (see example)",
            striped: "boolean (zebra-stripe rows for readability, default true)",
            bordered: "boolean (show cell borders, default true)"
        },
        rowStructure: {
            id: "string (uuid)",
            cells: "array of cell objects"
        },
        cellStructure: {
            id: "string (uuid)",
            content: "string (cell text)"
        },
        example: {
            type: "table",
            attrs: {
                headers: ["Feature", "Starter", "Pro", "Enterprise"],
                rows: [
                    {
                        id: "uuid-here",
                        cells: [
                            { id: "uuid-1", content: "Users" },
                            { id: "uuid-2", content: "Up to 5" },
                            { id: "uuid-3", content: "Up to 25" },
                            { id: "uuid-4", content: "Unlimited" }
                        ]
                    },
                    {
                        id: "uuid-here",
                        cells: [
                            { id: "uuid-5", content: "Storage" },
                            { id: "uuid-6", content: "10GB" },
                            { id: "uuid-7", content: "100GB" },
                            { id: "uuid-8", content: "1TB" }
                        ]
                    }
                ],
                striped: true,
                bordered: true
            }
        },
        notes: "All rows must have the same number of cells as there are headers. Empty cells should use empty string ('')."
    },
    html: {
        description: "Raw HTML embed code. Use for Tweets, YouTube, Google Maps, or custom forms.",
        attrs: {
            content: "string (The raw HTML/JS code)",
            isSandboxed: "boolean (if true, runs in iframe sandbox, default false)"
        },
        example: {
            type: "html",
            attrs: {
                content: "<iframe src='...' width='100%'></iframe>",
                isSandboxed: false
            }
        }
    },
    faq: {
        description: "Accordion list for Frequently Asked Questions. Generates FAQPage JSON-LD for SEO.",
        attrs: {
            headline: "string (e.g., 'Frequently Asked Questions')",
            items: "array of Q&A objects (see example)"
        },
        faqItemStructure: {
            id: "string (uuid)",
            question: "string",
            answer: "string"
        },
        example: {
            type: "faq",
            attrs: {
                headline: "FAQ",
                items: [
                    { id: "uuid-1", question: "Is this free?", answer: "Yes." },
                    { id: "uuid-2", question: "Can I cancel?", answer: "Anytime." }
                ]
            }
        }
    },
    postGrid: {
        description: "A dynamic grid that displays blog posts or pages matching a specific tag.",
        attrs: {
            headline: "string (e.g., 'Latest News')",
            filterTag: "string (optional - if empty, shows all)",
            limit: "number (default 6)",
            showImages: "boolean (default true)",
            layout: "'grid' | 'list' (default 'list')",
            columns: "'2' | '3' (default '3', used in grid layout)"
        },
        example: {
            type: "postGrid",
            attrs: {
                headline: "From the Blog",
                filterTag: "news",
                limit: 3,
                layout: "grid",
                columns: "3",
                showImages: true
            }
        }
    },
    carousel: {
        description: "Image/card carousel with Swiper. Supports standard and coverflow styles.",
        attrs: {
            headline: "string (e.g., 'Featured Collection')",
            items: "array of carousel item objects (see example)",
            height: "'small' | 'medium' | 'large' (default 'medium')",
            style: "'standard' | 'coverflow' (default 'coverflow')"
        },
        carouselItemStructure: {
            id: "string (uuid)",
            title: "string (card title)",
            description: "string (short description)",
            image: "string (optional, image URL)",
            link: "string (destination URL, default '#')",
            linkText: "string (e.g., 'Learn More')"
        },
        example: {
            type: "carousel",
            attrs: {
                headline: "Our Portfolio",
                height: "medium",
                style: "coverflow",
                items: [
                    {
                        id: "uuid-here",
                        title: "Project Alpha",
                        description: "A complete brand redesign",
                        image: "https://example.com/alpha.jpg",
                        link: "/projects/alpha",
                        linkText: "View Project"
                    },
                    {
                        id: "uuid-here",
                        title: "Project Beta",
                        description: "E-commerce platform launch",
                        image: "https://example.com/beta.jpg",
                        link: "/projects/beta",
                        linkText: "View Project"
                    }
                ]
            }
        }
    },
    codeBlock: {
        description: "Syntax-highlighted code block with dark theme, optional line numbers, filename bar, and copy button. Supports 19 languages.",
        attrs: {
            code: "string (the source code)",
            language: "'plaintext' | 'javascript' | 'typescript' | 'python' | 'html' | 'css' | 'json' | 'bash' | 'sql' | 'go' | 'rust' | 'java' | 'csharp' | 'php' | 'ruby' | 'yaml' | 'xml' | 'markdown' | 'diff'",
            filename: "string (optional, displayed above code)",
            showLineNumbers: "boolean (default false)"
        },
        example: {
            type: "codeBlock",
            attrs: {
                code: "const greeting = 'Hello, World!';\nconsole.log(greeting);",
                language: "javascript",
                filename: "example.js",
                showLineNumbers: true
            }
        }
    },
    reviewsCarousel: {
        description: "Horizontal scrolling carousel of customer/Google/Facebook reviews with star ratings, source badges, and optional auto-scroll.",
        attrs: {
            headline: "string (e.g., 'What Our Customers Say')",
            items: "array of review objects (see example)",
            showSource: "boolean (default true, shows Google/Facebook badge)",
            autoScroll: "boolean (default false)"
        },
        reviewItemStructure: {
            id: "string (uuid)",
            name: "string (reviewer name)",
            avatarUrl: "string (optional, reviewer photo URL)",
            date: "string (e.g., '2025-01-15')",
            rating: "number (1-5)",
            text: "string (review content)",
            source: "'google' | 'facebook' | 'manual'"
        },
        example: {
            type: "reviewsCarousel",
            attrs: {
                headline: "Customer Reviews",
                showSource: true,
                autoScroll: false,
                items: [
                    { id: "uuid-here", name: "Maria P.", date: "2025-03-10", rating: 5, text: "Excellent quality!", source: "google" },
                    { id: "uuid-here", name: "Ion D.", date: "2025-02-28", rating: 4, text: "Fast delivery, great product.", source: "facebook" }
                ]
            }
        }
    },
    categoryShowcase: {
        description: "Displays products from a specific category with grid layout and 'View All' CTA button. Fetches products live from the commerce API. Only works on commerce-enabled tenants.",
        attrs: {
            categoryId: "string (category UUID from list_categories)",
            categoryName: "string (display name)",
            categorySlug: "string (URL slug)",
            limit: "number (1-12, default 4)",
            columns: "'2' | '3' | '4' (default '4')",
            showPrice: "boolean (default true)",
            ctaText: "string (e.g., 'View All Products')"
        },
        example: {
            type: "categoryShowcase",
            attrs: {
                categoryId: "cat-uuid-here",
                categoryName: "Best Sellers",
                categorySlug: "best-sellers",
                limit: 4,
                columns: "4",
                showPrice: true,
                ctaText: "View All"
            }
        }
    },
    paragraph: {
        description: "Standard text paragraph. Use for body content.",
        content: "string (the text content)"
    },
    heading: {
        description: "Section heading (H1, H2, or H3).",
        attrs: {
            level: "number (1, 2, or 3)"
        },
        content: "string (heading text)"
    }
};

const server = new McpServer({
    name: "AMODX-Bridge",
    version: "3.0.0",
});

// ==========================================
// 1. SITE & TENANT MANAGEMENT
// ==========================================

server.tool("list_tenants", {}, async () => {
    try {
        const response = await axios.get(`${API_URL}/tenants`, { headers: getHeaders() });
        const summary = response.data.items.map((t: any) =>
            `- ${t.name} (ID: ${t.id}, Domain: ${t.domain})`
        ).join("\n");
        return { content: [{ type: "text", text: `Available Sites:\n${summary}` }] };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
});

server.tool("create_tenant",
    {
        name: z.string().describe("Name of the new website/client"),
        domain: z.string().optional().describe("Custom domain (optional)"),
    },
    async ({ name, domain }) => {
        try {
            const response = await axios.post(`${API_URL}/tenants`, { name, domain }, { headers: getHeaders() });
            return { content: [{ type: "text", text: `Success! Created site "${name}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// 2. STRATEGY & CONTEXT
// ==========================================

server.tool("list_context",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/context`, { headers: getHeaders(tenant_id) });
            const summary = response.data.items.map((item: any) => {
                const tags = item.tags && item.tags.length > 0 ? `[${item.tags.join(', ')}] ` : '';
                let snippet = "No content";
                if (item.blocks && item.blocks.length > 0) {
                    const firstBlock = item.blocks[0];
                    if (firstBlock.content && firstBlock.content[0]) {
                        snippet = firstBlock.content[0].text || "Complex Block";
                    } else {
                        snippet = firstBlock.type;
                    }
                }
                return `- ${tags}${item.title} (ID: ${item.id}): ${snippet}...`;
            }).join("\n");
            return { content: [{ type: "text", text: `Context Documents for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("create_context",
    {
        tenant_id: z.string(),
        title: z.string(),
        tags: z.string().describe("Comma separated tags (e.g. 'Persona, Q1')"),
        content: z.string().describe("Initial text content"),
    },
    async ({ tenant_id, title, tags, content }) => {
        try {
            const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: content }] }];
            const tagArray = tags.split(',').map(t => t.trim());

            const response = await axios.post(`${API_URL}/context`, { title, tags: tagArray, blocks }, {
                headers: getHeaders(tenant_id)
            });
            return { content: [{ type: "text", text: `Created context doc "${title}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("read_context",
    { tenant_id: z.string(), id: z.string() },
    async ({ tenant_id, id }) => {
        try {
            const response = await axios.get(`${API_URL}/context/${id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// 3. CONTENT & BLOCKS
// ==========================================

server.tool("list_content",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/content`, { headers: getHeaders(tenant_id) });
            const summary = response.data.items.map((item: any) =>
                `- [${item.status}] ${item.title} (Slug: ${item.slug}, ID: ${item.nodeId})`
            ).join("\n");
            return { content: [{ type: "text", text: `Pages for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// 4. READ PAGE (Essential for editing context)
server.tool("read_page",
    {
        tenant_id: z.string(),
        page_id: z.string().describe("The Node ID of the page (from list_content)")
    },
    async ({ tenant_id, page_id }) => {
        try {
            const response = await axios.get(`${API_URL}/content/${page_id}`, {
                headers: getHeaders(tenant_id)
            });
            // We return the raw JSON so Claude can copy/paste existing blocks to modify them
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(response.data, null, 2)
                }]
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error: ${error.message}` }],
                isError: true
            };
        }
    }
);

// 5. UPDATE PAGE (The "God Mode" Editor)
server.tool("update_page",
    {
        tenant_id: z.string(),
        page_id: z.string(),
        title: z.string().optional(),
        slug: z.string().optional(),
        status: z.enum(["Draft", "Published", "Archived"]).optional(),
        // This is the magic field. Claude sends the full array here.
        blocks: z.string().optional().describe("Full JSON array of blocks. REPLACES existing content. Use read_page first to get current blocks, then modify/reorder/add/delete as needed."),
        seo_title: z.string().optional(),
        seo_description: z.string().optional(),
        tags: z.string().optional().describe("Comma separated tags"),
        hide_nav: z.boolean().optional(),
        hide_footer: z.boolean().optional(),
        hide_sharing: z.boolean().optional(),
        theme_override: z.string().optional().describe("JSON string of theme variables to override for THIS PAGE ONLY. Example: {\"primaryColor\": \"#ff0000\", \"backgroundColor\": \"#000000\"}")
    },
    async ({ tenant_id, page_id, title, slug, status, blocks, seo_title, seo_description, tags, hide_nav, hide_footer, hide_sharing, theme_override }) => {
        try {
            const payload: any = {};
            if (title) payload.title = title;
            if (slug) payload.slug = slug;
            if (status) payload.status = status;
            if (seo_title) payload.seoTitle = seo_title;
            if (seo_description) payload.seoDescription = seo_description;
            if (tags) payload.tags = tags.split(',').map(t => t.trim());
            if (hide_nav !== undefined) payload.hideNav = hide_nav;
            if (hide_footer !== undefined) payload.hideFooter = hide_footer;
            if (hide_sharing !== undefined) payload.hideSharing = hide_sharing;

            if (blocks) {
                try {
                    payload.blocks = JSON.parse(blocks);
                } catch (e) {
                    return { content: [{ type: "text", text: "Error: blocks must be valid JSON string" }], isError: true };
                }
            }

            // Handle Theme Parsing
            if (theme_override) {
                try {
                    payload.themeOverride = JSON.parse(theme_override);
                } catch (e) {
                    return { content: [{ type: "text", text: "Error: theme_override must be valid JSON string" }], isError: true };
                }
            }

            const response = await axios.put(`${API_URL}/content/${page_id}`, payload, {
                headers: getHeaders(tenant_id)
            });

            return { content: [{ type: "text", text: `✓ Updated page "${title || page_id}". New slug: ${response.data.slug || 'unchanged'}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("get_block_schemas", {}, async () => {
    return {
        content: [{
            type: "text",
            text: `AMODX Available UI Blocks (18 plugins + 2 builtins):\n\n${JSON.stringify(BLOCK_SCHEMAS, null, 2)}\n\nNOTE: All blocks with array attributes (plans, items, columns, rows) require proper UUID generation for 'id' fields. Use crypto.randomUUID() or similar.`
        }]
    };
});

server.tool("add_block",
    {
        tenant_id: z.string(),
        page_id: z.string(),
        type: z.enum([
            "hero",
            "pricing",
            "contact",
            "image",
            "video",
            "leadMagnet",
            "features",
            "cta",
            "testimonials",
            "columns",
            "table",
            "paragraph",
            "heading",
            "html",
            "faq",
            "postGrid",
            "carousel",
            "codeBlock",
            "reviewsCarousel",
            "categoryShowcase"
        ]),
        attrs: z.string().describe("JSON string of attributes matching get_block_schemas"),
        content_text: z.string().optional().describe("For text blocks (paragraph/heading), the text content"),
    },
    async ({ tenant_id, page_id, type, attrs, content_text }) => {
        try {
            // 1. Fetch current page
            const getRes = await axios.get(`${API_URL}/content/${page_id}`, { headers: getHeaders(tenant_id) });
            const page = getRes.data;

            // 2. Construct new block
            let newBlock: any = { type };
            if (attrs) {
                try {
                    newBlock.attrs = JSON.parse(attrs);
                } catch (e) {
                    return { content: [{ type: "text", text: "Error: attrs must be valid JSON string" }], isError: true };
                }
            }
            if (content_text) {
                newBlock.content = [{ type: "text", text: content_text }];
            }

            // 3. Append
            const newBlocks = [...(page.blocks || []), newBlock];

            // 4. Save
            await axios.put(`${API_URL}/content/${page_id}`, { blocks: newBlocks }, {
                headers: getHeaders(tenant_id)
            });

            return { content: [{ type: "text", text: `✓ Added ${type} block to page "${page.title}".` }] };

        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("create_page",
    {
        tenant_id: z.string(),
        title: z.string(),
        slug: z.string().optional(),
        tags: z.string().optional().describe("Comma separated tags (e.g. 'blog, news')"),
    },
    async ({ tenant_id, title, slug, tags }) => {
        try {
            const payload: any = { title, status: "Draft", blocks: [] };
            if (slug) payload.slug = slug;
            if (tags) payload.tags = tags.split(',').map(t => t.trim());

            const response = await axios.post(`${API_URL}/content`, payload, {
                headers: getHeaders(tenant_id)
            });
            return { content: [{ type: "text", text: `✓ Created page "${title}" (ID: ${response.data.nodeId})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// LIST PRODUCTS
server.tool("list_products",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/products`, { headers: getHeaders(tenant_id) });
            const summary = response.data.items.map((p: any) =>
                `- ${p.title} (${p.price} ${p.currency}) [${p.status}] ID: ${p.id}`
            ).join("\n");
            return { content: [{ type: "text", text: `Products for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("list_tags",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/content`, { headers: getHeaders(tenant_id) });
            const allTags = new Set<string>();
            (response.data.items || []).forEach((item: any) => {
                if (Array.isArray(item.tags)) {
                    item.tags.forEach((t: string) => allTags.add(t));
                }
            });
            const sorted = Array.from(allTags).sort();
            return { content: [{ type: "text", text: `Available Tags for ${tenant_id}:\n${sorted.join(", ")}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// CREATE PRODUCT
server.tool("create_product",
    {
        tenant_id: z.string(),
        title: z.string(),
        price: z.string(),
        slug: z.string().optional().describe("URL-friendly slug (auto-generated if omitted)"),
        description: z.string().describe("Plain text description"),
        image_link: z.string().describe("URL of main image"),
        currency: z.string().optional().describe("Currency code (e.g., 'RON', 'EUR'). Defaults to tenant currency."),
        category_ids: z.string().optional().describe("Comma-separated category IDs to assign product to"),
        sale_price: z.string().optional().describe("Discounted price (shown with strikethrough on original)"),
        sku: z.string().optional().describe("Stock Keeping Unit code"),
        tags: z.string().optional().describe("Comma-separated product tags"),
        resource_id: z.string().optional().describe("ID of a private file to deliver upon purchase"),
    },
    async ({ tenant_id, title, price, slug, description, image_link, currency, category_ids, sale_price, sku, tags, resource_id }) => {
        try {
            const payload: any = {
                title,
                price,
                description,
                imageLink: image_link,
                resourceId: resource_id,
                status: "draft",
                availability: "in_stock",
                condition: "new"
            };
            if (slug) payload.slug = slug;
            if (currency) payload.currency = currency;
            if (sale_price) payload.salePrice = sale_price;
            if (sku) payload.sku = sku;
            if (category_ids) payload.categoryIds = category_ids.split(',').map(s => s.trim());
            if (tags) payload.tags = tags.split(',').map(s => s.trim());
            const response = await axios.post(`${API_URL}/products`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Created product "${title}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: CATEGORIES
// ==========================================

server.tool("list_categories",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/categories`, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((c: any) =>
                `- ${c.title} (ID: ${c.id}, Slug: ${c.slug}, Products: ${c.productCount || 0})`
            ).join("\n");
            return { content: [{ type: "text", text: `Categories for ${tenant_id}:\n${summary || "No categories found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("create_category",
    {
        tenant_id: z.string(),
        title: z.string(),
        slug: z.string().optional().describe("URL-friendly slug (auto-generated if omitted)"),
        description: z.string().optional(),
        image_link: z.string().optional().describe("Category image URL"),
        parent_id: z.string().optional().describe("Parent category ID for nested categories"),
        sort_order: z.number().optional().describe("Sort order (lower = first)"),
    },
    async ({ tenant_id, title, slug, description, image_link, parent_id, sort_order }) => {
        try {
            const payload: any = { title };
            if (slug) payload.slug = slug;
            if (description) payload.description = description;
            if (image_link) payload.imageLink = image_link;
            if (parent_id) payload.parentId = parent_id;
            if (sort_order !== undefined) payload.sortOrder = sort_order;
            const response = await axios.post(`${API_URL}/categories`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Created category "${title}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: ORDERS
// ==========================================

server.tool("list_orders",
    {
        tenant_id: z.string(),
        status: z.string().optional().describe("Filter by status: placed, confirmed, prepared, shipped, delivered, cancelled, annulled"),
    },
    async ({ tenant_id, status }) => {
        try {
            const url = status ? `${API_URL}/orders?status=${status}` : `${API_URL}/orders`;
            const response = await axios.get(url, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((o: any) =>
                `- ${o.orderNumber} [${o.status}] ${o.customerName} — ${o.total} ${o.currency} (${o.itemCount} items) ${o.createdAt}`
            ).join("\n");
            return { content: [{ type: "text", text: `Orders for ${tenant_id}:\n${summary || "No orders found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("get_order",
    {
        tenant_id: z.string(),
        order_id: z.string().describe("Order ID (from list_orders)"),
    },
    async ({ tenant_id, order_id }) => {
        try {
            const response = await axios.get(`${API_URL}/orders/${order_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("update_order_status",
    {
        tenant_id: z.string(),
        order_id: z.string(),
        status: z.enum(["placed", "confirmed", "prepared", "shipped", "delivered", "cancelled", "annulled"]),
        tracking_number: z.string().optional().describe("Courier tracking number (typically added when shipping)"),
        note: z.string().optional().describe("Internal note about the status change"),
    },
    async ({ tenant_id, order_id, status, tracking_number, note }) => {
        try {
            const payload: any = { status };
            if (tracking_number) payload.trackingNumber = tracking_number;
            if (note) payload.note = note;
            await axios.put(`${API_URL}/orders/${order_id}/status`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Order ${order_id} status updated to "${status}"` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: CUSTOMERS
// ==========================================

server.tool("list_customers",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/customers`, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((c: any) =>
                `- ${c.name} (${c.email}) — ${c.orderCount || 0} orders, Total: ${c.totalSpent || 0} ${c.currency || ""}`
            ).join("\n");
            return { content: [{ type: "text", text: `Customers for ${tenant_id}:\n${summary || "No customers found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("get_customer",
    {
        tenant_id: z.string(),
        customer_id: z.string().describe("Customer ID (email-based, from list_customers)"),
    },
    async ({ tenant_id, customer_id }) => {
        try {
            const response = await axios.get(`${API_URL}/customers/${customer_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: COUPONS
// ==========================================

server.tool("list_coupons",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/coupons`, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((c: any) =>
                `- ${c.code} (${c.type === "percent" ? c.value + "%" : c.value + " off"}) [${c.active ? "Active" : "Inactive"}] Used: ${c.usageCount || 0}/${c.usageLimit || "∞"} ID: ${c.id}`
            ).join("\n");
            return { content: [{ type: "text", text: `Coupons for ${tenant_id}:\n${summary || "No coupons found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("create_coupon",
    {
        tenant_id: z.string(),
        code: z.string().describe("Coupon code customers will enter (e.g., 'SUMMER20')"),
        type: z.enum(["percent", "fixed"]).describe("Discount type"),
        value: z.number().describe("Discount value (percentage or fixed amount)"),
        min_order: z.number().optional().describe("Minimum order value required"),
        usage_limit: z.number().optional().describe("Max total uses (omit for unlimited)"),
        expires_at: z.string().optional().describe("Expiry date in ISO format (e.g., '2025-12-31')"),
    },
    async ({ tenant_id, code, type, value, min_order, usage_limit, expires_at }) => {
        try {
            const payload: any = { code: code.toUpperCase(), type, value, active: true };
            if (min_order !== undefined) payload.minOrder = min_order;
            if (usage_limit !== undefined) payload.usageLimit = usage_limit;
            if (expires_at) payload.expiresAt = expires_at;
            const response = await axios.post(`${API_URL}/coupons`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Created coupon "${code}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: REVIEWS
// ==========================================

server.tool("list_reviews",
    {
        tenant_id: z.string(),
        product_id: z.string().optional().describe("Filter reviews by product ID"),
    },
    async ({ tenant_id, product_id }) => {
        try {
            const url = product_id ? `${API_URL}/reviews?productId=${product_id}` : `${API_URL}/reviews`;
            const response = await axios.get(url, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((r: any) =>
                `- [${r.status}] ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)} ${r.authorName}: "${(r.content || "").substring(0, 80)}" (Product: ${r.productId})`
            ).join("\n");
            return { content: [{ type: "text", text: `Reviews for ${tenant_id}:\n${summary || "No reviews found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("moderate_review",
    {
        tenant_id: z.string(),
        review_id: z.string(),
        product_id: z.string().describe("Product ID the review belongs to"),
        status: z.enum(["approved", "rejected", "pending"]),
    },
    async ({ tenant_id, review_id, product_id, status }) => {
        try {
            await axios.put(`${API_URL}/reviews/${review_id}`, { productId: product_id, status }, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Review ${review_id} status updated to "${status}"` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: DELIVERY
// ==========================================

server.tool("get_delivery_config",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/delivery`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("update_delivery_config",
    {
        tenant_id: z.string(),
        config: z.string().describe("JSON string of delivery config fields to update. Fields: freeDeliveryThreshold, deliveryFee, leadDays, weekDaysOff (array of 0-6), blockedDates, yearlyOffDays, unblockedDates, minOrder"),
    },
    async ({ tenant_id, config }) => {
        try {
            const payload = JSON.parse(config);
            await axios.put(`${API_URL}/delivery`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Delivery config updated` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: REPORTS
// ==========================================

server.tool("get_reports",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/reports/summary`, { headers: getHeaders(tenant_id) });
            const d = response.data;
            const lines = [
                `=== Commerce Reports for ${tenant_id} ===`,
                ``,
                `KPIs:`,
                `  Total Revenue: ${d.kpi?.totalRevenue || 0}`,
                `  Total Orders: ${d.kpi?.totalOrders || 0}`,
                `  Avg Order Value: ${d.kpi?.avgOrderValue || 0}`,
                `  Delivered Revenue: ${d.kpi?.deliveredRevenue || 0}`,
                ``,
                `Orders by Status:`,
                ...(d.byStatus || []).map((s: any) => `  ${s.status}: ${s.count} orders (${s.revenue})`),
                ``,
                `Payment Methods:`,
                ...(d.byPayment || []).map((p: any) => `  ${p.method}: ${p.count} orders (${p.revenue})`),
                ``,
                `Revenue by Month:`,
                ...(d.revenueByMonth || []).map((m: any) => `  ${m.month}: ${m.revenue} (${m.orders} orders)`),
                ``,
                `Top Products:`,
                ...(d.topProducts || []).slice(0, 10).map((p: any) => `  ${p.title}: ${p.quantity} sold (${p.revenue})`),
            ];
            if (d.coupons && d.coupons.length > 0) {
                lines.push(``, `Coupon Usage:`);
                d.coupons.forEach((c: any) => lines.push(`  ${c.code}: ${c.count} uses (${c.discount} discount)`));
            }
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: BULK PRICE ADJUSTMENT
// ==========================================

server.tool("bulk_price_adjust",
    {
        tenant_id: z.string(),
        percent: z.number().describe("Percentage change (e.g., 10 for +10%, -5 for -5%)"),
        category_id: z.string().optional().describe("Category ID to scope adjustment (omit for all products)"),
        round_to: z.number().optional().describe("Rounding: 0=none, 5=nearest 5, 9=ending in 9, 0.99=ending in .99"),
        apply_to_sale_price: z.boolean().optional().describe("Also adjust sale prices (default false)"),
        dry_run: z.boolean().optional().describe("Preview changes without applying (default true)"),
    },
    async ({ tenant_id, percent, category_id, round_to, apply_to_sale_price, dry_run }) => {
        try {
            const payload: any = { percent, dryRun: dry_run !== false };
            if (category_id) payload.categoryId = category_id;
            if (round_to !== undefined) payload.roundTo = round_to;
            if (apply_to_sale_price !== undefined) payload.applyToSalePrice = apply_to_sale_price;
            const response = await axios.post(`${API_URL}/products/bulk-price`, payload, { headers: getHeaders(tenant_id) });
            const d = response.data;
            if (d.preview) {
                const lines = [`Price Preview (${d.count} products):\n`];
                d.preview.slice(0, 20).forEach((p: any) => {
                    let line = `  ${p.title}: ${p.oldPrice} → ${p.newPrice} ${p.currency}`;
                    if (p.oldSalePrice) line += ` (sale: ${p.oldSalePrice} → ${p.newSalePrice})`;
                    lines.push(line);
                });
                if (d.count > 20) lines.push(`  ... and ${d.count - 20} more`);
                lines.push(`\nTo apply, call again with dry_run=false`);
                return { content: [{ type: "text", text: lines.join("\n") }] };
            }
            return { content: [{ type: "text", text: `✓ ${d.message}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// COMMERCE: POPUPS & FORMS
// ==========================================

server.tool("list_popups",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/popups`, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((p: any) =>
                `- ${p.title} [${p.active ? "Active" : "Inactive"}] Trigger: ${p.trigger} (ID: ${p.id})`
            ).join("\n");
            return { content: [{ type: "text", text: `Popups for ${tenant_id}:\n${summary || "No popups found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("list_forms",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/forms`, { headers: getHeaders(tenant_id) });
            const summary = (response.data.items || []).map((f: any) =>
                `- ${f.title} (Slug: ${f.slug}, Fields: ${f.fields?.length || 0}) [${f.active ? "Active" : "Inactive"}] ID: ${f.id}`
            ).join("\n");
            return { content: [{ type: "text", text: `Forms for ${tenant_id}:\n${summary || "No forms found."}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("get_form_submissions",
    {
        tenant_id: z.string(),
        form_id: z.string().describe("Form ID (from list_forms)"),
    },
    async ({ tenant_id, form_id }) => {
        try {
            const response = await axios.get(`${API_URL}/forms/${form_id}/submissions`, { headers: getHeaders(tenant_id) });
            const items = response.data.items || [];
            if (items.length === 0) {
                return { content: [{ type: "text", text: "No submissions found." }] };
            }
            const summary = items.map((s: any) =>
                `- ${s.createdAt}: ${JSON.stringify(s.data)}`
            ).join("\n");
            return { content: [{ type: "text", text: `Submissions for form ${form_id} (${items.length} total):\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// LIST ASSETS (Media)
server.tool("list_assets",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/assets`, { headers: getHeaders(tenant_id) });
            const summary = response.data.items.slice(0, 20).map((a: any) =>
                `- [${a.fileType}] ${a.fileName}: ${a.publicUrl}`
            ).join("\n");
            return { content: [{ type: "text", text: `Recent Assets (Top 20) for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// LIST COMMENTS (Admin View)
server.tool("list_comments",
    {
        tenant_id: z.string(),
        page_id: z.string().optional().describe("Optional: Filter by specific page node ID")
    },
    async ({ tenant_id, page_id }) => {
        try {
            const url = page_id
                ? `${API_URL}/comments?pageId=${page_id}`
                : `${API_URL}/comments`; // Backend now supports listing all if no pageId provided

            const response = await axios.get(url, { headers: getHeaders(tenant_id) });

            const summary = response.data.items.map((c: any) =>
                `[${c.status}] ${c.authorName} (${c.authorEmail}): "${c.content.substring(0, 50)}..." (Date: ${c.createdAt})`
            ).join("\n");

            if (!summary) return { content: [{ type: "text", text: "No comments found." }] };

            return { content: [{ type: "text", text: `Comments for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// MODERATE COMMENT
server.tool("moderate_comment",
    {
        tenant_id: z.string(),
        page_id: z.string().describe("The Page ID belonging to the comment"),
        created_at: z.string().describe("The exact ISO timestamp of the comment (acts as ID)"),
        action: z.enum(["UPDATE_STATUS", "DELETE"]),
        status: z.enum(["Approved", "Pending", "Spam", "Hidden"]).optional().describe("Required if action is UPDATE_STATUS")
    },
    async ({ tenant_id, page_id, created_at, action, status }) => {
        try {
            const payload = {
                pageId: page_id,
                createdAt: created_at,
                action,
                status
            };

            await axios.put(`${API_URL}/comments`, payload, {
                headers: getHeaders(tenant_id)
            });

            return { content: [{ type: "text", text: `✓ Comment moderated: ${action} ${status ? `-> ${status}` : ''}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// 5. THEME MANAGEMENT
// ==========================================

server.tool("list_themes",
    { tenant_id: z.string() }, // Needed for auth headers
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/themes`, { headers: getHeaders(tenant_id) });
            const summary = response.data.items.map((t: any) =>
                `- ${t.name} (ID: ${t.id}) [Primary: ${t.theme.primaryColor}]`
            ).join("\n");
            return { content: [{ type: "text", text: `Custom Themes:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("create_theme",
    {
        tenant_id: z.string(),
        name: z.string(),
        primary_color: z.string().optional(),
        primary_foreground: z.string().optional(),
        background_color: z.string().optional(),
        text_color: z.string().optional(),
        secondary_color: z.string().optional(),
        surface_color: z.string().optional(),
        font_heading: z.string().optional(),
        font_body: z.string().optional(),
        radius: z.string().optional(),
    },
    async (args) => {
        try {
            // Construct the theme object with defaults
            const theme = {
                mode: "light", // Default
                primaryColor: args.primary_color || "#000000",
                primaryForeground: args.primary_foreground || "#ffffff",
                backgroundColor: args.background_color || "#ffffff",
                textColor: args.text_color || "#020817",
                secondaryColor: args.secondary_color || "#ffffff",
                secondaryForeground: "#000000",
                surfaceColor: args.surface_color || "#f4f4f5",
                fontHeading: args.font_heading || "Inter",
                fontBody: args.font_body || "Inter",
                radius: args.radius || "0.5rem"
            };

            const response = await axios.post(`${API_URL}/themes`, {
                name: args.name,
                theme
            }, { headers: getHeaders(args.tenant_id) });

            return { content: [{ type: "text", text: `✓ Created theme "${args.name}" (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("apply_theme",
    {
        tenant_id: z.string(),
        theme_id: z.string().describe("ID from list_themes"),
        mode: z.enum(["light", "dark"]).default("light").describe("Which slot to apply this theme to")
    },
    async ({ tenant_id, theme_id, mode }) => {
        try {
            // 1. Get the theme details first (since we need the data to update settings)
            // Ideally backend would have an endpoint for this, but we can list and find
            const themesRes = await axios.get(`${API_URL}/themes`, { headers: getHeaders(tenant_id) });
            const themeItem = themesRes.data.items.find((t: any) => t.id === theme_id);

            if (!themeItem) return { content: [{ type: "text", text: "Theme not found" }], isError: true };

            // 2. Update Tenant Settings
            const settingsRes = await axios.get(`${API_URL}/settings`, { headers: getHeaders(tenant_id) });
            const currentConfig = settingsRes.data;

            const payload: any = {};
            if (mode === 'light') {
                payload.theme = { ...currentConfig.theme, ...themeItem.theme };
            } else {
                payload.darkTheme = { ...(currentConfig.darkTheme || currentConfig.theme), ...themeItem.theme };
            }

            await axios.put(`${API_URL}/settings`, payload, { headers: getHeaders(tenant_id) });

            return { content: [{ type: "text", text: `✓ Applied theme "${themeItem.name}" to ${mode} mode.` }] };

        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// 6. SIGNALS (Outbound Lead Tracking)
// ==========================================

server.tool("search_web",
    {
        query: z.string().describe("Search query"),
        tenant_id: z.string().describe("Tenant ID to fetch Brave API key from settings"),
    },
    async ({ query, tenant_id }) => {
        try {
            // Step 1: Fetch tenant settings to get Brave API key
            const settingsRes = await axios.get(`${API_URL}/settings`, {
                headers: getHeaders(tenant_id),
            });
            const braveApiKey = settingsRes.data?.integrations?.braveApiKey;

            if (!braveApiKey) {
                return { content: [{ type: "text" as const, text: "Configure Brave API Key in Admin Settings." }], isError: true };
            }

            // Step 2: Call Brave Search API directly
            const braveRes = await axios.get("https://api.search.brave.com/res/v1/web/search", {
                params: { q: query },
                headers: {
                    "Accept": "application/json",
                    "X-Subscription-Token": braveApiKey,
                },
            });

            const results = (braveRes.data.web?.results || []).slice(0, 10).map((r: any, i: number) =>
                `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description || ""}`
            ).join("\n\n");

            return { content: [{ type: "text" as const, text: `Search results for "${query}":\n\n${results}` }] };
        } catch (error: any) {
            const message = error.response?.data?.error || error.message;
            return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
        }
    }
);

server.tool("scrape_url",
    {
        url: z.string().describe("URL to scrape"),
    },
    async ({ url }) => {
        try {
            const response = await axios.get(url, {
                headers: { "User-Agent": "Mozilla/5.0 (compatible; AMODX-Bot/1.0)" },
                timeout: 15000,
            });
            const $ = cheerio.load(response.data);

            // Remove scripts, styles, navs
            $("script, style, nav, header, footer, aside").remove();

            const title = $("title").text().trim();
            const body = $("article, main, .post-content, .entry-content, body")
                .first()
                .text()
                .replace(/\s+/g, " ")
                .trim()
                .substring(0, 5000);

            const author = $("meta[name='author']").attr("content") || $("[rel='author']").first().text().trim() || undefined;

            return {
                content: [{
                    type: "text" as const,
                    text: `Scraped: ${url}\n\nTitle: ${title}\nAuthor: ${author || "Unknown"}\n\nContent:\n${body}`
                }]
            };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Error scraping ${url}: ${error.message}` }], isError: true };
        }
    }
);

server.tool("save_signal",
    {
        tenant_id: z.string(),
        source: z.enum(["Reddit", "Twitter", "LinkedIn", "Web"]),
        url: z.string(),
        title: z.string(),
        contentSnapshot: z.string().describe("The scraped/relevant text (max 5000 chars)"),
        author: z.string().optional(),
        painScore: z.number().min(1).max(10).describe("How urgent/painful is this lead's problem (1-10)"),
        walletSignal: z.boolean().describe("Does the post indicate willingness to pay?"),
        analysis: z.string().describe("AI analysis of why this is relevant"),
        draftReply: z.string().optional().describe("Suggested reply to post"),
    },
    async (args) => {
        try {
            const response = await axios.post(`${API_URL}/signals`, {
                source: args.source,
                url: args.url,
                title: args.title,
                contentSnapshot: args.contentSnapshot,
                author: args.author,
                painScore: args.painScore,
                walletSignal: args.walletSignal,
                analysis: args.analysis,
                draftReply: args.draftReply,
            }, { headers: getHeaders(args.tenant_id) });
            return { content: [{ type: "text" as const, text: `Saved signal "${args.title}" (ID: ${response.data.id}, Pain: ${args.painScore}/10)` }] };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("list_signals",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/signals`, { headers: getHeaders(tenant_id) });
            const items = response.data.items || [];
            if (items.length === 0) {
                return { content: [{ type: "text" as const, text: "No signals found." }] };
            }
            const summary = items.map((s: any) =>
                `- [${s.status}] (Pain: ${s.painScore}/10) ${s.source}: ${s.title}${s.walletSignal ? " 💰" : ""} (ID: ${s.id})`
            ).join("\n");
            return { content: [{ type: "text" as const, text: `Signals for ${tenant_id}:\n${summary}` }] };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// 7. SOCIAL MEDIA (Browser Automation)
// ==========================================

const PLATFORM_URLS: Record<string, { login: string; feed: string }> = {
    linkedin: { login: "https://www.linkedin.com/login", feed: "https://www.linkedin.com/feed" },
    X: { login: "https://x.com/i/flow/login", feed: "https://x.com/home" },
    reddit: { login: "https://www.reddit.com/login", feed: "https://www.reddit.com" },
    facebook: { login: "https://www.facebook.com/login", feed: "https://www.facebook.com" },
};

server.tool("social_login",
    {
        platform: z.enum(["linkedin", "X", "reddit", "facebook"]).describe("Social platform to log into"),
    },
    async ({ platform }) => {
        const urls = PLATFORM_URLS[platform];
        if (!urls) {
            return { content: [{ type: "text" as const, text: `Unknown platform: ${platform}` }], isError: true };
        }

        try {
            const browser = await chromium.launch({ headless: false });
            const context = await browser.newContext();
            const page = await context.newPage();

            await page.goto(urls.login);

            // Wait for user to complete login (poll for feed URL or extended timeout)
            let loggedIn = false;
            const maxWait = 5 * 60 * 1000; // 5 minutes
            const startTime = Date.now();

            while (!loggedIn && Date.now() - startTime < maxWait) {
                const currentUrl = page.url();
                // Check if we've navigated away from login page
                if (!currentUrl.includes("login") && !currentUrl.includes("flow")) {
                    loggedIn = true;
                    break;
                }
                await page.waitForTimeout(2000);
            }

            if (!loggedIn) {
                await browser.close();
                return { content: [{ type: "text" as const, text: `Login timeout for ${platform}. Please try again.` }], isError: true };
            }

            // Give extra time for session to stabilize
            await page.waitForTimeout(3000);

            // Save storage state
            const storagePath = path.join(STORAGE_DIR, `${platform}.json`);
            await context.storageState({ path: storagePath });

            await browser.close();

            return { content: [{ type: "text" as const, text: `Successfully logged into ${platform}. Session saved to ${storagePath}` }] };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Error during ${platform} login: ${error.message}` }], isError: true };
        }
    }
);

server.tool("post_social",
    {
        platform: z.enum(["linkedin", "X", "reddit", "facebook"]).describe("Social platform to post to"),
        content: z.string().describe("Content to post"),
    },
    async ({ platform, content }) => {
        const storagePath = path.join(STORAGE_DIR, `${platform}.json`);

        if (!fs.existsSync(storagePath)) {
            return { content: [{ type: "text" as const, text: `No saved session for ${platform}. Please run social_login first.` }], isError: true };
        }

        const urls = PLATFORM_URLS[platform];
        if (!urls) {
            return { content: [{ type: "text" as const, text: `Unknown platform: ${platform}` }], isError: true };
        }

        try {
            const browser = await chromium.launch({ headless: false }); // Visible to avoid detection
            const context = await browser.newContext({ storageState: storagePath });
            const page = await context.newPage();

            await page.goto(urls.feed);
            await page.waitForTimeout(3000);

            // Platform-specific posting logic
            if (platform === "linkedin") {
                // Click "Start a post" button
                await page.click('button:has-text("Start a post")');
                await page.waitForTimeout(1000);
                // Type in the post editor
                await page.fill('.ql-editor[data-placeholder="What do you want to talk about?"]', content);
                await page.waitForTimeout(500);
                // Click Post button
                await page.click('button:has-text("Post")');
                await page.waitForTimeout(3000);
            } else if (platform === "X") {
                // Click compose tweet area
                await page.click('[data-testid="tweetTextarea_0"]');
                await page.waitForTimeout(500);
                await page.fill('[data-testid="tweetTextarea_0"]', content);
                await page.waitForTimeout(500);
                // Click Post button
                await page.click('[data-testid="tweetButtonInline"]');
                await page.waitForTimeout(3000);
            } else if (platform === "reddit") {
                // Reddit is more complex - go to submit page
                await page.goto("https://www.reddit.com/submit?type=TEXT");
                await page.waitForTimeout(2000);
                // This varies by subreddit - simplified version
                const textarea = page.locator('textarea[placeholder*="Text"]').first();
                if (await textarea.isVisible()) {
                    await textarea.fill(content);
                }
                await page.waitForTimeout(2000);
                // Note: Reddit requires selecting a subreddit - manual intervention may be needed
            } else if (platform === "facebook") {
                // Click "What's on your mind?" area
                await page.click('[aria-label="Create a post"]');
                await page.waitForTimeout(1000);
                await page.fill('[aria-label*="What\'s on your mind"]', content);
                await page.waitForTimeout(500);
                await page.click('div[aria-label="Post"]');
                await page.waitForTimeout(3000);
            }

            // Save updated state (new cookies, etc.)
            await context.storageState({ path: storagePath });

            await browser.close();

            return { content: [{ type: "text" as const, text: `Posted to ${platform}: "${content.substring(0, 50)}..."` }] };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Error posting to ${platform}: ${error.message}` }], isError: true };
        }
    }
);

// ==========================================
// 4. SCHEMA REFERENCE
// ==========================================

server.tool("get_schema", {}, async () => {
    return {
        content: [{
            type: "text",
            text: `AMODX System Architecture (v3.0):

ENTITIES:
- Tenant: A client website/site (has domain, theme, integrations, currency)
- Content: Pages with blocks (hero, pricing, table, etc)
- Context: Strategy documents with tags (persona, Q1, etc)
- Blocks: UI components that render on pages (18 plugins + 2 builtins)
- Products: Physical/digital goods with pricing, variants, availability dates
- Categories: Product categories with slugs and nested hierarchy
- Orders: Customer orders with status workflow and email notifications
- Customers: Auto-created on first order, tracks order history and total spent
- Coupons: Discount codes (percent/fixed) with usage limits and expiry
- Reviews: Product reviews with star ratings, source badges (Google/Facebook/manual)
- Delivery: Configurable delivery fees, lead days, off-days, blocked/unblocked dates
- Popups: Triggered overlays (page_load, exit_intent, scroll, time_delay)
- Forms: Dynamic forms with field builder, email notifications, submissions tracking
- Assets: Private files that can be offered in exchange for the visitor email
- Comments: User discussions on pages (can be moderated)

WORKFLOW TO BUILD A PAGE:
1. list_tenants → Get tenant_id
2. list_content → Find existing pages or create_page
3. get_block_schemas → See all available blocks
4. add_block → Insert blocks with proper JSON attrs

WORKFLOW TO EDIT A PAGE:
1. list_content → Find the page_id
2. read_page → Get the current JSON structure
3. update_page → Send back the modified JSON (change order, fix typos, add blocks)

WORKFLOW TO MODERATE COMMENTS:
1. list_comments → See all comments (optionally filter by page_id)
2. moderate_comment → Approve, Spam, or Delete based on content

WORKFLOW FOR BLOGGING:
1. list_tags → See existing tags (to ensure consistency)
2. create_page / update_page → Apply tags to content items
3. add_block (postGrid) → Add a grid filtered by those tags

WORKFLOW FOR STYLING:
1. list_themes → See available presets
2. create_theme → Generate a new visual style (colors/fonts)
3. apply_theme → Apply a saved theme to Light or Dark mode
4. update_page (theme_override) → Apply specific colors to a single landing page

WORKFLOW FOR COMMERCE (Physical Goods):
1. list_categories → See existing categories (or create_category)
2. list_products → See existing products (or create_product with category_ids)
3. Storefront is auto-generated: product pages, category pages, cart, checkout
4. list_orders → Monitor incoming orders
5. update_order_status → Process orders through: placed → confirmed → prepared → shipped → delivered
6. get_reports → See revenue KPIs, top products, payment methods, monthly trends

WORKFLOW FOR PROMOTIONS:
1. list_coupons → See existing discount codes
2. create_coupon → Create percent or fixed discount with limits
3. bulk_price_adjust → Preview and apply percentage price changes across products/categories
4. list_popups → See engagement popups (exit intent, scroll triggers)

WORKFLOW FOR CUSTOMER INSIGHTS:
1. list_customers → See all customers with order counts and totals
2. get_customer → Full profile with address and order history
3. list_reviews → See product reviews, moderate_review to approve/reject
4. get_form_submissions → See form submission data
5. get_reports → Revenue analytics, top products, coupon performance

CURRENT PLUGINS (18 + 2 builtins):
✓ Hero (3 styles: center, split, minimal)
✓ Pricing (dynamic plans with highlight)
✓ Contact Form (email capture)
✓ Image (with caption & width control)
✓ Video (YouTube/Vimeo/MP4)
✓ Lead Magnet (gated downloads)
✓ Features (grid of cards)
✓ CTA (call-to-action banner)
✓ Testimonials (social proof)
✓ Columns (2-4 column layouts)
✓ Table (data tables with headers)
✓ Paragraph & Heading (text blocks)
✓ Custom HTML (Embeds, Scripts)
✓ FAQ (Accordion with JSON-LD)
✓ Post Grid (Dynamic Blog List)
✓ Carousel (Image/card slider with Swiper)
✓ Code Block (syntax-highlighted, 19 languages)
✓ Reviews Carousel (Google/Facebook badges, star ratings)
✓ Category Showcase (live product grid from commerce API)

ORDER STATUS FLOW:
placed → confirmed → prepared → shipped → delivered
                                         ↘ cancelled
                                         ↘ annulled

TIPS:
- Always generate UUIDs for array items (plans, columns, rows, etc)
- Use newline (\\n) for multi-line text in features/pricing
- Check existing blocks with get_block_schemas before adding
- Columns widths should add up logically (1/2 + 1/2, 1/3 + 2/3, etc)
- Table rows must have same number of cells as headers
- categoryShowcase requires commerce-enabled tenant and valid category ID
- bulk_price_adjust defaults to dry_run=true (preview only) — call with dry_run=false to apply
- Currency is set per-tenant in settings (default RON), inherited by new products`
        }],
    };
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("AMODX MCP Server v3.0.0 running on Stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
