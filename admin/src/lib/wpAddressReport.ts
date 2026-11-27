/**
 * IMPORT-PATHS-1 (docs/slices/import-paths-1.md) — the address report of the WordPress pages import, as the WP Migration
 * page shows it (Step 3). Pure: the page renders EXCLUSIVELY from `addressRowView` and `summarizeReport`, so a node test
 * of these functions proves the texts and counts the operator reads (as importReportView.ts does for the reviews
 * import).
 *
 * Abstraction ledger: `addressRowView` / `summarizeReport` — view-model builders. Concrete user: `Migration.tsx` (single
 * caller). Axis: none; they are the test seam for the report (the admin tests have no DOM). Rejected alternative: the
 * texts inline in JSX — untestable without a DOM runner.
 *
 * The row type mirrors `AddressRow` of backend/src/import/wordpress.ts (the response of `POST /import/wordpress`, with
 * `?dryRun=1` or `keepOldAddresses: true`). The admin does not import backend code; a change there must change this.
 */

export type OldAddress =
    | { kind: "none" }
    | { kind: "invalid"; link: string }
    | { kind: "home"; link: string }
    | { kind: "query-only"; link: string }
    | { kind: "undecodable"; link: string; raw: string }   // a malformed %-escape: the site answers 400
    | { kind: "path"; path: string; raw: string; query?: string; slashesFrom?: string };

export type Blocked = { kind: "reserved"; refusal: string } | { kind: "served-before"; by: string };

export type PageResult =
    | { kind: "kept" | "parent" | "flat"; address: string; write: "create" | "update" }
    | { kind: "moved"; address: string; wanted: string; blocked: Blocked; write: "create" | "update" }
    | { kind: "refused-taken"; address: string; heldBy: string }
    | { kind: "refused-blocked"; address: string; blocked: Blocked }
    | { kind: "refused-site"; address: string; holder: "page"; source: string | null }
    | { kind: "refused-site"; address: string; holder: "redirect" | "route" }
    | { kind: "today"; address: string; write: "create" | "update" }
    | { kind: "failed"; address: string; error: string }        // confirmed: nothing of the page was written
    | { kind: "unconfirmed"; address: string; error: string };  // the write was sent; its result is unknown

export type RedirectResult =
    | { kind: "none" }
    | { kind: "write"; from: string; to: string }
    | { kind: "present"; from: string; to: string }
    | { kind: "cannot-redirect"; from: string; by: string }
    | { kind: "taken-in-export"; from: string; heldBy: string }
    | { kind: "taken-on-site"; from: string }
    | { kind: "no-target"; from: string }
    | { kind: "not-attempted"; from: string; to: string }
    | { kind: "failed"; from: string; to: string; error: string }
    | { kind: "unconfirmed"; from: string; to: string; error: string };

export type FeaturedImageResult =
    | { kind: "none" }
    | { kind: "from-export"; url: string }
    | { kind: "missing"; id: string }
    | { kind: "copied"; url: string }
    | { kind: "not-copied"; url: string; error: string };

export type ProductResult =
    | { kind: "found"; address: string }
    | { kind: "unavailable"; address: string; reason: string }
    | { kind: "unreachable"; address: string; reason: string }
    | { kind: "not-found"; tried: string[] }
    | { kind: "failed"; error: string };

export type AddressRow =
    | { item: "page" | "post"; title: string; oldAddress: OldAddress; page: PageResult; redirect: RedirectResult; featuredImage: FeaturedImageResult; commentsError?: string }
    | { item: "product"; title: string; oldAddress: OldAddress; product: ProductResult; redirect: RedirectResult };

export interface AddressRowView {
    title: string;
    oldAddress: string;
    newAddress: string;
    redirect: string;
    note: string;
    /** True when the old address is lost, the item is not imported, or something is missing: the row is shown in red. */
    problem: boolean;
}

function oldAddressText(old: OldAddress): string {
    switch (old.kind) {
        case "none": return "—";
        case "invalid": return old.link;
        case "home": return "/";
        case "query-only": return old.link;
        case "undecodable": return old.raw;
        case "path": return old.path;
    }
}

/** The redirect column, and whether the old address is lost. `dryRun`: the import has not run yet. */
function redirectText(r: RedirectResult, dryRun: boolean): { text: string; lost: boolean } {
    switch (r.kind) {
        case "none": return { text: "", lost: false };
        case "write": return { text: `${dryRun ? "Will redirect" : "Redirects"} (308) to ${r.to}`, lost: false };
        case "present": return { text: `Redirects (308) to ${r.to} (already there)`, lost: false };
        case "cannot-redirect": return { text: `Cannot be kept or redirected: ${r.by}`, lost: true };
        case "taken-in-export": return { text: `Lost: "${r.heldBy}" has this address`, lost: true };
        case "taken-on-site": return { text: "Lost: a page or a redirect of this site already uses this address", lost: true };
        case "no-target": return { text: "Lost: there is no public page to redirect to", lost: true };
        case "not-attempted": return { text: `Not written: the page write is not confirmed, so the redirect to ${r.to} was not attempted`, lost: true };
        case "failed": return { text: `Lost: the redirect to ${r.to} was not written (${r.error})`, lost: true };
        case "unconfirmed": return { text: `Not confirmed: the redirect to ${r.to} was sent, its result is unknown (${r.error}). Check it before you import again`, lost: true };
    }
}

function blockedText(address: string, b: Blocked): string {
    switch (b.kind) {
        case "reserved": return b.refusal;
        case "served-before": return `${address} cannot be a page address: ${b.by}.`;
    }
}

