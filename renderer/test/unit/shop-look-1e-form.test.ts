import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { urlPrefixesOf, resolveLocaleStrings } from "@amodx/shared";

/**
 * SHOP-LOOK-1E (record docs/slices/shop-look-1e.md § 3) — the server pass for the `form` block (`prepareBlocks` →
 * `formForBlock` in `SitePage.tsx`), through the real `SitePage` (server render).
 *
 * The read is the REAL `getFormBySlug` of `renderer/src/lib/dynamo.ts`, wrapped in a spy that counts calls. Under it only
 * the DynamoDB document client is replaced, by a stub that answers a `GetCommand` with the exact-key item of the store
 * (or none) and throws for any other command — so one test counts helper calls and DynamoDB requests. Every other read
 * is a mock; Next's runtime-coupled modules, `CommentsSection` and `RenderBlocks` (a probe that prints its props) are
 * mocked as in `shop-look-1d-showcase.test.ts`.
 */

type Item = Record<string, any>;
const store = vi.hoisted(() => ({ items: [] as Item[], calls: [] as { name: string; input: any }[] }));
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
    const real: any = await importOriginal();
    return {
        ...real,
        DynamoDBDocumentClient: {
            from: () => ({
                send: async (c: any) => {
                    store.calls.push({ name: c.constructor.name, input: c.input });
                    if (c.constructor.name !== "GetCommand") throw new Error(`unmodelled ${c.constructor.name} ${JSON.stringify(c.input)}`);
                    const item = store.items.find((i) => i.PK === c.input.Key.PK && i.SK === c.input.Key.SK);
                    return item ? { Item: { ...item } } : {};
                },
            }),
        },
    };
});

const dynamo = vi.hoisted(() => ({
    getTenantConfig: vi.fn(), getContentBySlug: vi.fn(async (..._args: unknown[]) => null as any), getPosts: vi.fn(async () => []),
    getDeliveryConfig: vi.fn(async () => null), getProductBySlug: vi.fn(async (..._args: unknown[]) => null),
    getCategoryBySlug: vi.fn(async () => null), getProductsByCategory: vi.fn(), getActiveProducts: vi.fn(), getCatalogListing: vi.fn(async () => []),
    searchProducts: vi.fn(), getOrderForCustomer: vi.fn(async () => null), getSiteReviews: vi.fn(), getActiveCategoriesByIds: vi.fn(async () => []),
    hasActivePopups: vi.fn(async () => false), getAllCategories: vi.fn(), getProductById: vi.fn(), getProductReviews: vi.fn(),
}));
vi.mock("@/lib/dynamo", async (importOriginal) => {
    const real: any = await importOriginal();
    return { ...dynamo, getFormBySlug: vi.fn(real.getFormBySlug) };
});
vi.mock("next/navigation", () => ({
    permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
    redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
    usePathname: () => "/",
}));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn(async () => null) }));
vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: any) => React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));
vi.mock("next/script", () => ({ default: () => null }));
(globalThis as any).__react = React;
vi.mock("@/components/CommentsSection", () => ({ CommentsSection: () => null }));
vi.mock("@/components/RenderBlocks", () => ({
    RenderBlocks: (props: any) => (globalThis as any).__react.createElement("render-blocks-probe", { "data-props": JSON.stringify(props) }),
}));

process.env.TABLE_NAME = "amodx-table";

import { SitePage } from "@/components/SitePage";
import { getFormBySlug } from "@/lib/dynamo";
const formSpy = getFormBySlug as unknown as ReturnType<typeof vi.fn>;

function tenant(extra: Record<string, unknown> = {}) {
    return {
        id: "t1", name: "Site", domain: "t1.test", status: "LIVE", header: {}, navLinks: [], footerLinks: [], theme: {},
        integrations: {}, urlPrefixes: urlPrefixesOf(undefined), locale: "en-US", currency: "USD", commerceEnabled: true, ...extra,
    };
}

const FIELDS = [
    { id: "f1", label: "Name", type: "text", required: true },
    { id: "f2", label: "E-mail", type: "email", required: true, placeholder: "you@example.com" },
    { id: "f3", label: "Primary interest", type: "select", required: false, options: ["Hardwood", "Carpet"] },
    { id: "f4", label: "Message", type: "textarea", required: false },
];
/** A stored form and its slug pointer, as `backend/src/forms/create.ts` writes them. */
function storeForm(tenantId: string, slug: string, id: string, over: Item = {}) {
    store.items.push(
        { PK: `TENANT#${tenantId}`, SK: `FORMSLUG#${slug}`, Type: "FormSlug", formId: id, formName: `Form ${id}` },
        {
            PK: `TENANT#${tenantId}`, SK: `FORM#${id}`, Type: "Form", id, tenantId, name: `Form ${id}`, slug, fields: FIELDS,
            submitButtonText: "Send", successMessage: "Thanks!", notifyEmail: "owner@private.test", status: "active",
            createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...over,
        },
    );
}

