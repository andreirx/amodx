import { APIGatewayProxyHandlerV2WithLambdaAuthorizer } from "aws-lambda";
import { db, TABLE_NAME } from "../lib/db.js";
import { PutCommand, QueryCommand, DeleteCommand, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { parseWXR, WordPressPost, WordPressProduct } from "./wxr-parser.js";
import { planAddresses, oldAddressOf, decodeSegment, oldProductPrefixes, pageAddressOf, productPageProblem, type ItemPlan, type OldAddress, type Placement, type RedirectPlan } from "./wp-addresses.js";
import { findProductBySlug, slugify } from "./product-slug.js";
import { readReservedAddresses, type ReservedAddresses } from "../lib/slug-guard.js";
import { urlPrefixesOf } from "@amodx/shared";
import { isProductAvailable } from "../lib/availability.js";
import { redirectRouteItem } from "../content/update.js";
import { HTMLToTiptapConverter } from "./html-to-tiptap.js";
import { downloadAndUploadImage } from "../lib/image-upload.js";
import { loadMediaMap } from "../lib/media-map.js";
import { withInvalidation } from "../lib/invalidate-cdn.js";
import { purgeStoredPagesOfRequestTenant } from "../lib/revalidate.js";
import { AuthorizerContext } from "../auth/context.js";
import { requireRole } from "../auth/policy.js";
import { readMigrationUpload, deleteMigrationUpload } from "./migration-upload.js";

/**
 * Find existing content by slug using ROUTE# lookup. LANG-1A: also the page's `translationKey` as read (raw; undefined
 * when absent), taken only from the LATEST item: `CONTENT#<n>#LATEST` sorts before every `CONTENT#<n>#v<k>`, so the
 * first item is LATEST whenever it exists.
 */
async function findContentBySlug(tenantId: string, slug: string): Promise<ExistingPage | null> {
    const routeResult = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND SK = :sk",
        ExpressionAttributeValues: {
            ":pk": `TENANT#${tenantId}`,
            ":sk": `ROUTE#${slug}`
        }
    }));

    if (!routeResult.Items || routeResult.Items.length === 0) return null;

    const route = routeResult.Items[0];
    const targetNode = route.TargetNode as string;
    if (!targetNode) return null;

    return findContentByNode(tenantId, targetNode.replace('NODE#', ''));
}

/**
 * The page a lookup finds. `translationKey`, `author` and `sourceItem` (`wordpressSourceItem`, IMPORT-PATHS-1) are read
 * from the LATEST only, raw (undefined when absent).
 */
interface ExistingPage { nodeId: string; contentId: string; createdAt: string; translationKey: unknown; author: unknown; sourceItem: unknown }

/** The page record `findContentBySlug` returns, for a node (IMPORT-PATHS-1: split out for `routeAt`; same reads). */
async function findContentByNode(tenantId: string, nodeId: string): Promise<ExistingPage | null> {
    // Get existing content record
    const contentResult = await db.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
            ":pk": `TENANT#${tenantId}`,
            ":sk": `CONTENT#${nodeId}#`
        },
        Limit: 1
    }));

    if (!contentResult.Items || contentResult.Items.length === 0) return null;

    const first = contentResult.Items[0];
    return {
        nodeId,
        contentId: first.id,
        createdAt: first.createdAt,
        translationKey: String(first.SK).endsWith("#LATEST") ? first.translationKey : undefined,
        author: String(first.SK).endsWith("#LATEST") ? first.author : undefined,
        sourceItem: String(first.SK).endsWith("#LATEST") ? first.wordpressSourceItem : undefined,
    };
}

const s3 = new S3Client({});
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET;
// MIGRATION-UPLOAD-1: an uploaded export is read from the PRIVATE bucket (`migration/<tenantId>/…`); featured images
// still go to UPLOADS_BUCKET.
const PRIVATE_BUCKET = process.env.PRIVATE_BUCKET;
const UPLOADS_CDN_URL = process.env.UPLOADS_CDN_URL;

interface ImportRequest {
    tenantId: string;
    wxrContent?: string;
    s3Key?: string;
    batchStart?: number;
    batchSize?: number;
    /** IMPORT-PATHS-1: write pages at their old addresses (+ redirects). Absent → on for a site with no imported page. */
    keepOldAddresses?: boolean;
}

interface ImportResponse {
    processedCount: number;
    createdCount: number;
    updatedCount: number;
    totalCount: number;
    nextBatchStart?: number;
    complete: boolean;
    errors?: string[];
    /** IMPORT-PATHS-1: answered when the request left the option out (the default this call decided). */
    keepOldAddresses?: false;
}

