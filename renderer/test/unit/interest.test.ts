import { describe, it, expect } from "vitest";
import {
    INTEREST_CAP, addItem, removeItem, listRows, sendableItems, resolveShortlist, uuidV4, storageKey, createShortlistStore,
    type FetchPort, type ShortlistItem, type StoragePort,
} from "@/lib/interest";

/**
 * CAT-INTEREST-1 — the shortlist module `src/lib/interest.ts` (slice docs/slices/cat-interest-1.md § 5 "Unit":
 * add/remove/dedupe-by-pair/cap/persist with a failing storage; expiry rendering) and review-0 F3/F5/F7: the
 * resolve lookup → row state → what a send carries, and a late response after a list change. Pure: a Map-backed
 * storage port stands in for localStorage and a fake fetch for the resolve route; no browser, no network.
 */

const item = (productId: string, optionValue?: string, title = `T-${productId}`): ShortlistItem => ({
    productId, title, slug: `s-${productId}`, addedAt: "2026-10-30T00:00:00.000Z",
    ...(optionValue !== undefined ? { optionValue } : {}),
});

class MapStorage implements StoragePort {
    data = new Map<string, string>();
    failWrites = false;
    failReads = false;
    getItem(k: string) { if (this.failReads) throw new Error("SecurityError"); return this.data.get(k) ?? null; }
    setItem(k: string, v: string) { if (this.failWrites) throw new Error("QuotaExceededError"); this.data.set(k, v); }
}

const BYTES = new Uint8Array(16).fill(0xab);

