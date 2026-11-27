import { GALLERY_BLOCK_SHAPE } from "./tool-shapes.js";

// --- COMPLETE BLOCK DEFINITIONS FOR AI ---
// Synced with packages/plugins — 18 custom blocks + 2 Tiptap builtins
export const BLOCK_SCHEMAS = {
    hero: {
        description: "A large banner with headline, subheadline, CTA button, and optional image. Supports 4 layout styles: center, split (image beside the text), cover (image as full background with an overlay), minimal. Optional extras (omit = not shown): a small label above the headline, a second-tone part of the headline, a second outline button, up to 4 numbers with captions, pill-shaped buttons, and a dark text panel on split.",
        attrs: {
            headline: "string (e.g., 'Welcome to AMODX')",
            subheadline: "string (optional)",
            ctaText: "string (e.g., 'Get Started')",
            ctaLink: "string (e.g., '/contact' or '#pricing')",
            style: "'center' | 'split' | 'cover' | 'minimal'",
            imageSrc: "string (optional, image URL; the background in 'cover')",
            overlayOpacity: "number 0-1 (optional, 'cover' only; default 0.5)",
            overlayColorToken: "'auto' | 'black' | 'foreground' | 'primary' | 'muted' | 'accent' (optional, 'cover' only)",
            headlineColorToken: "'auto' | 'white' | 'foreground' | 'primary' | 'primary-foreground' | 'muted-foreground' | 'accent-foreground' (optional, 'cover' only)",
            subheadlineColorToken: "same values as headlineColorToken (optional, 'cover' only)",
            eyebrow: "string (optional, every style) — small pill label above the headline, e.g. 'Since 1998'",
            headlineAccent: "string (optional, every style) — shown inside the headline after it, in a second colour",
            headlineAccentColorToken: "same values as headlineColorToken (optional; omit or 'auto' = primary colour, or a light tone on an inverse panel)",
            secondaryCtaText: "string (optional; center, split, cover) — a second, outline button beside the first",
            secondaryCtaLink: "string (optional) — link of the second button",
            stats: "array of up to 4 { value: string (max 12 chars), label: string (max 40 chars) } (optional; center, split, cover) — a row of numbers with captions",
            buttonShape: "'rounded' | 'pill' (optional; default rounded)",
            splitPanel: "'plain' | 'inverse' (optional, 'split' only) — 'inverse' = dark text panel (page colours swapped)"
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
            columns: "'2' | '3' (default '3', used in grid layout)",
            eyebrow: "string (optional small label above the headline; omit or '' = none)",
            asideText: "string (optional; a side panel left of the posts, above them on a phone, shows when asideText, asideQuote or asideButtonText is set)",
            asideQuote: "string (optional quote in the side panel)",
            asideButtonText: "string (optional button in the side panel; drawn only with a text)",
            asideButtonLink: "string (the button's link; without it the button goes to '#'; a link without a text draws no button)"
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
        description: "Horizontal scrolling carousel of customer/Google/Facebook reviews with star ratings, source badges, optional auto-scroll, and (in a DB scope — site-reviews or product-reviews-by-id) approved review photos.",
        attrs: {
            headline: "string (e.g., 'What Our Customers Say')",
            scope: "'manual' | 'product-reviews-by-id' | 'site-reviews' (default 'manual'). 'manual' renders the authored `items` below. 'product-reviews-by-id' ignores `items` and renders a specific product's approved moderated reviews (set `productId`). 'site-reviews' ignores `items` and renders the tenant's approved SITE-scope moderated reviews. Both DB scopes include approved review photos, pulled at render time.",
            productId: "string (UUID) — required when scope is 'product-reviews-by-id'; ignored otherwise",
            items: "array of review objects (see example) — used only when scope is 'manual'",
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
            ctaText: "string (e.g., 'View All Products')",
            eyebrow: "string (optional small label above the category name; omit or '' = none)",
            badgeTags: "array of product tags (max 10; optional). A product with one of these tags shows ONE badge over its photo: the first tag of THIS list that the product has. Letter case does not count (\"top pick\" matches \"TOP PICK\"); spaces do count. The badge shows the tag as written in THIS list",
            showCategoryLabel: "boolean (optional; the name of each product's first category above its title; none when that category is hidden or missing)",
            showDescription: "boolean (optional; each product's short description as plain text, two lines at most)",
            showRating: "boolean (optional; the average and count of each product's approved reviews; none without an approved review). badgeTags and the three show* options have no effect on a catalog site"
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
    categoryGrid: {
        description: "Tall tiles of chosen categories (photo, name, description, optional foot text over the photo), in the chosen order, with an optional label and headline above and optional pill links under the grid. Each tile links to its category page. The categories are read from the shop when the page renders: a hidden or deleted category is left out. Offered on commerce and catalog sites.",
        attrs: {
            eyebrow: "string (optional small label above the headline; '' = none)",
            headline: "string (optional; '' = none)",
            categoryIds: "array of category UUIDs from list_categories, in tile order (max 12)",
            columns: "'2' | '3' | '4' (default '4'; columns from large screens, 1 on a phone, 2 on a tablet)",
            ctaText: "string (optional text at the foot of every tile, e.g. 'Shop category'; '' = none)",
            chips: "array of { label, href } — pill links under the grid (max 12); an item without a label or href is not shown",
            blockWidth: "'content' | 'wide' | 'full' (default 'content')"
        },
        example: {
            type: "categoryGrid",
            attrs: {
                eyebrow: "Shop by room",
                headline: "Floors for every space",
                categoryIds: ["cat-uuid-1", "cat-uuid-2", "cat-uuid-3", "cat-uuid-4"],
                columns: "4",
                ctaText: "Shop category",
                chips: [{ label: "Hardwood", href: "/category/hardwood" }, { label: "All floors", href: "/shop" }],
                blockWidth: "wide"
            }
        }
    },
    form: {
        description: "One custom form of the tenant (built with create_form), placed by its slug: the form's fields by type, its button text and its success text. Optional label, headline and text above it, optional card around it. The form is read from the site's forms when the page renders: a slug of no form, or of a disabled form, draws nothing. Visitors submit to the public route /public/forms/{slug}/submit; read submissions with get_form_submissions. Offered on every site kind.",
        attrs: {
            formSlug: "string — the slug of a form from list_forms ('' = no form, the block draws nothing)",
            eyebrow: "string (optional small label above the headline; '' = none)",
            headline: "string (optional; '' = none)",
            text: "string (optional text under the headline; '' = none)",
            card: "boolean (default false; true = the form inside a bordered card)",
            blockWidth: "'content' | 'wide' | 'full' (default 'content')"
        },
        example: {
            type: "form",
            attrs: {
                formSlug: "contact",
                eyebrow: "Contact",
                headline: "Not sure where to start?",
                text: "Tell us about your room and we will call you.",
                card: true,
                blockWidth: "content"
            }
        }
    },
    // GALLERY-1: the shape lives in tool-shapes.ts (bound to the plugin's schema by test/tool-shapes.test.ts).
    gallery: GALLERY_BLOCK_SHAPE,
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
