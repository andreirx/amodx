import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import dotenv from "dotenv";
import * as path from "path";
import { registerTenantTools } from "./tools/tenants.js";
import { registerStrategyContextTools } from "./tools/strategy-context.js";
import { registerContentTools } from "./tools/content.js";
import { registerProductTools } from "./tools/products.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerOrderCustomerTools } from "./tools/orders-customers.js";
import { registerCouponTools } from "./tools/coupons.js";
import { registerReviewTools } from "./tools/reviews.js";
import { registerDeliveryTools } from "./tools/delivery.js";
import { registerReportTools } from "./tools/reports.js";
import { registerBulkPriceTools } from "./tools/bulk-price.js";
import { registerFormPopupTools } from "./tools/forms-popups.js";
import { registerAssetResourceTools } from "./tools/assets-resources.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerThemeTools } from "./tools/themes.js";
import { registerSignalTools } from "./tools/signals.js";
import { registerLeadTools } from "./tools/leads.js";
import { registerServiceKeyTools } from "./tools/service-keys.js";
import { registerSystemAuditEmailTools } from "./tools/system-audit-email.js";
import { registerSocialTools } from "./tools/social.js";
import { registerSchemaReferenceTools } from "./tools/schema-reference.js";

// Storage directory for browser auth states
const STORAGE_DIR = path.join(import.meta.dirname, "../.storage");

dotenv.config();

const API_KEY = process.env.AMODX_API_KEY;
// Normalised once: the API Gateway URL that post-deploy writes into .env ends with "/", and
// every call below appends "/<path>" to API_URL. Stripping the slash keeps one convention.
const API_URL = (process.env.AMODX_API_URL ?? '').replace(/\/+$/, '');

if (!API_URL || !API_KEY) {
    console.error("Error: AMODX_API_URL or AMODX_API_KEY is missing in .env");
    process.exit(1);
}

// Startup health check flag — set by validateApiKey() before server.connect().
// When false, getHeaders() throws immediately so every API tool fails fast
// with a clear fix instruction instead of making a doomed HTTP call.
let apiKeyValid = false;

async function validateApiKey(): Promise<boolean> {
    try {
        const res = await axios.get(`${API_URL}/tenants`, {
            headers: { 'x-api-key': API_KEY, 'Authorization': 'Bearer robot' },
            timeout: 10000,
        });
        return res.status === 200;
    } catch (e: any) {
        if (e.response?.status === 403) {
            console.error(
                "STARTUP: API key validation FAILED (403 Forbidden). All API tools will return errors.\n" +
                "FIX: Run `npm run post-deploy` in the amodx project root, then restart the MCP server."
            );
        } else {
            console.error(`STARTUP: API connectivity check failed: ${e.message}`);
        }
        return false;
    }
}

// HELPER: Standard Headers
// Throws immediately when the API key is known-invalid so the tool's
// existing catch block returns a clear error to the caller.
const getHeaders = (tenantId?: string) => {
    if (!apiKeyValid) {
        throw new Error(
            "AMODX API key is invalid (403 Forbidden). The key in tools/mcp-server/.env is stale.\n" +
            "Fix: Run `npm run post-deploy` in the amodx project root, then restart the MCP server."
        );
    }
    const h: any = {
        'x-api-key': API_KEY,
        'Authorization': 'Bearer robot',
    };
    if (tenantId) h['x-tenant-id'] = tenantId;
    return h;
};

const server = new McpServer({
    name: "AMODX-Bridge",
    version: "3.0.0",
});

registerTenantTools(server, { API_URL, getHeaders });
registerStrategyContextTools(server, { API_URL, getHeaders });
registerContentTools(server, { API_URL, getHeaders });
registerProductTools(server, { API_URL, getHeaders });
registerCategoryTools(server, { API_URL, getHeaders });
registerOrderCustomerTools(server, { API_URL, getHeaders });
registerCouponTools(server, { API_URL, getHeaders });
registerReviewTools(server, { API_URL, getHeaders });
registerDeliveryTools(server, { API_URL, getHeaders });
registerReportTools(server, { API_URL, getHeaders });
registerBulkPriceTools(server, { API_URL, getHeaders });
registerFormPopupTools(server, { API_URL, getHeaders });
registerAssetResourceTools(server, { API_URL, getHeaders });
registerCommentTools(server, { API_URL, getHeaders });
registerThemeTools(server, { API_URL, getHeaders });
registerSignalTools(server, { API_URL, getHeaders });
registerLeadTools(server, { API_URL, getHeaders });
registerServiceKeyTools(server, { API_URL, getHeaders });
registerSystemAuditEmailTools(server, { API_URL, getHeaders });
registerSocialTools(server, { STORAGE_DIR });
registerSchemaReferenceTools(server);

async function main() {
    // Validate API key before accepting tool calls.
    // Server stays alive either way — non-API tools (scrape_url, social_login,
    // get_block_schemas, get_schema) remain functional.
    apiKeyValid = await validateApiKey();
    if (apiKeyValid) {
        console.error("STARTUP: API key validated. All tools operational.");
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("AMODX MCP Server v3.0.0 running on Stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
