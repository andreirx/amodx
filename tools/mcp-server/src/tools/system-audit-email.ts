import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { apiError } from "../tool-helpers.js";

export function registerSystemAuditEmailTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// SYSTEM, AUDIT & EMAIL
// ==========================================

server.tool("get_invalidation_status",
    "Read the pending-invalidation marker: whether it exists, the last change time, and goLiveAt — the flush-due time the backend " +
    "CALCULATES from the marker (not proof that a flush ran or that edits are published). " +
    "The marker is DEPLOYMENT-WIDE (one for all sites), not per site; tenant_id only satisfies the access check.",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/system/invalidation`, { headers: getHeaders(tenant_id) });
            const d = response.data;
            const text = d.pending
                ? `Pending invalidation marker present: last change ${d.lastChangeAt}; calculated flush-due time (goLiveAt) ${d.goLiveAt}. ` +
                  "The due time is not proof that a flush ran or that edits are published."
                : "No pending invalidation marker.";
            return { content: [{ type: "text", text }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("request_invalidation",
    "'GO LIVE NOW': asks the backend to invalidate the WHOLE renderer CDN ('/*', every site of this deployment, not only tenant_id) " +
    "and to delete the pending marker. The backend sends the CloudFront invalidation only when its renderer distribution ID is configured, " +
    "and ignores a failed marker delete; its response is the same in all these cases, so this tool cannot confirm either effect.",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.post(`${API_URL}/system/invalidation`, {}, { headers: getHeaders(tenant_id) });
            return {
                content: [{
                    type: "text",
                    text: `Backend returned HTTP ${response.status} ${JSON.stringify(response.data)}. ` +
                        "This body does not say whether a CloudFront invalidation was sent (the backend sends it only when its " +
                        "renderer distribution ID is configured) or whether the pending marker was deleted (a failed delete is " +
                        "logged and ignored); the backend returns the same body in all these cases."
                }]
            };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("list_audit",
    "Read the site's audit log, newest first (who did what). The backend returns one database page; the tool shows the newest `limit` entries.",
    {
        tenant_id: z.string(),
        limit: z.number().int().min(1).optional().describe("Entries to show (default 50)"),
    },
    async ({ tenant_id, limit }) => {
        try {
            const response = await axios.get(`${API_URL}/audit`, { headers: getHeaders(tenant_id) });
            const items = response.data.items || [];
            const shown = items.slice(0, limit ?? 50);
            const summary = shown.map((a: any) =>
                `- ${a.createdAt} ${a.actorEmail} ${a.action} "${a.entityTitle ?? a.entityId ?? "-"}"${a.details ? ` ${JSON.stringify(a.details)}` : ""}`
            ).join("\n");
            return { content: [{ type: "text", text: `Audit log for ${tenant_id} (showing ${shown.length} of ${items.length}):\n${summary || "No entries."}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("audit_graph",
    "Internal-link graph of the site's pages: which page links to which (text links, button/CTA links, postGrid listings), " +
    "and orphan pages that nothing links to (navigation, footer, '/' and '/contact' count as links; the homepage is never an orphan).",
    { tenant_id: z.string() },
    async ({ tenant_id }) => {
        try {
            const response = await axios.get(`${API_URL}/audit/graph`, { headers: getHeaders(tenant_id) });
            const { nodes = [], edges = [], orphans = [] } = response.data;
            const slugOf = new Map(nodes.map((n: any) => [n.id, n.slug]));
            const lines = [
                `Link graph for ${tenant_id}: ${nodes.length} pages, ${edges.length} links.`,
                ``,
                `Orphans (${orphans.length}):`,
                ...orphans.map((o: any) => `  - ${o.slug} "${o.title}" (ID: ${o.id})`),
                ``,
                `Links:`,
                ...edges.map((e: any) => `  ${slugOf.get(e.source) ?? e.source} → ${slugOf.get(e.target) ?? e.target}`),
            ];
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("email_dns_check",
    "Read-only check of the site's email DNS records in PUBLIC DNS against a mailbox provider's recipe. The domain comes from the site settings, " +
    "never from input. Writes nothing. A missing/errored record may only be unpropagated: re-check after its TTL.",
    {
        tenant_id: z.string(),
        provider: z.string().describe("Provider recipe ID. Current IDs: 'google-workspace', 'microsoft-365', 'zoho-mail', 'keep-existing'. The backend list is authoritative."),
    },
    async ({ tenant_id, provider }) => {
        try {
            const response = await axios.post(`${API_URL}/email/dns-check`, { provider }, { headers: getHeaders(tenant_id) });
            const d = response.data;
            const lines = [
                `Email DNS check — ${d.provider} for ${d.domain} at ${d.queriedAt}:`,
                ...(d.records || []).map((r: any) =>
                    `  [${r.status}] ${r.type} ${r.fqdn}: expected ${r.expected}${r.expectedPriority !== undefined ? ` (priority ${r.expectedPriority})` : ""}; ` +
                    `observed ${r.observed?.length ? r.observed.join(" | ") : "none"}${r.detail ? ` — ${r.detail}` : ""}`
                ),
                ``,
                d.ambiguityNote,
            ];
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
