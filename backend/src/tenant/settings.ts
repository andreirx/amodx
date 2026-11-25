import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js"; // <--- Added .js
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js"; // <--- Added .js
import { publishAudit } from "../lib/events.js"; // <--- Added .js
import { requireRole } from "../auth/policy.js"; // <--- Added .js
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { purgeStoredPagesOfDomains } from "../lib/revalidate.js";
import { withoutRetiredTemplateKeys } from "../lib/scheduling-email.js";
import { z } from "zod";
import { isCatalogMode, COOKIE_AND_LEGAL_LABEL_LOCATIONS, PLURAL_CATEGORIES, BOOKING_TEXT_KEYS, EN_LANGUAGE_PACK, templatePlaceholders, ContactChannelsSchema, ThemeSchema, FooterConfigSchema, HeaderConfigSchema, SchedulingSettingsSchema, SchedulingEmailConfigSchema, languageSettingsProblem, readLanguageSettings, type CookieOrLegalLabelKey } from "@amodx/shared";

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
 * Unknown keys are kept (§ 2.4) and count toward every limit. What this bounds: the serialised size of these
 * attributes (3 × 32 768 bytes with `bookingStrings`); it does not bound the whole tenant item.
 *
 * LOCALE-1B (§ 16.2 item 6): a value is a text, or a COUNT text — a JSON object whose keys are plural categories
 * (`PLURAL_CATEGORIES`: zero, one, two, few, many, other) and whose values are texts; the length limit applies to each
 * of its texts, and it counts as one entry.
 *
 * SCHED-LABELS-1: `bookingStrings` (the booking-page texts) has the same limits, plus one rule for this attribute ONLY
 * (`bookingPlaceholderError`): a value of a booking key (`BOOKING_TEXT_KEYS`) is a text, and a non-empty text keeps
 * exactly the `{placeholders}` of the key's standard text. The site and catalog parts have no placeholder rule; it is
 * not added to them, so their existing stored values cannot be refused by it.
 */
const LOCALE_STRING_ATTRIBUTES = ["siteStrings", "catalogStrings", "bookingStrings"] as const;
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

const BOOKING_KEYS: ReadonlySet<string> = new Set(BOOKING_TEXT_KEYS);

/**
 * SCHED-LABELS-1 — one entry of `bookingStrings`. An unknown key: no rule here (kept, § 2.4). A booking key: the value
 * must be a text (the booking texts have no count key); `""` is no override and is not checked; any other text must
 * keep exactly the placeholders of the English standard text of the key — every placeholder of the standard text
 * present, and no other (`fillTemplate` leaves an unknown one in the page as written). The English text is the key's
 * contract: every language pack keeps the same placeholders per key (shared test `sched-labels-1`). The message names
 * the key and the first missing or unknown placeholder; null when the entry is accepted.
 */
