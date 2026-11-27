import { describe, it, expect } from "vitest";
import { addressRowView, summarizeReport, type AddressRow } from "./wpAddressReport";

/**
 * IMPORT-PATHS-1 — the texts of the address report (admin/src/lib/wpAddressReport.ts), one row per kind the backend
 * answers (backend/src/import/wordpress.ts `AddressRow`). Rows taken from the fixture's dry run
 * (backend/test/unit/import-paths-1.test.ts IP1-DRY-RUN-LIST).
 */
const none = { kind: "none" } as const;
const page = (p: any, extra: Partial<Record<string, any>> = {}): AddressRow =>
    ({ item: "page", title: "T", oldAddress: { kind: "path", path: "/a", raw: "/a" }, page: p, redirect: none, featuredImage: none, ...extra }) as AddressRow;

describe("IP1-ADMIN-REPORT — the address report texts", () => {
    it("kept, same address: no problem", () => {
        expect(addressRowView(page({ kind: "kept", address: "/a", write: "create" }), true)).toEqual({
            title: "T", oldAddress: "/a", newAddress: "/a", redirect: "", note: "Old address kept.", problem: false,
        });
    });
    it("kept in slug form with a redirect (upper case): the dry run says it will redirect; the import says it does", () => {
        const row = page({ kind: "kept", address: "/atelier/program", write: "create" }, { oldAddress: { kind: "path", path: "/Atelier/Program", raw: "/Atelier/Program" }, redirect: { kind: "write", from: "/Atelier/Program", to: "/atelier/program" } });
        expect(addressRowView(row, true)).toMatchObject({ redirect: "Will redirect (308) to /atelier/program", note: "Old address written in this site's slug form (lower case, letters a–z, digits, -).", problem: false });
        expect(addressRowView(row, false).redirect).toBe("Redirects (308) to /atelier/program");
    });
    it("moved from a reserved address, the old one answered by a built-in page: cannot be kept or redirected, a problem", () => {
        const v = addressRowView(page({ kind: "moved", address: "/ghid", wanted: "/product/ghid", blocked: { kind: "reserved", refusal: "R." }, write: "create" }, { redirect: { kind: "cannot-redirect", from: "/product/ghid", by: "the site's product pages" } }), true);
        expect(v).toMatchObject({ newAddress: "/ghid", note: "Moved: R.", redirect: "Cannot be kept or redirected: the site's product pages", problem: true });
    });
    it("moved because the renderer answers the address first", () => {
        const v = addressRowView(page({ kind: "moved", address: "/guide", wanted: "/api/guide", blocked: { kind: "served-before", by: "B" }, write: "create" }), true);
        expect(v.note).toBe("Moved: /api/guide cannot be a page address: B.");
    });
    it.each([
        [{ kind: "refused-taken", address: "/coala", heldBy: "Coala" }, '"Coala" comes first in the export and has the address /coala.'],
        [{ kind: "refused-blocked", address: "/cart", blocked: { kind: "reserved", refusal: "Reserved." } }, "Reserved."],
        [{ kind: "refused-site", address: "/cursuri", holder: "page", source: null }, "A page of this site with no WordPress source (made in the admin, or imported before) has the address /cursuri. It is not replaced."],
        [{ kind: "refused-site", address: "/cursuri", holder: "page", source: "wordpress:a.test/10" }, "A page imported from another WordPress item (wordpress:a.test/10) has the address /cursuri. It is not replaced."],
        [{ kind: "refused-site", address: "/galerie", holder: "redirect" }, "A redirect of this site uses the address /galerie."],
        [{ kind: "failed", address: "/x", error: "boom" }, "Failed: boom. Nothing of this page was written."],
    ])("refused %j: not imported, a problem", (p, note) => {
        expect(addressRowView(page(p), true)).toMatchObject({ newAddress: "Not imported", note, problem: true });
    });
    it("a query-only address and a missing featured image are problems; the redirect text names the reason the backend gives", () => {
        const link = "https://old.example.test/?page_id=60";
        const v = addressRowView(page({ kind: "parent", address: "/cursuri/ciorna", write: "create" }, {
            oldAddress: { kind: "query-only", link }, redirect: { kind: "cannot-redirect", from: link, by: "an address by query string only (?p=…)" }, featuredImage: { kind: "missing", id: "999" },
        }), true);
        expect(v).toEqual({
            title: "T", oldAddress: link, newAddress: "/cursuri/ciorna",
            redirect: "Cannot be kept or redirected: an address by query string only (?p=…)",
            note: "No public address by path on WordPress: placed under its parent page. Featured image 999 is not in the export: the page gets no featured image.",
            problem: true,
        });
    });
    it("a path with a query: kept by path, the dropped query named, not a problem", () => {
        const v = addressRowView(page({ kind: "kept", address: "/nested/page", write: "create" }, { oldAddress: { kind: "path", path: "/nested/page", raw: "/nested/page", query: "?campaign=1" } }), true);
        expect(v).toMatchObject({ note: "Old address kept. The query ?campaign=1 is not part of the address: the page answers without it.", problem: false });
    });
    it("written page, failed redirect and failed comments: problems that say what was written", () => {
        expect(addressRowView(page({ kind: "kept", address: "/a", write: "create" }, { redirect: { kind: "failed", from: "/A", to: "/a", error: "e" } }), false))
            .toMatchObject({ newAddress: "/a", redirect: "Lost: the redirect to /a was not written (e)", problem: true });
        expect(addressRowView(page({ kind: "kept", address: "/a", write: "create" }, { commentsError: "c" }), false))
            .toMatchObject({ note: "Old address kept. The page is written; its comments are not all confirmed (c).", problem: true });
    });
    it("option off: today's address; an overwrite is named", () => {
        expect(addressRowView(page({ kind: "today", address: "/ceara", write: "update" }), true)).toMatchObject({ newAddress: "/ceara", note: "Overwrites the page at this address.", problem: false });
    });
    it("a product not on the site: a problem, the slugs tried named", () => {
        const row = { item: "product", title: "Vas mare", oldAddress: { kind: "path", path: "/produs/vas-mare", raw: "/produs/vas-mare" }, product: { kind: "not-found", tried: ["vas-mare"] }, redirect: { kind: "no-target", from: "/produs/vas-mare" } } as AddressRow;
        expect(addressRowView(row, true)).toEqual({
            title: "Vas mare (product)", oldAddress: "/produs/vas-mare", newAddress: "Not found",
            redirect: "Lost: there is no public page to redirect to",
            note: "No product with the slug vas-mare on this site. Import the products (Step 2) first, then check again.",
            problem: true,
        });
    });
    it("a product that is not public: a problem with the backend's reason", () => {
        const row = { item: "product", title: "Vas", oldAddress: { kind: "none" }, product: { kind: "unavailable", address: "/product/vas", reason: "the product is not active (status: draft), so its page answers 404" }, redirect: { kind: "none" } } as AddressRow;
        expect(addressRowView(row, true)).toMatchObject({ newAddress: "/product/vas", note: "Not public: the product is not active (status: draft), so its page answers 404.", problem: true });
    });
});