const _handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<AuthorizerContext> = async (event) => {
    try {
        const tenantId = event.headers['x-tenant-id'];
        if (!tenantId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing Tenant Context" })
            };
        }

        // BACKEND-CONTRACT-1 D4 (BC1-WP-AUTH): the API authorizer does not tie `x-tenant-id` to the
        // caller; requireRole authorises the caller for the target tenant — a TENANT_ADMIN or an EDITOR
        // (IMPORT-POLICY-1 D1; a token with no role counts as EDITOR, policy.ts) whose token tenant
        // equals the header, or a GLOBAL_ADMIN (passed with no tenant check). Same rule and 403 shape as
        // the sibling import/media.ts. It runs before any S3 read and any DynamoDB write, so it guards
        // the inline `wxrContent` path too.
        const auth = event.requestContext.authorizer.lambda;
        try {
            requireRole(auth, ["TENANT_ADMIN", "EDITOR"], tenantId);
        } catch (e: any) {
            return { statusCode: 403, body: JSON.stringify({ error: e.message }) };
        }

        const body: ImportRequest = JSON.parse(event.body || "{}");
        const { wxrContent, s3Key, batchStart = 0, batchSize = 100 } = body;

        // IMPORT-PATHS-1 (docs/slices/import-paths-1.md scope 2, ruling 3): `keepOldAddresses` absent → on for a site that
        // holds no imported page, off otherwise — decided on the first batch only. A later batch decided again would see
        // the pages of the first batch and switch to off in the middle of one import, so it must send the value.
        const keepSent = body.keepOldAddresses;
        if (keepSent !== undefined && typeof keepSent !== "boolean") {
            return { statusCode: 400, body: JSON.stringify({ error: "keepOldAddresses must be true or false" }) };
        }
        if (keepSent === undefined && batchStart > 0) {
            return { statusCode: 400, body: JSON.stringify({ error: "keepOldAddresses is required after the first batch: send the value the first batch answered" }) };
        }
        const dryRun = isDryRun(event);

        // Get content from either direct string or S3
        let content: string;
        if (s3Key) {
            // BACKEND-CONTRACT-1 D4, MIGRATION-UPLOAD-1: second half of key ownership, after the authorisation above —
            // the key must be this tenant's migration upload (`migration/<tenantId>/<uuid>-<name>`, POST
            // /import/upload-url), checked before any S3 call.
            console.log(`Reading WXR from S3: ${s3Key}`);
            const read = await readMigrationUpload(s3, PRIVATE_BUCKET, tenantId, s3Key);
            if (read.kind === "refused") return { statusCode: read.statusCode, body: JSON.stringify({ error: read.error }) };
            content = read.content;
        } else if (wxrContent) {
            content = wxrContent;
        } else {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Missing wxrContent or s3Key" })
            };
        }

        console.log(`Starting WordPress import for tenant ${tenantId}, batch ${batchStart}-${batchStart + batchSize}`);

        // MIGRATION-UPLOAD-1: one upload serves the check (dry run, every batch) and then the import (every batch). The
        // upload is deleted after the LAST batch of the import — never after a dry run, which the import still needs.
        const deleteUploadIfImportComplete = async (complete: boolean): Promise<void> => {
            if (s3Key && !dryRun && complete) await deleteMigrationUpload(s3, PRIVATE_BUCKET!, s3Key);
        };

        const keep = keepSent ?? !(await siteHoldsImportedPage(tenantId));
        if (dryRun || keep) {
            const answer = await importWithAddressReport({ tenantId, userId: auth.sub, content, keep, dryRun, batchStart, batchSize });
            await deleteUploadIfImportComplete(answer.complete);
            return answer.response;
        }

        // Option off: today's import, unchanged (golden: backend/test/unit/import-paths-1.test.ts IP1-GOLDEN-OPTION-OFF).
        // Load media URL map (from prior media import step)
        const mediaMap = await loadMediaMap(tenantId);
        console.log(`Loaded ${mediaMap.size} media URL mappings`);

        // Parse the WXR XML (IMPORT-PATHS-1: the products of the export are read only for their addresses — not here)
        const allPosts = (await parseWXR(content)).filter(isPost);
        const totalCount = allPosts.length;

        // Get the batch to process
        const postsToProcess = allPosts.slice(batchStart, batchStart + batchSize);
        const errors: string[] = [];
        let createdCount = 0;
        let updatedCount = 0;

        // Process each post
        for (let i = 0; i < postsToProcess.length; i++) {
            const post = postsToProcess[i];
            const itemIndex = batchStart + i;

            try {
                const wasUpdate = await processPost(tenantId, post, mediaMap);
                if (wasUpdate) {
                    updatedCount++;
                    console.log(`Updated item ${itemIndex + 1}/${totalCount}: ${post.title}`);
                } else {
                    createdCount++;
                    console.log(`Created item ${itemIndex + 1}/${totalCount}: ${post.title}`);
                }
            } catch (error: any) {
                const errorMsg = `Failed to process "${post.title}": ${error.message}`;
                console.error(errorMsg);
                errors.push(errorMsg);
            }
        }

        const processedCount = batchStart + postsToProcess.length;
        const complete = processedCount >= totalCount;
        const nextBatchStart = complete ? undefined : processedCount;

        const response: ImportResponse = {
            processedCount,
            createdCount,
            updatedCount,
            totalCount,
            nextBatchStart,
            complete,
            errors: errors.length > 0 ? errors : undefined,
            // The default was decided here: answer it, so a caller can send it with the next batch.
            ...(keepSent === undefined ? { keepOldAddresses: false } : {}),
        };

        await deleteUploadIfImportComplete(complete);
        return {
            statusCode: 200,
            body: JSON.stringify(response)
        };

    } catch (e: any) {
        console.error("WordPress import error:", e);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: e.message })
        };
    }
};

async function processPost(
    tenantId: string,
    post: WordPressPost,
    mediaMap: Map<string, string>,
): Promise<boolean> {
    // Build slug path - FLATTEN everything instead of keeping the blog
    const slugPath = `/${post.slug}`;

    // Check for existing content by slug
    const existing = await findContentBySlug(tenantId, slugPath);
    return (await writePage(tenantId, post, mediaMap, slugPath, existing, { kind: "today" })).isUpdate;
}

