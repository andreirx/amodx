// CM1 showcase DOM probe — slice cat-mode-1, cycle 2 (CM1-SHOWCASE-CLOSURE; spec § 3.2.6). A COMMITTED TEST, run by
// contract row `(cm1-catalog-showcase-dom)` on every `npm run test:serving` — not an operator probe.
//
// WHY A CHILD PROCESS WITH A DOM: the `categoryShowcase` block's browser fallback (it fetches
// `/public/categories/{slug}` in `useEffect` when the server sent no `prefetchedProducts`) never runs in an HTTP
// capture — only a browser runs effects. This script renders the BUILT plugin component (`@amodx/plugins` dist, the
// code the renderer bundles) into a jsdom document with a mocked `fetch`, lets the effect resolve, and prints what
// the DOM holds as one JSON line. Contract row `(cm1-catalog-showcase-dom)` spawns it, so the jsdom globals never
// touch the suite's own process.
//
// Four cases: {browser fallback, stale authored prefetch} × {`_catalogMode: true`, absent}. The cases without
// `_catalogMode` are the positive controls: they MUST show the price and "Out of Stock", or the probe is blind.
//
// Dependencies: React and react-dom are resolved from the plugin package's location (one React instance — the
// plugin's); jsdom from `renderer`, which declares it (`devDependencies` `"jsdom": "28.1.0"`, cat-mode-1 cycle 3). If
// jsdom cannot be resolved this script exits 1 — the row fails, it never skips. Credential-free: no network, `fetch`
// is a local function.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const fromRenderer = createRequire(new URL("../../package.json", import.meta.url));
const pluginRender = fromRenderer.resolve("@amodx/plugins/render");
const fromPlugin = createRequire(pluginRender);
let JSDOM;
try {
    ({ JSDOM } = fromRenderer("jsdom"));
} catch (e) {
    console.error(`cm1-showcase-dom: jsdom (a renderer devDependency) not resolvable: ${e.message}`);
    process.exit(1);
}

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://probe.serving-contract.test/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MutationObserver"]) {
    Object.defineProperty(globalThis, key, { value: dom.window[key] ?? dom.window, configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import(pathToFileURL(fromPlugin.resolve("react")).href);
const { createRoot } = await import(pathToFileURL(fromPlugin.resolve("react-dom/client")).href);
const { CategoryShowcaseRender } = await import(
    pathToFileURL(fromPlugin.resolve("@amodx/plugins/render").replace(/render\.js$/, "category-showcase/CategoryShowcaseRender.js")).href
);
const act = React.act;

/** A product as the public category endpoint (or a stale authored attr) would carry it: priced and out of stock. */
const PRODUCT = {
    id: "dom-1", title: "Probe Item", slug: "probe-item", price: "12.00", currency: "USD",
    availability: "out_of_stock", imageLink: "https://img.serving-contract.test/probe.jpg", volumePricing: [],
};

async function render(attrs) {
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(String(url));
        return { ok: true, status: 200, json: async () => ({ products: [PRODUCT] }) };
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(CategoryShowcaseRender, { attrs, tenantId: "cm1-probe" })));
    for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
    const html = host.innerHTML;
    await act(async () => root.unmount());
    host.remove();
    return { fetched: calls, html };
}

const base = { categorySlug: "probe-category", categoryName: "Probe", limit: 4, columns: "4", showPrice: true, ctaText: "" };
const results = {};
for (const [name, attrs] of [
    ["fallbackCatalog", { ...base, _catalogMode: true }],
    ["fallbackCommerce", { ...base }],
    ["staleCatalog", { ...base, _catalogMode: true, prefetchedProducts: [PRODUCT] }],
    ["staleCommerce", { ...base, prefetchedProducts: [PRODUCT] }],
]) {
    const { fetched, html } = await render(attrs);
    results[name] = {
        fetched: fetched.length,
        title: html.includes("Probe Item"),
        price: html.includes("12.00"),
        currency: html.includes("USD"),
        outOfStock: html.includes("Out of Stock"),
    };
}
console.log(JSON.stringify(results));
