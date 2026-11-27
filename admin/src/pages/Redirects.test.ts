import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * REDIRECT-1 (docs/slices/redirect-1.md, ruling 8) — the Redirects page. The view of each state is rendered with
 * react-dom/server in the admin's node test environment (no DOM; effects do not run, so each state is given as
 * props to `RedirectsView`). The page itself is rendered too, for the state "no site selected" (no request is sent).
 * Replaced: the tenant context, Amplify and `apiRequest` (recorded).
 */

const tenant = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
const api = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: tenant.current ? [tenant.current] : [], currentTenant: tenant.current, selectTenant: () => {}, refreshTenants: async () => {} }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn(), fetchAuthSession: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
    const real = await importOriginal<typeof import("@/lib/api")>();
    return { ...real, apiRequest: vi.fn(async (path: string) => { api.calls.push(path); return { items: [] }; }) };
});

import Redirects, { RedirectsView, redirectRowsOf, requestErrorText, TARGET_NOT_FOUND, type RedirectsViewProps } from "./Redirects";
import { ApiError } from "@/lib/api";

const BASE: RedirectsViewProps = {
    loading: false, loadError: null, rows: [], from: "", to: "", adding: false, addError: null, deleteError: null,
    onFromChange: () => {}, onToChange: () => {}, onAdd: () => {}, onDelete: () => {},
};
const view = (p: Partial<RedirectsViewProps>) => renderToStaticMarkup(createElement(RedirectsView, { ...BASE, ...p }));
/** The table rows' cell texts (tags stripped). */
const bodyRows = (html: string) => [...html.split("<tbody")[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim()));

const ANSWER = {
    items: [
        { SK: "ROUTE#/to-see-articles", IsRedirect: true, RedirectTo: "/to-see", CreatedAt: "2026-11-27T10:00:00.000Z", targetFound: false },
        { SK: "ROUTE#/room", IsRedirect: true, RedirectTo: "/guest-house", CreatedAt: "2026-11-26T10:00:00.000Z", targetFound: true },
        { SK: "CONTENT#x", RedirectTo: "/skipped" },
    ],
};

describe("redirectRowsOf — the list answer as rows", () => {
    it("ROUTE# items only, the stored key as the old address, sorted by it; a missing or broken answer → no rows", () => {
        expect(redirectRowsOf(ANSWER)).toEqual([
            { from: "/room", to: "/guest-house", createdAt: "2026-11-26T10:00:00.000Z", targetFound: true },
            { from: "/to-see-articles", to: "/to-see", createdAt: "2026-11-27T10:00:00.000Z", targetFound: false },
        ]);
        for (const bad of [undefined, null, {}, { items: "x" }]) expect(redirectRowsOf(bad)).toEqual([]);
    });
});

describe("requestErrorText — the refusal text of the API, as sent", () => {
    it("the `error` of the answer body; else the message", () => {
        const text = 'A page uses the address "/despre". A redirect never replaces a page.';
        expect(requestErrorText(new ApiError(409, { error: text, refusal: "page-at-from" }, `API Error (409): ${text}`))).toBe(text);
        expect(requestErrorText(new ApiError(500, null, "API Error (500): Internal"))).toBe("API Error (500): Internal");
        expect(requestErrorText(new Error("offline"))).toBe("offline");
    });
});

describe("RedirectsView — the states of the page", () => {
    it("empty: the empty row; the add row and the rule that a redirect never replaces a page and is changed by delete then add", () => {
        const html = view({});
        expect(bodyRows(html)).toEqual([["No redirects yet. Add the old addresses of your previous site above."]]);
        expect(html).toContain("A redirect never replaces a page. To change a redirect, delete it, then add it again.");
        expect(html).toContain("The system addresses / and /contact cannot hold a redirect.");
        expect(html).toContain('aria-label="Old address"');
        expect(html).toContain('aria-label="New address"');
        expect(html).toContain("Add redirect");
        expect(html).not.toContain('role="alert"');
    });

    it("list: from → to, created date, a delete button per row; the target-not-found mark (ruled text) on that row only", () => {
        expect(TARGET_NOT_FOUND).toBe("target not found (no page at this address yet)");
        const html = view({ rows: redirectRowsOf(ANSWER) });
        const rows = bodyRows(html);
        expect(rows.map((r) => [r[0], r[1]])).toEqual([["/room", "/guest-house"], ["/to-see-articles", `/to-see${TARGET_NOT_FOUND}`]]);
        expect(rows[0][2]).toBe(new Date("2026-11-26T10:00:00.000Z").toLocaleDateString());
        expect(html.split(TARGET_NOT_FOUND)).toHaveLength(2);
        expect(html).toContain('aria-label="Delete the redirect from /room"');
        expect(html).toContain('aria-label="Delete the redirect from /to-see-articles"');
    });

    it("refusal shown: the API's text under the add row, the typed addresses kept", () => {
        const addError = 'A redirect from "/room" already exists (to "/guest-house"). To change it, delete it first, then add the new one.';
        const html = view({ from: "/room", to: "/rooms", addError });
        expect(html).toContain(`<p role="alert" class="text-sm text-destructive">${addError.replace(/"/g, "&quot;")}</p>`);
        expect(html).toContain('value="/room"');
        expect(html).toContain('value="/rooms"');
    });

    it("a refused delete and a failed load show their text", () => {
        expect(view({ deleteError: "The address \"/despre\" belongs to a page, not to a redirect. Nothing was deleted." })).toContain("Nothing was deleted.");
        expect(view({ loadError: "offline" })).toContain("Could not load the redirects: offline");
    });
});

describe("Redirects page — waits for the selected site", () => {
    it("no site selected: 'Select a site.' and no request", () => {
        tenant.current = null;
        api.calls = [];
        expect(renderToStaticMarkup(createElement(Redirects))).toBe('<div class="p-8">Select a site.</div>');
        expect(api.calls).toEqual([]);
    });
});
