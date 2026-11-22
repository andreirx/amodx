/**
 * SCHED-1D1 — POST /scheduling/admin/resources/{resourceId}/feed-secret (T; docs/slices/sched-1.md § 10.3, § 12):
 * a new secret (32 random bytes, base64url) replaces the old one, which stops at once. Only its SHA-256 is stored;
 * the answer `{ feedUrl }` is the only place the secret appears (shown once; never logged or audited).
 * `feedUrl = <bookingBase>/_booking/feed/<resourceId>/<secret>.ics` (§ 8.2, § 12; served by `sched-1g`).
 * Audit (§ 6.5 point 2: "resources (and feed secret rotation)"): the resource name; no secret, no `ip`.
 */
import { randomBytes } from "node:crypto";
import type { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { z } from "zod";
import { bookingBase } from "@amodx/shared";
import type { AuthorizerContext } from "../../auth/context.js";
import { publishAudit } from "../../lib/events.js";
import { getResource, schedulingStoreFromEnv, setFeedSecretHash, sha256hex } from "../../lib/scheduling-db.js";
import { TENANT_ADMIN, adminRoute } from "./common.js";
import { answer, parseBody, readTenantRecord, refusal, pathParam } from "../common.js";

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) =>
    adminRoute(event, "resources-feed-secret", TENANT_ADMIN, async ({ tenantId, auth }) => {
        const origin = process.env.RENDERER_CLOUDFRONT_ORIGIN;
        if (!origin) throw new Error("RENDERER_CLOUDFRONT_ORIGIN is not set");
        const id = pathParam(event, "resourceId");
        if (!id.ok) return id.answer;
        const body = parseBody(event, z.object({}).strict());
        if (!body.ok) return body.answer;
        const tenant = await readTenantRecord(tenantId, true);   // a missing record → 404 instead of the write: consistent
        if (tenant === undefined) return refusal(404, "notFound", "Site not found.");
        const store = schedulingStoreFromEnv();
        const resource = await getResource(store, tenantId, id.value, true);
        if (resource === undefined) return refusal(404, "notFound", "Resource not found.");
        const secret = randomBytes(32).toString("base64url");
        const set = await setFeedSecretHash(store, tenantId, id.value, sha256hex(secret));
        if (!set.ok) return refusal(404, "notFound", "Resource not found.");
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "ROTATE_SCHEDULING_FEED_SECRET",
            target: { id: id.value, title: resource.name },
        });
        const base = bookingBase({ id: tenantId, domain: typeof tenant.domain === "string" ? tenant.domain : undefined }, origin);
        return answer(200, { feedUrl: `${base}/_booking/feed/${id.value}/${secret}.ics` });
    });