describe("shortlist rules (pure)", () => {
    it("identity is the pair (productId, optionValue): two options of one product are two items; the same pair is one", () => {
        let list: ShortlistItem[] = [];
        for (const it of [item("p", "red"), item("p", "blue"), item("p", "red"), item("p"), item("p")]) list = addItem(list, it).items;
        expect(list.map((i) => [i.productId, i.optionValue ?? null])).toEqual([["p", "red"], ["p", "blue"], ["p", null]]);
        expect(addItem(list, item("p", "red")).result).toBe("already-present");
    });

    it("remove takes out exactly the pair", () => {
        const list = [item("p", "red"), item("p", "blue"), item("p")];
        expect(removeItem(list, { productId: "p", optionValue: "red" }).map((i) => i.optionValue ?? null)).toEqual(["blue", null]);
        expect(removeItem(list, { productId: "p" }).map((i) => i.optionValue)).toEqual(["red", "blue"]);
    });

    it(`cap ${INTEREST_CAP}: the 51st add is refused ("full") and the list is unchanged`, () => {
        let list: ShortlistItem[] = [];
        for (let n = 0; n < INTEREST_CAP; n++) list = addItem(list, item(`p${n}`)).items;
        expect(list).toHaveLength(50);
        const r = addItem(list, item("p50"));
        expect(r.result).toBe("full");
        expect(r.items).toBe(list);
    });

    it("uuidV4 sets the version and variant bits (a valid v4 token)", () => {
        expect(uuidV4(BYTES)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});

describe("shortlist store (persistence over the storage port)", () => {
    it("persists under amodx:interest:<tenantId>, one list per tenant, and reloads it", () => {
        const s = new MapStorage();
        const a = createShortlistStore("t1", s);
        a.add(item("p", "red"));
        expect([...s.data.keys()]).toEqual([storageKey("t1")]);
        expect(storageKey("t1")).toBe("amodx:interest:t1");
        expect(createShortlistStore("t1", s).getSnapshot().items).toEqual([item("p", "red")]);
        expect(createShortlistStore("t2", s).getSnapshot().items).toEqual([]);
    });

    it("malformed stored data is dropped item by item, never trusted", () => {
        const s = new MapStorage();
        s.data.set(storageKey("t1"), JSON.stringify({ items: [item("ok"), { productId: 5 }, "x", item("ok")] }));
        expect(createShortlistStore("t1", s).getSnapshot().items.map((i) => i.productId)).toEqual(["ok"]);
        s.data.set(storageKey("t1"), "{not json");
        expect(createShortlistStore("t1", s).getSnapshot().items).toEqual([]);
    });

    it("a failing write: the list keeps working for the page, the notice is raised ONCE", () => {
        const s = new MapStorage();
        const store = createShortlistStore("t1", s);
        let notified = 0;
        store.subscribe(() => notified++);
        s.failWrites = true;
        expect(store.add(item("a"))).toBe("added");
        expect(store.getSnapshot()).toMatchObject({ persistence: "page-only", notice: "page-only" });
        expect(store.getSnapshot().items.map((i) => i.productId)).toEqual(["a"]);
        store.acknowledgeNotice();
        expect(store.getSnapshot().notice).toBeNull();
        store.add(item("b"));
        expect(store.getSnapshot().notice).toBeNull();
        expect(store.getSnapshot().items.map((i) => i.productId)).toEqual(["a", "b"]);
        expect(notified).toBe(3);
    });

    it("storage that throws on read, or no storage at all: page-only from the start, with the notice", () => {
        const s = new MapStorage();
        s.failReads = true;
        expect(createShortlistStore("t1", s).getSnapshot()).toMatchObject({ items: [], persistence: "page-only", notice: "page-only" });
        const none = createShortlistStore("t1", null);
        expect(none.add(item("a"))).toBe("added");
        expect(none.getSnapshot().items).toHaveLength(1);
    });

    it("the token: one per list content — reused by a resend, persisted before the send, dropped by a change", () => {
        const s = new MapStorage();
        const store = createShortlistStore("t1", s);
        store.add(item("a"));
        const t = store.tokenForSend(BYTES);
        expect(store.tokenForSend(new Uint8Array(16))).toBe(t);
        expect(createShortlistStore("t1", s).getSnapshot().token).toBe(t);
        store.add(item("b"));
        expect(store.getSnapshot().token).toBeUndefined();
        expect(store.tokenForSend(new Uint8Array(16))).not.toBe(t);
    });

    it("after a successful send: the list is empty, the outcome survives a reload (the confirmation sends nothing), a new add starts a new list", () => {
        const s = new MapStorage();
        const store = createShortlistStore("t1", s);
        store.add(item("a"));
        store.tokenForSend(BYTES);
        store.markSent({ submissionId: "sub-1", droppedTitles: ["Old"] }, store.getSnapshot().items);
        const reloaded = createShortlistStore("t1", s).getSnapshot();
        expect(reloaded.items).toEqual([]);
        expect(reloaded.token).toBeUndefined();
        expect(reloaded.sent).toEqual({ submissionId: "sub-1", droppedTitles: ["Old"] });
        store.add(item("b"));
        expect(store.getSnapshot().sent).toBeUndefined();
    });
});

describe("a late response after a list change (review-0 F5, review-1 F5): completion removes only the item instances it was sent with", () => {
    it("an item added while the send was pending survives the response; the sent items are removed; token retired", () => {
        const store = createShortlistStore("t-f5a", new MapStorage());
        store.add(item("a"));
        const listAtSend = store.getSnapshot().items;
        store.tokenForSend(BYTES);
        store.add(item("b"));                      // during the request
        store.markSent({ submissionId: "s", droppedTitles: [] }, listAtSend);
        const st = store.getSnapshot();
        expect(st.items.map((i) => i.productId)).toEqual(["b"]);
        expect(st.token).toBeUndefined();
        expect(st.sent?.submissionId).toBe("s");
    });

    it("an item removed while pending stays removed; nothing else is touched", () => {
        const store = createShortlistStore("t-f5b", new MapStorage());
        store.add(item("a")); store.add(item("b"));
        const listAtSend = store.getSnapshot().items;
        store.add(item("c"));                      // during the request
        store.remove({ productId: "b" });          // during the request
        store.markSent({ submissionId: "s", droppedTitles: [] }, listAtSend);
        expect(store.getSnapshot().items.map((i) => i.productId)).toEqual(["c"]);
    });

    it("removed and added AGAIN while pending (no option): the new addition survives the earlier response", () => {
        const store = createShortlistStore("t-f5c", new MapStorage());
        store.add(item("a"));
        const listAtSend = store.getSnapshot().items;
        store.remove({ productId: "a" });          // during the request
        store.add(item("a"));                      // during the request: the same pair, a new addition
        store.markSent({ submissionId: "s", droppedTitles: [] }, listAtSend);
        expect(store.getSnapshot().items.map((i) => [i.productId, i.optionValue ?? null])).toEqual([["a", null]]);
    });

    it("removed and added AGAIN while pending with the SAME option: the new addition survives; the other sent pair is removed", () => {
        const store = createShortlistStore("t-f5d", new MapStorage());
        store.add(item("a", "red")); store.add(item("a", "blue"));
        const listAtSend = store.getSnapshot().items;
        store.remove({ productId: "a", optionValue: "red" });
        store.add(item("a", "red"));
        store.markSent({ submissionId: "s", droppedTitles: [] }, listAtSend);
        expect(store.getSnapshot().items.map((i) => [i.productId, i.optionValue ?? null])).toEqual([["a", "red"]]);
    });

    it("the instances survive persistence of unrelated changes (a commit never copies an item object)", () => {
        const store = createShortlistStore("t-f5e", new MapStorage());
        store.add(item("a"));
        const listAtSend = store.getSnapshot().items;
        store.tokenForSend(BYTES);                 // a commit that changes no item
        store.acknowledgeNotice();
        store.markSent({ submissionId: "s", droppedTitles: [] }, listAtSend);
        expect(store.getSnapshot().items).toEqual([]);
    });
});

describe("the resolve lookup → the row state → what a send carries (review-0 F3, F7)", () => {
    const answer = (status: number, body: unknown): FetchPort => async () => ({ ok: status >= 200 && status < 300, json: async () => body });
    const LIST = [item("live", "red", "Oak"), item("live2", undefined, "Ash"), item("gone", undefined, "Old"), item("draft", undefined, "Draft"), item("live", "blue", "Oak")];
    const RESOLVED = { products: [
        { productId: "live", status: "active", title: "Oak", slug: "oak", collection: "Herringbone", optionValues: ["red", "green"] },
        { productId: "live2", status: "active", title: "Ash", slug: "ash", optionValues: [] },
        { productId: "gone", status: "absent" },
        { productId: "draft", status: "not-available" },
    ] };

    it("the request: POST <api>/public/interest/resolve, tenant header, the DISTINCT stored ids", async () => {
        const calls: any[] = [];
        const port: FetchPort = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => RESOLVED }; };
        await resolveShortlist(port, "https://api.test", "t1", LIST.map((i) => i.productId));
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://api.test/public/interest/resolve");
        expect(calls[0].init.headers["x-tenant-id"]).toBe("t1");
        expect(JSON.parse(calls[0].init.body)).toEqual({ productIds: ["live", "live2", "gone", "draft"] });
    });

    it("a complete answer: available (+ live collection) | expired (absent) | unavailable | option-gone; only available items are sent", async () => {
        const rows = listRows(LIST, await resolveShortlist(answer(200, RESOLVED), "", "t1", LIST.map((i) => i.productId)));
        expect(rows.map((r) => [r.item.productId, r.item.optionValue ?? null, r.state])).toEqual([
            ["live", "red", { kind: "available", collection: "Herringbone" }],
            ["live2", null, { kind: "available" }],
            ["gone", null, { kind: "expired" }],
            ["draft", null, { kind: "unavailable" }],
            ["live", "blue", { kind: "option-gone", collection: "Herringbone" }],
        ]);
        expect(sendableItems(rows).map((i) => [i.productId, i.optionValue ?? null])).toEqual([["live", "red"], ["live2", null]]);
    });

    it("the route's 503 (keys unprocessed), a network failure, a malformed or incomplete answer: NOTHING is marked and every item is sent (the server validates)", async () => {
        const withEntry = (entry: unknown) => answer(200, { products: [...RESOLVED.products.slice(1), entry] });
        const failing: [string, FetchPort][] = [
            ["503", answer(503, { error: "x", retryable: true })],
            ["network failure", async () => { throw new TypeError("Failed to fetch"); }],
            ["no products array", answer(200, { nope: true })],
            ["ids missing from the answer", answer(200, { products: RESOLVED.products.slice(0, 2) })],
            // review-1 F9: an entry that does not match the shared InterestResolveResponseSchema.
            ["unknown status", withEntry({ productId: "live", status: "future" })],
            ["active without its fields", withEntry({ productId: "live", status: "active" })],
            ["optionValues of the wrong type", withEntry({ productId: "live", status: "active", title: "Oak", slug: "oak", optionValues: "red" })],
            ["title of the wrong type", withEntry({ productId: "live", status: "active", title: 5, slug: "oak", optionValues: [] })],
            ["productId missing", answer(200, { products: [...RESOLVED.products, { status: "absent" }] })],
        ];
        for (const [why, port] of failing) {
            const resolution = await resolveShortlist(port, "", "t1", LIST.map((i) => i.productId));
            expect({ why, resolution }).toEqual({ why, resolution: null });
            const rows = listRows(LIST, resolution);
            expect(rows.every((r) => r.state.kind === "unchecked")).toBe(true);
            expect(sendableItems(rows)).toHaveLength(LIST.length);
        }
    });
});
