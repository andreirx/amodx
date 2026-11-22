/**
 * SCHED-1D2 — GET /scheduling/visitor/offer (renderer op `offer`; docs/slices/sched-1.md § 10.2) → `OfferDTO`.
 * The services (id, name, duration) and courses (id, name, languages) of the tenant, and its time zone. Public
 * derived read (§ 16.3 class 1): no resource, no eligibility list (it names resources, row D9), no customer data.
 * Display reads (not consistent). Errors: 403 (role or switch, `visitorRoute`).
 */
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import type { AuthorizerContext } from "../../auth/context.js";
import { listCourses, listServices, schedulingStoreFromEnv } from "../../lib/scheduling-db.js";
import { answer } from "../common.js";
import { visitorRoute } from "./common.js";

export type OfferDTO = {
    timezone: string;
    services: { id: string; name: string; durationMin: number }[];
    courses: { id: string; name: string; languages: string[] }[];
};

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    visitorRoute(event, "offer", { consistent: false }, async ({ tenantId, settings }) => {
        const store = schedulingStoreFromEnv();
        const [services, courses] = await Promise.all([listServices(store, tenantId), listCourses(store, tenantId)]);
        const dto: OfferDTO = {
            timezone: settings.timezone,
            services: services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin })),
            courses: courses.map((c) => ({ id: c.id, name: c.name, languages: c.languages })),
        };
        return answer(200, dto);
    });