const FORM = (attrs: Record<string, unknown> = {}) => ({ type: "form", attrs: { formSlug: "contact", eyebrow: "", headline: "", text: "", card: false, blockWidth: "content", ...attrs } });
const PARAGRAPH = { type: "paragraph", content: [{ type: "text", text: "Hello." }] };
const SHOWCASE = { type: "faq", attrs: { headline: "Q", items: [{ id: "1", question: "a", answer: "b" }] } };

const decoded = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
async function prepared(blocks: unknown[], config: any = tenant()): Promise<{ blocks: any[]; html: string }> {
    dynamo.getTenantConfig.mockResolvedValue(config);
    dynamo.getContentBySlug.mockImplementation(async () => ({
        id: "n1", nodeId: "n1", slug: "/about", title: "About", status: "Published", accessPolicy: { type: "Public" },
        commentsMode: "Hidden", hideSharing: true, blocks: structuredClone(blocks),
    }));
    const html = renderToStaticMarkup((await SitePage({ siteId: "t1", slug: ["about"], preview: false, basePath: "", sessionToken: null, query: {}, cacheable: true })) as any);
    const m = html.match(/<render-blocks-probe data-props="([^"]*)"/);
    if (!m) throw new Error("RenderBlocks not rendered");
    return { blocks: JSON.parse(decoded(m[1])).blocks, html };
}
const gets = () => store.calls.filter((c) => c.name === "GetCommand").map((c) => c.input.Key);
const EN_TEXTS = (() => { const s = resolveLocaleStrings({}).strings.site; return { formSubmissionFailed: s.formSubmissionFailed, formErrorShort: s.formErrorShort, formSelectPlaceholder: s.formSelectPlaceholder, formSubmitting: s.formSubmitting }; })();

beforeEach(() => {
    store.items = [];
    store.calls = [];
    formSpy.mockClear();
    storeForm("t1", "contact", "form-1");
});

describe("slug set, form active: `_form` built field by field", () => {
    it("exactly { slug, name, fields, submitButtonText, successMessage, strings } — never the notify address, keys, status or dates", async () => {
        const { blocks, html } = await prepared([FORM()]);
        expect(blocks[0].attrs._form).toEqual({ slug: "contact", name: "Form form-1", fields: FIELDS, submitButtonText: "Send", successMessage: "Thanks!", strings: EN_TEXTS });
        expect(html).not.toContain("owner@private.test");
        expect(html).not.toContain("TENANT#t1");
        expect(Object.keys(blocks[0].attrs).sort()).toEqual(["_form", "blockWidth", "card", "eyebrow", "formSlug", "headline", "text"]);
    });

    it("one getFormBySlug for the block: two keyed GetCommands, both under TENANT#<this tenant>", async () => {
        await prepared([FORM()]);
        expect(formSpy.mock.calls).toEqual([["t1", "contact"]]);
        expect(gets()).toEqual([{ PK: "TENANT#t1", SK: "FORMSLUG#contact" }, { PK: "TENANT#t1", SK: "FORM#form-1" }]);
        expect(store.calls.map((c) => c.name)).toEqual(["GetCommand", "GetCommand"]);
    });

    it("one call PER BLOCK: two form blocks → two calls, four GetCommands", async () => {
        storeForm("t1", "quote", "form-2");
        const { blocks } = await prepared([FORM(), FORM({ formSlug: "quote" })]);
        expect(formSpy.mock.calls).toEqual([["t1", "contact"], ["t1", "quote"]]);
        expect(gets()).toHaveLength(4);
        expect(blocks.map((b) => b.attrs._form.slug)).toEqual(["contact", "quote"]);
    });

    it("the stored slug is trimmed for the read; `_form.slug` is the slug read", async () => {
        const { blocks } = await prepared([FORM({ formSlug: "  contact " })]);
        expect(formSpy.mock.calls).toEqual([["t1", "contact"]]);
        expect(blocks[0].attrs._form.slug).toBe("contact");
        expect(blocks[0].attrs.formSlug).toBe("  contact ");
    });

    it("the texts are the tenant's locale table: RO pack, and a stored override", async () => {
        const ro = (await prepared([FORM()], tenant({ locale: "ro-RO" }))).blocks[0].attrs._form.strings;
        const roSite = resolveLocaleStrings({ locale: "ro-RO" }).strings.site;
        expect(ro).toEqual({ formSubmissionFailed: roSite.formSubmissionFailed, formErrorShort: roSite.formErrorShort, formSelectPlaceholder: roSite.formSelectPlaceholder, formSubmitting: roSite.formSubmitting });
        expect(ro.formSelectPlaceholder).not.toBe(EN_TEXTS.formSelectPlaceholder);
        const own = (await prepared([FORM()], tenant({ siteStrings: { formSubmitting: "Wait…" } }))).blocks[0].attrs._form.strings;
        expect(own.formSubmitting).toBe("Wait…");
    });

    it("fields: the stored entries that are fields, the first field of each label (the submit handler's rule)", async () => {
        store.items = [];
        storeForm("t1", "contact", "form-1", { fields: [
            { id: "a", label: "Name", type: "text", required: true, extra: "dropped" },
            { id: "b", label: "Name", type: "checkbox", required: true },
            { id: "c", type: "text" },
            { id: "d", label: "Kind", type: "radio" },
            "not a field",
            { id: "e", label: "City", type: "text" },
        ] });
        const { blocks } = await prepared([FORM()]);
        expect(blocks[0].attrs._form.fields).toEqual([{ id: "a", label: "Name", type: "text", required: true }, { id: "e", label: "City", type: "text", required: false }]);
    });

    it("stored texts that are not strings → \"\" (no code-added text); no fields stored → []", async () => {
        store.items = [];
        storeForm("t1", "contact", "form-1", { name: 3, fields: undefined, submitButtonText: null, successMessage: undefined });
        const { blocks } = await prepared([FORM()]);
        expect(blocks[0].attrs._form).toMatchObject({ name: "", fields: [], submitButtonText: "", successMessage: "" });
    });
});

