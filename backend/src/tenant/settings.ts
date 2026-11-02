import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js"; // <--- Added .js
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js"; // <--- Added .js
import { publishAudit } from "../lib/events.js"; // <--- Added .js
import { requireRole } from "../auth/policy.js"; // <--- Added .js
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { purgeStoredPagesOfDomains } from "../lib/revalidate.js";
import { z } from "zod";
import { isCatalogMode, COOKIE_AND_LEGAL_LABEL_LOCATIONS, PLURAL_CATEGORIES, ContactChannelsSchema, ThemeSchema, FooterConfigSchema, type CookieOrLegalLabelKey } from "@amodx/shared";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * SETTINGS-KEYS-1 — fields of the tenant record that only the server sets (see `tenant/create.ts`).
 * PUT /settings removes them from the request body before the merge. Before this rule, `{ ...current, ...body }`
 * let a body `PK`/`SK` choose WHICH item of the single table was written (another tenant's record, or any item
 * such as `TENANT#<t>`/`PRODUCT#<p>`), and a body `id` relabelled the record (the renderer's `mapTenant` copies
 * `item.id` as the tenant id). `Domain` is derived from `domain`; `createdAt`/`createdBy` come from the stored record.
 * The handler, not the body, names the item: the written Item sets PK, SK and id after the spread.
 *
 * SETTINGS-KEYS-1B — the rule: no request field may name a key of the table or of any GSI
 * (`infra/lib/database.ts:27-51`: GSI_Domain `Domain`/`PK`, GSI_Type `Type`/`CreatedAt`,
 * GSI_Status `Status`/`ScheduledFor`, GSI_Slug `TenantSlug`). A body `TenantSlug: "<other>#<slug>"` plus
 * `Type: "Product"` placed this record (secrets included) in another tenant's GSI_Slug partition, where
 * `GET /public/products/{slug}` returned it.
 * See docs/slices/settings-keys-1.md §§ 2, 12.
 */
const SERVER_OWNED_FIELDS = [
    "PK", "SK", "id", "Domain", "createdAt", "createdBy",
    "Type", "CreatedAt", "Status", "ScheduledFor", "TenantSlug",
] as const;

/**
 * CATALOG-MODE-1 (CM-D11) — the FIRST content validation on this route, and deliberately narrow: exactly the two
 * mode flags, parsed on the MERGED item and used only as a check (the handler still writes `merged`). Never a full
 * `TenantConfigSchema.parse` here: stored configs predate the schema, and a full parse could refuse a live tenant's
 * next save for a field unrelated to the mode (spec § 3.1, "a new validator on a path that never validated").
 * An absent flag defaults to false, so a record created before the flag existed is "not catalog" on both sides.
 */
const ModeFlagsSchema = z.object({
    commerceEnabled: z.boolean().default(false),
    catalogMode: z.boolean().default(false),
});

/**
 * LOCALE-1A (docs/slices/locale-1.md § 4.4) — limits of the two NEW locale-table attributes, checked on the
 * attribute AS SENT and only when the body contains it. Same narrow kind as the mode-flag check: `commerceStrings`,
 * `gdpr` and `legalLinks` stay unvalidated, so no live tenant's next save can be refused for data it already has.
 * Unknown keys are kept (§ 2.4) and count toward every limit. What this bounds: the serialised size of these two
 * attributes (2 × 32 768 bytes); it does not bound the whole tenant item.
 *
 * LOCALE-1B (§ 16.2 item 6): a value is a text, or a COUNT text — a JSON object whose keys are plural categories
 * (`PLURAL_CATEGORIES`: zero, one, two, few, many, other) and whose values are texts; the length limit applies to each
 * of its texts, and it counts as one entry.
 */
const LOCALE_STRING_ATTRIBUTES = ["siteStrings", "catalogStrings"] as const;
const LOCALE_KEY_FORM = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const LOCALE_MAX_ENTRIES = 200;
const LOCALE_MAX_VALUE_UNITS = 500;      // UTF-16 code units (String.length)
const LOCALE_MAX_BYTES = 32_768;         // UTF-8 bytes of JSON.stringify(attribute)

/** The texts of `value` with the name each is reported under, or null when `value` is neither a text nor a count text. */
function textsOf(name: string, value: unknown): [string, string][] | null {
    if (typeof value === "string") return [[name, value]];
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const out: [string, string][] = [];
    for (const [category, text] of Object.entries(value)) {
        if (!(PLURAL_CATEGORIES as readonly string[]).includes(category) || typeof text !== "string") return null;
        out.push([`${name}.${category}`, text]);
    }
    return out;
}