/**
 * How `writePage` writes (IMPORT-PATHS-1).
 *  - `today`: the option-off import, unchanged — content `Put` (conditioned only on the translation key, LANG-1A), then
 *    an unconditioned route `Put`, then the comments. Its bytes are the golden's.
 *  - `keeping`: the option-on import (review F-IP1-ATOMICITY, F-IP1-IDENTITY). Content and route are ONE
 *    `TransactWriteCommand`, each conditioned on what authorised the write: a new page → both items absent
 *    (`attribute_not_exists(SK)`); the same imported item → the content still has the translation key as read AND the
 *    same `wordpressSourceItem`, the route still names this node and is not a redirect. Either condition failing cancels
 *    both writes (`TransactionCanceledException`, nothing written). The content gets `wordpressSourceItem` when the
 *    item has one, and the export's attachment as its featured image (scope 4).
 */
type PageWriteMode = { kind: "today" } | { kind: "keeping"; sourceItem: string | undefined };

/**
 * Writes one page at `slugPath` (content LATEST, route, comments). `existing`: the page it overwrites (keeps its ids,
 * `createdAt` and translation key), or null for a new page. The body of today's `processPost`; IMPORT-PATHS-1 calls it
 * with the address of the plan and `mode` (above). In mode `keeping` it reports what it did (review-1
 * F-IP1-FAILURE-REPORT, every attempted side effect confirmed, failed without being applied, partial, or not
 * confirmed): the featured-image copy, and how many comment writes were confirmed; a transaction error other than a
 * cancellation throws `WriteNotConfirmed` (the write was sent, its result is unknown). In mode `today` it behaves as on
 * 30421e3 (a failed comment throws; a failed image copy is logged).
 */
