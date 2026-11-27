import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { TransactWriteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AuthorizerContext } from "../auth/context.js";
import { publishAudit } from "../lib/events.js";
import { z } from "zod";
import { AccessPolicySchema, TranslationOfInputSchema, readLanguageSettings, pageLanguageOf, languageTagOf, localeLanguageSubtag } from "@amodx/shared";
import { requireRole } from "../auth/policy.js";
import { reservedAddressRefusal } from "../lib/slug-guard.js";
import { revalidateTenantPaths } from "../lib/revalidate.js";
import { normalizeSlug } from "@amodx/shared";

type AmodxHandler = APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext>;

// ── LANG-1A translation sets (docs/slices/lang-1.md § 5.2 C1-C3, § 6.1, § 6.3). Used by this handler and by create.ts
// (a new backend module is outside the slice's paths, so the one implementation lives here). ────────────────────────
//
// A set is a random UUID `K` held as `translationKey` on each member's LATEST, plus one membership item per member:
// `PK = TENANT#<t>, SK = TRANSLATION#<K>#<nodeId>, Type = "Translation"` (no language, slug or status: those are read
// from the page). Every write that changes a page's key is ONE transaction, one action per item, and each page action
// is conditioned on the key as it was read, so a concurrent change of either page cancels the whole write (→ 409).

/**
 * IMPORT-PATHS-1 (ruling 4) — the redirect route item: `ROUTE#<from>` answers a permanent redirect to `to`. The ONE
 * shape both writers use: this handler on a slug rename, and the WordPress importer for an old address it cannot keep
 * (import/wordpress.ts). The renderer reads it by key `ROUTE#<path>` and serves `RedirectTo` when `IsRedirect` is
 * truthy (renderer/src/lib/dynamo.ts `getContentBySlug`, SitePage.tsx `permanentRedirect` → 308). It does so only where
 * the renderer looks up content: not at a built-in page's address (slug-guard.ts `builtInPageAt`).
 */
export function redirectRouteItem(tenantId: string, from: string, to: string, timestamp: string, userId: string) {
    return {
        PK: `TENANT#${tenantId}`,
        SK: `ROUTE#${from}`,
        Type: "Route",
        IsRedirect: true,
        RedirectTo: to,
        CreatedAt: timestamp,
        UpdatedBy: userId
    };
}

/** A stored set id: a non-empty string. Anything else stored there (only a table edit makes it) counts as no set. */
function isSetKey(value: unknown): value is string {
    return typeof value === "string" && value !== "";
}

/** The condition "`translationKey` is still what was read": the raw value read, or absent when none was read. */
function keyAsRead(read: unknown, placeholder: string): { expression: string; values: Record<string, unknown> } {
    return read === undefined
        ? { expression: "attribute_not_exists(translationKey)", values: {} }
        : { expression: `translationKey = ${placeholder}`, values: { [placeholder]: read } };
}

const membershipKey = (tenantId: string, setKey: string, nodeId: string) => ({ PK: `TENANT#${tenantId}`, SK: `TRANSLATION#${setKey}#${nodeId}` });
const latestKey = (tenantId: string, nodeId: string) => ({ PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` });

/**
 * The pages of set `setKey` other than `exceptNodeId`, by the membership rule's conditions 1 and 3 (§ 6.2): a
 * membership item exists AND the page's LATEST holds `setKey` now; its address is a string. Any status counts (a Draft
 * or Archived member can be published again). One paginated Query on the tenant partition, then one Get per item.
 */
async function otherSetMembers(tenantId: string, setKey: string, exceptNodeId: string, consistentRead = false): Promise<{ nodeId: string; slug: string }[]> {
    const prefix = `TRANSLATION#${setKey}#`;
    const nodeIds: string[] = [];
    let start: Record<string, any> | undefined;
    // LANG-1C: the purge reads right after its own write, so it reads strongly consistent (the C3 check keeps today's read).
    const consistency = consistentRead ? { ConsistentRead: true } : {};
    do {
        const page = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": prefix },
            ProjectionExpression: "SK",
            ExclusiveStartKey: start,
            ...consistency,
        }));
        for (const item of page.Items ?? []) {
            const nodeId = String(item.SK).slice(prefix.length);
            if (nodeId !== "" && nodeId !== exceptNodeId) nodeIds.push(nodeId);
        }
        start = page.LastEvaluatedKey;
    } while (start);
    const pages = await Promise.all(nodeIds.map(async (nodeId) => {
        const res = await db.send(new GetCommand({
            TableName: TABLE_NAME, Key: latestKey(tenantId, nodeId),
            ProjectionExpression: "slug, translationKey",
            ...consistency,
        }));
        return { nodeId, item: res.Item };
    }));
    return pages
        .filter(({ item }) => item !== undefined && item.translationKey === setKey && typeof item.slug === "string")
        .map(({ nodeId, item }) => ({ nodeId, slug: item!.slug as string }));
}