describe("IP1-R1-ADMIN-REPORT — the review-1 outcomes", () => {
    it("a page write not confirmed: never `Nothing … was written`; its redirect not attempted", () => {
        const v = addressRowView(page({ kind: "unconfirmed", address: "/a", error: "response lost after commit" }, { redirect: { kind: "not-attempted", from: "/A", to: "/a" } }), false);
        expect(v).toEqual({
            title: "T", oldAddress: "/a", newAddress: "/a (not confirmed)",
            redirect: "Not written: the page write is not confirmed, so the redirect to /a was not attempted",
            note: "The page was sent to /a and its result is unknown (response lost after commit). Look at Content before you import again.",
            problem: true,
        });
        expect(v.note).not.toMatch(/Nothing of this page was written/);
    });
    it("a redirect sent and not confirmed", () => {
        expect(addressRowView(page({ kind: "kept", address: "/a", write: "create" }, { redirect: { kind: "unconfirmed", from: "/A", to: "/a", error: "e" } }), false).redirect)
            .toBe("Not confirmed: the redirect to /a was sent, its result is unknown (e). Check it before you import again");
    });
    it("a written page whose featured image copy failed: a problem that says the page is written", () => {
        const v = addressRowView(page({ kind: "kept", address: "/a", write: "create" }, { featuredImage: { kind: "not-copied", url: "https://old.example.test/i.jpg", error: "timeout" } }), false);
        expect(v).toMatchObject({ newAddress: "/a", note: "Old address kept. The page is written without its featured image: the copy failed (timeout).", problem: true });
    });
    it("an old address with repeated slashes: kept through the site's own 308, not a problem", () => {
        const v = addressRowView(page({ kind: "kept", address: "/a/b", write: "create" }, { oldAddress: { kind: "path", path: "/a/b", raw: "/a/b", slashesFrom: "/a//b" } }), true);
        expect(v).toMatchObject({ oldAddress: "/a/b", note: "Old address kept. The old address /a//b has repeated slashes: the site answers it with a 308 to /a/b.", problem: false });
    });
    it("an undecodable old address (review-2): shown as written, cannot be kept or redirected, counted", () => {
        const row = page({ kind: "flat", address: "/pagina", write: "create" }, {
            oldAddress: { kind: "undecodable", link: "https://old.example.test/a%E0%A4%A/", raw: "/a%E0%A4%A" },
            redirect: { kind: "cannot-redirect", from: "/a%E0%A4%A", by: "Next.js cannot decode this address (a malformed %-escape) and answers 400" },
        });
        expect(addressRowView(row, true)).toMatchObject({
            oldAddress: "/a%E0%A4%A", newAddress: "/pagina",
            redirect: "Cannot be kept or redirected: Next.js cannot decode this address (a malformed %-escape) and answers 400", problem: true,
        });
        expect(summarizeReport([row], true)).toMatchObject({ cannotKeepOrRedirect: 1, problems: 1 });
    });
    it("comments not written and not confirmed: the page is still reported written", () => {
        const v = addressRowView(page({ kind: "kept", address: "/a", write: "create" }, { commentsError: "1 of 2 comments not written: Invalid time value" }), false);
        expect(v).toMatchObject({ newAddress: "/a", note: "Old address kept. The page is written; its comments are not all confirmed (1 of 2 comments not written: Invalid time value).", problem: true });
    });
    it("a product whose destination does not show it", () => {
        const row = { item: "product", title: "Vas", oldAddress: { kind: "none" }, product: { kind: "unreachable", address: "/checkout/vas", reason: "R" }, redirect: { kind: "no-target", from: "/produs/vas" } } as AddressRow;
        expect(addressRowView(row, true)).toMatchObject({ newAddress: "/checkout/vas", note: "Not reachable: R.", problem: true });
    });
    it("the summary counts unconfirmed and not-copied as failed steps", () => {
        const rows = [
            page({ kind: "unconfirmed", address: "/a", error: "e" }, { redirect: { kind: "not-attempted", from: "/A", to: "/a" } }),
            page({ kind: "kept", address: "/b", write: "create" }, { featuredImage: { kind: "not-copied", url: "u", error: "e" } }),
            page({ kind: "kept", address: "/c", write: "create" }, { featuredImage: { kind: "copied", url: "u" } }),
        ];
        expect(summarizeReport(rows, false)).toEqual({ items: 3, problems: 2, cannotKeepOrRedirect: 0, failed: 2 });
    });
});

describe("IP1-ADMIN-SUMMARY — the counts above the import button (ruling IP1-BUILTIN-REDIRECTS = A)", () => {
    it("counts items, problems, addresses that cannot be kept or redirected, and failures", () => {
        const rows = [
            page({ kind: "kept", address: "/a", write: "create" }),
            page({ kind: "moved", address: "/ghid", wanted: "/product/ghid", blocked: { kind: "reserved", refusal: "R." }, write: "create" }, { redirect: { kind: "cannot-redirect", from: "/product/ghid", by: "b" } }),
            page({ kind: "kept", address: "/x", write: "create" }, { redirect: { kind: "cannot-redirect", from: "/robots.txt", by: "b" } }),
            page({ kind: "failed", address: "/f", error: "e" }),
        ];
        expect(summarizeReport(rows, true)).toEqual({ items: 4, problems: 3, cannotKeepOrRedirect: 2, failed: 1 });
    });
});
