/**
 * CAT-INTEREST-1 — the visitor's interest shortlist ("Mă interesează"), client-side state.
 * Spec: docs/slices/catalog-mode-1.md § 3.5 (shortlist, expired items); slice docs/slices/cat-interest-1.md § 2.1–2.2, § 2.8.
 *
 * Pure: no `window`, no React, no network. Storage arrives through `StoragePort` (the subset of Web Storage this
 * module uses), randomness through an argument, so every rule here is unit-tested in Node
 * (`renderer/test/unit/interest.test.ts`). The React binding and the network calls live in
 * `components/InterestShortlist.tsx`.
 *
 * Rules:
 *  - one list per tenant, persisted under `amodx:interest:<tenantId>`;
 *  - an item is a SNAPSHOT of what the visitor saw (`title`, `slug`, `imageLink`) plus the variant option they chose;
 *    its identity is the pair `(productId, optionValue)` — two options of one product are two items;
 *  - at most 50 items (the server cap); the 51st add is refused with a reason, never dropped silently;
 *  - storage that throws (private mode, quota, disabled) → the list lives for the page only, and the visitor is told
 *    once (`notice`);
 *  - each item is resolved BY ID against the catalogue (`POST /public/interest/resolve`): absent → EXPIRED (shown,
 *    not sent, never rebound by slug), not active → unavailable (not sent), saved option gone → reselect (not sent);
 *    when that read fails or is incomplete NOTHING is marked and the server's own validation decides;
 *  - the submission token identifies one list content: a change to the list drops it, a send reuses it, so a resend
 *    of the same list (lost response, double click) is deduplicated by the server;
 *  - after a successful send exactly the items that were in the list WHEN IT WAS SENT are removed (a change made
 *    while the request was pending survives its response) and the "sent" outcome is kept, so a reload shows the
 *    confirmation and sends nothing.
 */

import { InterestResolveResponseSchema, type InterestResolution } from "@amodx/shared";

export const INTEREST_CAP = 50;

export interface ShortlistItem {
    productId: string;
    title: string;
    slug: string;
    imageLink?: string;
    optionValue?: string;
    addedAt: string;
}

/** The outcome of the last successful send, kept for the confirmation view. */
export interface SentOutcome {
    submissionId: string;
    /** Titles of the items the server did not record (expired, not available, option gone). */
    droppedTitles: string[];
}

export interface ShortlistState {
    items: ShortlistItem[];
    /** The token of the current list content; absent until the first send attempt. */
    token?: string;
    /** Present after a successful send, until the visitor starts a new list. */
    sent?: SentOutcome;
    /** "saved" = in storage; "page-only" = storage failed, the list ends with the page. */
    persistence: "saved" | "page-only";
    /** The one-time storage-failure notice; `null` once acknowledged or when never raised. */
    notice: "page-only" | null;
}

