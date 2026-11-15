import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * CATEGORY-CONTENT-1 (docs/slices/category-content-1.md, rule 4; review-0 findings 1 and 2) — the category editor's
 * "Page content", through the REAL component function and its REAL callbacks: the load effect, the block editor's
 * `onChange`, the field handlers, the image upload and Save, with the POST / PUT bodies captured.
 *
 * The admin tests run in Node without a DOM (vitest.config.ts) and the slice adds no dependency, so the component is run
 * by a small deterministic hook store: `useState` / `useEffect` of `react` are replaced (state slots by call order,
 * effects run after a render when their deps change, cleanups first); everything else of React is the real module.
 * `render()` calls `CategoryEditor()` and answers its element tree; the tests find the elements in it and call their
 * handlers, exactly as the browser would. Mocked: the router (`id`), the tenant (`h.tenant`: null while the admin resolves
 * it, then a site), `apiRequest` and `uploadFile` (each a deferred promise the test resolves when it wants — the delays of
 * the reviews' scenarios), `BlockEditor` (a marker: its props are what the test reads).
 *
 * The editor's DOCUMENT is modelled as `BlockEditor` keeps it (review-1): it reads `initialContent` once, when an editor
 * with a new key mounts, and afterwards changes only by its own edits (`type`). `shown(tree)` is that document; every
 * Save asserts that the saved `blocks` are the shown document — the guarantee of rule 4.
 */

const h = vi.hoisted(() => {
    type Effect = { deps: unknown[] | undefined; cleanup?: (() => void) | void };
    const store = { slots: [] as unknown[], effects: [] as Effect[], slot: 0, effect: 0, pending: [] as (() => void)[], changed: false };
    const deferred = () => {
        let resolve!: (v: any) => void, reject!: (e: any) => void;
        const promise = new Promise<any>((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
    };
    return {
        store, deferred,
        params: { id: "c1" as string | undefined },
        tenant: { id: "t1" } as { id: string } | null,
        /** The document of each mounted editor, by its key (see the file header). */
        docs: new Map<unknown, unknown>(),
        navigate: vi.fn(),
        calls: [] as { path: string; init?: any; reply: ReturnType<typeof deferred> }[],
        uploads: [] as ReturnType<typeof deferred>[],
        useState(init: unknown) {
            const i = store.slot++;
            if (!(i in store.slots)) store.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
            const set = (v: unknown) => { store.slots[i] = typeof v === "function" ? (v as (p: unknown) => unknown)(store.slots[i]) : v; store.changed = true; };
            return [store.slots[i], set];
        },
        useEffect(fn: () => (() => void) | void, deps?: unknown[]) {
            const i = store.effect++;
            const prev = store.effects[i];
            if (prev && deps && prev.deps && deps.length === prev.deps.length && deps.every((d, k) => Object.is(d, prev.deps![k]))) return;
            store.pending.push(() => {
                prev?.cleanup?.();
                store.effects[i] = { deps, cleanup: fn() };
            });
        },
    };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<any>()), useState: h.useState, useEffect: h.useEffect }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ id: h.params.id }), useNavigate: () => h.navigate }));
vi.mock("@/context/TenantContext", () => ({ useTenant: () => ({ currentTenant: h.tenant }) }));
vi.mock("@/lib/api", () => ({
    apiRequest: (path: string, init?: any) => {
        const reply = h.deferred();
        h.calls.push({ path, init, reply });
        return reply.promise;
    },
}));
vi.mock("@/lib/upload", () => ({ uploadFile: () => { const d = h.deferred(); h.uploads.push(d); return d.promise; } }));
vi.mock("@/components/editor/BlockEditor", () => ({ BlockEditor: function BlockEditorMarker() { return null; } }));

import CategoryEditor, { categoryFormOf } from "./CategoryEditor";
import { BlockEditor } from "@/components/editor/BlockEditor";

// ── the harness ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A render of the real component, then its due effects (as React commits them); an effect that set state renders again
 * (as React does), so the answer is the tree the screen shows once the commit has settled.
 */