/** The first limit `value` breaks, as a message that names the attribute and the limit; null when it breaks none. */
function localeStringsLimitError(attribute: (typeof LOCALE_STRING_ATTRIBUTES)[number], value: unknown): string | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return `${attribute} must be a JSON object of texts.`;
    }
    const entries = Object.entries(value);
    if (entries.length > LOCALE_MAX_ENTRIES) return `${attribute} has ${entries.length} entries; at most ${LOCALE_MAX_ENTRIES} are allowed.`;
    for (const [key, text] of entries) {
        if (!LOCALE_KEY_FORM.test(key)) return `${attribute} key "${key.slice(0, 80)}" is not a valid key (a letter, then letters or digits, at most 64 characters).`;
        const texts = textsOf(`${attribute}.${key}`, text);
        if (texts === null) return `${attribute}.${key} must be a text, or an object of texts per plural category (${PLURAL_CATEGORIES.join(", ")}).`;
        for (const [name, t] of texts) {
            if (t.length > LOCALE_MAX_VALUE_UNITS) return `${name} is ${t.length} characters long; at most ${LOCALE_MAX_VALUE_UNITS} are allowed.`;
        }
        if (attribute === "siteStrings" && Object.hasOwn(COOKIE_AND_LEGAL_LABEL_LOCATIONS, key)) {
            const { attribute: home, field } = COOKIE_AND_LEGAL_LABEL_LOCATIONS[key as CookieOrLegalLabelKey];
            return `siteStrings must not contain "${key}": that text is stored only in ${home}.${field}.`;
        }
    }
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes > LOCALE_MAX_BYTES) return `${attribute} is ${bytes} bytes as JSON; at most ${LOCALE_MAX_BYTES} are allowed.`;
    return null;
}

/**
 * CAT-QUOTE-1 (docs/slices/cat-quote-1.md § 3 items 1 and 4; packet rule 2) — the two NEW contact attributes, checked
 * as sent and only when the body contains them (the LOCALE-1A kind: no other attribute is validated, so no live tenant's
 * next save is refused for data it already has). `contactChannels`: `ContactChannelsSchema` (shared — the one rule for
 * a number and an e-mail; unknown channels refused); the object replaces the stored one whole, so `{}` clears every
 * channel. `interestListEmail`: an e-mail, or `null` = remove the attribute (interest lists then go to
 * `integrations.contactEmail` again); the top-level merge cannot remove an attribute that the body only omits.
 * Returns the message of the first problem, naming the field; null when there is none.
 */
const InterestListEmailSchema = z.string().email();
function contactAttributesError(body: Record<string, unknown>): string | null {
    if (Object.hasOwn(body, "contactChannels")) {
        const parsed = ContactChannelsSchema.safeParse(body.contactChannels);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return `${["contactChannels", ...issue.path.map(String)].join(".")}: ${issue.message}`;
        }
    }
    if (Object.hasOwn(body, "interestListEmail") && body.interestListEmail !== null && !InterestListEmailSchema.safeParse(body.interestListEmail).success) {
        return "interestListEmail: must be an e-mail address, or null to send interest lists to the visitor contact e-mail.";
    }
    return null;
}

/**
 * CAT-THEME-1 (docs/slices/cat-theme-1.md § 3; packet rule 3) — the NEW theme fields and the new `footer` attribute,
 * checked as sent and only when the body contains them (the LOCALE-1A kind). On `theme` and `darkTheme` only the eight
 * fields this slice added are checked (`ThemeDetailsSchema`); the older theme fields stay unvalidated, so no live
 * tenant's next save is refused for a theme it already has. Both representations the renderer reads are checked
 * (review-0 R-CT-1): an object, and a theme sent as a JSON STRING (the legacy form `mapTenant` parses,
 * `renderer/src/lib/dynamo.ts`) — parsed here for the check only; the body is stored as sent, never rewritten. A string
 * that does not parse to an object is not checked (today's behaviour: the renderer reads it as `{}`). `footer`:
 * `FooterConfigSchema` (unknown keys refused). Returns the message of the first problem, naming the field (e.g.
 * `theme.fontWeights.1: …`); null when there is none.
 */