/** The part of Web Storage this module calls. Either method may throw. */
export interface StoragePort {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export type AddResult = "added" | "already-present" | "full";

export const storageKey = (tenantId: string) => `amodx:interest:${tenantId}`;

/** The item identity `(productId, optionValue)`; "no option" is one value. */
export function sameItem(a: { productId: string; optionValue?: string }, b: { productId: string; optionValue?: string }): boolean {
    return a.productId === b.productId && (a.optionValue ?? null) === (b.optionValue ?? null);
}

export function hasItem(items: ShortlistItem[], key: { productId: string; optionValue?: string }): boolean {
    return items.some((i) => sameItem(i, key));
}

/** Add one item. Pure: returns the next list (the same array when nothing changed) and why. */
export function addItem(items: ShortlistItem[], item: ShortlistItem): { items: ShortlistItem[]; result: AddResult } {
    if (hasItem(items, item)) return { items, result: "already-present" };
    if (items.length >= INTEREST_CAP) return { items, result: "full" };
    return { items: [...items, item], result: "added" };
}

export function removeItem(items: ShortlistItem[], key: { productId: string; optionValue?: string }): ShortlistItem[] {
    return items.filter((i) => !sameItem(i, key));
}

/**
 * How the list page shows one item, from the catalogue resolution:
 *  - "unchecked": no complete resolution (the read failed, was incomplete, or is still running) — shown as saved,
 *    sent, and left to the server's validation;
 *  - "available": active, and the saved option (if any) still offered — sent; `collection` is the live one;
 *  - "expired": no product has this id any more — reselect; not sent;
 *  - "unavailable": the product exists but is not active — not sent;
 *  - "option-gone": active, but the saved option is no longer offered — reselect the option; not sent.
 */
export type RowState =
    | { kind: "unchecked" }
    | { kind: "available"; collection?: string }
    | { kind: "expired" }
    | { kind: "unavailable" }
    | { kind: "option-gone"; collection?: string };
export interface ListRow { item: ShortlistItem; state: RowState }

/** The rows of the list page. `resolution` = `null` when no complete resolution exists. Pure. */
export function listRows(items: ShortlistItem[], resolution: ReadonlyMap<string, InterestResolution> | null): ListRow[] {
    return items.map((item) => ({ item, state: rowState(item, resolution?.get(item.productId)) }));
}

function rowState(item: ShortlistItem, r: InterestResolution | undefined): RowState {
    if (!r) return { kind: "unchecked" };
    switch (r.status) {
        case "absent": return { kind: "expired" };
        case "not-available": return { kind: "unavailable" };
        case "active": {
            const collection = r.collection !== undefined ? { collection: r.collection } : {};
            if (item.optionValue !== undefined && !r.optionValues.includes(item.optionValue)) return { kind: "option-gone", ...collection };
            return { kind: "available", ...collection };
        }
    }
}

/** The items a send carries: the available ones and, without a complete resolution, the unchecked ones. Pure. */
export function sendableItems(rows: ListRow[]): ShortlistItem[] {
    return rows.filter((r) => r.state.kind === "available" || r.state.kind === "unchecked").map((r) => r.item);
}

/** The part of `fetch` the resolve call uses (a port, so the lookup is testable without a browser). */
export type FetchPort = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) =>
    Promise<{ ok: boolean; json(): Promise<any> }>;

/**
 * Resolves the stored ids by id (`POST /public/interest/resolve`). `null` = no complete resolution — a non-2xx answer
 * (the route's 503 when keys stayed unprocessed), a network failure, an answer that does not parse against the shared
 * `InterestResolveResponseSchema` (an unknown status, a missing or mistyped field in ANY entry), or one that does not
 * cover every asked id: the caller marks nothing and the server's validation decides. Nothing from the network is used
 * as an `InterestResolution` before that parse (review-1 F9).
 */