function render(): any {
    for (let pass = 0; pass < 5; pass++) {
        h.store.slot = 0;
        h.store.effect = 0;
        const tree = (CategoryEditor as any)();
        // An editor with a key not seen before mounts now and reads its initial document once.
        const editor = all(tree).find((n) => n.type === BlockEditor);
        if (editor && !h.docs.has(editor.key)) h.docs.set(editor.key, editor.props.initialContent);
        h.store.changed = false;
        for (const run of h.store.pending.splice(0)) run();
        if (!h.store.changed) return tree;
    }
    throw new Error("render did not settle in 5 passes");
}
/** Let every resolved promise run its `then` (the component's async callbacks). */
const settle = () => new Promise((r) => setTimeout(r, 0));

function children(node: any): any[] {
    if (node === null || node === undefined || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(children);
    return [node, ...children(node.props?.children)];
}
const all = (tree: any) => children(tree);
const textOf = (node: any): string => (typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(textOf).join("") : node?.props ? textOf(node.props.children) : "");
const editorOf = (tree: any) => all(tree).find((n) => n.type === BlockEditor);
const fileInput = (tree: any) => all(tree).find((n) => n.type === "input" && n.props.type === "file");
const saveButton = (tree: any) => all(tree).find((n) => typeof n.props?.onClick === "function" && textOf(n).includes("Save"));
/** The document the owner sees in the editor of `tree`. */
const shown = (tree: any) => h.docs.get(editorOf(tree).key);
/** The owner edits the blocks in the editor of `tree` (its document changes, then its `onChange` runs). */
function type(tree: any, blocks: unknown[]) {
    const editor = editorOf(tree);
    h.docs.set(editor.key, blocks);
    editor.props.onChange(blocks);
}
/** The control whose `placeholder` is given (the Input / Textarea of a field). */
const field = (tree: any, placeholder: string) => all(tree).find((n) => n.props?.placeholder === placeholder);

/** The first pending API call to `path` (asserted to exist). */
function call(path: string) {
    const c = h.calls.find((x) => x.path === path && !(x as any).done);
    expect(c, `a request to ${path}`).toBeDefined();
    (c as any).done = true;
    return c!;
}
/** Route to `id`, render, answer nothing yet. */
function open(id: string) {
    h.params.id = id;
    return render();
}
async function answer(path: string, data: any) {
    call(path).reply.resolve(data);
    await settle();
    return render();
}
/** Click Save; answer the request; return its method, path and parsed body. */
async function save(tree: any) {
    const before = h.calls.length;
    const done = saveButton(tree).props.onClick();
    const req = h.calls[before];
    expect(req, "Save sent a request").toBeDefined();
    req.reply.resolve({});
    await done;
    const body = JSON.parse(req.init.body);
    // Rule 4: what Save sends is what the editor shows.
    expect(body.blocks, "saved blocks = the editor's shown document").toEqual(shown(tree));
    return { method: req.init.method, path: req.path, body };
}

const BLOCKS_C1 = [{ type: "paragraph", content: [{ type: "text", text: "OLD" }] }];
const BLOCKS_C2 = [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Category two" }] }];
const NEW_BLOCKS = [{ type: "heading", content: [{ type: "text", text: "NEW" }] }];
const C1 = { id: "c1", name: "Boen", slug: "boen", description: "Plain text.", parentId: null, sortOrder: 2, imageLink: "", seoTitle: "", seoDescription: "", status: "active", blocks: BLOCKS_C1 };
const C2 = { ...C1, id: "c2", name: "Alpod", slug: "alpod", blocks: BLOCKS_C2 };

beforeEach(() => {
    h.store.slots = [];
    h.store.effects = [];
    h.store.pending = [];
    h.store.changed = false;
    h.params.id = "c1";
    h.tenant = { id: "t1" };
    h.docs.clear();
    h.calls.length = 0;
    h.uploads.length = 0;
    h.navigate.mockReset();
    vi.stubGlobal("alert", vi.fn());
});

// ── rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("CategoryEditor — load, edit, save (rule 4)", () => {
    it("load: no editor and no Save until the category's data is in; then the editor opens on the stored blocks", async () => {
        let tree = open("c1");
        expect(editorOf(tree)).toBeUndefined();
        expect(saveButton(tree)).toBeUndefined();
        await answer("/categories", { items: [] });
        tree = await answer("/categories/c1", C1);
        expect(editorOf(tree).props.initialContent).toEqual(BLOCKS_C1);
        expect(shown(tree)).toEqual(BLOCKS_C1);
    });

    it("a category without blocks (absent, or not a list) opens an empty editor; Save sends blocks: []", async () => {
        for (const blocks of [undefined, "x"]) {
            h.store.slots = []; h.store.effects = []; h.calls.length = 0; h.docs.clear();
            open("c1");
            const tree = await answer("/categories/c1", { ...C1, blocks });
            expect(editorOf(tree).props.initialContent, JSON.stringify(blocks)).toEqual([]);
            expect((await save(tree)).body.blocks).toEqual([]);
        }
    });

    it("edit + save: the PUT body carries the edited blocks and every loaded field", async () => {
        open("c1");
        let tree = await answer("/categories/c1", C1);
        type(tree, NEW_BLOCKS);
        tree = render();
        expect(await save(tree)).toEqual({ method: "PUT", path: "/categories/c1", body: { ...categoryFormOf(C1), blocks: NEW_BLOCKS } });
    });

    it("handlers of an OLDER render (the block editor's first onChange, a field's old onChange) never write an older copy back", async () => {
        open("c1");
        const first = await answer("/categories/c1", C1);
        // Both callbacks are taken from the same (first) render, as Tiptap may keep its first onChange.
        type(first, NEW_BLOCKS);
        field(first, "Brief description of this category...").props.onChange({ target: { value: "New description." } });
        field(first, "Category page title for search engines").props.onChange({ target: { value: "SEO title" } });
        const body = (await save(render())).body;
        expect(body.blocks).toEqual(NEW_BLOCKS);
        expect(body.description).toBe("New description.");
        expect(body.seoTitle).toBe("SEO title");
    });

    it("review-0 finding 1: an image upload that ends AFTER a block edit keeps the edit; Save sends both", async () => {
        open("c1");
        const tree = await answer("/categories/c1", C1);
        // The upload starts, and is slow.
        const uploading = fileInput(tree).props.onChange({ target: { files: [new Blob(["x"])] } });
        type(render(), NEW_BLOCKS);
        h.uploads[0].resolve("https://cdn.test/boen.jpg");
        await uploading;
        const body = (await save(render())).body;
        expect(body.blocks).toEqual(NEW_BLOCKS);
        expect(body.imageLink).toBe("https://cdn.test/boen.jpg");
    });

    it("an image upload that ends after the owner moved to another category changes nothing there", async () => {
        open("c1");
        const tree = await answer("/categories/c1", C1);
        const uploading = fileInput(tree).props.onChange({ target: { files: [new Blob(["x"])] } });
        open("c2");
        await answer("/categories/c2", C2);
        h.uploads[0].resolve("https://cdn.test/boen.jpg");
        await uploading;
        const { path, body } = await save(render());
        expect(path).toBe("/categories/c2");
        expect(body).toEqual(categoryFormOf(C2));
    });
});