const ThemeDetailsSchema = ThemeSchema.pick({
    fontNav: true, fontWeights: true, headingWeight: true, mutedColor: true, borderColor: true,
    shape: true, cardImage: true, cardCategoryLine: true,
});
/** The theme as the renderer reads it: an object as is, a JSON string parsed; anything else (unparsable included) → null. */
function themeObjectOf(value: unknown): Record<string, unknown> | null {
    let theme = value;
    if (typeof theme === "string") {
        try { theme = JSON.parse(theme); } catch { return null; }
    }
    return theme !== null && typeof theme === "object" && !Array.isArray(theme) ? theme as Record<string, unknown> : null;
}
function themeAttributesError(body: Record<string, unknown>): string | null {
    const checks: [string, unknown, typeof ThemeDetailsSchema | typeof FooterConfigSchema][] = [];
    for (const attribute of ["theme", "darkTheme"] as const) {
        const theme = themeObjectOf(body[attribute]);
        if (theme) checks.push([attribute, theme, ThemeDetailsSchema]);
    }
    if (Object.hasOwn(body, "footer")) checks.push(["footer", body.footer, FooterConfigSchema]);
    for (const [attribute, value, schema] of checks) {
        const parsed = schema.safeParse(value);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return `${[attribute, ...issue.path.map(String)].join(".")}: ${issue.message}`;
        }
    }
    return null;
}

/**
 * Strips secret fields from tenant config before returning to any caller.
 * Secrets are served exclusively via GET /settings/secrets (TENANT_ADMIN/GLOBAL_ADMIN only).
 *
 * IMPORTANT: When adding new secret fields to TenantConfig, add them here too.
 * Current secret fields:
 *   - recaptcha.secretKey
 *   - integrations.google.clientSecret
 *   - integrations.braveApiKey
 */
function redactSecrets(config: Record<string, any>): Record<string, any> {
    const redacted = structuredClone(config);

    if (redacted.recaptcha) {
        delete redacted.recaptcha.secretKey;
    }

    if (redacted.integrations) {
        if (redacted.integrations.google) {
            delete redacted.integrations.google.clientSecret;
        }
        delete redacted.integrations.braveApiKey;
    }

    return redacted;
}

