import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { apiError, PENDING_MARKER_ATTEMPT } from "../tool-helpers.js";
import { BLOCK_SCHEMAS } from "../block-schemas.js";

export function registerContentTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// 3. CONTENT & BLOCKS
// ==========================================

server.tool("list_content",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/content`, { headers: getHeaders(tenant_id) });
            // LANG-1A (docs/slices/lang-1.md § 10): the translation set, when the page is in one.
            const summary = response.data.items.map((item: any) =>
                `- [${item.status}] ${item.title} (Slug: ${item.slug}, ID: ${item.nodeId}${item.translationKey ? `, Translation set: ${item.translationKey}` : ""})`
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
        theme_override: z.string().optional().describe("JSON string of theme variables to override for THIS PAGE ONLY. Example: {\"primaryColor\": \"#ff0000\", \"backgroundColor\": \"#000000\"}"),
        translation_of: z.string().nullable().optional().describe("LANG-1: the Node ID of a page in another language that this page translates (joins its translation set); null = leave the set; omit = no change. Needs extra languages in Settings. The page's language is its address prefix (/ro/…)."),
    },
    async ({ tenant_id, page_id, title, slug, status, blocks, seo_title, seo_description, tags, hide_nav, hide_footer, hide_sharing, theme_override, translation_of }) => {
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
            if (translation_of !== undefined) payload.translationOf = translation_of;   // null is sent: leave the set

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
            "categoryShowcase",
            "categoryGrid",
            "form",
            "gallery"
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
        translation_of: z.string().nullable().optional().describe("LANG-1: the Node ID of a page in another language that the new page translates (joins its translation set). Needs extra languages in Settings; the new page's language is its address prefix (/ro/…)."),
    },
    async ({ tenant_id, title, slug, tags, translation_of }) => {
        try {
            const payload: any = { title, status: "Draft", blocks: [] };
            if (slug) payload.slug = slug;
            if (tags) payload.tags = tags.split(',').map(t => t.trim());
            if (translation_of !== undefined) payload.translationOf = translation_of;

            const response = await axios.post(`${API_URL}/content`, payload, {
                headers: getHeaders(tenant_id)
            });
            return { content: [{ type: "text", text: `✓ Created page "${title}" (ID: ${response.data.nodeId})` }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
    }
);

server.tool("page_history",
    "List the saved versions of a page, newest first. Use a version number with restore_page_version.",
    {
        tenant_id: z.string(),
        page_id: z.string().describe("The Node ID of the page (from list_content)"),
    },
    async ({ tenant_id, page_id }) => {
        try {
            const response = await axios.get(`${API_URL}/content/${page_id}/versions`, { headers: getHeaders(tenant_id) });
            // Sorted here, numerically: the handler orders by sort key, where "v10" sorts before "v9".
            const versions = [...(response.data.versions || [])].sort((a: any, b: any) => Number(b.version) - Number(a.version));
            const summary = versions.map((v: any) =>
                `- v${v.version} [${v.status}] "${v.title}" — ${v.updatedAt || "?"} by ${v.updatedBy || "?"}`
            ).join("\n");
            return { content: [{ type: "text", text: `Versions of page ${page_id}:\n${summary || "No saved versions."}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("restore_page_version",
    "Restore a page to a saved version. Forward rollback: the snapshot is copied into the live page under a NEW version number; history is kept. " + PENDING_MARKER_ATTEMPT,
    {
        tenant_id: z.string(),
        page_id: z.string().describe("The Node ID of the page (from list_content)"),
        version: z.number().int().describe("Version number to restore (from page_history)"),
    },
    async ({ tenant_id, page_id, version }) => {
        try {
            const response = await axios.post(`${API_URL}/content/${page_id}/restore`, { version }, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Restored page ${page_id} from v${version}; it is now v${response.data.version}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

// REDIRECT-1 (docs/slices/redirect-1.md): redirects from old addresses — list (the existing GET /content?type=Redirect),
// add (POST /redirects), delete (DELETE /redirects). The refusal texts are the backend's (redirects/rules.ts).
const REDIRECT_REVALIDATION_ATTEMPT =
    "On success the backend attempts a best-effort cache revalidation of the old address and attempts to mark listings pending " +
    "(failures are logged and ignored; skipped when the site has no domain). Until a refresh completes, the old answer may still be served.";

server.tool("list_redirects",
    "List the site's redirects from old addresses (308). A target with no page route is marked 'target not found (no page at this address yet)' — route presence only; a built-in page such as the cart has no route and is marked too.",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/content?type=Redirect`, { headers: getHeaders(tenant_id) });
            const lines = (response.data.items as any[]).map((i) =>
                `- ${String(i.SK).replace(/^ROUTE#/, "")} → ${i.RedirectTo}${i.targetFound === false ? " — target not found (no page at this address yet)" : ""}`);
            return { content: [{ type: "text", text: lines.length ? `Redirects for ${tenant_id}:\n${lines.join("\n")}` : `No redirects for ${tenant_id}.` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("add_redirect",
    "Add a permanent redirect (308) from an old address of the site to a new one. Both are addresses of this site " +
    "(start with /; a trailing slash is dropped; lowercase a-z, digits, - and / only, no // inside — any other address is refused, never changed). " +
    "Never replaces a page or an existing redirect: to change one, delete it first. / and /contact cannot hold a redirect. " +
    REDIRECT_REVALIDATION_ATTEMPT,
    {
        tenant_id: z.string(),
        from: z.string().describe("Old address, e.g. /room/"),
        to: z.string().describe("New address on the same site, e.g. /guest-house (need not exist yet; not a redirect itself)"),
    },
    async ({ tenant_id, from, to }) => {
        try {
            const response = await axios.post(`${API_URL}/redirects`, { from, to }, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Redirect ${response.data.from} → ${response.data.to}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("delete_redirect",
    "Delete a redirect. Only a redirect is deleted; a page at the address is refused (409); / and /contact are refused (400). " + REDIRECT_REVALIDATION_ATTEMPT,
    {
        tenant_id: z.string(),
        from: z.string().describe("The old address exactly as list_redirects shows it"),
    },
    async ({ tenant_id, from }) => {
        try {
            await axios.delete(`${API_URL}/redirects`, { headers: getHeaders(tenant_id), data: { from } });
            return { content: [{ type: "text", text: `✓ Deleted the redirect from ${from}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
