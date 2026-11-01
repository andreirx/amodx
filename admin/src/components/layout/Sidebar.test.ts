import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

/**
 * LOCALE-1A — the Labels page is reachable by EVERY tenant, from the System section (docs/slices/locale-1.md § 7.1;
 * review-0 R3). The real Sidebar, rendered with react-dom/server in the admin's node test environment (no DOM); only
 * the tenant context and the Amplify sign-out are replaced. No production seam was added for this test.
 */

const tenant = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/context/TenantContext", () => ({
    useTenant: () => ({ tenants: tenant.current ? [tenant.current] : [], currentTenant: tenant.current, selectTenant: () => {}, refreshTenants: async () => {} }),
}));
vi.mock("aws-amplify/auth", () => ({ signOut: vi.fn() }));
// CAT-ADMIN-1: the site switcher's menu and the "Create New Site" dialog render inline (Radix renders closed menus and
// dialogs as nothing on the server), so the dialog's fields can be read. The nav below is not inside them.
vi.mock("@/components/ui/dropdown-menu", () => {
    const pass = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
    return { DropdownMenu: pass, DropdownMenuTrigger: pass, DropdownMenuContent: pass, DropdownMenuItem: pass, DropdownMenuLabel: pass, DropdownMenuSeparator: pass };
});
vi.mock("@/components/ui/dialog", () => {
    const pass = ({ children }: { children?: unknown }) => createElement("div", null, children as never);
    return { Dialog: pass, DialogTrigger: pass, DialogHeader: pass, DialogTitle: pass, DialogContent: ({ children }: { children?: unknown }) => createElement("div", { "data-testid": "create-site" }, children as never) };
});

import { Sidebar } from "./Sidebar";

/** The nav as `{ section: [item names] }`, read from the rendered markup (section heading, then its items). */
function sections(html: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    let current = "";
    // An item renders as <a href><button><svg …></svg>Name</button></a> (Link > Button > icon + name).
    const re = /<p class="text-\[11px\][^"]*">([^<]+)<\/p>|<a [^>]*href="([^"]*)"[^>]*><button[^>]*>[\s\S]*?<\/svg>([^<]+)<\/button><\/a>/g;
    for (const m of html.matchAll(re)) {
        if (m[1]) { current = m[1]; out[current] = []; } else if (current) out[current].push(m[3].trim());
    }
    return out;
}
const markup = (t: Record<string, unknown>) => {
    tenant.current = t;
    return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Sidebar)));
};
const render = (t: Record<string, unknown>) => sections(markup(t));

describe("Sidebar — Labels for every tenant (§ 7.1)", () => {
    for (const [kind, t] of [
        ["content tenant", { id: "t1", name: "Content", commerceEnabled: false }],
        ["commerce tenant", { id: "t2", name: "Shop", commerceEnabled: true }],
        ["catalog tenant", { id: "t3", name: "Catalog", commerceEnabled: false, catalogMode: true }],
    ] as const) {
        it(`${kind}: Labels is listed once, in System, and not in Commerce`, () => {
            const nav = render(t);
            expect(nav.System).toContain("Labels");
            expect(nav.Commerce ?? []).not.toContain("Labels");
            expect(Object.values(nav).flat().filter((n) => n === "Labels")).toHaveLength(1);
        });
    }

    it("the commerce-only entries still depend on commerceEnabled (unchanged)", () => {
        expect(render({ id: "t1", commerceEnabled: false }).Commerce).not.toContain("Orders");
        expect(render({ id: "t2", commerceEnabled: true }).Commerce).toContain("Orders");
    });
});

/**
 * CAT-ADMIN-1 (docs/slices/cat-admin-1.md § 4.2, CA-D1 = A). BEFORE is the nav of 3912c5d, read from the rendered
 * markup of the unchanged Sidebar (EXECUTED in the build, record docs/slices/cat-admin-1-impl.md), written out here.
 * A non-catalog site keeps it except for ONE move: "Digital Products" leaves Commerce for the new "Digital sales" group.
 */
