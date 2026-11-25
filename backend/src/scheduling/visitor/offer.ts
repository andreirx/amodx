/**
 * SCHED-1D2 — GET /scheduling/visitor/offer (renderer op `offer`; docs/slices/sched-1.md § 10.2) → `OfferDTO`.
 * The services (id, name, duration) of the tenant, and its time zone. Public
 * derived read (§ 16.3 class 1): no resource, no eligibility list (it names resources, row D9), no customer data.
 * Display reads (not consistent). Errors: 403 (role or switch, `visitorRoute`).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { listServices, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { answer } from "../common.js";
import { visitorRoute } from "./common.js";

export type OfferDTO = {
    timezone: string;
    services: { id: string; name: string; durationMin: number }[];
};

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "offer", { consistent: false }, async ({ tenantId, settings }) => {
        const store = schedulingStoreFromEnv();
        const services = await listServices(store, tenantId, false);
        const dto: OfferDTO = {
            timezone: settings.timezone,
            services: services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin })),
        };
        return answer(200, dto);
    });