/**
 * What a create or update does to the page's translation set (§ 6.3). `unchanged`: no membership action (the write runs
 * as today). `join`: the page's LATEST gets `translationKey = key` under `selfCondition`, plus `actions`. `leave`: the
 * LATEST gets `REMOVE translationKey` under `selfCondition`, plus `actions`.
 *
 * Rule for every reader (review R-L1A-03): a decision on `kind` is a `switch` whose every arm returns, in a function
 * whose declared return type excludes `undefined`, with no default arm — so a new variant is a compile error (TS2366)
 * at each site. The refusal is not a variant: `planTranslation` returns a Result (`ok: false`).
 */
export type TranslationPlan =
    | { kind: "unchanged" }
    | { kind: "join"; key: string; selfCondition: { expression: string; values: Record<string, unknown> }; actions: Record<string, unknown>[] }
    | { kind: "leave"; selfCondition: { expression: string; values: Record<string, unknown> }; actions: Record<string, unknown>[] };

/** The outcome of `planTranslation`: the plan, or the refusal to answer (rules C2 → 400, C3 → 409). */
export type TranslationPlanResult =
    | { ok: true; plan: TranslationPlan }
    | { ok: false; statusCode: 400 | 409; error: string };

/** The membership actions the plan adds to the page's transaction (none when the set does not change). */
export function membershipActionsOf(plan: TranslationPlan): Record<string, unknown>[] {
    switch (plan.kind) {
        case "unchanged": return [];
        case "join": return plan.actions;
        case "leave": return plan.actions;
    }
}

/** True when the plan changes the page's set (a cancelled transaction can then be a changed page or set, → 409 text). */
export function changesSet(plan: TranslationPlan): boolean {
    switch (plan.kind) {
        case "unchanged": return false;
        case "join": return true;
        case "leave": return true;
    }
}

/**
 * The plan for `translationOf` on page `selfNodeId` (address `selfSlug` after this write; raw `translationKey` read
 * `selfKeyRead`, undefined on create). Rules C2 (400: no languages, no such page, the page itself), C3 (409: a target in
 * this page's language, or a set that already has a page in it — compared by language tag, § 5.3; read-then-write, so
 * two concurrent requests can both pass), the no-op when already in the target's set, and the link / leave actions.
 * `null` (leave) is allowed without languages: it only removes a key.
 */
