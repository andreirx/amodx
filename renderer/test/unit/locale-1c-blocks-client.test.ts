// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import React, { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import * as shared from "@amodx/shared";
import { RENDER_LOADERS } from "@amodx/plugins/render";
// The § 8.5 extraction (locale-1/extract.mjs, importable under jsdom; the locale-1d precedent).
import { extractVisibleText, textChanges } from "../serving-contract/locale-1/extract.mjs";

/**
 * LOCALE-1C (docs/slices/locale-1.md § 8.5 "client-only states", § 10 row `locale-1c`, § 16.2 items 4-5) — the block
 * renderers of `packages/plugins` show most of their fixed texts only after an interaction or a browser fetch (the contact
 * and lead forms while sending, after success or failure; the code block's "Copied!"; the reviews' "Read more" / "Show
 * less"; the post grid's fetched list, its empty and its failed state; the category showcase's empty list). Here each
 * block is loaded through its registry entry (`RENDER_LOADERS`, the built `@amodx/plugins/render` that RenderBlocks uses),
 * mounted in jsdom (or rendered with react-dom/server for the blocks whose texts are all server-rendered) and every
 * state of § 8.5 is driven. The block tests live in the renderer's unit suite because the plugins package has no DOM
 * test harness and no jsdom dependency (docs/slices/locale-1c.md D2).
 *
 * Two oracles per state (the locale-1d pattern):
 *  1. EN (an en-US tenant): the markup after every step equals `locale-1c-blocks-client-before.json`, rendered by THIS
 *     file from the slice's start commit 0c0dbc8 (capture mode `LOCALE_1C_CAPTURE=<file>`; procedure in the record). A
 *     date the runtime default formats (the post grid of an en-US tenant; a reviews `locale` the runtime cannot use) is
 *     replaced by a token on both sides and checked separately against the runtime default. Since
 *     LOCALE-REVIEWS-DATE-1 (human ruling 2026-11-01, ledger row L-ALL-2) the capture is compared with exactly one
 *     declared difference (`L_ALL_2` below): the review date of a carousel without its own non-empty `locale`
 *     attribute, "31 octombrie 2026" (absent) or the raw date string (`""`) → "October 31, 2026".
 *  2. RO (a ro-RO tenant): every visible-text change against the EN render is one declared key of the state (EN value →
 *     RO value) or a declared formatted value, and every declared key whose RO value differs changes.
 * Plus: the reviews-carousel date cases of § 3.4 under the LOCALE-REVIEWS-DATE-1 ruling (en-US, ro-RO, en-GB and de-DE
 * tenants; the non-string attribute cases), and the § 5.2
 * preservation cases at one direct reader of every block (absent → language default, "" → empty, "X" → X), EN and RO —
 * with the two iframe names as the named pattern-F exceptions ("" → the language default; ruling LOCALE1C-IFRAME-NAMES).
 * Mocked: `fetch`, the clipboard, the element heights jsdom does not compute, and `swiper/react` (pass-through
 * containers: swiper is an external package bound to the monorepo root's React copy, which the renderer's react-dom
 * cannot render in this runner; the carousel's own cards, which hold its texts, are real — and the real swiper markup
 * of both carousel styles is in the serving captures of the content home). Real: the eleven block renderers and the
 * resolver. The `strings` prop is what RenderBlocks passes (`blockStrings`); the 0c0dbc8 components ignore it.
 */
vi.mock("swiper/react", () => ({
    Swiper: ({ children }: { children?: React.ReactNode }) => createElement("div", { "data-swiper": "" }, children),
    SwiperSlide: ({ children }: { children?: React.ReactNode }) => createElement("div", { "data-swiper-slide": "" }, children),
}));

const BEFORE_FILE = fileURLToPath(new NodeURL("./locale-1c-blocks-client-before.json", import.meta.url));
const CAPTURE = process.env.LOCALE_1C_CAPTURE;

type Lang = "en" | "ro";
const LOCALE: Record<Lang, string> = { en: "en-US", ro: "ro-RO" };
/** The flat table of one language (site + commerce), for the expected values; read only outside capture mode. */
const TABLE = (lang: Lang): Record<string, any> => {
    const r = shared.resolveLocaleStrings({ locale: LOCALE[lang] }).strings;
    return { ...r.site, ...r.commerce };
};
/** The `strings` prop RenderBlocks gives every block (SitePage: `blockStrings(resolved, { catalogMode })`). In capture
 *  mode (the 0c0dbc8 tree, which has no `blockStrings`) no prop is passed — those components read none. */
function blockProps(lang: Lang, { catalogMode = false, input = {} as Record<string, unknown> } = {}) {
    if (CAPTURE) return {};
    return { strings: shared.blockStrings(shared.resolveLocaleStrings({ locale: LOCALE[lang], ...input }), { catalogMode }) };
}