interface PageWriteOutcome {
    isUpdate: boolean;
    image: { kind: "none" } | { kind: "copied"; url: string } | { kind: "not-copied"; source: string; error: string };
    /** `notWritten`: not prepared, nothing sent; `notConfirmed`: sent, rejected (may have been applied). */
    comments: { total: number; notWritten: number; notConfirmed: number; firstError?: string };
}
async function writePage(
    tenantId: string,
    post: WordPressPost,
    mediaMap: Map<string, string>,
    slugPath: string,
    existing: ExistingPage | null,
    mode: PageWriteMode,
): Promise<PageWriteOutcome> {
    const isUpdate = !!existing;

    // Use existing IDs for update, or generate new ones for create
    const nodeId = existing?.nodeId || crypto.randomUUID();
    const contentId = existing?.contentId || crypto.randomUUID();

    // 1. Rewrite image URLs in HTML content before converting
    let htmlContent = post.content;
    for (const [oldUrl, newUrl] of mediaMap) {
        // Replace full URLs and also resized variants (-NNNxNNN suffix)
        const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match the URL with optional -WIDTHxHEIGHT suffix before extension
        const baseWithoutExt = escaped.replace(/\\\.\w+$/, '');
        const ext = oldUrl.match(/\.\w+$/)?.[0] || '';
        const pattern = new RegExp(baseWithoutExt + '(?:-\\d+x\\d+)?' + ext.replace('.', '\\.'), 'g');
        htmlContent = htmlContent.replace(pattern, newUrl);
    }

    // 2. Convert HTML to Tiptap JSON (pass media map for URL rewriting)
    const converter = new HTMLToTiptapConverter(mediaMap);
    const { blocks } = converter.convert(htmlContent);

    // 3. Handle featured image (IMPORT-PATHS-1: with the option on, also the export's attachment — scope 4)
    let featuredImageUrl: string | undefined;
    let image: PageWriteOutcome["image"] = { kind: "none" };
    const featuredImageSource = mode.kind === "today" ? post.featuredImage : (post.featuredImage ?? post.featuredImageAttachmentUrl);
    if (featuredImageSource) {
        // Check media map first
        const mapped = mediaMap.get(featuredImageSource);
        if (mapped) {
            featuredImageUrl = mapped;
        } else if (UPLOADS_BUCKET && UPLOADS_CDN_URL) {
            try {
                featuredImageUrl = await downloadAndUploadImage(
                    tenantId, featuredImageSource, UPLOADS_BUCKET, UPLOADS_CDN_URL, "wordpress-importer",
                );
            } catch (error) {
                console.warn(`Failed to download featured image for "${post.title}":`, error);
                image = { kind: "not-copied", source: featuredImageSource, error: (error as any)?.message ?? String(error) };
            }
        } else {
            image = { kind: "not-copied", source: featuredImageSource, error: "the image is not in the media map (Step 1) and no upload target is configured" };
        }
        if (featuredImageUrl) image = { kind: "copied", url: featuredImageUrl };
    }

    // Map WordPress status to AMODX status
    const status = post.status === 'publish' ? 'Published' : 'Draft';

    // Determine Comments Mode
    const commentsMode = post.comments.length > 0 ? "Enabled" : "Hidden";

    // Preserve original createdAt for updates
    const createdAt = existing?.createdAt || post.publishedAt || new Date().toISOString();

    // LANG-1A (docs/slices/lang-1.md § 6.3): the importer writes no new set key. When it overwrites an existing page it
    // copies the page's `translationKey` and conditions the Put on the key as read (`translationKey = :readKey`, or
    // `attribute_not_exists(translationKey)` when it read none), so a link made since the read is not lost: the Put
    // fails and this post is reported failed like any other. A new page: no key, no condition (as before).
    const keyCondition: { ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> } = !existing
        ? {}
        : existing.translationKey === undefined
            ? { ConditionExpression: "attribute_not_exists(translationKey)" }
            : { ConditionExpression: "translationKey = :readKey", ExpressionAttributeValues: { ":readKey": existing.translationKey } };
    const contentItem = {
        ...(existing && existing.translationKey !== undefined ? { translationKey: existing.translationKey } : {}),
        PK: `TENANT#${tenantId}`,
        SK: `CONTENT#${nodeId}#LATEST`,
        id: contentId,
        nodeId,
        slug: slugPath,
        title: post.title,
        status,
        version: 1,
        author: IMPORTER_AUTHOR,
        createdAt,
        updatedAt: new Date().toISOString(),
        Type: "Page",
        blocks,
        featuredImage: featuredImageUrl,
        commentsMode: commentsMode,
        ...(mode.kind === "keeping" && mode.sourceItem !== undefined ? { wordpressSourceItem: mode.sourceItem } : {}),
    };
    const routeItem = {
        PK: `TENANT#${tenantId}`,
        SK: `ROUTE#${slugPath}`,
        TargetNode: `NODE#${nodeId}`,
        createdAt: new Date().toISOString(),
        Type: "Route"
    };

    switch (mode.kind) {
        case "today":
            await db.send(new PutCommand({
                ...keyCondition,
                TableName: TABLE_NAME,
                Item: contentItem,
            }));

            // 5. Create route record
            await db.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: routeItem,
            }));
            break;
        case "keeping": {
            const content = !existing
                ? { ConditionExpression: "attribute_not_exists(SK)" }
                : {
                    ConditionExpression: `${keyCondition.ConditionExpression} AND wordpressSourceItem = :readSource`,
                    ExpressionAttributeValues: { ...(keyCondition.ExpressionAttributeValues ?? {}), ":readSource": existing.sourceItem },
                };
            const route = !existing
                ? { ConditionExpression: "attribute_not_exists(SK)" }
                : { ConditionExpression: "TargetNode = :node AND attribute_not_exists(IsRedirect)", ExpressionAttributeValues: { ":node": `NODE#${nodeId}` } };
            try {
                await db.send(new TransactWriteCommand({
                    TransactItems: [
                        { Put: { TableName: TABLE_NAME, Item: contentItem, ...content } },
                        { Put: { TableName: TABLE_NAME, Item: routeItem, ...route } },
                    ],
                }));
            } catch (error: any) {
                // A cancellation is the database's answer that it applied nothing; any other error leaves it unknown.
                if (error?.name === "TransactionCanceledException") throw error;
                throw new WriteNotConfirmed(error?.message ?? String(error));
            }
            break;
        }
    }

    // 6. PROCESS COMMENTS
    const comments: PageWriteOutcome["comments"] = { total: post.comments.length, notWritten: 0, notConfirmed: 0 };
    const commentItem = (c: WordPressPost["comments"][number]) => {
        const commentId = crypto.randomUUID();
        const commentDate = c.date ? new Date(c.date).toISOString() : new Date().toISOString();
        return {
            PK: `TENANT#${tenantId}`,
            SK: `COMMENT#${nodeId}#${commentDate}`,
            id: commentId,
            tenantId,
            pageId: nodeId,
            authorName: c.author || "Anonymous",
            authorEmail: c.email || "unknown@example.com",
            authorImage: "",
            content: c.content,
            status: c.approved ? "Approved" : "Pending",
            createdAt: commentDate,
            Type: "Comment"
        };
    };
    if (post.comments.length > 0) {
        console.log(`Importing ${post.comments.length} comments for ${post.title}`);

        switch (mode.kind) {
            case "today": {
                // 30421e3: one map, one Promise.all — a comment that cannot be prepared or written fails the post.
                const commentPromises = post.comments.map(c => db.send(new PutCommand({
                    TableName: TABLE_NAME,
                    Item: commentItem(c),
                })));
                await Promise.all(commentPromises);
                break;
            }
            case "keeping": {
                // The page is COMMITTED here (review-2 F-IP1-FAILURE-REPORT): nothing below may throw out of writePage,
                // so whatever does leave it happened before the transaction (or is its cancellation / WriteNotConfirmed).
                // A comment that cannot be prepared (an unparseable date) is NOT written — known, nothing was sent; a write
                // that rejects is NOT CONFIRMED (it may have been applied). Every write already started is awaited.
                const started: Promise<unknown>[] = [];
                const note = (error: unknown) => { comments.firstError ??= (error as any)?.message ?? String(error); };
                for (const c of post.comments) {
                    let item: ReturnType<typeof commentItem>;
                    try {
                        item = commentItem(c);
                    } catch (error) {
                        comments.notWritten++;
                        note(error);
                        continue;
                    }
                    try {
                        started.push(db.send(new PutCommand({ TableName: TABLE_NAME, Item: item })));
                    } catch (error) {
                        comments.notConfirmed++;   // thrown while sending: whether it was applied is unknown
                        note(error);
                    }
                }
                for (const result of await Promise.allSettled(started)) {
                    if (result.status === "rejected") {
                        comments.notConfirmed++;
                        note(result.reason);
                    }
                }
                break;
            }
        }
    }
    console.log(`${isUpdate ? 'Updated' : 'Created'} content and route for "${post.title}" at ${slugPath}`);
    return { isUpdate, image, comments };
}

/** The `author` of every page this importer writes. IMPORT-PATHS-1: also "the site holds an imported page" (default). */
const IMPORTER_AUTHOR = "wordpress-importer";

/** The page transaction was sent and its result is unknown (an error that is not the database's cancellation). */
class WriteNotConfirmed extends Error {}

