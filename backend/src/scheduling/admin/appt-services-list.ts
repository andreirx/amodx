/**
 * SCHED-1E1 — GET /scheduling/admin/services (E+T; docs/slices/sched-1.md § 10.3): `{ services: ServiceDTO[] }`, the
 * whole list (≤ 200, § 4.5), sorted by name. `ServiceDTO = { id, name, durationMin, eligibility }` (the stored
 * `Service`). A display read (not consistent).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { listServices, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute } from "./common.js";
import { answer } from "../common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "appt-services-list", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const services = await listServices(schedulingStoreFromEnv(), tenantId, false);
        services.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        return answer(200, {
            services: services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, eligibility: s.eligibility })),
        });
    });