describe("CategoryEditor — the category changes while a load is slow (review-0 finding 2)", () => {
    it("c1 → c2: the late c1 answer is dropped; the editor mounts once, on c2's blocks; Save writes c2", async () => {
        open("c1");
        const c1Load = call("/categories/c1");
        let tree = open("c2");
        expect(editorOf(tree)).toBeUndefined(); // the c1 form is never shown for c2
        tree = await answer("/categories/c2", C2);
        c1Load.reply.resolve(C1); // the old answer arrives last
        await settle();
        tree = render();
        expect(editorOf(tree).props.initialContent).toEqual(BLOCKS_C2);
        expect(shown(tree)).toEqual(BLOCKS_C2);
        expect(await save(tree)).toEqual({ method: "PUT", path: "/categories/c2", body: categoryFormOf(C2) });
    });

    it("c1 loaded → c2 (slow): until c2's data is in, neither c1's editor nor Save is shown", async () => {
        open("c1");
        await answer("/categories/c1", C1);
        const tree = open("c2");
        expect(editorOf(tree)).toBeUndefined();
        expect(saveButton(tree)).toBeUndefined();
        expect(editorOf(await answer("/categories/c2", C2)).props.initialContent).toEqual(BLOCKS_C2);
    });

    it("c1 (slow) → new: an empty form after the first commit; the late c1 answer is dropped; Save POSTs only what the owner typed", async () => {
        open("c1");
        const c1Load = call("/categories/c1");
        let tree = open("new");
        expect(editorOf(tree).props.initialContent).toEqual([]);
        expect(shown(tree)).toEqual([]);
        c1Load.reply.resolve(C1);
        await settle();
        tree = render();
        expect(editorOf(tree).props.initialContent).toEqual([]);
        field(tree, "e.g. Birthday Cookies").props.onChange({ target: { value: "Krono Floors" } });
        type(tree, NEW_BLOCKS);
        expect(await save(render())).toEqual({
            method: "POST", path: "/categories",
            body: { ...categoryFormOf({}), name: "Krono Floors", slug: "krono-floors", blocks: NEW_BLOCKS },
        });
    });

    it("a load failure of an older category does not alert or leave the current one", async () => {
        open("c1");
        const c1Load = call("/categories/c1");
        open("c2");
        c1Load.reply.reject(new Error("boom"));
        await settle();
        expect(globalThis.alert).not.toHaveBeenCalled();
        expect(h.navigate).not.toHaveBeenCalled();
        expect(editorOf(await answer("/categories/c2", C2)).props.initialContent).toEqual(BLOCKS_C2);
    });
});

