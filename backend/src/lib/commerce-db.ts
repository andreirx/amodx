import { TABLE_NAME } from "./db.js";

/**
 * CMRC-1A (docs/slices/cmrc-1a.md; docs/slices/cmrc-1.md § 5.5; PROTOTYPE) — the only RUNTIME code (`backend/src`,
 * `renderer/src`, `packages/<name>/src`) that writes the commerce-private key prefixes and that chooses the table of
 * those items: the 15 handler sites S1-S15 and the three renderer-key reads of `customers/self-service.ts` take both
 * from here.
 *
 * The public renderer names none of these keys since CMRC-1L (docs/slices/cmrc-1l.md): its three reads (S16
 * `getOrderForCustomer`, S17 `getCustomerOrders`, S18 `getCustomerProfile`) now ask `customers/self-service.ts`
 * (CMRC-1B removed S17 and S18, CMRC-1L removed S16).
 *
 * NOT true for the whole repository. Still outside this module: the operational copy tool
 * `scripts/migrate-commerce-private-table.ts` (S19) keeps its own list of the prefixes and takes its table names from
 * its arguments. `cmrc-2` makes it import the list below.
 *
 * Why: Track B moves these items out of the main table, which the public renderer can read (docs/VISION.md,
 * guarantee 2). That move is now a change of ONE binding below (`COMMERCE_TABLE`), not of every handler. The storage
 * may move only when no runtime reader or writer names the main table for these items (cutover gate, cmrc-1.md § 6):
 * a reader that still names it would keep reading the old copy. The renderer's IAM role can still read all four
 * families in the main table until the data has moved (`cmrc-4`) and the old items are removed (`cmrc-6`).
 *
 * What it gives: LOCATED REFERENCES. A reference carries the table and the key in one value, so a caller cannot name
 * a key without its table. The handler still builds its own command and spreads the reference into it:
 *
 *   new GetCommand(orderRef(tenantId, id))
 *   new UpdateCommand({ ...orderRef(tenantId, id), UpdateExpression: "…", … })
 *   { Put: { TableName: ref.TableName, Item: { ...ref.Key, …attributes } } }            // a transaction Put
 *   new QueryCommand({ ...ordersQuery(tenantId), ProjectionExpression: "…", … })
 *
 * A handler that adds its own expression values to a query merges them AFTER the reference's:
 *   ExpressionAttributeValues: { ...query.ExpressionAttributeValues, ":x": value }
 *
 * Rules:
 *  - No I/O. Every function is pure: strings in, a plain object out. Reads, writes and error handling stay in the
 *    handlers. A reference cannot fail, so nothing here returns a Result.
 *  - Inputs are used as given. A caller passes `normalizeEmail()` output for an email (PD-001), as it did before this
 *    module existed. The module does not normalize: one place holds that rule, the caller.
 *  - Tenant isolation: the partition key is always `TENANT#<tenantId>` of the tenant id the caller passes.
 *  - No scan: only `Key` values and `PK = :pk AND begins_with(SK, :sk)` key conditions.
 *  - This module and `scheduling-db.ts` do not import each other (two release paths).
 *
 * The guard: `test/unit/cmrc-1-key-ownership.test.ts` parses the source files under `backend/src`, `renderer/src`
 * and `packages/<name>/src` and fails when a string literal or template text of a file other than this one contains
 * one of `COMMERCE_PRIVATE_PREFIXES` — with no exception since CMRC-1L. It does not read `scripts/`, tests,
 * `admin/`, `tools/` or `infra/`, and it cannot see a prefix joined from parts at run time. The command trace `test/unit/cmrc-1-command-trace.test.ts` pins the commands that the backend handlers
 * build from these references.
 */

// CMRC-1A: the main table. `cmrc-4` replaces this ONE binding — the backend's only choice of this table — with a
// required COMMERCE_TABLE_NAME (no fallback: a fallback would let a missing variable read the main table in silence
// after the cutover).
const COMMERCE_TABLE = TABLE_NAME;

const ORDER = "ORDER#";
const CUSTOMER_ORDER = "CUSTORDER#";
const CUSTOMER = "CUSTOMER#";
const ORDER_COUNTER = "COUNTER#ORDER";

/**
 * Every key prefix this module owns. The key-ownership test refuses each of them outside this file; the copy tool of
 * `cmrc-2` imports the same list. A new commerce-private kind is added here, with its reference function.
 */
export const COMMERCE_PRIVATE_PREFIXES = [ORDER, CUSTOMER_ORDER, CUSTOMER, ORDER_COUNTER] as const;

/** The table and the full key of one item: the input of a GetItem, the start of an UpdateItem. */
type ItemRef = { TableName: string; Key: { PK: string; SK: string } };

/** The table and the key condition of every item of one tenant whose sort key starts with a prefix. */
type PrefixQuery = {
    TableName: string;
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)";
    ExpressionAttributeValues: { ":pk": string; ":sk": string };
};

const itemRef = (tenantId: string, sk: string): ItemRef => ({ TableName: COMMERCE_TABLE, Key: { PK: `TENANT#${tenantId}`, SK: sk } });

const prefixQuery = (tenantId: string, skPrefix: string): PrefixQuery => ({
    TableName: COMMERCE_TABLE,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
    ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": skPrefix },
});

/** One order: `ORDER#<orderId>`. */
export const orderRef = (tenantId: string, orderId: string): ItemRef => itemRef(tenantId, `${ORDER}${orderId}`);

/** One customer profile: `CUSTOMER#<normalizedEmail>`. */
export const customerRef = (tenantId: string, normalizedEmail: string): ItemRef => itemRef(tenantId, `${CUSTOMER}${normalizedEmail}`);

/** One row of the email → order index: `CUSTORDER#<normalizedEmail>#<orderId>`. */
export const customerOrderRef = (tenantId: string, normalizedEmail: string, orderId: string): ItemRef =>
    itemRef(tenantId, `${CUSTOMER_ORDER}${normalizedEmail}#${orderId}`);

/** The tenant's order-number counter: `COUNTER#ORDER`. */
export const orderCounterRef = (tenantId: string): ItemRef => itemRef(tenantId, ORDER_COUNTER);

/** Every order of the tenant. */
export const ordersQuery = (tenantId: string): PrefixQuery => prefixQuery(tenantId, ORDER);

/** Every customer profile of the tenant. */
export const customersQuery = (tenantId: string): PrefixQuery => prefixQuery(tenantId, CUSTOMER);

/** Every index row of one customer: `CUSTORDER#<normalizedEmail>#…`. */
export const customerOrdersQuery = (tenantId: string, normalizedEmail: string): PrefixQuery =>
    prefixQuery(tenantId, `${CUSTOMER_ORDER}${normalizedEmail}#`);

/**
 * The order id of one row of the email → order index: the text after the last `#` of its sort key
 * (`CUSTORDER#<normalizedEmail>#<orderId>` → `<orderId>`). The inverse of `customerOrderRef` for the order id. A sort
 * key without `#` is returned whole. (CMRC-1B: the rule the renderer's `getCustomerOrders` applied before the read
 * moved to `customers/self-service.ts`.)
 */
export const orderIdOfCustomerOrder = (sk: string): string => sk.slice(sk.lastIndexOf("#") + 1);