/**
 * IMPORT-PATHS-1 (operator ruling IP1-ITEM-IDENTITY = A): the source identity of a WordPress item — the export's site
 * host and the item's `wp:post_id` — as `wordpress:<host>/<post id>`, stored on an option-on page as
 * `wordpressSourceItem`. Same string form as the products' `importSource` (`glam:<producer>/<sheet>`), finer grain:
 * `importSource` names the uploaded SET a product came from, this names the ONE item a page came from. Undefined
 * when the export gives no host or the item no id: such an item can create a page, never replace one.
 */
function sourceItemOf(item: { sourceHost?: string; wpId?: string }): string | undefined {
    return item.sourceHost && item.wpId ? `wordpress:${item.sourceHost}/${item.wpId}` : undefined;
}

const isPost = (item: WordPressPost | WordPressProduct): item is WordPressPost => item.postType !== "product";

/** `POST /import/wordpress?dryRun=1` — the address report only (as glam-pricelist.ts). */
const isDryRun = (event: { queryStringParameters?: Record<string, string | undefined> }) => event.queryStringParameters?.dryRun === "1";

// ── IMPORT-PATHS-1: the import that keeps the old addresses, and the dry run of either mode ─────────────────────────────

/**
 * One row of the address report — the dry run's list, and the import's record of what it did. A DTO: plain JSON, the
 * admin renders it (admin/src/lib/wpAddressReport.ts). In a dry run nothing is written: `write` and
 * `redirect.kind: "write"` say what the import would do. EVERY item of the batch has exactly one row (review
 * F-IP1-FAILURE-REPORT): a failed read or write is a `failed` result, never a missing row.
 */
type Placed = Extract<Placement, { kind: "kept" | "parent" | "flat" | "moved" }>;
export type PageResult =
    | (Placed & { write: "create" | "update" })
    | Extract<Placement, { kind: "refused-taken" | "refused-blocked" }>
    // The site holds the address with something the import may not replace: a page whose `wordpressSourceItem` is not
    // this item's (`source`: the page's value, null when it has none), a redirect, or another route.
    | { kind: "refused-site"; address: string; holder: "page"; source: string | null }
    | { kind: "refused-site"; address: string; holder: "redirect" | "route" }
    | { kind: "today"; address: string; write: "create" | "update" }   // option off: today's address
    | { kind: "failed"; address: string; error: string }               // CONFIRMED: nothing of the page was written
    | { kind: "unconfirmed"; address: string; error: string };         // the write was sent; its result is unknown
export type RedirectResult =
    | Exclude<RedirectPlan, { kind: "planned" }>
    | { kind: "write"; from: string; to: string }   // written (dry run: to be written)
    | { kind: "present"; from: string; to: string } // the same redirect is there already (a second run)
    | { kind: "taken-on-site"; from: string }       // a page, a route or another redirect of the site holds `from`
    | { kind: "no-target"; from: string }          // nothing public to point to (refused, failed, product not found)
    | { kind: "not-attempted"; from: string; to: string }               // the page write is not confirmed
    | { kind: "failed"; from: string; to: string; error: string }       // CONFIRMED not written (failed before the write)
    | { kind: "unconfirmed"; from: string; to: string; error: string }; // the write was sent; its result is unknown
export type ProductResult =
    | { kind: "found"; address: string }
    | { kind: "unavailable"; address: string; reason: string }   // the product page would answer 404 (F-IP1-PRODUCT-TARGET)
    | { kind: "unreachable"; address: string; reason: string }   // the address does not show this product (review-1)
    | { kind: "not-found"; tried: string[] }
    | { kind: "failed"; error: string };
export type FeaturedImageResult =
    | { kind: "none" }
    | { kind: "from-export"; url: string }                 // dry run: the import will copy it
    | { kind: "missing"; id: string }                      // the export does not hold that attachment
    | { kind: "copied"; url: string }                      // the page has it
    | { kind: "not-copied"; url: string; error: string };  // the page is written without it
export type AddressRow =
    | {
        item: "page" | "post"; title: string; oldAddress: OldAddress; page: PageResult; redirect: RedirectResult;
        featuredImage: FeaturedImageResult;
        commentsError?: string;   // the page was written; some comment writes are not confirmed
    }
    | { item: "product"; title: string; oldAddress: OldAddress; product: ProductResult; redirect: RedirectResult };

interface ReportContext {
    tenantId: string;
    userId: string;
    dryRun: boolean;
    mediaMap: Map<string, string>;
    reserved: ReservedAddresses;
    errors: string[];
}

/** True when the site holds a page this importer wrote (a LATEST with its `author`). Paginated Query, projected. */
async function siteHoldsImportedPage(tenantId: string): Promise<boolean> {
    let start: Record<string, any> | undefined;
    do {
        const page = await db.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "CONTENT#" },
            ProjectionExpression: "SK, #author",
            ExpressionAttributeNames: { "#author": "author" },
            ExclusiveStartKey: start,
        }));
        if ((page.Items ?? []).some((i) => String(i.SK).endsWith("#LATEST") && i.author === IMPORTER_AUTHOR)) return true;
        start = page.LastEvaluatedKey;
    } while (start);
    return false;
}

/** What holds `ROUTE#<address>`: nothing, a page (with the record `findContentBySlug` reads), a redirect, or a route of neither kind. */
type RouteAt =
    | { kind: "none" }
    | { kind: "page"; existing: ExistingPage }
    | { kind: "redirect"; to: unknown }
    | { kind: "route" };

