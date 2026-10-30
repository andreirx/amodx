import { APIGatewayProxyHandlerV2, APIGatewayProxyEventV2 } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { BatchGetCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import {
    INTEREST_FORM_ID, InterestSubmissionSchema, InterestResolveRequestSchema, URL_PREFIX_DEFAULTS,
    type InterestPair, type InterestDropReason, type InterestResolution, type InterestSubmitResult,
} from "@amodx/shared";
import { db, TABLE_NAME } from "../lib/db.js";
import { verifyRecaptcha, getRecaptchaErrorMessage, resolveRecaptchaConfig } from "../lib/recaptcha.js";
import { verifyTenantFromOrigin } from "../lib/tenant-verify.js";
import { formatFromHeader } from "../lib/email-from.js";
import { readTenantMode } from "../lib/catalog-product.js";

/**
 * CAT-INTEREST-1 — the interest list's two public routes, one function (dispatch on `routeKey`).
 * Contract: docs/slices/catalog-mode-1.md § 3.5; slice docs/slices/cat-interest-1.md § 2.4–2.6 and § 8 (rulings).
 *
 * `POST /public/interest` — a catalog visitor's shortlist, sent as one record. The forms posture
 * (`forms/public-submit.ts`): the browser calls it directly, the tenant header is checked against the request
 * origin, then reCAPTCHA. Then, in this order:
 *   1. the body against `InterestSubmissionSchema` (strict; the size caps);
 *   2. the tenant mode, strongly consistent: no tenant record → 404, not a catalog tenant → 403;
 *   3. the replay check: a record for this list's token (`FORMSUB#interest-list#<sha256(token)>`, consistent read)
 *      → 200 "already-recorded" from THAT record, before and independent of any catalogue read (a resend after a lost
 *      response is answered as the first send was recorded, whatever the catalogue does meanwhile);
 *   4. the items: deduplicated by (productId, optionValue), first kept; read keys deduplicated by productId; the
 *      shared chunked consistent BatchGet; `UnprocessedKeys` retried at most 3 times, then 503 and NOTHING written;
 *      only after a complete read is an item dropped (`unknown`, `not-available`, `option-not-found`) — a missing
 *      option is never turned into interest in the plain product; no valid item → 400;
 *   5. the system form (created on first use) and the record, both conditional on a new key; title, slug, option and
 *      image are the ones READ in step 4, never the client's. A lost race on the record key → step 3's answer.
 * The notification goes to `integrations.contactEmail` only — none → logged, no mail (no platform fallback).
 *
 * `POST /public/interest/resolve` — the list page's identity read (§ 8, F3): the stored ids resolved by id, with the
 * SAME BatchGet and retry. No reCAPTCHA (it reads public fields only). Order: origin → body → tenant mode → read.
 * Each id is `active` (display fields, the `colecție` attribute as `collection`, the option values), `not-available`
 * (no fields) or `absent`; keys still unprocessed → 503 `retryable`, so absence is only ever stated from a complete
 * read.
 */

const ses = new SESClient({});
const FROM_EMAIL = process.env.SES_FROM_EMAIL!;

const SUBMIT_ROUTE = "POST /public/interest";
const RESOLVE_ROUTE = "POST /public/interest/resolve";

/** Retries of `UnprocessedKeys` after the first BatchGet of a chunk (spec § 3.5: "at most 3 times"). */
export const UNPROCESSED_RETRIES = 3;
const BACKOFF_MS = 50;
const BATCH_GET_MAX_KEYS = 100;

/** Spec § 3.5: the submit read projects exactly what the record and the option check need. */
const SUBMIT_PROJECTION = "id, title, slug, #s, imageLink, variants";
/** The resolve read adds `attributes` for the collection (§ 8, F7). */
const RESOLVE_PROJECTION = "id, title, slug, #s, imageLink, variants, attributes";
/** The attribute the glam importer writes for the producer's collection (`backend/src/import/glam/map.ts`). */
const COLLECTION_ATTRIBUTE = "colecție".normalize("NFC");

const FORM_NAME = "Listă de interes";
/**
 * The system form's fields (spec § 3.5): the record's `data` keys, in display order. Every type is one of
 * `FormFieldSchema`'s; `items` (a list of products) is typed `textarea` (§ 8, F8) and the admin renders it as a list
 * only for this form's `items` field.
 */
const FORM_FIELDS = [
    { id: "name", label: "Nume", type: "text" },
    { id: "email", label: "E-mail", type: "email" },
    { id: "phone", label: "Telefon", type: "phone" },
    { id: "message", label: "Mesaj", type: "textarea" },
    { id: "items", label: "Produse", type: "textarea" },
];

type Dropped = InterestPair & { reason: InterestDropReason };
interface RecordedItem extends InterestPair { title: string; slug: string; imageLink?: string }
type Product = Record<string, any>;

const json = (statusCode: number, body: unknown) => ({
    statusCode,
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(body),
});

const pairOf = (i: InterestPair): InterestPair =>
    (i.optionValue === undefined ? { productId: i.productId } : { productId: i.productId, optionValue: i.optionValue });

/** First occurrence of each (productId, optionValue) pair, in order. Pure. */
function dedupePairs(items: InterestPair[]): InterestPair[] {
    const seen = new Set<string>();
    const out: InterestPair[] = [];
    for (const i of items) {
        const key = JSON.stringify([i.productId, i.optionValue ?? null]);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(pairOf(i));
    }
    return out;
}

/** Every variant option value of a product, across its groups. */
const optionsOf = (product: Product): { value: string; imageLink?: string }[] =>
    (product.variants ?? []).flatMap((group: any) => group?.options ?? []).filter((o: any) => typeof o?.value === "string");

/**
 * Every product the ids name, read with a consistent BatchGet in chunks of ≤ 100 keys (ids deduplicated: BatchGet
 * refuses repeated keys). `null` = some keys stayed unprocessed after the retries: the caller must not decide anything
 * from a partial read. Users: the submit (projection of spec § 3.5) and the resolve route.
 */
async function readProducts(tenantId: string, ids: string[], projection: string): Promise<Map<string, Product> | null> {
    const unique = [...new Set(ids)];
    const found = new Map<string, Product>();
    for (let start = 0; start < unique.length; start += BATCH_GET_MAX_KEYS) {
        let keys: Record<string, any>[] = unique.slice(start, start + BATCH_GET_MAX_KEYS)
            .map((id) => ({ PK: `TENANT#${tenantId}`, SK: `PRODUCT#${id}` }));
        for (let retry = 0; ; retry++) {
            const res = await db.send(new BatchGetCommand({
                RequestItems: {
                    [TABLE_NAME]: {
                        Keys: keys,
                        ProjectionExpression: projection,
                        ExpressionAttributeNames: { "#s": "status" },
                        ConsistentRead: true,
                    },
                },
            }));
            for (const item of res.Responses?.[TABLE_NAME] ?? []) found.set(item.id, item);
            keys = res.UnprocessedKeys?.[TABLE_NAME]?.Keys ?? [];
            if (keys.length === 0) break;
            if (retry === UNPROCESSED_RETRIES) return null;
            await new Promise((r) => setTimeout(r, BACKOFF_MS * 2 ** retry));
        }
    }
    return found;
}

/** Each pair against the complete read: the recorded item (server data) or the drop with its reason. Pure. */
function resolvePairs(pairs: InterestPair[], products: Map<string, Product>): { items: RecordedItem[]; dropped: Dropped[] } {
    const items: RecordedItem[] = [];
    const dropped: Dropped[] = [];
    for (const pair of pairs) {
        const product = products.get(pair.productId);
        const drop = (reason: InterestDropReason) => dropped.push({ ...pair, reason });
        if (!product) { drop("unknown"); continue; }
        if (product.status !== "active") { drop("not-available"); continue; }
        let imageLink: string | undefined = product.imageLink;
        if (pair.optionValue !== undefined) {
            const option = optionsOf(product).find((o) => o.value === pair.optionValue);
            if (!option) { drop("option-not-found"); continue; }
            imageLink = option.imageLink || product.imageLink;
        }
        items.push({
            productId: pair.productId, title: product.title, slug: product.slug,
            ...(pair.optionValue !== undefined ? { optionValue: pair.optionValue } : {}),
            ...(imageLink ? { imageLink } : {}),
        });
    }
    return { items, dropped };
}

/** One id against the complete read (resolve route). Pure. */
function resolutionOf(productId: string, product: Product | undefined): InterestResolution {
    if (!product) return { productId, status: "absent" };
    if (product.status !== "active") return { productId, status: "not-available" };
    const collection = (product.attributes ?? [])
        .find((a: any) => typeof a?.key === "string" && a.key.normalize("NFC") === COLLECTION_ATTRIBUTE)?.value;
    return {
        productId, status: "active", title: product.title, slug: product.slug,
        ...(product.imageLink ? { imageLink: product.imageLink } : {}),
        ...(typeof collection === "string" && collection ? { collection } : {}),
        optionValues: optionsOf(product).map((o) => o.value),
    };
}

const isConditionFailure = (e: any) => e?.name === "ConditionalCheckFailedException";

const recordKey = (tenantId: string, submissionId: string) =>
    ({ PK: `TENANT#${tenantId}`, SK: `FORMSUB#${INTEREST_FORM_ID}#${submissionId}` });

/** The stored record for a token hash, as the "already-recorded" answer; `null` when there is none. */
async function storedOutcome(tenantId: string, submissionId: string): Promise<InterestSubmitResult | null> {
    const res = await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: recordKey(tenantId, submissionId),
        ConsistentRead: true,
        ProjectionExpression: "#d",
        ExpressionAttributeNames: { "#d": "data" },
    }));
    if (!res.Item) return null;
    const recorded = (Array.isArray(res.Item.data?.items) ? res.Item.data.items : []).map(pairOf);
    return { outcome: "already-recorded", submissionId, recorded };
}