const load = async (type: string) => (await RENDER_LOADERS[type]()).default as React.FC<any>;
const Contact = await load("contact");
const Lead = await load("leadMagnet");
const Hero = await load("hero");
const ImageBlock = await load("image");
const Video = await load("video");
const VideoHero = await load("videoHero");
const Carousel = await load("carousel");
const Code = await load("codeBlock");
const Reviews = await load("reviewsCarousel");
const Posts = await load("postGrid");
const Showcase = await load("categoryShowcase");

let root: Root | null = null;
let host: HTMLDivElement;
beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, "error").mockImplementation(() => {});   // the blocks log every failed request
});
afterAll(() => { vi.restoreAllMocks(); });
function reset() {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
}
afterEach(reset);
function mount(el: React.ReactElement) {
    host = document.createElement("div");
    document.body.appendChild(host);
    act(() => { root = createRoot(host); root.render(el); });
}
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const snap = () => host.innerHTML;
const ssr = (el: React.ReactElement) => renderToStaticMarkup(el);
/** A detached element holding server-rendered markup, for querying it. */
const domOf = (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d; };
async function submitForm() {
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
}
const response = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const stubFetch = (reply: () => Promise<unknown>) => vi.stubGlobal("fetch", vi.fn(reply));
const pending = () => new Promise(() => {});

// ── Runtime-default dates (§ 16.2 item 4: kept for an en-US tenant), tokenised for the capture ───────────────────────
const DATE = "2026-10-31T12:00:00.000Z";                       // midday UTC: the same calendar day in every time zone
const REVIEW_OPTS: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
const runtimePostDate = () => new Date(DATE).toLocaleDateString();
const runtimeReviewDate = () => new Date(DATE).toLocaleDateString(undefined, REVIEW_OPTS);
/** Replaces the text `text` (a whole text node) by `token`. */
const tokenise = (html: string, text: string, token: string) => html.split(`>${text}<`).join(`>${token}<`);
/** The review date of the carousel in a tenant's locale (the formatter's own options). */
const reviewDate = (locale: string) => new Date(DATE).toLocaleDateString(locale, REVIEW_OPTS);

// ── LOCALE-REVIEWS-DATE-1: the one declared en-US difference to the 0c0dbc8 capture (ledger row L-ALL-2) ───────────────
/** Per state and step: the review-date text the capture holds, which an en-US tenant now renders as
 *  `reviewDate("en-US")` ("October 31, 2026"). Absent attribute: "31 octombrie 2026" (the old `"ro-RO"` default);
 *  `""` (step 6 of reviews-dates): the raw date string (the caught RangeError). Every other step: no difference. */
const L_ALL_2: Record<string, Record<number, string>> = {
    "reviews-toggle": { 0: "31 octombrie 2026", 1: "31 octombrie 2026" },
    "reviews-dates": { 0: "31 octombrie 2026", 6: DATE },
};
const REVIEW_DATE_P = (text: string) => `<p class="text-xs text-muted-foreground">${text}</p>`;
/** The capture of one state with the declared L-ALL-2 differences applied; each declared text must occur exactly once. */
function withLedger(name: string, states: string[]): string[] {
    const steps = L_ALL_2[name] ?? {};
    return states.map((html, step) => {
        if (!Object.hasOwn(steps, step)) return html;
        const from = REVIEW_DATE_P(steps[step]);
        if (html.split(from).length !== 2) throw new Error(`${name} step ${step}: the declared date ${steps[step]} does not occur exactly once in the capture`);
        return html.replace(from, REVIEW_DATE_P(reviewDate("en-US")));
    });
}

// ── The states ───────────────────────────────────────────────────────────────────────────────────────────────────
/** A declared change: a key of the language table (filled with `values`), or a formatted value. */
type Spec = { key: string; values?: Record<string, string | number> } | { formatted: (lang: Lang) => string };
/** `title`: the literal test-title prefix of the state (cited by locale-1/1c/coverage.json). */
type State = { title: string; run: (lang: Lang) => Promise<string[]>; keys: Spec[] };
const K = (key: string, values?: Record<string, string | number>): Spec => ({ key, values });
const keys = (...names: string[]) => names.map((n) => K(n));
const render = (lang: Lang, s: Spec) => ("key" in s ? shared.fillTemplate(TABLE(lang)[s.key], s.values ?? {}) : s.formatted(lang));

const CONTACT = { headline: "Write to us", description: "We answer every message.", buttonText: "Send", tags: "t" };
const LEAD = { headline: "Rug care guide", description: "Free download.", buttonText: "Get the guide", resourceId: "r1" };
/** The four failure answers of the contact and lead forms: an error answer without a text, with a server text, a thrown
 *  error without a message, a thrown error with one. */