async function routeAt(tenantId: string, address: string): Promise<RouteAt> {
    const route = (await db.send(new GetCommand({ TableName: TABLE_NAME, Key: { PK: `TENANT#${tenantId}`, SK: `ROUTE#${address}` } }))).Item;
    if (!route) return { kind: "none" };
    // The renderer's test (renderer/src/lib/dynamo.ts `getContentBySlug`): a truthy `IsRedirect` is a redirect.
    if (route.IsRedirect) return { kind: "redirect", to: route.RedirectTo };
    if (typeof route.TargetNode === "string" && route.TargetNode !== "") {
        const existing = await findContentByNode(tenantId, route.TargetNode.replace("NODE#", ""));
        if (existing) return { kind: "page", existing };
    }
    return { kind: "route" };
}

/**
 * A planned redirect `from` → `to`: written when `ROUTE#<from>` is free (create only), kept when it is already the
 * same. A read or write failure is the row's `failed` redirect (the page, if written, stays reported as written).
 */
async function settleRedirect(ctx: ReportContext, from: string, to: string): Promise<RedirectResult> {
    let sent = false;
    try {
        const at = await routeAt(ctx.tenantId, from);
        if (at.kind === "redirect" && at.to === to) return { kind: "present", from, to };
        if (at.kind !== "none") return { kind: "taken-on-site", from };
        if (ctx.dryRun) return { kind: "write", from, to };
        sent = true;
        await db.send(new PutCommand({
            TableName: TABLE_NAME,
            Item: redirectRouteItem(ctx.tenantId, from, to, new Date().toISOString(), ctx.userId),
            ConditionExpression: "attribute_not_exists(SK)",
        }));
        return { kind: "write", from, to };
    } catch (e: any) {
        if (e?.name === "ConditionalCheckFailedException") return { kind: "taken-on-site", from };
        const error = e?.message ?? String(e);
        if (!sent) {
            ctx.errors.push(`Redirect ${from} → ${to} not written: ${error}`);
            return { kind: "failed", from, to, error };
        }
        ctx.errors.push(`Redirect ${from} → ${to} not confirmed: ${error}`);
        return { kind: "unconfirmed", from, to, error };
    }
}

/**
 * The old address's outcome when this item's page is not at its planned address (refused by the site, or failed):
 * a planned redirect has nothing to point to, and an old address that WAS the planned address is lost too.
 */
function withoutTarget(plan: RedirectPlan, old: OldAddress): RedirectResult {
    switch (plan.kind) {
        case "planned": return { kind: "no-target", from: plan.from };
        case "none": return old.kind === "path" ? { kind: "no-target", from: old.path } : plan;
        case "cannot-redirect": return plan;
        case "taken-in-export": return plan;
        case "no-target": return plan;
    }
}

function featuredImageOf(post: WordPressPost): FeaturedImageResult {
    const url = post.featuredImage ?? post.featuredImageAttachmentUrl;
    if (url) return { kind: "from-export", url };
    if (post.featuredImageId) return { kind: "missing", id: post.featuredImageId };
    return { kind: "none" };
}

/**
 * A page of the plan: the site check, the write, the redirect. Ruling 5 with IP1-ITEM-IDENTITY = A: a page that holds
 * the address is replaced only when its `wordpressSourceItem` equals this item's (`sourceItemOf`); a page without one
 * (made in the admin, or imported flat or before this slice) or with another one is never replaced. The write itself
 * is conditioned on the same state (writePage `keeping`), so a change between this check and the write cancels it.
 */