export async function planTranslation(args: {
    tenantId: string; selfNodeId: string; selfSlug: string; selfKeyRead: unknown; translationOf: string | null | undefined;
}): Promise<TranslationPlanResult> {
    const { tenantId, selfNodeId, selfSlug, selfKeyRead, translationOf } = args;
    const plan = (p: TranslationPlan): TranslationPlanResult => ({ ok: true, plan: p });
    const refuse = (statusCode: 400 | 409, error: string): TranslationPlanResult => ({ ok: false, statusCode, error });
    if (translationOf === undefined) return plan({ kind: "unchanged" });
    const selfCondition = keyAsRead(selfKeyRead, ":tkRead");
    const leaveOwnItem = isSetKey(selfKeyRead)
        ? [{ Delete: { TableName: TABLE_NAME, Key: membershipKey(tenantId, selfKeyRead, selfNodeId) } }]
        : [];
    if (translationOf === null) {
        return selfKeyRead === undefined ? plan({ kind: "unchanged" }) : plan({ kind: "leave", selfCondition, actions: leaveOwnItem });
    }

    if (translationOf === selfNodeId) return refuse(400, "translationOf: a page cannot be a translation of itself.");
    const tenant = (await db.send(new GetCommand({
        TableName: TABLE_NAME, Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` },
        ProjectionExpression: "#langs, #locale", ExpressionAttributeNames: { "#langs": "languages", "#locale": "locale" },
    }))).Item;
    const { languages } = readLanguageSettings(tenant);
    if (languages.length === 0) {
        return refuse(400, "translationOf: this site has no extra languages (Settings → Languages), so a page cannot be a translation.");
    }
    const target = (await db.send(new GetCommand({
        TableName: TABLE_NAME, Key: latestKey(tenantId, translationOf), ProjectionExpression: "slug, translationKey",
    }))).Item;
    if (!target) return refuse(400, `translationOf: no page with the id "${translationOf.slice(0, 80)}" on this site.`);

    const kp = target.translationKey;
    if (isSetKey(kp) && kp === selfKeyRead) return plan({ kind: "unchanged" });

    const defaultSubtag = localeLanguageSubtag(tenant?.locale);
    const tagOf = (slug: unknown) => languageTagOf(pageLanguageOf(typeof slug === "string" ? slug : "", languages), defaultSubtag);
    const selfTag = tagOf(selfSlug);
    if (tagOf(target.slug) === selfTag) {
        return refuse(409, `translationOf: the page "${String(target.slug)}" is in the same language (${selfTag}) as this page.`);
    }
    if (isSetKey(kp)) {
        const clash = (await otherSetMembers(tenantId, kp, selfNodeId)).find((m) => tagOf(m.slug) === selfTag);
        if (clash) {
            return refuse(409, `translationOf: that translation set already has a page in ${selfTag} ("${clash.slug}").`);
        }
    }

    // A new set gets a new random id, never a nodeId; a set id is never used again (rule C1).
    const key = isSetKey(kp) ? kp : crypto.randomUUID();
    const targetCondition = keyAsRead(kp, ":tpRead");
    const actions: Record<string, unknown>[] = [
        ...leaveOwnItem,
        { Put: { TableName: TABLE_NAME, Item: { ...membershipKey(tenantId, key, selfNodeId), Type: "Translation" } } },
        isSetKey(kp)
            ? { ConditionCheck: { TableName: TABLE_NAME, Key: latestKey(tenantId, translationOf), ConditionExpression: targetCondition.expression, ExpressionAttributeValues: targetCondition.values } }
            : { Update: {
                TableName: TABLE_NAME, Key: latestKey(tenantId, translationOf),
                UpdateExpression: "SET translationKey = :tk",
                ConditionExpression: targetCondition.expression,
                ExpressionAttributeValues: { ":tk": key, ...targetCondition.values },
            } },
        ...(isSetKey(kp) ? [] : [{ Put: { TableName: TABLE_NAME, Item: { ...membershipKey(tenantId, key, translationOf), Type: "Translation" } } }]),
    ];
    return plan({ kind: "join", key, selfCondition, actions });
}

/** The set key a page's LATEST holds after a write with `plan`, given the key it held before (`keyRead`). */
export function keyAfter(plan: TranslationPlan, keyRead: unknown): unknown {
    switch (plan.kind) {
        case "unchanged": return keyRead;
        case "join": return plan.key;
        case "leave": return undefined;
    }
}

/**
 * LANG-1C (docs/slices/lang-1.md § 9.3) — the purge targets a write adds besides today's (the page's own slugs). One rule
 * for every writer of a page item that this handler pair is: when the page's LATEST held a set key as read OR holds one
 * as written, purge every PUBLIC ADDRESS whose stored copy carries an affected set's alternates:
 *  - the slug of every OTHER page of each named set (§ 6.2 conditions 1 and 3, any status; their `hreflang` links,
 *    which name this page, change);
 *  - `/` when `/` serves one of the affected pages — the root renders the page named by the tenant's `homePageSlug`
 *    (`SitePage`), so `/` is added when `homePageSlug` equals the edited page's slug as read or as written
 *    (`selfSlugs`) or a remaining member's slug (review R-LANG1C-01). `/` is the only address that serves a page
 *    under another path than its slug: an old slug answers a redirect, not the page;
 *  - `/sitemap.xml` (its alternates change).
 * Keys that are not a non-empty string are no key (the reader treats them so). No key before or after → `[]`: exactly
 * today's targets, no read.
 *
 * Reads, only for a keyed page: one GetItem of the tenant record (`homePageSlug`), and per set one paginated Query of
 * its membership items + one GetItem per item; the set reads are strongly consistent (they run right after this
 * handler's own transaction). Best-effort like the purge it feeds: a failed read is logged and what it would have added
 * is skipped (the whole-tenant stored-page purge of the same call and the bulk `/*` still cover it); `/sitemap.xml` is
 * always returned.
 */
export async function setPurgeSlugs(tenantId: string, selfNodeId: string, keys: unknown[], selfSlugs: unknown[]): Promise<string[]> {
    const setKeys = [...new Set(keys.filter(isSetKey))];
    if (setKeys.length === 0) return [];
    const siblings: string[] = [];
    try {
        for (const setKey of setKeys) {
            for (const m of await otherSetMembers(tenantId, setKey, selfNodeId, true)) siblings.push(m.slug);
        }
    } catch (e) {
        console.error(`[LANG-1C] Reading the translation set(s) of ${selfNodeId} for the purge failed; siblings not purged at the edge`, e);
    }
    let root: string[] = [];
    try {
        const home = (await db.send(new GetCommand({
            TableName: TABLE_NAME, Key: { PK: "SYSTEM", SK: `TENANT#${tenantId}` }, ProjectionExpression: "homePageSlug",
        }))).Item?.homePageSlug;
        if (typeof home === "string" && home !== "" && [...selfSlugs, ...siblings].includes(home)) root = ["/"];
    } catch (e) {
        console.error(`[LANG-1C] Reading homePageSlug of ${tenantId} for the purge failed; "/" not purged at the edge`, e);
    }
    return [...siblings, ...root, "/sitemap.xml"];
}

/** The 409 text when a transaction that carried translation-set actions was cancelled outside its route item. */
export const TRANSLATION_CHANGED_ERROR = "The page or its translation set changed while saving; load it again.";

// STRICT SCHEMA - No Defaults!
// BACKEND-CONTRACT-1 D2: the five SEO/schema fields accept `null` because GET returns `null` for
// them (the merge below stores `null` when nothing is set) — a GET→PUT round-trip must validate.
// Field semantics in the merge: absent = keep the current value, `null` = clear, string = set.
const StrictUpdateSchema = z.object({
    title: z.string().optional(),
    slug: z.string().optional(),
    status: z.string().optional(),
    commentsMode: z.string().optional(),
    blocks: z.array(z.any()).optional(),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    seoKeywords: z.string().nullable().optional(),
    featuredImage: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    accessPolicy: AccessPolicySchema.optional(),
    themeOverride: z.any().optional(),
    hideNav: z.boolean().optional(),
    hideFooter: z.boolean().optional(),
    hideSharing: z.boolean().optional(),
    schemaType: z.string().nullable().optional(),
    // LANG-1A (§ 5): the nodeId of a page whose translation set to join; null = leave the set; absent = no change.
    // `translationKey` is NOT listed: it is never input (rule C1); zod drops it with every other unknown key.
    translationOf: TranslationOfInputSchema,
});

const _handler: AmodxHandler = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        const auth = event.requestContext.authorizer.lambda;
        const nodeId = event.pathParameters?.id;

        if (!tenantId) return { statusCode: 400, body: JSON.stringify({ error: "Missing x-tenant-id" }) };
        // BACKEND-CONTRACT-1 D1: a forbidden caller is a 403, not a 500 (same shape as create.ts).
        try {
            requireRole(auth, ["GLOBAL_ADMIN", "TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        if (!nodeId || !event.body) return { statusCode: 400, body: JSON.stringify({ error: "Missing ID or Body" }) };

        // BACKEND-CONTRACT-1 D1: a malformed body or a schema mismatch is the CLIENT's error → 400.
        // Before D1 both threw inside this `try` and the catch below answered 500.
        let body: unknown;
        try {
            body = JSON.parse(event.body);
        } catch {
            return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
        }

        // 1. Parse using the strict local schema
        // This guarantees 'blocks' is undefined if not sent, never []
        const parsed = StrictUpdateSchema.safeParse(body);
        if (!parsed.success) {
            return { statusCode: 400, body: JSON.stringify({ error: "Validation failed", issues: parsed.error.issues }) };
        }
        const input = parsed.data;

        // 1. Fetch Current State (to snapshot it)
        const currentRes = await db.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` }
        }));
        const current = currentRes.Item;
        if (!current) return { statusCode: 404, body: "Content not found" };

        // 2. Prepare Snapshot Item (The version we are about to overwrite)
        const currentVersion = current.version || 1;
        const snapshotItem = {
            ...current,
            SK: `CONTENT#${nodeId}#v${currentVersion}`, // Save as v1, v2...
            snapshotCreatedAt: new Date().toISOString() // Metadata for history list
        };

        // 3. Prepare Update Logic
        const oldSlug = current.slug;
        // BACKEND-CONTRACT-1 D3: a slug that DIFFERS from the stored one is normalised (same
        // normaliser as create), so a rename is stored in the form the renderer matches.
        // Absent, or resent unchanged, = keep the stored slug as it is: the admin resends `slug` on
        // every save, and a legacy non-normal slug (e.g. a raw WordPress import) must not be renamed
        // — and its live URL moved — by an unrelated edit.
        const newSlug = input.slug === undefined || input.slug === oldSlug ? oldSlug : normalizeSlug(input.slug);
        const slugChanged = newSlug !== oldSlug;

        // Refuse a slug at a reserved address (a built-in page the renderer serves for this kind of site)
        if (slugChanged) {
            const conflict = await reservedAddressRefusal(tenantId, newSlug);
            if (conflict) {
                return { statusCode: 400, body: JSON.stringify({ error: conflict }) };
            }
        }

        // LANG-1A (§ 6.3): the translation set, decided on the page's address AFTER this write and on the key as read.
        const planned = await planTranslation({
            tenantId, selfNodeId: nodeId, selfSlug: typeof newSlug === "string" ? newSlug : "",
            selfKeyRead: current.translationKey, translationOf: input.translationOf,
        });
        if (!planned.ok) return { statusCode: planned.statusCode, body: JSON.stringify({ error: planned.error }) };
        const plan = planned.plan;

        const timestamp = new Date().toISOString();
        const userId = auth.sub;

        // 2. Merge Logic using strict undefined checks
        // If input.blocks is undefined, use current.blocks.
        // D2: the five nullable fields use `keepOrSet` — `??` would read a `null` (clear) as "keep".
        const keepOrSet = (sent: string | null | undefined, stored: unknown) =>
            sent === undefined ? (stored ?? null) : sent;
        const updateValues = {
            ":t": input.title ?? current.title,
            ":b": input.blocks ?? current.blocks,
            ":s": input.status ?? current.status,
            ":cm": input.commentsMode ?? current.commentsMode ?? "Hidden",
            ":ap": input.accessPolicy ?? current.accessPolicy ?? { type: 'Public' },
            ":st": keepOrSet(input.seoTitle, current.seoTitle),
            ":sd": keepOrSet(input.seoDescription, current.seoDescription),
            ":sk": keepOrSet(input.seoKeywords, current.seoKeywords),
            ":fi": keepOrSet(input.featuredImage, current.featuredImage),
            ":tags": input.tags ?? current.tags ?? [],
            ":to": input.themeOverride ?? current.themeOverride ?? {},
            ":hn": input.hideNav ?? current.hideNav ?? false,
            ":hf": input.hideFooter ?? current.hideFooter ?? false,
            ":hs": input.hideSharing ?? current.hideSharing ?? false,
            ":sch": keepOrSet(input.schemaType, current.schemaType),
            ":u": timestamp,
            ":ub": userId,
            ":v": currentVersion + 1 // INCREMENT VERSION
        };

        const updateExprBase = "SET title = :t, blocks = :b, #s = :s, commentsMode = :cm, accessPolicy = :ap, seoTitle = :st, seoDescription = :sd, seoKeywords = :sk, featuredImage = :fi, tags = :tags, hideNav = :hn, hideFooter = :hf, hideSharing = :hs, themeOverride = :to, schemaType = :sch, updatedAt = :u, updatedBy = :ub, version = :v";

        /**
         * LANG-1A: the LATEST update of the plan. `unchanged` → today's action exactly (no condition: a SET of other
         * attributes cannot change the key). `join` → `, translationKey = :tk`; `leave` → ` REMOVE translationKey`; both
         * conditioned on the key as read. Exhaustive over the plan (rule above: every arm returns).
         */
        const latestUpdate = (expression: string, values: Record<string, unknown>): { Update: Record<string, unknown> } => {
            const base = {
                TableName: TABLE_NAME,
                Key: { PK: `TENANT#${tenantId}`, SK: `CONTENT#${nodeId}#LATEST` },
                ExpressionAttributeNames: { "#s": "status" },
            };
            switch (plan.kind) {
                case "unchanged":
                    return { Update: { ...base, UpdateExpression: expression, ExpressionAttributeValues: values } };
                case "join":
                    return { Update: {
                        ...base, UpdateExpression: expression + ", translationKey = :tk",
                        ConditionExpression: plan.selfCondition.expression,
                        ExpressionAttributeValues: { ...values, ":tk": plan.key, ...plan.selfCondition.values },
                    } };
                case "leave":
                    return { Update: {
                        ...base, UpdateExpression: expression + " REMOVE translationKey",
                        ConditionExpression: plan.selfCondition.expression,
                        ExpressionAttributeValues: { ...values, ...plan.selfCondition.values },
                    } };
            }
        };

        // 4. Transaction: Snapshot + Update (+ Redirects if needed)
        const transactItems: any[] = [
            // A. Save the Snapshot
            {
                Put: {
                    TableName: TABLE_NAME,
                    Item: snapshotItem
                }
            }
        ];

        if (slugChanged) {
            // B. Handle Slug Change (Redirect Old -> New)
            transactItems.push({
                Put: {
                    TableName: TABLE_NAME,
                    Item: redirectRouteItem(tenantId, oldSlug, newSlug, timestamp, userId)
                }
            });
            transactItems.push({
                Put: {
                    TableName: TABLE_NAME,
                    Item: {
                        PK: `TENANT#${tenantId}`,
                        SK: `ROUTE#${newSlug}`,
                        TargetNode: `NODE#${nodeId}`,
                        Type: "Route",
                        CreatedAt: timestamp,
                        CreatedBy: userId
                    },
                    ConditionExpression: "attribute_not_exists(SK)"
                }
            });
            transactItems.push(latestUpdate(updateExprBase + ", slug = :sl", { ...updateValues, ":sl": newSlug }));
        } else {
            // C. Just Update Content
            transactItems.push(latestUpdate(updateExprBase, updateValues));
        }
        // D. LANG-1A: the membership actions of the plan, in the same transaction.
        transactItems.push(...membershipActionsOf(plan));

        try {
            await db.send(new TransactWriteCommand({ TransactItems: transactItems }));
        } catch (error: any) {
            // LANG-1A: with set actions, a cancellation that is not the new route's condition (index 2 on a rename) is a
            // changed page or set → 409 with that text. Without set actions: today's mapping, unchanged (catch below).
            const routeTaken = slugChanged && error?.CancellationReasons?.[2]?.Code === "ConditionalCheckFailed";
            if (error?.name === "TransactionCanceledException" && changesSet(plan) && !routeTaken) {
                return { statusCode: 409, body: JSON.stringify({ error: TRANSLATION_CHANGED_ERROR }) };
            }
            throw error;
        }

        // Audit Log
        await publishAudit({
            tenantId,
            actor: { id: auth.sub, email: auth.email },
            action: "UPDATE_PAGE",
            target: { id: nodeId, title: input.title || current.title },
            details: {
                version: currentVersion + 1,
                slugChanged,
                fieldsUpdated: Object.keys(input)
            },
            ip: event.requestContext.http.sourceIp
        });

        // Purge the ISR (Layer 2) entries for this page. cache-2: keyed by the tenant's
        // DOMAIN, which is what middleware rewrites to and therefore what the S3 entry is
        // keyed by — the previous tenantId-keyed purge addressed nothing in production.
        // On a rename both slugs are purged: the new path (fresh content) and the old one
        // (which now serves a redirect).
        // LANG-1C (§ 9.3): a page in a set (as read or as written) also purges its siblings' addresses and /sitemap.xml;
        // a page in no set adds nothing (today's targets).
        const setTargets = await setPurgeSlugs(tenantId, nodeId, [current.translationKey, keyAfter(plan, current.translationKey)], [oldSlug, newSlug]);
        await revalidateTenantPaths(tenantId, "page", [newSlug, slugChanged ? oldSlug : undefined, ...setTargets]);

        return { statusCode: 200, body: JSON.stringify({ message: "Updated", version: currentVersion + 1, slug: newSlug }) };
    } catch (error: any) {
        console.error(error);
        // BACKEND-CONTRACT-1 D1: mapped as create.ts does — every TransactionCanceledException → 409.
        // The case this mapping is for: the conditional `ROUTE#<newSlug>` Put finds the slug taken
        // (reason ConditionalCheckFailed). The SDK documents other reasons that land here too
        // (TransactionConflict, ProvisionedThroughputExceeded, ThrottlingError, ValidationError,
        // ItemCollectionSizeLimitExceeded); they also answer 409, exactly as in create.ts.
        if (error.name === "TransactionCanceledException") {
            return { statusCode: 409, body: JSON.stringify({ error: "Update cancelled by the database transaction (for example, the new slug is already taken)" }) };
        }
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

// cache-4a: ORDINARY class — edge invalidated via the fast lane in `revalidateTenantPaths()`
// (targeted, ~10s). No `withInvalidation()` wrapper.
// CACHE-10: `revalidateTenantPaths()` also arms the bulk `/*` lane (CDN_PENDING) so listings
// refresh ≤ ~16 min (bulk `/*` due ≤15 min after the first pending change — max wait) — the
// "GO LIVE NOW" banner therefore shows after this edit too.
export const handler = _handler;