const modeRefusal = async (tenantId: string) => {
    const mode = await readTenantMode(tenantId);
    if (!mode) return json(404, { error: "Site not found" });
    if (!mode.catalogMode) return json(403, { error: "Interest lists are not available on this site" });
    return null;
};

async function submit(event: APIGatewayProxyEventV2, tenantId: string, body: any) {
    // As forms/public-submit.ts: reCAPTCHA (deployment-level mandatory; the tenant may override keys/threshold).
    const tenantConfig = (await db.send(new GetCommand({
        TableName: TABLE_NAME,
        Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
    }))).Item;
    const recaptchaConfig = resolveRecaptchaConfig(tenantConfig?.recaptcha);
    if (recaptchaConfig) {
        if (!body.recaptchaToken) return json(400, { error: "CAPTCHA verification required" });
        const result = await verifyRecaptcha(body.recaptchaToken, recaptchaConfig.secretKey, event.requestContext?.http?.sourceIp);
        if (!result.success || result.score < recaptchaConfig.threshold) {
            console.warn(`reCAPTCHA BLOCKED [${recaptchaConfig.source}]: score=${result.score}, ip=${event.requestContext?.http?.sourceIp}, form=interest`);
            return json(403, { error: getRecaptchaErrorMessage(result) });
        }
    }

    const parsed = InterestSubmissionSchema.safeParse(body);
    if (!parsed.success) {
        return json(400, { error: "Invalid submission", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    const submission = parsed.data;

    const refused = await modeRefusal(tenantId);
    if (refused) return refused;

    // Replay: answered from the stored record, before (and whatever) the catalogue read would say.
    const submissionId = createHash("sha256").update(submission.submissionToken).digest("hex");
    const replay = await storedOutcome(tenantId, submissionId);
    if (replay) return json(200, replay);

    // Item validation (spec § 3.5 (3)). At most 50 distinct ids: the schema caps the raw list at 50 entries.
    const pairs = dedupePairs(submission.items);
    const products = await readProducts(tenantId, pairs.map((p) => p.productId), SUBMIT_PROJECTION);
    if (!products) return json(503, { error: "The product list could not be checked. Please try again.", retryable: true });

    const { items, dropped } = resolvePairs(pairs, products);
    if (items.length === 0) return json(400, { error: "None of the listed products is available", dropped });

    const now = new Date().toISOString();
    const pk = `TENANT#${tenantId}`;

    // The system form, created on first use (the shape forms/create.ts writes, minus slug and notifyEmail).
    try {
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: { PK: pk, SK: `FORM#${INTEREST_FORM_ID}`, Type: "Form", id: INTEREST_FORM_ID, tenantId, name: FORM_NAME, fields: FORM_FIELDS, status: "active", createdAt: now, updatedAt: now },
            ConditionExpression: "attribute_not_exists(SK)",
        }));
    } catch (e: any) {
        if (!isConditionFailure(e)) throw e;
    }

    const data = {
        name: submission.name,
        email: submission.email,
        ...(submission.phone !== undefined ? { phone: submission.phone } : {}),
        ...(submission.message !== undefined ? { message: submission.message } : {}),
        items,
    };
    try {
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                ...recordKey(tenantId, submissionId), Type: "FormSubmission",
                id: submissionId, tenantId, formId: INTEREST_FORM_ID, formName: FORM_NAME,
                data, submitterEmail: submission.email, status: "new", createdAt: now,
            },
            ConditionExpression: "attribute_not_exists(SK)",
        }));
    } catch (e: any) {
        if (!isConditionFailure(e)) throw e;
        // A concurrent send of the same list won the write: answer as step 3 does, from what it stored.
        const raced = await storedOutcome(tenantId, submissionId);
        if (raced) return json(200, raced);
        throw e;
    }

    const contactEmail: string | undefined = tenantConfig?.integrations?.contactEmail || undefined;
    if (!contactEmail) {
        console.warn(`[interest] notification not sent: tenant ${tenantId} has no integrations.contactEmail (submission ${submissionId} stored)`);
    } else {
        const productPrefix = tenantConfig?.urlPrefixes?.product || URL_PREFIX_DEFAULTS.product;
        const lines = items.map((i) => [i.title, i.optionValue, `https://${tenantConfig?.domain}${productPrefix}/${i.slug}`].filter(Boolean).join(" — "));
        const text = [
            `Listă de interes nouă de la ${submission.name}`,
            "",
            `Nume: ${submission.name}`,
            `E-mail: ${submission.email}`,
            `Telefon: ${submission.phone || "—"}`,
            `Mesaj: ${submission.message || "—"}`,
            "",
            `Produse (${items.length}):`,
            ...lines.map((l) => `- ${l}`),
            "",
            `Trimisă: ${now}`,
        ].join("\n");
        try {
            await ses.send(new SendEmailCommand({
                Source: formatFromHeader(tenantConfig?.name, FROM_EMAIL),
                Destination: { ToAddresses: [contactEmail] },
                ReplyToAddresses: [submission.email],
                Message: {
                    Subject: { Data: `${FORM_NAME} — ${submission.name.replace(/[\r\n]+/g, " ")}` },
                    Body: { Text: { Data: text } },
                },
            }));
        } catch (emailErr: any) {
            console.error("Interest notification email failed:", emailErr.message);
        }
    }

    const result: InterestSubmitResult = { outcome: "recorded", submissionId, recorded: items.map(pairOf), dropped };
    return json(201, result);
}

