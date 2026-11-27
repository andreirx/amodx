import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import { apiError } from "../tool-helpers.js";

export function registerSignalTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// 6. SIGNALS (Outbound Lead Tracking)
// ==========================================

server.tool("search_web",
    {
        query: z.string().describe("Search query"),
        tenant_id: z.string().describe("Tenant whose Brave API key (in its settings) the backend uses"),
    },
    async ({ query, tenant_id }) => {
        try {
            // The backend reads the tenant's Brave key and calls Brave; the key never reaches this process.
            const response = await axios.post(`${API_URL}/research/search`, { query }, { headers: getHeaders(tenant_id) });

            const results = (response.data.results || []).map((r: any, i: number) =>
                `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description || ""}`
            ).join("\n\n");

            return { content: [{ type: "text" as const, text: `Search results for "${query}":\n\n${results}` }] };
        } catch (error: any) {
            return apiError(error);
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

server.tool("update_signal",
    "Update a saved signal. Only the keys you send change; the backend accepts only these five fields.",
    {
        tenant_id: z.string(),
        signal_id: z.string().describe("Signal ID (from list_signals)"),
        status: z.enum(["New", "Drafted", "Replied", "Dismissed"]).optional(),
        draft_reply: z.string().optional(),
        analysis: z.string().optional(),
        pain_score: z.number().min(1).max(10).optional(),
        wallet_signal: z.boolean().optional(),
    },
    async ({ tenant_id, signal_id, status, draft_reply, analysis, pain_score, wallet_signal }) => {
        try {
            const payload: Record<string, unknown> = {};
            if (status !== undefined) payload.status = status;
            if (draft_reply !== undefined) payload.draftReply = draft_reply;
            if (analysis !== undefined) payload.analysis = analysis;
            if (pain_score !== undefined) payload.painScore = pain_score;
            if (wallet_signal !== undefined) payload.walletSignal = wallet_signal;
            await axios.put(`${API_URL}/signals/${signal_id}`, payload, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text" as const, text: `✓ Updated signal ${signal_id} (${Object.keys(payload).join(", ") || "no fields"})` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