async function pageRow(plan: Extract<ItemPlan, { item: WordPressPost }>, ctx: ReportContext): Promise<AddressRow> {
    const post = plan.item;
    const base = { item: post.postType, title: post.title, oldAddress: plan.old, featuredImage: featuredImageOf(post) };
    const placement = plan.placement;
    switch (placement.kind) {
        case "refused-taken":
        case "refused-blocked":
            return { ...base, page: placement, redirect: withoutTarget(plan.redirect, plan.old) };
        case "kept":
        case "parent":
        case "flat":
        case "moved":
            break;
    }
    const address = placement.address;
    const failed = (error: string): AddressRow => {
        ctx.errors.push(`Failed to process "${post.title}": ${error}`);
        return { ...base, page: { kind: "failed", address, error }, redirect: withoutTarget(plan.redirect, plan.old) };
    };
    const sourceItem = sourceItemOf(post);
    let site: RouteAt;
    try {
        site = await routeAt(ctx.tenantId, address);
    } catch (e: any) {
        return failed(`the site could not be read at ${address}: ${e?.message ?? String(e)}`);
    }
    let existing: ExistingPage | null = null;
    switch (site.kind) {
        case "none":
            break;
        case "page":
            if (sourceItem === undefined || site.existing.sourceItem !== sourceItem) {
                const source = typeof site.existing.sourceItem === "string" ? site.existing.sourceItem : null;
                return { ...base, page: { kind: "refused-site", address, holder: "page", source }, redirect: withoutTarget(plan.redirect, plan.old) };
            }
            existing = site.existing;
            break;
        case "redirect":
            return { ...base, page: { kind: "refused-site", address, holder: "redirect" }, redirect: withoutTarget(plan.redirect, plan.old) };
        case "route":
            return { ...base, page: { kind: "refused-site", address, holder: "route" }, redirect: withoutTarget(plan.redirect, plan.old) };
    }
    const write = existing ? "update" : "create";
    if (ctx.dryRun) {
        const redirect = plan.redirect.kind === "planned" ? await settleRedirect(ctx, plan.redirect.from, address) : plan.redirect;
        return { ...base, page: { ...placement, write }, redirect };
    }
    let outcome: PageWriteOutcome;
    try {
        outcome = await writePage(ctx.tenantId, post, ctx.mediaMap, address, existing, { kind: "keeping", sourceItem });
    } catch (e: any) {
        if (e instanceof WriteNotConfirmed) {
            ctx.errors.push(`The page "${post.title}" at ${address} is not confirmed: ${e.message}`);
            const redirect: RedirectResult = plan.redirect.kind === "planned" ? { kind: "not-attempted", from: plan.redirect.from, to: address } : plan.redirect;
            return { ...base, page: { kind: "unconfirmed", address, error: e.message }, redirect };
        }
        if (e?.name === "TransactionCanceledException") {
            return failed(`the address or the page changed between the check and the write; the database applied nothing`);
        }
        // By construction of writePage `keeping` (nothing after the commit leaves it), any other error was thrown BEFORE
        // the transaction was sent (content conversion, the image copy step): no page write was made.
        return failed(e?.message ?? String(e));
    }
    let featuredImage: FeaturedImageResult = base.featuredImage;
    switch (outcome.image.kind) {
        case "none": break;
        case "copied": featuredImage = { kind: "copied", url: outcome.image.url }; break;
        case "not-copied":
            featuredImage = { kind: "not-copied", url: outcome.image.source, error: outcome.image.error };
            ctx.errors.push(`The featured image of "${post.title}" was not copied: ${outcome.image.error}`);
            break;
    }
    let commentsError: string | undefined;
    const c = outcome.comments;
    if (c.notWritten > 0 || c.notConfirmed > 0) {
        const parts = [
            ...(c.notWritten > 0 ? [`${c.notWritten} of ${c.total} comments not written`] : []),
            ...(c.notConfirmed > 0 ? [`${c.notConfirmed} of ${c.total} comment writes not confirmed`] : []),
        ];
        commentsError = `${parts.join(", ")}: ${c.firstError}`;
        ctx.errors.push(`Comments of "${post.title}": ${commentsError}`);
    }
    const redirect = plan.redirect.kind === "planned" ? await settleRedirect(ctx, plan.redirect.from, address) : plan.redirect;
    return { ...base, featuredImage, page: { ...placement, write }, redirect, ...(commentsError !== undefined ? { commentsError } : {}) };
}

/**
 * Why the product page would not answer (review F-IP1-PRODUCT-TARGET), or null when it answers: the renderer's rules
 * (SitePage.tsx:395-401: a product that is not `active` is not found; dynamo.ts `getProductBySlug`: outside its
 * availability dates it is not found — the same `isProductAvailable` rule as backend/src/lib/availability.ts).
 */
function unavailableReason(product: any): string | null {
    if (product.status !== "active") return `the product is not active (status: ${String(product.status ?? "none")}), so its page answers 404`;
    if (!isProductAvailable(product)) return `the product is outside its availability dates (${product.availableFrom ?? "…"} – ${product.availableUntil ?? "…"}), so its page answers 404`;
    return null;
}

/**
 * A product of the export (scope 5): its page on the site is `<product prefix>/<slug>`, the slug as the WooCommerce
 * import stores it (woocommerce.ts: the `Slug` cell, else `slugify(Name)`): tried as the post name (raw, decoded) and
 * as `slugify(title)`, through this tenant's products only (product-slug.ts). Found, public, and at another address
 * than the old one → a redirect from the old one.
 */
async function productRow(plan: Extract<ItemPlan, { item: WordPressProduct }>, ctx: ReportContext): Promise<AddressRow> {
    const product = plan.item;
    const base = { item: "product" as const, title: product.title, oldAddress: plan.old };
    const claimed = plan.claimed;
    const noTarget: RedirectResult = claimed.kind === "claimed" ? { kind: "no-target", from: claimed.from } : claimed;
    const name = String(product.slug);
    const tried = [...new Set([name, decodeSegment(name), slugify(product.title)])].filter((s) => s !== "");
    let found: any = null;
    try {
        for (const slug of tried) {
            found = await findProductBySlug(ctx.tenantId, slug);
            if (found) break;
        }
    } catch (e: any) {
        const error = e?.message ?? String(e);
        ctx.errors.push(`Product "${product.title}" could not be looked up: ${error}`);
        return { ...base, product: { kind: "failed", error }, redirect: noTarget };
    }
    if (!found) return { ...base, product: { kind: "not-found", tried }, redirect: noTarget };
    const address = `${ctx.reserved.prefixes.product}/${found.slug}`;
    const reason = unavailableReason(found);
    if (reason) return { ...base, product: { kind: "unavailable", address, reason }, redirect: noTarget };
    const unreachable = productPageProblem(address, String(found.slug), ctx.reserved);
    if (unreachable) return { ...base, product: { kind: "unreachable", address, reason: unreachable }, redirect: noTarget };
    const result: ProductResult = { kind: "found", address };
    if (plan.old.kind === "path" && plan.old.path === address) return { ...base, product: result, redirect: { kind: "none" } };
    switch (claimed.kind) {
        case "claimed":
            return { ...base, product: result, redirect: await settleRedirect(ctx, claimed.from, address) };
        case "none":
        case "cannot-redirect":
        case "taken-in-export":
            return { ...base, product: result, redirect: claimed };
    }
}

