import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSchemaReferenceTools(server: McpServer) {
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
✓ Category Grid (tiles of chosen categories + pill links)

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
- categoryGrid takes category IDs (list_categories); hidden or deleted categories are left out
- form takes the slug of a form (list_forms); the form's fields are edited with update_form, not on the page
- gallery takes photo addresses (https:// or /...); give alt for every photo, thumb when a smaller file exists
- bulk_price_adjust defaults to dry_run=true (preview only) — call with dry_run=false to apply
- Currency is set per-tenant in settings (default RON), inherited by new products`
        }],
    };
});
}
