import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { FORM_FIELDS_DESCRIPTION, FORM_DATE_ORDER_DESCRIPTION, formBody } from "../tool-shapes.js";
import { apiError, PENDING_MARKER_ATTEMPT, parseJsonInput, type JsonInput } from "../tool-helpers.js";

export function registerFormPopupTools(server: McpServer, { API_URL, getHeaders }: { API_URL: string; getHeaders: (tenantId?: string) => any }) {
// ==========================================
// ENGAGEMENT: POPUPS & FORMS
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

// Form fields shared by create_form and update_form (snake_case in, camelCase to the API; body built by `formBody`).
// The forms handlers do not validate the fields; the shapes below are FormDefinitionSchema's. STAY-1A: the pair rule
// `date_order` is validated by the backend at save.
const FormInput = z.object({
    slug: z.string().optional().describe("URL slug, slugified by the backend; must be unique in the tenant (HTTP 409 otherwise). Default: from name."),
    fields: z.string().optional().describe(FORM_FIELDS_DESCRIPTION),
    date_order: z.string().optional().describe(FORM_DATE_ORDER_DESCRIPTION),
    submit_button_text: z.string().optional(),
    success_message: z.string().optional(),
    notify_email: z.string().optional().describe("Email address notified on each submission"),
    status: z.enum(["active", "disabled"]).optional(),
});
const formPayload = (a: z.infer<typeof FormInput> & { name?: string }): JsonInput => {
    let fields: unknown[] | undefined;
    if (a.fields !== undefined) {
        const parsed = parseJsonInput(a.fields, "array", "fields");
        if (!parsed.ok) return parsed;
        fields = parsed.value;
    }
    let dateOrder: Record<string, unknown> | null | undefined;
    if (a.date_order !== undefined) {
        if (a.date_order.trim() === "null") dateOrder = null;
        else {
            const parsed = parseJsonInput(a.date_order, "object", "date_order");
            if (!parsed.ok) return parsed;
            dateOrder = parsed.value;
        }
    }
    return { ok: true, value: formBody(a, fields, dateOrder) };
};

server.tool("create_form",
    "Create a form. Visitors submit to the public route /public/forms/{slug}/submit; read submissions with get_form_submissions. " + PENDING_MARKER_ATTEMPT,
    { tenant_id: z.string(), name: z.string(), ...FormInput.shape },
    async ({ tenant_id, ...args }) => {
        const payload = formPayload(args);
        if (!payload.ok) return payload.result;
        try {
            const response = await axios.post(`${API_URL}/forms`, payload.value, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Created form "${response.data.name}" (ID: ${response.data.id}, Slug: ${response.data.slug})` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("get_form",
    "Read one form definition (JSON).",
    {
        tenant_id: z.string(),
        form_id: z.string().describe("Form ID (from list_forms)"),
    },
    async ({ tenant_id, form_id }) => {
        try {
            const response = await axios.get(`${API_URL}/forms/${form_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("update_form",
    "Update a form. Only the keys you send change; `fields` REPLACES the whole field list. " + PENDING_MARKER_ATTEMPT,
    {
        tenant_id: z.string(),
        form_id: z.string().describe("Form ID (from list_forms)"),
        name: z.string().optional(),
        ...FormInput.shape,
    },
    async ({ tenant_id, form_id, ...args }) => {
        const payload = formPayload(args);
        if (!payload.ok) return payload.result;
        try {
            const response = await axios.put(`${API_URL}/forms/${form_id}`, payload.value, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Updated form "${response.data.name}" (Slug: ${response.data.slug})` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("delete_form",
    "Permanently delete a form and its slug. Stored submissions are NOT deleted. No undo. " + PENDING_MARKER_ATTEMPT,
    {
        tenant_id: z.string(),
        form_id: z.string().describe("Form ID (from list_forms)"),
    },
    async ({ tenant_id, form_id }) => {
        try {
            await axios.delete(`${API_URL}/forms/${form_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Deleted form ${form_id}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

// Popup fields shared by create_popup and update_popup; values mirror PopupSchema.
const PopupInput = z.object({
    type: z.enum(["announcement", "newsletter", "promotion", "custom"]).optional(),
    headline: z.string().optional(),
    body: z.string().optional().describe("HTML content"),
    image_link: z.string().optional(),
    cta_text: z.string().optional(),
    cta_link: z.string().optional(),
    trigger: z.enum(["page_load", "exit_intent", "scroll", "time_delay"]).optional(),
    trigger_value: z.string().optional().describe("Scroll percent for 'scroll', seconds for 'time_delay'"),
    show_on_pages: z.string().optional().describe("Comma separated path prefixes (e.g. '/blog, /pricing'); a page matches when its path starts with one. Empty = all pages."),
    show_once_per_session: z.boolean().optional(),
    status: z.enum(["active", "disabled"]).optional().describe("New popups default to 'disabled'"),
});
const popupPayload = (a: z.infer<typeof PopupInput> & { name?: string }) => {
    const p: Record<string, unknown> = {
        name: a.name, type: a.type, headline: a.headline, body: a.body, imageLink: a.image_link,
        ctaText: a.cta_text, ctaLink: a.cta_link, trigger: a.trigger, triggerValue: a.trigger_value,
        showOnPages: a.show_on_pages?.split(",").map(s => s.trim()).filter(Boolean),
        showOncePerSession: a.show_once_per_session, status: a.status,
    };
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
};

server.tool("create_popup",
    "Create a popup. It stays 'disabled' unless you send status 'active'. " + PENDING_MARKER_ATTEMPT,
    { tenant_id: z.string(), name: z.string(), ...PopupInput.shape },
    async ({ tenant_id, ...args }) => {
        try {
            const response = await axios.post(`${API_URL}/popups`, popupPayload(args), { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Created popup "${response.data.name}" [${response.data.status}] (ID: ${response.data.id})` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("get_popup",
    "Read one popup (JSON).",
    {
        tenant_id: z.string(),
        popup_id: z.string().describe("Popup ID (from list_popups)"),
    },
    async ({ tenant_id, popup_id }) => {
        try {
            const response = await axios.get(`${API_URL}/popups/${popup_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("update_popup",
    "Update a popup. Only the keys you send change. The tool reads the stored popup, merges your keys over it and sends the full popup, " +
    "because the backend's partial validation fills every omitted field with its schema default (e.g. status 'disabled', trigger 'page_load'). " +
    "Not atomic: an admin edit made between the read and the write is overwritten. " + PENDING_MARKER_ATTEMPT,
    {
        tenant_id: z.string(),
        popup_id: z.string().describe("Popup ID (from list_popups)"),
        name: z.string().optional(),
        ...PopupInput.shape,
    },
    async ({ tenant_id, popup_id, ...args }) => {
        try {
            const headers = getHeaders(tenant_id);
            const current = await axios.get(`${API_URL}/popups/${popup_id}`, { headers });
            const response = await axios.put(`${API_URL}/popups/${popup_id}`, { ...current.data, ...popupPayload(args) }, { headers });
            return { content: [{ type: "text", text: `✓ Updated popup "${response.data.name}" [${response.data.status}]` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);

server.tool("delete_popup",
    "Permanently delete a popup. No undo. " + PENDING_MARKER_ATTEMPT,
    {
        tenant_id: z.string(),
        popup_id: z.string().describe("Popup ID (from list_popups)"),
    },
    async ({ tenant_id, popup_id }) => {
        try {
            await axios.delete(`${API_URL}/popups/${popup_id}`, { headers: getHeaders(tenant_id) });
            return { content: [{ type: "text", text: `✓ Deleted popup ${popup_id}` }] };
        } catch (error: any) {
            return apiError(error);
        }
    }
);
}