/**
 * The row of an item whose processing threw outside the steps above (a last guard: every item keeps its row). In a dry
 * run nothing is written, so the page is `failed`; in an import the guard cannot know how far the item got, so the
 * page is `unconfirmed` (review-1: missing confirmation is never reported as certainty).
 */
function failedRow(plan: ItemPlan, error: string, dryRun: boolean): AddressRow {
    if (plan.item.postType === "product") {
        const claimed = (plan as Extract<ItemPlan, { item: WordPressProduct }>).claimed;
        return {
            item: "product", title: plan.item.title, oldAddress: plan.old, product: { kind: "failed", error },
            redirect: claimed.kind === "claimed" ? { kind: "no-target", from: claimed.from } : claimed,
        };
    }
    const page = plan as Extract<ItemPlan, { item: WordPressPost }>;
    const address = pageAddressOf(page.placement) ?? "";
    return {
        item: page.item.postType, title: page.item.title, oldAddress: page.old, featuredImage: featuredImageOf(page.item),
        page: dryRun ? { kind: "failed", address, error } : { kind: "unconfirmed", address, error }, redirect: withoutTarget(page.redirect, page.old),
    };
}

/**
 * The import with `keepOldAddresses` on, and the dry run of either mode: one batch of the export's items (export
 * order; with the option on the products count too), each with its row. The plan is made over the WHOLE export on
 * every batch (deterministic), so the first item keeps an address whichever batch it is in.
 */
async function importWithAddressReport(args: {
    tenantId: string; userId: string; content: string; keep: boolean; dryRun: boolean; batchStart: number; batchSize: number;
}) {
    const { tenantId, userId, content, keep, dryRun, batchStart, batchSize } = args;
    const mediaMap = dryRun ? new Map<string, string>() : await loadMediaMap(tenantId);
    const items = await parseWXR(content);
    const reserved = keep ? await readReservedAddresses(tenantId) : null;
    // The option-off dry run reads no reserved addresses: its rows never use them.
    const ctx: ReportContext = { tenantId, userId, dryRun, mediaMap, reserved: reserved ?? { prefixes: urlPrefixesOf(undefined), catalog: false }, errors: [] };

    const rows: AddressRow[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    const count = (row: AddressRow): void => {
        if (row.item === "product") return;
        const page = row.page;
        switch (page.kind) {
            case "kept": case "parent": case "flat": case "moved": case "today":
                if (page.write === "create") createdCount++; else updatedCount++;
                return;
            case "refused-taken": case "refused-blocked": case "refused-site": case "failed": case "unconfirmed":
                return;
        }
    };

    let totalCount: number;
    let batchLength: number;
    let plans: ItemPlan[] = [];
    if (reserved) {
        plans = planAddresses(items, reserved);
        totalCount = plans.length;
        const batch = plans.slice(batchStart, batchStart + batchSize);
        batchLength = batch.length;
        for (const plan of batch) {
            let row: AddressRow;
            try {
                row = plan.item.postType === "product"
                    ? await productRow(plan as Extract<ItemPlan, { item: WordPressProduct }>, ctx)
                    : await pageRow(plan as Extract<ItemPlan, { item: WordPressPost }>, ctx);
            } catch (error: any) {
                ctx.errors.push(`Failed to process "${plan.item.title}": ${error?.message ?? String(error)}`);
                row = failedRow(plan, error?.message ?? String(error), dryRun);
            }
            count(row);
            rows.push(row);
        }
    } else {
        // A dry run with the option off: today's addresses (`/<post name>`, matched by slug, wordpress.ts processPost).
        const posts = items.filter(isPost);
        totalCount = posts.length;
        const batch = posts.slice(batchStart, batchStart + batchSize);
        batchLength = batch.length;
        for (const post of batch) {
            const address = `/${post.slug}`;
            const base = { item: post.postType, title: post.title, oldAddress: oldAddressOf(post.link), featuredImage: { kind: "none" } as FeaturedImageResult, redirect: { kind: "none" } as RedirectResult };
            let row: AddressRow;
            try {
                const existing = await findContentBySlug(tenantId, address);
                row = { ...base, page: { kind: "today", address, write: existing ? "update" : "create" } };
            } catch (error: any) {
                ctx.errors.push(`Failed to process "${post.title}": ${error?.message ?? String(error)}`);
                row = { ...base, page: { kind: "failed", address, error: error?.message ?? String(error) } };
            }
            count(row);
            rows.push(row);
        }
    }

    const processedCount = batchStart + batchLength;   // as today's import
    const complete = processedCount >= totalCount;
    return { complete, response: {
        statusCode: 200,
        body: JSON.stringify({
            processedCount,
            createdCount,
            updatedCount,
            totalCount,
            nextBatchStart: complete ? undefined : processedCount,
            complete,
            errors: ctx.errors.length > 0 ? ctx.errors : undefined,
            keepOldAddresses: keep,
            ...(dryRun ? { dryRun: true } : {}),
            ...(dryRun && reserved ? { productAddresses: { site: reserved.prefixes.product, old: oldProductPrefixes(plans) } } : {}),
            rows,
        }),
    } };
}

// Dry runs write nothing — not even the CDN marker that `withInvalidation` writes after a 2xx answer, nor the purge of
// the tenant's stored pages it runs before it (BULK-PURGE-FOOTER-1 rule A6; as glam-pricelist.ts).
const invalidating = withInvalidation(_handler, purgeStoredPagesOfRequestTenant);
export const handler: typeof _handler = (event, context, callback) =>
    isDryRun(event) ? _handler(event, context, callback) : invalidating(event, context, callback);