const CONTENT_T = { id: "t1", name: "Content", commerceEnabled: false };
const COMMERCE_T = { id: "t2", name: "Shop", commerceEnabled: true };
const CATALOG_T = { id: "t3", name: "Catalog", commerceEnabled: false, catalogMode: true };
const COMMON = {
    Content: ["Pages", "Content Graph", "Media"],
    Growth: ["Strategy", "Signals", "Leads"],
    Engagement: ["Popups", "Forms"],
    System: ["Comments", "Audit Log", "Resources", "Team", "WP Migration", "Email DNS", "Labels", "Settings"],
};
const COMMERCE_ONLY = ["Reports", "Orders", "Customers", "Coupons", "Reviews", "Delivery", "Email Templates"];
const BEFORE = {
    content: { Content: COMMON.Content, Commerce: ["Products", "Digital Products", "Categories"], Growth: COMMON.Growth, Engagement: COMMON.Engagement, System: COMMON.System },
    commerce: { Content: COMMON.Content, Commerce: ["Products", "Digital Products", "Categories", ...COMMERCE_ONLY], Growth: COMMON.Growth, Engagement: COMMON.Engagement, System: COMMON.System },
};
/** BEFORE with the one ratified difference applied: Digital Products moves to "Digital sales", placed after Commerce. */
function withDigitalSalesGroup(before: Record<string, string[]>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [group, items] of Object.entries(before)) {
        out[group] = group === "Commerce" ? items.filter((n) => n !== "Digital Products") : items;
        if (group === "Commerce") out["Digital sales"] = ["Digital Products"];
    }
    return out;
}
/** The href of the nav link named `name`: the one `<a …>…</a>` whose button text is `name`. */
const hrefOf = (html: string, name: string) =>
    html.split("</a>").find((chunk) => chunk.endsWith(`</svg>${name}</button>`))?.match(/<a [^>]*href="([^"]*)"[^>]*>(?![\s\S]*<a )/)?.[1];

describe("Sidebar — the groups of each site kind (CAT-ADMIN-1 § 4.2)", () => {
    for (const [kind, t, before] of [["content", CONTENT_T, BEFORE.content], ["commerce", COMMERCE_T, BEFORE.commerce]] as const) {
        it(`${kind} tenant: exactly the 3912c5d nav, except Digital Products in its own "Digital sales" group`, () => {
            const nav = render(t);
            const expected = withDigitalSalesGroup(before);
            expect(nav).toEqual(expected);
            expect(Object.keys(nav)).toEqual(Object.keys(expected));   // the group order too
        });
    }

    it("catalog tenant: a Catalog group of exactly four entries, Digital sales, no Commerce group; Engagement keeps only Popups and Forms", () => {
        const nav = render(CATALOG_T);
        expect(nav).toEqual({
            Content: COMMON.Content,
            Catalog: ["Products", "Categories", "Pricelist import", "Interest lists"],
            "Digital sales": ["Digital Products"],
            Growth: COMMON.Growth,
            Engagement: COMMON.Engagement,
            System: COMMON.System,
        });
        expect(Object.keys(nav)).toEqual(["Content", "Catalog", "Digital sales", "Growth", "Engagement", "System"]);
    });

    it("catalog tenant: the two catalog entries go to the pricelist import page and the interest-list submissions", () => {
        const html = markup(CATALOG_T);
        expect(hrefOf(html, "Pricelist import")).toBe("/catalog-import");
        expect(hrefOf(html, "Interest lists")).toBe("/forms/interest-list/submissions");
    });
});

describe("Create New Site — a choice between the two kinds (CAT-ADMIN-1 § 4.1)", () => {
    const dialog = () => {
        const html = markup(CONTENT_T);
        return html.slice(html.indexOf('data-testid="create-site"'));
    };
    const text = (html: string) => html.replace(/<[^>]+>/g, "");
    it("two radios of one group, the shop/content kind selected first; no checkbox", () => {
        const radios = [...dialog().matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
        expect(radios).toHaveLength(2);
        for (const r of radios) expect(r).toContain('name="site-kind"');
        expect(radios[0]).toContain("checked");
        expect(radios[1]).not.toContain("checked");
        expect(dialog()).not.toContain('type="checkbox"');
    });
    it("each kind with the design's sentence, verbatim", () => {
        expect(text(dialog())).toContain("Shop or content site — products with prices; commerce (cart, checkout, orders) can be switched on later in Settings.");
        expect(text(dialog())).toContain("Catalog site — products without prices or ordering; visitors collect an interest list and send it to you. This choice is fixed for the life of the site.");
    });
});
