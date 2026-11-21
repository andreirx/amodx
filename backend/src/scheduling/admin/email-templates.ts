/**
 * SCHED-1D1 — GET /scheduling/admin/email-templates (E+T; docs/slices/sched-1.md § 10.3, § 11.1):
 * `{ defaults, overrides }` for the seven keys. `defaults` come from `scheduling-email.ts` (the admin screen holds no
 * second copy); `overrides` are the tenant's `schedulingEmailConfig.templates`, each with both recipient flags
 * resolved (an absent flag shows the default's). Overrides are WRITTEN through the existing PUT /settings.
 * A stored scheduling attribute that fails its schema → 500 `storedDataInvalid` (never read as "no override", § 10.2;
 * `readSchedulingTenant`).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { SCHEDULING_EMAIL_KEYS, defaultSchedulingTemplates, resolveTemplate, type EmailTemplate } from "../../lib/scheduling-email.js";
import { EDITOR_OR_ADMIN, adminRoute, answer, readSchedulingTenant, refusal } from "./common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "email-templates", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const tenant = await readSchedulingTenant(tenantId, false);   // display read; a broken stored attribute → 500 storedDataInvalid
        if (tenant === undefined) return refusal(404, "notFound", "Site not found.");
        const stored = tenant.templates;
        const overrides: Partial<Record<string, EmailTemplate>> = {};
        for (const key of SCHEDULING_EMAIL_KEYS) {
            if (stored[key] !== undefined) overrides[key] = resolveTemplate(key, stored);
        }
        return answer(200, { defaults: defaultSchedulingTemplates(), overrides });
    });