const FAILURES: (() => Promise<unknown>)[] = [
    async () => response(500, {}),
    async () => response(400, { error: "Rate limited" }),
    async () => { throw new Error(""); },
    async () => { throw new Error("Network down"); },
];
const PRODUCT = { id: "s1", title: "Plain Mat", slug: "plain-mat", price: "10.00", currency: "USD", availability: "out_of_stock" };
const SHOWCASE = { categorySlug: "mats", categoryName: "Featured", limit: 4, columns: "4", showPrice: true, ctaText: "" };
const POST = { id: "p1", slug: "/p1", title: "Post one", seoDescription: "About mats.", createdAt: DATE, tags: ["mats"], featuredImage: "" };
const REVIEW = (over: Record<string, unknown> = {}) => ({ headline: "Reviews", scope: "manual", showSource: false, items: [{ id: "r1", name: "Ana", date: DATE, rating: 5, text: "Soft and warm.", source: "manual" }], ...over });
/** The block `locale` attribute cases of § 3.4 (absent first). */
const REVIEW_LOCALES: (string | undefined)[] = [undefined, "ro-RO", "en-US", "ro-RO-u-nu-arab", "ro_RO", "xx-YY", ""];

const STATES: Record<string, State> = {
    "contact-form": {
        title: "[1c-client] contact-form",
        run: async (lang) => {
            const out: string[] = [];
            mount(createElement(Contact, { attrs: CONTACT, ...blockProps(lang) })); out.push(snap());
            stubFetch(pending);
            await submitForm(); out.push(snap());                                         // sending
            return out;
        },
        keys: keys("contactName", "contactEmail", "contactMessage", "contactSending"),
    },
    "contact-sent": {
        title: "[1c-client] contact-sent",
        run: async (lang) => {
            const out: string[] = [];
            mount(createElement(Contact, { attrs: CONTACT, ...blockProps(lang) }));
            stubFetch(async () => response(200, {}));
            await submitForm(); out.push(snap());                                         // sent, the default detail
            reset();
            mount(createElement(Contact, { attrs: { ...CONTACT, successMessage: "Thank you, we reply within a day." }, ...blockProps(lang) }));
            stubFetch(async () => response(200, {}));
            await submitForm(); out.push(snap());                                         // the block's own message wins
            return out;
        },
        keys: keys("contactSent", "contactSentDetail"),
    },
    "contact-errors": {
        title: "[1c-client] contact-errors",
        run: async (lang) => {
            const out: string[] = [];
            for (const reply of FAILURES) {
                mount(createElement(Contact, { attrs: CONTACT, ...blockProps(lang) }));
                stubFetch(reply);
                await submitForm(); out.push(snap());
                reset();
            }
            return out;
        },
        keys: keys("contactName", "contactEmail", "contactMessage", "contactSendFailed", "errorTryAgain"),
    },
    "lead-form": {
        title: "[1c-client] lead-form",
        run: async (lang) => {
            const out: string[] = [];
            mount(createElement(Lead, { attrs: LEAD, ...blockProps(lang) })); out.push(snap());
            stubFetch(pending);
            await submitForm(); out.push(snap());                                         // unlocking
            return out;
        },
        keys: keys("leadEmail", "leadEmailPlaceholder", "leadUnlocking"),
    },
    "lead-unlocked": {
        title: "[1c-client] lead-unlocked",
        run: async (lang) => {
            mount(createElement(Lead, { attrs: LEAD, ...blockProps(lang) }));
            stubFetch(async () => response(200, { downloadUrl: "https://files.serving-contract.test/guide.pdf" }));
            await submitForm();
            return [snap()];
        },
        keys: keys("leadUnlocked", "leadFileReady", "leadDownload"),
    },
    "lead-errors": {
        title: "[1c-client] lead-errors",
        run: async (lang) => {
            const out: string[] = [];
            for (const reply of FAILURES) {
                mount(createElement(Lead, { attrs: LEAD, ...blockProps(lang) }));
                stubFetch(reply);
                await submitForm(); out.push(snap());
                reset();
            }
            return out;
        },
        keys: keys("leadEmail", "leadEmailPlaceholder", "formSubmissionFailed", "errorTryAgain"),
    },
    "server-rendered-blocks": {
        title: "[1c-client] server-rendered-blocks",
        run: async (lang) => [
            ssr(createElement(Hero, { attrs: { style: "split", headline: "Mats", subheadline: "For every room.", ctaText: "", imageSrc: "" }, ...blockProps(lang) })),
            ssr(createElement(ImageBlock, { attrs: { src: "https://img.serving-contract.test/a.jpg", alt: "", width: "centered" }, ...blockProps(lang) })),
            ssr(createElement(ImageBlock, { attrs: { src: "https://img.serving-contract.test/a.jpg", alt: "A wool mat", width: "centered" }, ...blockProps(lang) })),
            ssr(createElement(Video, { attrs: { url: "https://www.youtube.com/watch?v=cm1video001", caption: "", width: "centered", autoplay: false }, ...blockProps(lang) })),
            ssr(createElement(Video, { attrs: { url: "https://www.youtube.com/watch?v=cm1video001", caption: "Workshop tour", width: "centered", autoplay: false }, ...blockProps(lang) })),
            ssr(createElement(VideoHero, { attrs: { videoSrc: "https://vimeo.com/123456789", headline: "" }, ...blockProps(lang) })),
            ssr(createElement(VideoHero, { attrs: { videoSrc: "https://vimeo.com/123456789", headline: "Handmade" }, ...blockProps(lang) })),
            ssr(createElement(Carousel, { attrs: { headline: "Gallery", style: "standard", items: [{ id: "g1", title: "Blank card", description: "", image: "", link: "#" }] }, ...blockProps(lang) })),
            ssr(createElement(Carousel, { attrs: { style: "coverflow", items: [{ id: "f1", title: "Blank slide", description: "", image: "", link: "/about" }] }, ...blockProps(lang) })),
        ],
        keys: keys("heroNoImage", "imageAltFallback", "videoTitle", "videoBackgroundTitle", "noImage", "noImageCaps", "carouselView"),
    },
    "code-copy": {
        title: "[1c-client] code-copy",
        run: async (lang) => {
            const out: string[] = [];
            Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
            mount(createElement(Code, { attrs: { code: "mats = 1", language: "plaintext", filename: "", showLineNumbers: false }, ...blockProps(lang) }));
            out.push(snap());
            await act(async () => { host.querySelector("button")!.click(); });
            await flush(); out.push(snap());                                              // copied
            return out;
        },
        keys: keys("codeCopy", "codeCopied"),
    },
    "reviews-toggle": {
        title: "[1c-client] reviews-toggle",
        run: async (lang) => {
            // jsdom computes no layout: the text is made taller than its clamp, so the card offers "Read more".
            const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
            Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 200 });
            try {
                const out: string[] = [];
                mount(createElement(Reviews, { attrs: REVIEW({ maxLines: 2 }), ...blockProps(lang) }));
                await flush(); out.push(snap());                                          // Read more
                await act(async () => { host.querySelector("button")!.click(); });
                out.push(snap());                                                         // Show less
                return out;
            } finally {
                if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scroll);
                else delete (HTMLElement.prototype as any).scrollHeight;
            }
        },
        // LOCALE-REVIEWS-DATE-1: the card's date follows the tenant (no `locale` attribute): en-US → ro-RO.
        keys: [...keys("reviewsReadMore", "reviewsShowLess"), { formatted: (lang) => reviewDate(LOCALE[lang]) }],
    },
    "reviews-dates": {
        title: "[1c-client] reviews-dates",
        // One server render per block `locale` attribute case of § 3.4 (absent first). LOCALE-REVIEWS-DATE-1: absent and
        // `""` follow the tenant (en-US "October 31, 2026", ro-RO "31 octombrie 2026"), the declared formatted value; the
        // non-empty attribute cases render the same for both tenants.
        run: async (lang) => REVIEW_LOCALES.map((locale) => {
            const html = ssr(createElement(Reviews, { attrs: REVIEW(locale === undefined ? {} : { locale }), ...blockProps(lang) }));
            return locale === "xx-YY" ? tokenise(html, runtimeReviewDate(), "{runtimeReviewDate}") : html;
        }),
        keys: [{ formatted: (lang) => reviewDate(LOCALE[lang]) }],
    },
    "posts-load-failed": {
        title: "[1c-client] posts-load-failed",
        run: async (lang) => {
            const out: string[] = [];
            stubFetch(pending);
            mount(createElement(Posts, { attrs: { headline: "News" }, tenantId: "t1", ...blockProps(lang) }));
            await flush(); out.push(snap());                                              // loading (no text)
            reset();
            stubFetch(async () => response(500, {}));
            mount(createElement(Posts, { attrs: { headline: "News" }, tenantId: "t1", ...blockProps(lang) }));
            await flush(); out.push(snap());                                              // API 500
            return out;
        },
        keys: [K("postsLoadFailed", { status: 500 })],
    },
    "posts-thrown": {
        title: "[1c-client] posts-thrown",
        run: async (lang) => {
            const out: string[] = [];
            stubFetch(async () => { throw new Error("Network down"); });
            mount(createElement(Posts, { attrs: {}, tenantId: "t1", ...blockProps(lang) }));
            await flush(); out.push(snap());                                              // the thrown message, as thrown
            reset();
            stubFetch(async () => { throw new Error(""); });
            mount(createElement(Posts, { attrs: {}, tenantId: "t1", ...blockProps(lang) }));
            await flush(); out.push(snap());                                              // no message: no error box → empty list
            return out;
        },
        keys: keys("postsEmpty"),
    },
    "posts-empty": {
        title: "[1c-client] posts-empty",
        run: async (lang) => {
            const out: string[] = [];
            stubFetch(async () => response(200, { items: [] }));
            mount(createElement(Posts, { attrs: {}, tenantId: "t1", ...blockProps(lang) }));
            await flush(); out.push(snap());                                              // fetched, empty
            reset();
            mount(createElement(Posts, { attrs: { prefetchedPosts: [] }, tenantId: "t1", ...blockProps(lang) }));
            out.push(snap());                                                             // prefetched by the server, empty
            return out;
        },
        keys: keys("postsEmpty"),
    },
    "posts-dates": {
        title: "[1c-client] posts-dates",
        run: async (lang) => {
            const out: string[] = [];
            for (const layout of ["list", "grid"]) {
                mount(createElement(Posts, { attrs: { headline: "News", layout, showImages: true, prefetchedPosts: [POST], serverDomain: "site.test" }, tenantId: "t1", ...blockProps(lang) }));
                out.push(lang === "en" ? tokenise(snap(), runtimePostDate(), "{runtimePostDate}") : snap());
                reset();
            }
            return out;
        },
        // RO: the post date takes the tenant's locale (L-ALL-1 / L-RO-6) where an en-US tenant keeps the runtime default.
        keys: [{ formatted: (lang) => (lang === "en" ? "{runtimePostDate}" : new Date(DATE).toLocaleDateString(LOCALE.ro)) }],
    },
    "showcase": {
        title: "[1c-client] showcase",
        run: async (lang) => {
            const out: string[] = [];
            mount(createElement(Showcase, { attrs: { ...SHOWCASE, prefetchedProducts: [PRODUCT] }, tenantId: "t1", ...blockProps(lang) }));
            out.push(snap());                                                             // no image, out of stock
            reset();
            mount(createElement(Showcase, { attrs: { ...SHOWCASE, prefetchedProducts: [] }, tenantId: "t1", ...blockProps(lang) }));
            out.push(snap());                                                             // empty category
            reset();
            mount(createElement(Showcase, { attrs: { ...SHOWCASE, prefetchedProducts: [PRODUCT], _catalogMode: true }, tenantId: "t1", ...blockProps(lang, { catalogMode: true }) }));
            out.push(snap());                                                             // catalog site: no overlay
            return out;
        },
        keys: keys("noImage", "outOfStock", "showcaseEmpty"),
    },
};