export const getHandler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // 1. FAIL if no tenant ID
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // 2. ENFORCE Policy
        requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);

        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: {
                PK: "SYSTEM",
                SK: `TENANT#${tenantId}`
            }
        }));

        // Default if not found
        const config = result.Item || {
            id: tenantId,
            domain: "localhost",
            name: "Untitled Site",
            status: "LIVE",
            plan: "Pro",
            theme: { primaryColor: "#000000" }
        };

        // SECURITY: Strip secrets for all callers. Use GET /settings/secrets for privileged access.
        return { statusCode: 200, body: JSON.stringify(redactSecrets(config)) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

const _updateHandler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;

        // CRITICAL FIX: Early return narrows type from (string | undefined) to (string)
        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id header" }) };

        // SECURITY
        try {
            requireRole(auth, ["TENANT_ADMIN", "GLOBAL_ADMIN"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!event.body) return { statusCode: 400, body: "Missing body" };
        const body = JSON.parse(event.body);
        const rejectedFields = SERVER_OWNED_FIELDS.filter((field) => Object.hasOwn(body, field));
        for (const field of rejectedFields) delete body[field];

        // LOCALE-1A § 4.4: before any read, so a refused body costs nothing and writes nothing.
        for (const attribute of LOCALE_STRING_ATTRIBUTES) {
            if (!Object.hasOwn(body, attribute)) continue;
            const limitError = localeStringsLimitError(attribute, body[attribute]);
            if (limitError) return { statusCode: 400, body: JSON.stringify({ error: limitError }) };
        }
        // CAT-QUOTE-1: same place and kind — before any read.
        const contactError = contactAttributesError(body);
        if (contactError) return { statusCode: 400, body: JSON.stringify({ error: contactError }) };
        // CAT-THEME-1: same place and kind — before any read.
        const themeError = themeAttributesError(body);
        if (themeError) return { statusCode: 400, body: JSON.stringify({ error: themeError }) };

        // CATALOG-MODE-1 (CM-D11 accepted refinement): the mode read is authoritative. Strongly consistent, and a
        // missing tenant record answers 404 with nothing written. Before, a miss became `{ name: "Unknown" }` and this
        // save created a record without its mode (intended regression, spec § 3.1).
        const result = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
            ConsistentRead: true,
        }));
        if (!result.Item) return { statusCode: 404, body: JSON.stringify({ error: "Site not found" }) };

        const current = result.Item;
        const merged = { ...current, ...body };

        // Deep-merge nested objects that contain secret fields.
        // GET /settings strips recaptcha.secretKey, integrations.google.clientSecret,
        // and integrations.braveApiKey. The client sends the full config on PUT, but
        // those fields are absent because they were never in the response.
        // Without deep-merge, { ...current, ...body } replaces the entire nested object,
        // deleting the secret fields that existed in `current`.
        if (body.integrations && current.integrations) {
            merged.integrations = { ...current.integrations, ...body.integrations };
            // google sub-object needs its own merge (contains clientSecret)
            if (current.integrations.google || body.integrations?.google) {
                merged.integrations.google = {
                    ...current.integrations.google,
                    ...body.integrations?.google,
                };
            }
        }
        if (body.recaptcha && current.recaptcha) {
            merged.recaptcha = { ...current.recaptcha, ...body.recaptcha };
        }
        // CAT-QUOTE-1: `null` removes the attribute (contactAttributesError).
        if (body.interestListEmail === null) delete merged.interestListEmail;

        // CATALOG-MODE-1 (CM-D11): the mode is fixed when the site is created, and a catalog site never sells.
        const flags = ModeFlagsSchema.safeParse(merged);
        if (!flags.success) {
            return { statusCode: 400, body: JSON.stringify({ error: "commerceEnabled and catalogMode must be true or false." }) };
        }
        if (flags.data.catalogMode !== isCatalogMode(current)) {
            return { statusCode: 400, body: JSON.stringify({ error: "The catalog mode is fixed when the site is created and cannot be changed." }) };
        }
        if (flags.data.catalogMode && flags.data.commerceEnabled) {
            return { statusCode: 400, body: JSON.stringify({ error: "A catalog site has no cart or checkout, so commerce cannot be enabled." }) };
        }

        // SETTINGS-KEYS-1B — best-effort hostname claim check: reject a new hostname when another tenant's record is
        // visible in GSI_Domain now. Two identity resolvers (renderer getTenantConfig, lib/tenant-verify
        // getTenantByDomain) take the first GSI_Domain hit, so two tenant records on one hostname make the answer
        // undefined. Checked only when the hostname changes, so a record that already shares a hostname can still
        // save its other settings. NOT a uniqueness guarantee: overlapping requests (check-then-write) and GSI
        // propagation lag (GSIs are eventually consistent; also hits sequential requests) can both let two tenants
        // store the same hostname (docs/slices/settings-keys-1.md § 12.4).
        if (merged.domain && merged.domain !== current.domain) {
            const holders = await db.send(new QueryCommand({
                TableName: TABLE_NAME,
                IndexName: "GSI_Domain",
                KeyConditionExpression: "#d = :d",
                FilterExpression: "begins_with(SK, :tenant)",
                ExpressionAttributeNames: { "#d": "Domain" },
                ExpressionAttributeValues: { ":d": merged.domain, ":tenant": "TENANT#" },
            }));
            if ((holders.Items ?? []).some((item) => item.SK !== `TENANT#${tenantId}`)) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({ error: `The domain "${merged.domain}" is already used by another site.` }),
                };
            }
        }

        // Metadata updates
        merged.updatedBy = auth.sub;
        merged.updatedAt = new Date().toISOString();

        if (merged.domain) {
            merged.Domain = merged.domain;
        }
        delete merged.error;

        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                ...merged,
                PK: "SYSTEM",
                SK: `TENANT#${tenantId}`,
                id: tenantId,
            }
        }));

        // AUDIT LOG
        await publishAudit({
            tenantId: tenantId, // TS is happy now because of the early return above
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SETTINGS",
            target: { title: current.name || "Settings" },
            details: {
                updatedFields: Object.keys(body),
                ...(rejectedFields.length > 0 ? { rejectedFields } : {}),
            },
            ip: event.requestContext.http.sourceIp
        });

        // BULK-PURGE-FOOTER-1 (rules A1, A4): every stored page of the tenant shows the old settings. Both the domain
        // before and the domain after the save: on a domain change the old host's pages would otherwise be served until
        // the nightly flush (one purge when the domain is unchanged — duplicates collapse). The domains held here, not
        // a re-read: an eventually consistent read just after the Put could still return the old domain. Never throws;
        // the wrapper marks the CDN after it (S3 before edge).
        await purgeStoredPagesOfDomains([current.domain, merged.domain]);

        return { statusCode: 200, body: JSON.stringify({ message: "Settings Saved" }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export const updateHandler = withInvalidation(_updateHandler);