function refusedSiteNote(p: Extract<PageResult, { kind: "refused-site" }>): string {
    switch (p.holder) {
        case "page": return p.source === null
            ? `A page of this site with no WordPress source (made in the admin, or imported before) has the address ${p.address}. It is not replaced.`
            : `A page imported from another WordPress item (${p.source}) has the address ${p.address}. It is not replaced.`;
        case "redirect": return `A redirect of this site uses the address ${p.address}.`;
        case "route": return `A route of this site uses the address ${p.address}.`;
    }
}

function pageTexts(p: PageResult, old: OldAddress): { newAddress: string; note: string; refused: boolean } {
    const update = (write: "create" | "update") => (write === "update" ? " Updates the page an earlier import of this item wrote." : "");
    switch (p.kind) {
        case "kept": return {
            newAddress: p.address,
            note: (old.kind === "path" && old.path === p.address ? "Old address kept." : "Old address written in this site's slug form (lower case, letters a–z, digits, -).") + update(p.write),
            refused: false,
        };
        case "parent": return { newAddress: p.address, note: `No public address by path on WordPress: placed under its parent page.${update(p.write)}`, refused: false };
        case "flat": return { newAddress: p.address, note: `No address by path on WordPress: placed at its post name.${update(p.write)}`, refused: false };
        case "moved": return { newAddress: p.address, note: `Moved: ${blockedText(p.wanted, p.blocked)}${update(p.write)}`, refused: false };
        case "refused-taken": return { newAddress: "Not imported", note: `"${p.heldBy}" comes first in the export and has the address ${p.address}.`, refused: true };
        case "refused-blocked": return { newAddress: "Not imported", note: blockedText(p.address, p.blocked), refused: true };
        case "refused-site": return { newAddress: "Not imported", note: refusedSiteNote(p), refused: true };
        case "today": return { newAddress: p.address, note: p.write === "update" ? "Overwrites the page at this address." : "", refused: false };
        case "failed": return { newAddress: "Not imported", note: `Failed: ${p.error}. Nothing of this page was written.`, refused: true };
        case "unconfirmed": return { newAddress: `${p.address} (not confirmed)`, note: `The page was sent to ${p.address} and its result is unknown (${p.error}). Look at Content before you import again.`, refused: true };
    }
}

export function addressRowView(row: AddressRow, dryRun: boolean): AddressRowView {
    const redirect = redirectText(row.redirect, dryRun);
    if (row.item === "product") {
        const p = row.product;
        const product = p.kind === "found" ? { address: p.address, note: "", problem: false }
            : p.kind === "unavailable" ? { address: p.address, note: `Not public: ${p.reason}.`, problem: true }
            : p.kind === "unreachable" ? { address: p.address, note: `Not reachable: ${p.reason}.`, problem: true }
            : p.kind === "not-found" ? { address: "Not found", note: `No product with the slug ${p.tried.join(" or ")} on this site. Import the products (Step 2) first, then check again.`, problem: true }
            : { address: "Not found", note: `The product lookup failed: ${p.error}.`, problem: true };
        return {
            title: `${row.title} (product)`,
            oldAddress: oldAddressText(row.oldAddress),
            newAddress: product.address,
            redirect: redirect.text,
            note: product.note,
            problem: redirect.lost || product.problem,
        };
    }
    const page = pageTexts(row.page, row.oldAddress);
    const query = row.oldAddress.kind === "path" && row.oldAddress.query ? `The query ${row.oldAddress.query} is not part of the address: the page answers without it.` : "";
    const fi = row.featuredImage;
    const image = fi.kind === "missing" ? `Featured image ${fi.id} is not in the export: the page gets no featured image.`
        : fi.kind === "not-copied" ? `The page is written without its featured image: the copy failed (${fi.error}).` : "";
    const comments = row.commentsError !== undefined ? `The page is written; its comments are not all confirmed (${row.commentsError}).` : "";
    const slashes = row.oldAddress.kind === "path" && row.oldAddress.slashesFrom ? `The old address ${row.oldAddress.slashesFrom} has repeated slashes: the site answers it with a 308 to ${row.oldAddress.path}.` : "";
    return {
        title: row.title,
        oldAddress: oldAddressText(row.oldAddress),
        newAddress: page.newAddress,
        redirect: redirect.text,
        note: [page.note, slashes, query, image, comments].filter(Boolean).join(" "),
        problem: redirect.lost || page.refused || image !== "" || comments !== "",
    };
}

/** The counts the page shows above the import button (operator ruling IP1-BUILTIN-REDIRECTS = A: before confirming). */
export interface ReportSummary {
    items: number;
    problems: number;
    /** Old addresses the renderer answers before its content lookup: cannot be kept or redirected. */
    cannotKeepOrRedirect: number;
    /** Items with a failed or unconfirmed step (page, product, redirect, featured image or comments). */
    failed: number;
}

export function summarizeReport(rows: AddressRow[], dryRun: boolean): ReportSummary {
    const failed = (row: AddressRow) => row.redirect.kind === "failed" || row.redirect.kind === "unconfirmed" || row.redirect.kind === "not-attempted"
        || (row.item === "product" ? row.product.kind === "failed"
            : row.page.kind === "failed" || row.page.kind === "unconfirmed" || row.featuredImage.kind === "not-copied" || row.commentsError !== undefined);
    return {
        items: rows.length,
        problems: rows.filter((row) => addressRowView(row, dryRun).problem).length,
        cannotKeepOrRedirect: rows.filter((row) => row.redirect.kind === "cannot-redirect").length,
        failed: rows.filter(failed).length,
    };
}