export async function resolveShortlist(fetchPort: FetchPort, apiUrl: string, tenantId: string, productIds: string[]): Promise<Map<string, InterestResolution> | null> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return new Map();
    try {
        const res = await fetchPort(`${apiUrl}/public/interest/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-tenant-id": tenantId },
            body: JSON.stringify({ productIds: ids }),
        });
        if (!res.ok) return null;
        const parsed = InterestResolveResponseSchema.safeParse(await res.json());
        if (!parsed.success) return null;
        const map = new Map<string, InterestResolution>(parsed.data.products.map((p) => [p.productId, p]));
        return ids.every((id) => map.has(id)) ? map : null;
    } catch {
        return null;
    }
}

/** A UUID v4 from 16 random bytes (RFC 9562 § 5.4). Takes the bytes so it is testable and needs no secure context. */
export function uuidV4(random16: Uint8Array): string {
    const b = Uint8Array.from(random16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const isStr = (v: unknown): v is string => typeof v === "string";

/** Reads a stored value; anything malformed is dropped item by item, never trusted. */
function parseStored(raw: string | null): Pick<ShortlistState, "items" | "token" | "sent"> {
    if (!raw) return { items: [] };
    let data: any;
    try { data = JSON.parse(raw); } catch { return { items: [] }; }
    const items: ShortlistItem[] = [];
    for (const i of Array.isArray(data?.items) ? data.items : []) {
        if (!isStr(i?.productId) || !isStr(i?.title) || !isStr(i?.slug) || !isStr(i?.addedAt)) continue;
        const item: ShortlistItem = { productId: i.productId, title: i.title, slug: i.slug, addedAt: i.addedAt };
        if (isStr(i.imageLink)) item.imageLink = i.imageLink;
        if (isStr(i.optionValue)) item.optionValue = i.optionValue;
        if (!hasItem(items, item) && items.length < INTEREST_CAP) items.push(item);
    }
    const out: Pick<ShortlistState, "items" | "token" | "sent"> = { items };
    if (isStr(data?.token)) out.token = data.token;
    if (isStr(data?.sent?.submissionId)) {
        out.sent = { submissionId: data.sent.submissionId, droppedTitles: (Array.isArray(data.sent.droppedTitles) ? data.sent.droppedTitles : []).filter(isStr) };
    }
    return out;
}

/**
 * One tenant's shortlist: the state plus its persistence. `subscribe`/`getSnapshot` match React's
 * `useSyncExternalStore`; every state is a new object, so a changed snapshot is a changed reference.
 *
 * @param storage `null` when the browser gives no storage at all (the list is page-only from the start).
 */
export function createShortlistStore(tenantId: string, storage: StoragePort | null) {
    const key = storageKey(tenantId);
    const listeners = new Set<() => void>();
    let state: ShortlistState;

    try {
        if (!storage) throw new Error("no storage");
        state = { ...parseStored(storage.getItem(key)), persistence: "saved", notice: null };
    } catch {
        state = { items: [], persistence: "page-only", notice: "page-only" };
    }

    function commit(next: Omit<ShortlistState, "persistence" | "notice">) {
        let { persistence, notice } = state;
        if (persistence === "saved") {
            try {
                storage!.setItem(key, JSON.stringify({ items: next.items, token: next.token, sent: next.sent }));
            } catch {
                // First failure only: from now on the list is page-only, and the notice is raised this once.
                persistence = "page-only";
                notice = "page-only";
            }
        }
        state = { ...next, persistence, notice };
        listeners.forEach((l) => l());
    }

    return {
        getSnapshot: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        /** A change to the list starts a new list content: new token, no "sent" outcome. */
        add(item: ShortlistItem): AddResult {
            const { items, result } = addItem(state.items, item);
            if (result === "added") commit({ items });
            return result;
        },
        remove(k: { productId: string; optionValue?: string }) {
            const items = removeItem(state.items, k);
            if (items.length !== state.items.length) commit({ items });
        },
        /** The token to send with the current list: the stored one, else a new one (persisted before the send). */
        tokenForSend(random16: Uint8Array): string {
            if (state.token) return state.token;
            const token = uuidV4(random16);
            commit({ items: state.items, token, sent: state.sent });
            return token;
        },
        /**
         * A successful send. Removes exactly the item INSTANCES of `listAtSend` — `getSnapshot().items` as it was when
         * the request started. Item objects are never copied between commits, so an unchanged item is the same object,
         * while an item added during the request — including one removed and added again with the same pair — is a
         * new object and survives the response (review-1 F5: the pair is the list's dedupe key, not the identity of an
         * addition). Retires the token; keeps the outcome.
         */
        markSent(outcome: SentOutcome, listAtSend: readonly ShortlistItem[]) {
            commit({ items: state.items.filter((i) => !listAtSend.includes(i)), sent: outcome });
        },
        acknowledgeNotice() {
            if (state.notice === null) return;
            state = { ...state, notice: null };
            listeners.forEach((l) => l());
        },
    };
}

export type ShortlistStore = ReturnType<typeof createShortlistStore>;
