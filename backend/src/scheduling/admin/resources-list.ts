/**
 * SCHED-1D1 — GET /scheduling/admin/resources (E+T; docs/slices/sched-1.md § 10.3): `{ resources: ResourceDTO[] }`,
 * the whole list (≤ 200, § 4.5), sorted by name. `ResourceDTO = { id, name, hasFeed }`; a removal fence never
 * leaves the store module (AP10).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { listResources, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { EDITOR_OR_ADMIN, adminRoute, answer } from "./common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "resources-list", EDITOR_OR_ADMIN, async ({ tenantId }) => {
        const resources = await listResources(schedulingStoreFromEnv(), tenantId, false);
        resources.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        return answer(200, { resources });
    });