function bookingPlaceholderError(key: string, value: unknown): string | null {
    if (!BOOKING_KEYS.has(key)) return null;
    if (typeof value !== "string") return `bookingStrings.${key} must be a text.`;
    if (value === "") return null;
    const standard = EN_LANGUAGE_PACK.booking[key as (typeof BOOKING_TEXT_KEYS)[number]];
    const required = templatePlaceholders(standard);
    const given = templatePlaceholders(value);
    const missing = required.find((name) => !given.includes(name));
    if (missing !== undefined) {
        return `bookingStrings.${key} must keep the placeholder {${missing}} (the standard text "${standard}" has ${required.map((n) => `{${n}}`).join(", ")}).`;
    }
    const unknown = given.find((name) => !required.includes(name));
    if (unknown !== undefined) {
        const allowed = required.length > 0 ? `only ${required.map((n) => `{${n}}`).join(", ")}` : "no placeholder";
        return `bookingStrings.${key} has the unknown placeholder {${unknown.slice(0, 64)}}; the text may use ${allowed}.`;
    }
    return null;
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
        if (attribute === "bookingStrings") {
            const placeholderError = bookingPlaceholderError(key, text);
            if (placeholderError) return placeholderError;
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
 * `FooterConfigSchema` (unknown keys refused; SHOP-LOOK-1A adds `brandText` and `columns` to it). HEADER-COLOURS-1: on
 * an object `header`, only the keys added since that slice (`HeaderCheckedKeysSchema`: the two colours, the footer's
 * colour rule; SHOP-LOOK-1A: `tagline` and `categoryBarIds`); the older header keys stay unvalidated and a non-object
 * `header` is stored as sent, as before. Returns the message of the first problem, naming the field (e.g.
 * `theme.fontWeights.1: …`); null when there is none.
 */
const ThemeDetailsSchema = ThemeSchema.pick({
    fontNav: true, fontWeights: true, headingWeight: true, mutedColor: true, borderColor: true,
    shape: true, cardImage: true, cardCategoryLine: true,
});
// The header keys PUT /settings checks: every key added from HEADER-COLOURS-1 on (renamed from `HeaderColorsSchema` by
// SHOP-LOOK-1A, when it stopped holding colours only). The older keys are not picked: a stored header with legacy values
// still saves.
const HeaderCheckedKeysSchema = HeaderConfigSchema.pick({ backgroundColor: true, textColor: true, tagline: true, categoryBarIds: true });
/** The theme as the renderer reads it: an object as is, a JSON string parsed; anything else (unparsable included) → null. */
function themeObjectOf(value: unknown): Record<string, unknown> | null {
    let theme = value;
    if (typeof theme === "string") {
        try { theme = JSON.parse(theme); } catch { return null; }
    }
    return theme !== null && typeof theme === "object" && !Array.isArray(theme) ? theme as Record<string, unknown> : null;
}
function themeAttributesError(body: Record<string, unknown>): string | null {
    const checks: [string, unknown, typeof ThemeDetailsSchema | typeof FooterConfigSchema | typeof HeaderCheckedKeysSchema][] = [];
    for (const attribute of ["theme", "darkTheme"] as const) {
        const theme = themeObjectOf(body[attribute]);
        if (theme) checks.push([attribute, theme, ThemeDetailsSchema]);
    }
    if (Object.hasOwn(body, "footer")) checks.push(["footer", body.footer, FooterConfigSchema]);
    const header = body.header;
    if (header !== null && typeof header === "object" && !Array.isArray(header)) checks.push(["header", header, HeaderCheckedKeysSchema]);
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
 * SCHED-1D1 (docs/slices/sched-1.md § 4.1, § 6.5 point 4, § 10.3) — the three scheduling attributes of the tenant
 * record. The LOCALE-1A kind: each is checked AS SENT and only when the body contains it, so no save without them is
 * refused for them; the body is stored as sent (defaults are applied when the record is read, as the shared schema
 * does). `schedulingEnabled`: a boolean. `scheduling`: `SchedulingSettingsSchema` with no unknown key (ranges of
 * § 4.5: `holdMinutes` 5-1440, `changeCutoffHours` and `reminderHours` 0-168, `bookingHorizonWeeks` 1-52; a timezone
 * must be an IANA name). `schedulingEmailConfig`: `SchedulingEmailConfigSchema` with no unknown key (the six keys of
 * § 11.1; each template needs `subject` and `body`; the retired group key `unplaced` is dropped first by the handler,
 * `withoutRetiredTemplateKeys`). The rule "enabling needs a timezone" is checked on the merged
 * record (`schedulingTimezoneError`). Returns the message of the first problem, naming the field; null when none.
 */
const SCHEDULING_ATTRIBUTES = ["schedulingEnabled", "scheduling", "schedulingEmailConfig"] as const;
const SchedulingAttributeSchemas = {
    schedulingEnabled: z.boolean(),
    scheduling: SchedulingSettingsSchema.strict(),
    schedulingEmailConfig: SchedulingEmailConfigSchema.strict(),
} as const;
/** True when the body names at least one scheduling attribute (§ 6.5 point 4: such a save publishes no `ip`). */
function hasSchedulingAttribute(body: Record<string, unknown>): boolean {
    return SCHEDULING_ATTRIBUTES.some((attribute) => Object.hasOwn(body, attribute));
}
function schedulingAttributesError(body: Record<string, unknown>): string | null {
    for (const attribute of SCHEDULING_ATTRIBUTES) {
        if (!Object.hasOwn(body, attribute)) continue;
        const parsed = SchedulingAttributeSchemas[attribute].safeParse(body[attribute]);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return `${[attribute, ...issue.path.map(String)].join(".")}: ${issue.message}`;
        }
    }
    return null;
}
/** § 4.1: "enabling without [a timezone] → 400". Checked on the merged record when the body names a scheduling attribute. */
function schedulingTimezoneError(merged: Record<string, any>): string | null {
    if (merged.schedulingEnabled !== true) return null;
    const timezone = merged.scheduling?.timezone;
    return typeof timezone === "string" && timezone !== ""
        ? null
        : "scheduling.timezone: a time zone is required when scheduling is enabled.";
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

// ── LANG-1B (docs/slices/lang-1.md § 9.4, ruling LANG1-STALENESS-BOUND = A with strengthening; LANG1-DEFERRED-FLUSH-LAYER2
// = A′): the deferred edge flush. A save that changes the tenant's language SET schedules one more distribution-wide `/*`
// about 5 minutes later — after the routing memory of the LAST language change (the middleware keeps a host's language
// list 60 s) — so the admin does not have to press GO LIVE NOW. Best-effort and edge only: it removes edge copies stored
// before it whose origin copy is right; it does not remove a copy stored again by a still-stale routing verdict, nor a
// wrong page stored under the live origin key by a stale layout read (§ 9.4, the two residual cases). No origin purge,
// no domain list, no infra change. The marker is drained by `scheduled/debounce-flush.ts` (`flushDeferredIfDue`).
//
// Abstraction line (§ 14): the `SYSTEM#CDN_DEFERRED_FLUSH` marker item — written here, drained by debounce-flush.ts —
// axis: none, a second due time the existing `SYSTEM#CDN_PENDING` marker cannot hold (one due time, deleted at its first
// `/*`) — rejected: a later due time in CDN_PENDING, and a new scheduled function.

/** The marker's key: one item for the deployment (a CloudFront path carries no host). Its only other attribute: `dueAt`. */
const DEFERRED_FLUSH_KEY = { PK: "SYSTEM", SK: "CDN_DEFERRED_FLUSH" } as const;
/** N of § 9.4: longer than the gate's 60-s memory plus the drain's resolution (one tick + ~50 s); shorter than 15 min. */
const DEFERRED_FLUSH_DELAY_MS = 5 * 60_000;

/** True when the two records' language SETS differ (order and repeats ignored), each read by the one read rule (§ 5.1). */
function languageSetChanged(before: unknown, after: unknown): boolean {
    const a = new Set(readLanguageSettings(before).languages);
    const b = new Set(readLanguageSettings(after).languages);
    return a.size !== b.size || [...a].some((language) => !b.has(language));
}

/**
 * Write `dueAt = now + N` to the marker, monotonically: only when no due time is stored or the stored one is EARLIER, so a
 * later save moves the flush later and an earlier or equal one never moves it back. A failed condition (a later due time
 * is already stored) is logged and ignored; any other failure is logged and never fails the save (as `markCdnPending`).
 */
async function armDeferredEdgeFlush(now: number): Promise<void> {
    const due = now + DEFERRED_FLUSH_DELAY_MS;
    try {
        await db.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: DEFERRED_FLUSH_KEY,
            UpdateExpression: "SET dueAt = :due",
            ConditionExpression: "attribute_not_exists(dueAt) OR dueAt < :due",
            ExpressionAttributeValues: { ":due": due },
        }));
        console.log(`[Settings] Language list changed — deferred edge flush due at ${new Date(due).toISOString()}`);
    } catch (error: any) {
        if (error?.name === "ConditionalCheckFailedException") {
            console.log("[Settings] Deferred edge flush already due later — kept");
        } else {
            console.error("[Settings] Failed to arm the deferred edge flush (best-effort; the bulk /* still runs):", error);
        }
    }
}

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
        // SCHED-GROUPS-REMOVE-1: a stored override of the retired group mail key comes back in a General Settings save
        // (the page sends the loaded config); it is dropped here by the same rule as on read, so the save is not refused
        // and the key is not stored again. Any other unknown key is still refused below.
        if (Object.hasOwn(body, "schedulingEmailConfig")) body.schedulingEmailConfig = withoutRetiredTemplateKeys(body.schedulingEmailConfig);
        // SCHED-1D1: same place and kind — before any read.
        const schedulingError = schedulingAttributesError(body);
        if (schedulingError) return { statusCode: 400, body: JSON.stringify({ error: schedulingError }) };
        const savesScheduling = hasSchedulingAttribute(body);

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
        // SCHED-1D1 (§ 4.1): enabling scheduling needs a timezone (on the merged record: the body may enable a site whose
        // timezone is already stored, or set the timezone of a site already enabled).
        if (savesScheduling) {
            const timezoneError = schedulingTimezoneError(merged);
            if (timezoneError) return { statusCode: 400, body: JSON.stringify({ error: timezoneError }) };
        }
        // LANG-1A (docs/slices/lang-1.md § 5.2, V1-V6): on the MERGED record, so a body that changes `locale`,
        // `urlPrefixes` or `homePageSlug` is refused when it breaks the stored language list. A record without
        // `languages`, `navLinksByLang` and `footerLinksByLang` checks nothing (every save of a one-language site passes).
        // A language-list change writes no page and no membership item.
        const languageProblem = languageSettingsProblem(merged);
        if (languageProblem) return { statusCode: 400, body: JSON.stringify({ error: languageProblem }) };

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

        // AUDIT LOG. SCHED-1D1 (docs/slices/sched-1.md § 6.5 point 4, SCHED-AUDIT-PII = C): no scheduling audit event
        // carries `ip`, so a save whose body names a scheduling attribute omits it — for the whole event, also when the
        // same body changes other settings (one event per save). A body without one sends `ip` as before.
        await publishAudit({
            tenantId: tenantId, // TS is happy now because of the early return above
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_SETTINGS",
            target: { title: current.name || "Settings" },
            details: {
                updatedFields: Object.keys(body),
                ...(rejectedFields.length > 0 ? { rejectedFields } : {}),
            },
            ...(savesScheduling ? {} : { ip: event.requestContext.http.sourceIp }),
        });

        // BULK-PURGE-FOOTER-1 (rules A1, A4): every stored page of the tenant shows the old settings. Both the domain
        // before and the domain after the save: on a domain change the old host's pages would otherwise be served until
        // the nightly flush (one purge when the domain is unchanged — duplicates collapse). The domains held here, not
        // a re-read: an eventually consistent read just after the Put could still return the old domain. Never throws;
        // the wrapper marks the CDN after it (S3 before edge).
        await purgeStoredPagesOfDomains([current.domain, merged.domain]);

        // LANG-1B (§ 9.4): after the stored-page purge, only when the language SET changed (another field, a reordered
        // list, or the menus per language do not change routing).
        if (languageSetChanged(current, merged)) await armDeferredEdgeFlush(Date.now());

        return { statusCode: 200, body: JSON.stringify({ message: "Settings Saved" }) };
    } catch (error: any) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

export const updateHandler = withInvalidation(_updateHandler);