async function resolve(tenantId: string, body: any) {
    const parsed = InterestResolveRequestSchema.safeParse(body);
    if (!parsed.success) {
        return json(400, { error: "Invalid request", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    const refused = await modeRefusal(tenantId);
    if (refused) return refused;

    const ids = [...new Set(parsed.data.productIds)];
    const products = await readProducts(tenantId, ids, RESOLVE_PROJECTION);
    if (!products) return json(503, { error: "The product list could not be checked. Please try again.", retryable: true });
    return json(200, { products: ids.map((id) => resolutionOf(id, products.get(id))) });
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const tenantId = event.headers["x-tenant-id"];
        if (!tenantId) return json(400, { error: "Missing x-tenant-id header" });

        // As forms/public-submit.ts: the tenant header must match the request origin (both routes).
        const tenantVerified = await verifyTenantFromOrigin(event.headers as Record<string, string | undefined>, tenantId);
        if (!tenantVerified) {
            console.warn("Tenant verification failed", { tenantId, origin: event.headers["origin"] });
            return json(403, { error: "Invalid request origin" });
        }

        let body: any;
        try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON body" }); }

        switch (event.routeKey) {
            case SUBMIT_ROUTE: return await submit(event, tenantId, body);
            case RESOLVE_ROUTE: return await resolve(tenantId, body);
            // Only the two routes above are wired to this function (infra/lib/api-engagement.ts).
            default: return json(404, { error: "Unknown route" });
        }
    } catch (e: any) {
        return json(500, { error: e.message });
    }
};
