import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { apiError, PENDING_MARKER_ATTEMPT } from "../tool-helpers.js";

export function registerThemeTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
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

server.tool("delete_theme",
    "Permanently delete a saved theme. Themes are SHARED by all tenants (not tenant-scoped). " +
    "Sites that already applied it keep their colors: apply_theme copies the values into the site settings. " + PENDING_MARKER_ATTEMPT,
    { theme_id: z.string().describe("ID from list_themes") },
    async ({ theme_id }) => {
        try {
            await axios.delete(`${API_URL}/themes/${theme_id}`, { headers: getHeaders() });
            return { content: [{ type: "text", text: `✓ Deleted theme ${theme_id}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