describe("no `_form`: the block draws nothing", () => {
    it("no slug (blank, spaces, not a string, absent): no call, no request, the attrs unchanged", async () => {
        for (const formSlug of ["", "   ", 7, null, undefined]) {
            store.calls = [];
            formSpy.mockClear();
            const block = FORM({ formSlug });
            const { blocks } = await prepared([block]);
            expect(formSpy).not.toHaveBeenCalled();
            expect(store.calls).toEqual([]);
            expect(blocks[0]).toEqual(JSON.parse(JSON.stringify(block)));
        }
    });

    it("a slug of no form: one call, one GetCommand, no `_form`", async () => {
        const { blocks } = await prepared([FORM({ formSlug: "missing" })]);
        expect(gets()).toEqual([{ PK: "TENANT#t1", SK: "FORMSLUG#missing" }]);
        expect(blocks[0].attrs).not.toHaveProperty("_form");
    });

    it("a disabled form: two GetCommands, no `_form`", async () => {
        store.items = [];
        storeForm("t1", "contact", "form-1", { status: "disabled" });
        const { blocks } = await prepared([FORM()]);
        expect(gets()).toHaveLength(2);
        expect(blocks[0].attrs).not.toHaveProperty("_form");
    });

    it("another tenant's form of the same slug is never read: only TENANT#t1 keys", async () => {
        store.items = [];
        storeForm("t2", "contact", "form-t2");
        const { blocks } = await prepared([FORM()]);
        expect(gets()).toEqual([{ PK: "TENANT#t1", SK: "FORMSLUG#contact" }]);
        expect(blocks[0].attrs).not.toHaveProperty("_form");
    });
});

describe("no other block changes", () => {
    it("the other blocks of a page with a form block keep their payload; a page without the block makes no form read", async () => {
        const others = [PARAGRAPH, SHOWCASE];
        const without = (await prepared(others)).blocks;
        expect(formSpy).not.toHaveBeenCalled();
        expect(store.calls).toEqual([]);
        const withForm = (await prepared([PARAGRAPH, FORM(), SHOWCASE])).blocks;
        expect([withForm[0], withForm[2]]).toEqual(without);
    });
});

// STAY-1A (docs/slices/stay-1.md § 2, Build record): a form with date fields. The fields keep their `min`; `_form` gets
// `dateOrder` only when the stored pair rule names two date fields of the form (a client hint), else no key.
describe("STAY-1A — date fields and the pair rule in `_form`", () => {
    const STAY = [
        { id: "a", label: "Arrival", type: "date", required: true, min: "today" },
        { id: "d", label: "Departure", type: "date", required: false },
        { id: "r", label: "Room", type: "text", required: true },
    ];

    it("a valid rule → `_form.dateOrder` = its two ids; the date fields as stored", async () => {
        store.items = [];
        storeForm("t1", "contact", "form-1", { fields: STAY, dateOrder: { earlier: "a", later: "d" } });
        const { blocks } = await prepared([FORM()]);
        expect(blocks[0].attrs._form).toEqual({ slug: "contact", name: "Form form-1", fields: STAY, submitButtonText: "Send", successMessage: "Thanks!", strings: EN_TEXTS, dateOrder: { earlier: "a", later: "d" } });
    });

    it("a stored rule that does not resolve (names a text field) → no dateOrder key", async () => {
        store.items = [];
        storeForm("t1", "contact", "form-1", { fields: STAY, dateOrder: { earlier: "a", later: "r" } });
        const { blocks } = await prepared([FORM()]);
        expect(Object.hasOwn(blocks[0].attrs._form, "dateOrder")).toBe(false);
    });
});