describe("CategoryEditor — an editing session is a category AND a tenant AND a visit (review-1)", () => {
    const upload = (tree: any) => fileInput(tree).props.onChange({ target: { files: [new Blob(["x"])] } });
    /** The parent options offered (the fixture parent ids start with "p-"; the status options are "active" / "hidden"). */
    const parentValues = (tree: any) => all(tree).filter((n) => typeof n.props?.value === "string" && n.props.value.startsWith("p-") && !n.props.onValueChange).map((n) => n.props.value);

    it("initial tenant resolution (null → t1): no form, no editor and no Save before the tenant is known; then one editor on [] and Save sends what it shows", async () => {
        h.tenant = null;
        let tree = open("new");
        expect(editorOf(tree)).toBeUndefined();
        expect(saveButton(tree)).toBeUndefined();
        expect(h.calls).toHaveLength(0);
        h.tenant = { id: "t1" };
        tree = render();
        expect(shown(tree)).toEqual([]);
        field(tree, "e.g. Birthday Cookies").props.onChange({ target: { value: "Boen" } });
        type(tree, NEW_BLOCKS);
        const { method, body } = await save(render());
        expect(method).toBe("POST");
        expect(body.blocks).toEqual(NEW_BLOCKS);
    });

    it("tenant change on a new draft (t1 → t2): a NEW editor on the new, empty form — the shown document and the saved blocks agree; t1's pending upload changes nothing", async () => {
        let tree = open("new");
        const firstKey = editorOf(tree).key;
        field(tree, "e.g. Birthday Cookies").props.onChange({ target: { value: "Boen" } });
        type(tree, NEW_BLOCKS);
        const uploading = upload(render());
        h.tenant = { id: "t2" };
        tree = render();
        expect(editorOf(tree).key).not.toBe(firstKey);
        expect(shown(tree)).toEqual([]);
        h.uploads[0].resolve("https://cdn.test/T1-DRAFT.jpg");
        await uploading;
        field(render(), "e.g. Birthday Cookies").props.onChange({ target: { value: "Alpod" } });
        const { body } = await save(render());
        expect(body).toEqual({ ...categoryFormOf({}), name: "Alpod", slug: "alpod", blocks: [] });
    });

    it("tenant change on a loaded category (t1 → t2): hidden until t2's answer; a new editor on t2's blocks; t1's parent options never shown under t2", async () => {
        open("c1");
        await answer("/categories", { items: [{ id: "p-t1", name: "T1 Parent", parentId: null }] });
        let tree = await answer("/categories/c1", C1);
        expect(parentValues(tree)).toContain("p-t1");
        const t1Key = editorOf(tree).key;
        // Switch: the requests of t2 are sent; nothing is answered yet.
        h.tenant = { id: "t2" };
        tree = render();
        expect(editorOf(tree)).toBeUndefined();
        expect(saveButton(tree)).toBeUndefined();
        // t2's category answers first; its parent list is still pending.
        tree = await answer("/categories/c1", { ...C1, name: "Boen T2", blocks: BLOCKS_C2 });
        expect(editorOf(tree).key).not.toBe(t1Key);
        expect(shown(tree)).toEqual(BLOCKS_C2);
        expect(parentValues(tree)).not.toContain("p-t1");
        tree = await answer("/categories", { items: [{ id: "p-t2", name: "T2 Parent", parentId: null }] });
        expect(parentValues(tree)).toEqual(["p-t2"]);
        const { path, body } = await save(tree);
        expect(path).toBe("/categories/c1");
        expect(body).toEqual(categoryFormOf({ ...C1, name: "Boen T2", blocks: BLOCKS_C2 }));
    });

    it("tenant change while t1's answers are pending: the late t1 category and parent list are dropped; t2's are shown", async () => {
        open("c1");
        h.tenant = { id: "t2" };
        let tree = render();
        // Pending, in order: t1 list, t1 category, t2 list, t2 category. t1's answers arrive late.
        tree = await answer("/categories", { items: [{ id: "p-t1", name: "T1 Parent", parentId: null }] });
        tree = await answer("/categories/c1", C1);
        expect(editorOf(tree)).toBeUndefined();
        tree = await answer("/categories", { items: [{ id: "p-t2", name: "T2 Parent", parentId: null }] });
        tree = await answer("/categories/c1", { ...C1, name: "Boen T2", blocks: BLOCKS_C2 });
        expect(shown(tree)).toEqual(BLOCKS_C2);
        expect(parentValues(tree)).toEqual(["p-t2"]);
        expect((await save(tree)).body.name).toBe("Boen T2");
    });

    it("\"new\" → c1 → \"new\" with the first draft's upload pending: the second draft is another session; the old upload changes nothing in it", async () => {
        let tree = open("new");
        const firstKey = editorOf(tree).key;
        const uploading = upload(tree);
        open("c1");
        await answer("/categories/c1", C1);
        tree = open("new");
        expect(editorOf(tree).key).not.toBe(firstKey);
        expect(shown(tree)).toEqual([]);
        field(tree, "e.g. Birthday Cookies").props.onChange({ target: { value: "Second" } });
        type(render(), NEW_BLOCKS);
        h.uploads[0].resolve("https://cdn.test/FIRST-DRAFT.jpg");
        await uploading;
        const { body } = await save(render());
        expect(body.imageLink).toBe("");
        expect(body.blocks).toEqual(NEW_BLOCKS);
        expect(body.name).toBe("Second");
    });

    it("an older render's block-editor onChange after a new session started changes nothing in the new session", async () => {
        let tree = open("new");
        const oldEditor = editorOf(tree);
        h.tenant = { id: "t2" };
        tree = render();
        oldEditor.props.onChange(NEW_BLOCKS); // the unmounted editor of the old session fires late
        const { body } = await save((field(render(), "e.g. Birthday Cookies").props.onChange({ target: { value: "X" } }), render()));
        expect(body.blocks).toEqual([]);
    });
});

describe("CategoryEditor — the section and the load mapping", () => {
    it("the \"Page content\" card holds the help line and the block editor (English)", async () => {
        open("c1");
        const tree = await answer("/categories/c1", C1);
        const card = all(tree).find((n) => children(n.props?.children).some((c) => textOf(c) === "Page content") && children(n.props?.children).some((c) => c.type === BlockEditor));
        expect(card).toBeDefined();
        expect(textOf(card)).toContain("Shown on the category page after the title and before the product list.");
    });

    it("categoryFormOf: the stored fields, blocks = the stored list or []", () => {
        expect(categoryFormOf(C1)).toEqual({
            name: "Boen", slug: "boen", description: "Plain text.", parentId: null, sortOrder: 2, imageLink: "",
            seoTitle: "", seoDescription: "", status: "active", blocks: BLOCKS_C1,
        });
        for (const blocks of [undefined, null, "x", { type: "paragraph" }]) expect(categoryFormOf({ ...C1, blocks }).blocks).toEqual([]);
    });
});
