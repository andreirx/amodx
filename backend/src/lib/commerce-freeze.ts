import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

/**
 * CMRC-2B (docs/slices/cmrc-2b.md; docs/slices/cmrc-1.md § 6 "The write freeze"; PROTOTYPE) — the commerce write freeze.
 *
 * Why: Track B copies the commerce-private items (orders, the email → order index, customer profiles, the order
 * counter) into `AmodxCommerceTable`. The copy is provably equal only if nothing writes these items between the copy
 * and the cutover. The deploy-time variable `COMMERCE_WRITE_FREEZE_TENANTS` names the tenants being copied; each of
 * the five runtime writers of these items (W1 `orders/create.ts`, W2 `orders/update-status.ts`, W3 `orders/update.ts`,
 * W4 `customers/update.ts`, W5 `customers/public-update.ts`) calls `commerceWriteFreezeRefusal` once, before its first
 * I/O call of any kind, and returns its answer when there is one. Readers never call it.
 *
 * The variable is on those five functions only (`infra/lib/api-commerce.ts`). Absent or empty: no tenant is frozen.
 *
 * This module is a sibling of `commerce-db.ts`, not part of it: `commerce-db.ts` is pure (strings in, objects out);
 * `commerceWriteFreezeRefusal` reads the environment and logs. `parseCommerceWriteFreeze` is pure. The two modules do
 * not import each other.
 */

/** The text of the 503 answer. The admin shows it after "API Error (503): "; the checkout shows it as sent. */
export const COMMERCE_FROZEN_TEXT = "Orders are paused for a short maintenance. Try again in a few minutes.";

/** What the variable says. `unreadable`: every tenant is frozen (fail closed, docs/slices/cmrc-2b.md D3). */
export type CommerceWriteFreeze =
    | { kind: "none" }
    | { kind: "tenants"; tenantIds: ReadonlySet<string> }
    | { kind: "unreadable"; entries: string[] };

// After the trim, these characters inside an entry are the signs of a wrong separator or of a quoting mistake.
const UNREADABLE_ENTRY = /[\s;"'`]/;

/**
 * The list of the variable. Rules: absent or empty → `none`; split on `,`; spaces and tabs around an entry are removed;
 * empty entries are dropped (only separators and spaces → `none`); an entry that still holds whitespace, `;`, `"`, `'`
 * or `` ` `` makes the whole list `unreadable` (those entries are returned, for the log). Tenant ids are compared
 * exactly, with no case folding.
 */
export function parseCommerceWriteFreeze(listText: string | undefined): CommerceWriteFreeze {
    const entries = (listText ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
    if (entries.length === 0) return { kind: "none" };
    const unreadable = entries.filter((entry) => UNREADABLE_ENTRY.test(entry));
    if (unreadable.length > 0) return { kind: "unreadable", entries: unreadable };
    return { kind: "tenants", tenantIds: new Set(entries) };
}

/**
 * The answer of a writer for a tenant whose commerce writes are frozen: 503 `{ code: "commerceFrozen", error }` in the
 * `{ error }` envelope of the writers' other refusals, no headers. `undefined` when the tenant is not frozen.
 * `listText` defaults to the variable, read at each call. Logs one warning line with the reason when it refuses.
 */
export function commerceWriteFreezeRefusal(
    tenantId: string,
    listText: string | undefined = process.env.COMMERCE_WRITE_FREEZE_TENANTS,
): APIGatewayProxyStructuredResultV2 | undefined {
    const freeze = parseCommerceWriteFreeze(listText);
    switch (freeze.kind) {
        case "none":
            return undefined;
        case "tenants":
            if (!freeze.tenantIds.has(tenantId)) return undefined;
            console.warn("Commerce write refused: the tenant is in COMMERCE_WRITE_FREEZE_TENANTS", { tenantId });
            return frozenAnswer();
        case "unreadable":
            console.warn("Commerce write refused: COMMERCE_WRITE_FREEZE_TENANTS is unreadable, every tenant is frozen", { tenantId, unreadableEntries: freeze.entries });
            return frozenAnswer();
    }
    // Exhaustiveness: the return type admits `undefined` and the backend compiles without `noImplicitReturns`, so a new
    // state with no case above would fall through here in silence. This assignment fails to compile then. If it is ever
    // reached at run time, the write is refused (fail closed), never let through.
    const unhandled: never = freeze;
    console.warn("Commerce write refused: unhandled freeze state", { tenantId, freeze: unhandled });
    return frozenAnswer();
}

const frozenAnswer = (): APIGatewayProxyStructuredResultV2 => ({
    statusCode: 503,
    body: JSON.stringify({ code: "commerceFrozen", error: COMMERCE_FROZEN_TEXT }),
});