if (CAPTURE) {
    // Capture mode (run once from the start commit 0c0dbc8, record docs/slices/locale-1c.md): write the EN markup of every
    // state; assert nothing else.
    describe("[locale-1c] capture", () => {
        it("writes the EN markup of every state", async () => {
            const states: Record<string, string[]> = {};
            for (const [name, st] of Object.entries(STATES)) {
                states[name] = await st.run("en");
                reset();
            }
            writeFileSync(CAPTURE, JSON.stringify({ commit: process.env.LOCALE_1C_COMMIT ?? "", states }, null, 2) + "\n");
        });
    });
} else {
    const before: { commit: string; states: Record<string, string[]> } = JSON.parse(readFileSync(BEFORE_FILE, "utf8"));
    const extract = (html: string) => extractVisibleText(html);

    describe("[1c-client] the en-US markup of every block state equals the 0c0dbc8 capture (§ 16.2 item 4), except the declared L-ALL-2 review dates (LOCALE-REVIEWS-DATE-1)", () => {
        it("the capture is from the start commit and holds every state", () => {
            expect(before.commit).toBe("0c0dbc8");
            expect(Object.keys(before.states).sort()).toEqual(Object.keys(STATES).sort());
        });
        for (const [name, st] of Object.entries(STATES)) {
            it(`${st.title}: EN markup after every step equals 0c0dbc8${Object.hasOwn(L_ALL_2, name) ? " except the declared L-ALL-2 review dates" : ""}`, async () => {
                expect(await st.run("en")).toEqual(withLedger(name, before.states[name]));
            });
        }
        // Rulings LOCALE1C-FALLBACK = A / LOCALE1C-REGISTRY-TYPE = A: `strings` is required by the typed contract (the
        // compiler checks every registration, `PluginDefinition.renderComponent`); omitting it is unsupported and there is
        // no English fallback. There is NO runtime validation: what an untyped caller without `strings` gets depends on the
        // branch (a direct-video URL, a captioned iframe or an image without `src` read no text and render). These two
        // fixtures read a text, so they throw the TypeError of the missing object instead of showing English.
        it("[1c-client] the YouTube video and code-block fixtures rendered without `strings` throw a TypeError (no English fallback)", () => {
            expect(() => ssr(createElement(Video, { attrs: { url: "https://www.youtube.com/watch?v=cm1video001" } }))).toThrow(TypeError);
            expect(() => ssr(createElement(Code, { attrs: { code: "a" } }))).toThrow(TypeError);
        });
        it("[1c-client] an en-US tenant keeps the runtime default for post dates, and a failed fetch still reads API 500", async () => {
            // The token stands for the runtime-default text (and for nothing else): it is where 0c0dbc8 rendered it, and the
            // current render holds that same runtime text there.
            mount(createElement(Posts, { attrs: { layout: "grid", prefetchedPosts: [POST] }, tenantId: "t1", ...blockProps("en") }));
            expect(snap()).toContain(`<span>${runtimePostDate()}</span>`);
            expect(before.states["posts-dates"].every((html) => html.includes(">{runtimePostDate}<"))).toBe(true);
            expect(extract(before.states["posts-load-failed"][1]).map((i) => i.text)).toContain("API 500");
            expect(extract((await STATES["posts-load-failed"].run("en"))[1]).map((i) => i.text)).toContain("API 500");
        });
    });

    describe("[1c-client] RO tenant: every visible change of every state is a declared key (EN → RO) or a declared formatted value", () => {
        for (const [name, st] of Object.entries(STATES)) {
            it(`${st.title}: RO texts`, async () => {
                const en = await st.run("en");
                reset();
                const ro = await st.run("ro");
                expect(ro).toHaveLength(en.length);
                const problems: string[] = [];
                const changed = new Set<number>();
                en.forEach((html, step) => {
                    for (const c of textChanges(extract(html), extract(ro[step]))) {
                        const matching = st.keys.map((s, i) => (render("en", s) === c.from && render("ro", s) === c.to ? i : -1)).filter((i) => i >= 0);
                        if (matching.length === 0) problems.push(`step ${step}: unexplained change ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
                        else matching.forEach((i) => changed.add(i));
                    }
                });
                st.keys.forEach((s, i) => {
                    const label = "key" in s ? s.key : "a formatted value";
                    if (render("en", s) !== render("ro", s)) { if (!changed.has(i)) problems.push(`declared ${label} did not change (${render("en", s)} → ${render("ro", s)})`); }
                    else if (!ro.some((html) => extract(html).some((x) => x.text === render("ro", s)))) problems.push(`declared ${label} (same in RO: ${render("ro", s)}) is not shown`);
                });
                expect(problems).toEqual([]);
                // The state's declared keys are shown on the RO side (none is silently missing).
                for (const s of st.keys) if ("key" in s) expect(ro.some((html) => extract(html).some((x) => x.text.includes(render("ro", s)))), s.key).toBe(true);
            });
        }
    });

    describe("[1c-client] reviews-carousel dates (LOCALE-REVIEWS-DATE-1, human ruling 2026-11-01): a non-empty string `locale` attribute is passed raw; otherwise (absent, \"\", not a string) the tenant's normalised locale, en-US by default", () => {
        const dateOf = (html: string) => extract(html).map((i) => i.text).find((t) => /2026|٢٠٢٦/.test(t));
        const dateWith = (tenant: Record<string, unknown>, attrs: Record<string, unknown>) => dateOf(ssr(createElement(Reviews, {
            attrs: REVIEW(attrs),
            strings: shared.blockStrings(shared.resolveLocaleStrings(tenant), { catalogMode: false }),
        })));
        const dates = (tenantLocale: string) => REVIEW_LOCALES.map((locale) => dateWith({ locale: tenantLocale }, locale === undefined ? {} : { locale }));
        // The seven attribute cases of § 3.4, in REVIEW_LOCALES order. The non-empty strings are the block's own setting,
        // raw, the same for every tenant (§ 12 E24); absent and "" are the site setting (`tenantDate`).
        const cases = (tenantDate: string) => [tenantDate, "31 octombrie 2026", "October 31, 2026", "٣١ octombrie ٢٠٢٦", DATE, runtimeReviewDate(), tenantDate];
        it("[1c-client] reviews-dates en-US tenant: absent and \"\" → October 31, 2026 (L-ALL-2; before: 31 octombrie 2026 and the raw date string)", () => {
            expect(dates("en-US")).toEqual(cases("October 31, 2026"));
            expect(dates("en_US")).toEqual(cases("October 31, 2026"));     // normalises to en-US
        });
        it("[1c-client] reviews-dates tenant without a valid locale (absent, malformed) → en-US dates", () => {
            expect(dateWith({}, {})).toBe("October 31, 2026");
            expect(dateWith({ locale: "xx-YY" }, {})).toBe("October 31, 2026");
            expect(dateWith({ locale: 42 }, { locale: "" })).toBe("October 31, 2026");
            // The en-US path is the explicit "en-US", never the runtime default (which is en-US on many machines, so the
            // text alone cannot tell them apart): the formatter receives the literal locale.
            const spy = vi.spyOn(Date.prototype, "toLocaleDateString");
            try {
                dateWith({}, {});
                dateWith({ locale: "en-US" }, { locale: "" });
                expect(spy.mock.calls.map((c) => c[0])).toEqual(["en-US", "en-US"]);
            } finally {
                spy.mockRestore();
            }
        });
        it("[1c-client] reviews-dates ro-RO tenant: absent and \"\" → its locale ro-RO (absent: unchanged; \"\": the raw date string before, so a RO date change too)", () => {
            expect(dates("ro-RO")).toEqual(cases("31 octombrie 2026"));
        });
        it("[1c-client] reviews-dates en-GB tenant: absent and \"\" → 31 October 2026", () => {
            expect(dates("en-GB")).toEqual(cases("31 October 2026"));
        });
        it("[1c-client] reviews-dates de-DE tenant: absent and \"\" → its locale de-DE; a non-empty attribute still wins", () => {
            expect(dates("de-DE")).toEqual(cases("31. Oktober 2026"));
        });
        it("[1c-client] reviews-dates a non-string attribute is no setting: the tenant's locale (before: null → the raw string; 42, true, {} → the runtime default; [\"de-DE\"] → German)", () => {
            for (const locale of [null, 42, true, {}, ["de-DE"]]) {
                expect(dateWith({ locale: "en-US" }, { locale }), JSON.stringify(locale)).toBe("October 31, 2026");
                expect(dateWith({ locale: "ro-RO" }, { locale }), JSON.stringify(locale)).toBe("31 octombrie 2026");
            }
        });
    });

    // § 5.2 pattern D at every new reader whose code chooses a branch: the text is shown exactly as resolved (absent → the
    // language default; "" → empty, never another text; "X" → X). The branch is chosen by the server's answer or the
    // fetch outcome, never by testing a translated text (the 1d R1 rule).
    describe("[1c-client] preservation (§ 5.2 pattern D): absent → language default, \"\" → empty, \"X\" → X", () => {
        const variants = (key: string, part: "site" | "commerce") => ({
            absent: {},
            empty: { [`${part}Strings`]: { [key]: "" } },
            own: { [`${part}Strings`]: { [key]: `X-${key}` } },
        });
        const formError = async (C: React.FC<any>, attrs: object, lang: Lang, input: object, reply: () => Promise<unknown>) => {
            mount(createElement(C, { attrs, ...blockProps(lang, { input: input as Record<string, unknown> }) }));
            stubFetch(reply);
            await submitForm();
            const p = host.querySelector("p.text-red-600");
            const text = p === null ? null : p.textContent;
            reset();
            return text;
        };
        for (const lang of ["en", "ro"] as Lang[]) {
            it(`[1c-client] ${lang} contact and lead errors: contactSendFailed, formSubmissionFailed, errorTryAgain; a server text passes through`, async () => {
                const t = TABLE(lang);
                const cases: [React.FC<any>, object, string, () => Promise<unknown>][] = [
                    [Contact, CONTACT, "contactSendFailed", FAILURES[0]], [Contact, CONTACT, "errorTryAgain", FAILURES[2]],
                    [Lead, LEAD, "formSubmissionFailed", FAILURES[0]], [Lead, LEAD, "errorTryAgain", FAILURES[2]],
                ];
                for (const [C, attrs, key, reply] of cases) {
                    const v = variants(key, "site");
                    expect(await formError(C, attrs, lang, v.absent, reply), `${key} absent`).toBe(t[key]);
                    expect(await formError(C, attrs, lang, v.empty, reply), `${key} ""`).toBe(null);     // empty text: no error line
                    expect(await formError(C, attrs, lang, v.own, reply), `${key} X`).toBe(`X-${key}`);
                }
                const silent = { siteStrings: { contactSendFailed: "", formSubmissionFailed: "", errorTryAgain: "" } };
                expect(await formError(Contact, CONTACT, lang, silent, FAILURES[1])).toBe("Rate limited");
                expect(await formError(Lead, LEAD, lang, silent, FAILURES[3])).toBe("Network down");
            });
            it(`[1c-client] ${lang} post grid: postsLoadFailed "" still shows the (empty) error box, never the empty-list text`, async () => {
                const box = async (input: object) => {
                    stubFetch(async () => response(503, {}));
                    mount(createElement(Posts, { attrs: {}, tenantId: "t1", ...blockProps(lang, { input: input as Record<string, unknown> }) }));
                    await flush();
                    const el = host.querySelector(".bg-red-50");
                    const out = { box: el === null ? null : el.textContent, empty: host.textContent?.includes(TABLE(lang).postsEmpty) ?? false };
                    reset();
                    return out;
                };
                const v = variants("postsLoadFailed", "site");
                expect(await box(v.absent)).toEqual({ box: shared.fillTemplate(TABLE(lang).postsLoadFailed, { status: 503 }), empty: false });
                expect(await box(v.empty)).toEqual({ box: "", empty: false });
                expect(await box({ siteStrings: { postsLoadFailed: "Failed ({status})" } })).toEqual({ box: "Failed (503)", empty: false });
            });
            it(`[1c-client] ${lang} direct texts: contactName, codeCopy, imageAltFallback (block alt wins), outOfStock, showcaseEmpty, postsEmpty, heroNoImage, noImage (carousel), reviewsReadMore`, async () => {
                const t = TABLE(lang);
                const read: [string, "site" | "commerce", (input: object) => string | null][] = [
                    ["contactName", "site", (input) => { mount(createElement(Contact, { attrs: CONTACT, ...blockProps(lang, { input: input as any }) })); const x = host.querySelector("label")!.textContent; reset(); return x; }],
                    ["codeCopy", "site", (input) => { mount(createElement(Code, { attrs: { code: "a", language: "plaintext" }, ...blockProps(lang, { input: input as any }) })); const x = host.querySelector("button")!.textContent; reset(); return x; }],
                    ["imageAltFallback", "site", (input) => /alt="([^"]*)"/.exec(ssr(createElement(ImageBlock, { attrs: { src: "https://img.test/a.jpg", alt: "" }, ...blockProps(lang, { input: input as any }) })))![1]],
                    ["outOfStock", "commerce", (input) => { mount(createElement(Showcase, { attrs: { ...SHOWCASE, prefetchedProducts: [PRODUCT] }, ...blockProps(lang, { input: input as any }) })); const x = host.querySelector("span.uppercase")!.textContent; reset(); return x; }],
                    ["showcaseEmpty", "commerce", (input) => { mount(createElement(Showcase, { attrs: { ...SHOWCASE, prefetchedProducts: [] }, ...blockProps(lang, { input: input as any }) })); const x = host.querySelector("p")!.textContent; reset(); return x; }],
                    ["postsEmpty", "site", (input) => { mount(createElement(Posts, { attrs: { prefetchedPosts: [] }, ...blockProps(lang, { input: input as any }) })); const x = host.querySelector("p")!.textContent; reset(); return x; }],
                    // Review 0 R3: one direct reader of each remaining block.
                    ["heroNoImage", "site", (input) => domOf(ssr(createElement(Hero, { attrs: { style: "split", headline: "Mats", imageSrc: "" }, ...blockProps(lang, { input: input as any }) }))).querySelector("div.min-h-\\[300px\\] > div")!.textContent],
                    ["noImage", "site", (input) => domOf(ssr(createElement(Carousel, { attrs: { style: "standard", items: [{ id: "g1", title: "Blank", image: "", link: "#" }] }, ...blockProps(lang, { input: input as any }) }))).querySelector("div.text-xs")!.textContent],
                    ["reviewsReadMore", "site", (input) => {
                        const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
                        Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 200 });
                        try {
                            mount(createElement(Reviews, { attrs: REVIEW({ maxLines: 2 }), ...blockProps(lang, { input: input as any }) }));
                            const x = host.querySelector("button")!.textContent; reset(); return x;
                        } finally {
                            if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scroll);
                            else delete (HTMLElement.prototype as any).scrollHeight;
                        }
                    }],
                ];
                for (const [key, part, get] of read) {
                    const v = variants(key, part);
                    expect(get(v.absent), `${key} absent`).toBe(t[key]);
                    expect(get(v.empty), `${key} ""`).toBe("");
                    expect(get(v.own), `${key} X`).toBe(`X-${key}`);
                }
                // A block field, where one exists, wins over the key (ruling LOCALE1-BLOCK-TEXTS = A).
                expect(/alt="([^"]*)"/.exec(ssr(createElement(ImageBlock, { attrs: { src: "https://img.test/a.jpg", alt: "A wool mat" }, ...blockProps(lang, { input: { siteStrings: { imageAltFallback: "X" } } }) })))![1]).toBe("A wool mat");
            });
            // Ruling LOCALE1C-IFRAME-NAMES = A (review 0 R2): the two iframe names are pattern F — the name is never empty.
            it(`[1c-client] ${lang} iframe names (pattern F): videoTitle and videoBackgroundTitle — absent → language default, "" → language default, "X" → X; the author field wins`, () => {
                const t = TABLE(lang);
                const title = (html: string) => /<iframe[^>]*\stitle="([^"]*)"/.exec(html)![1];
                const video = (attrs: object, input: object) => title(ssr(createElement(Video, { attrs: { url: "https://www.youtube.com/watch?v=cm1video001", caption: "", ...attrs }, ...blockProps(lang, { input: input as any }) })));
                const hero = (attrs: object, input: object) => title(ssr(createElement(VideoHero, { attrs: { videoSrc: "https://vimeo.com/123456789", headline: "", ...attrs }, ...blockProps(lang, { input: input as any }) })));
                for (const [key, get] of [["videoTitle", video], ["videoBackgroundTitle", hero]] as const) {
                    const v = variants(key, "site");
                    expect(get({}, v.absent), `${key} absent`).toBe(t[key]);
                    expect(get({}, v.empty), `${key} ""`).toBe(t[key]);
                    expect(t[key].length, `${key} default is not empty`).toBeGreaterThan(0);
                    expect(get({}, v.own), `${key} X`).toBe(`X-${key}`);
                }
                expect(video({ caption: "Workshop tour" }, variants("videoTitle", "site").own)).toBe("Workshop tour");
                expect(hero({ headline: "Handmade" }, variants("videoBackgroundTitle", "site").own)).toBe("Handmade");
            });
        }
    });
}
