import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
// Same harness as videoHeroPlugin.test.ts: an en-US tenant's block texts (RenderBlocks always passes `strings`).
import { blockStrings, resolveLocaleStrings } from "@amodx/shared";
import { RENDER_LOADERS } from "../src/render";
import { HeroSchema } from "../src/hero/schema";
import { HeroEditor, storedOption } from "../src/hero/HeroEditor";
import { HERO_BASELINE_CASES } from "./heroBaselineCases";
import BASELINE from "./hero.baseline.json";

/**
 * SHOP-LOOK-1B — the hero options of the reference look (docs/slices/shop-look-1b.md; design
 * docs/slices/shop-look-1.md § 4.2, § 6.2, § 6.5).
 *
 * The rule under test (§ 4): ABSENT = TODAY'S BYTES. `hero.baseline.json` holds the HTML that `HeroRender` at 783e95f
 * (before this slice) gave for the inputs of `heroBaselineCases.ts` — all four styles, with and without an image, rich
 * and legacy subheadlines, no button text, the cover tokens, the Tiptap defaults. Every "absent" test renders those
 * inputs with the current code and asserts equality, character for character, in BOTH server renderers:
 * `renderToStaticMarkup` and `renderToString` (the second keeps React's `<!-- -->` text separators, which the site's
 * streaming render emits too).
 *
 * Every "present" test asserts the new element AND that removing exactly that element gives back the baseline — so a
 * present option changes nothing else. Negative class assertions ("no `text-foreground` in the panel") are made only on
 * fixtures where every element is on its default colour (§ 16.1); each owner token that could produce the forbidden
 * class has its own fixture asserting the token is kept.
 */

const HeroRender = (await RENDER_LOADERS["hero"]()).default;
const STRINGS = blockStrings(resolveLocaleStrings({}), { catalogMode: false });
const STATIC = BASELINE.html as Record<string, string>;
const SSR = BASELINE.ssr as Record<string, string>;
const STYLES = ["center", "split", "cover", "minimal"] as const;

const staticHtml = (attrs: Record<string, unknown>) => renderToStaticMarkup(React.createElement(HeroRender, { attrs, strings: STRINGS }));
const ssrHtml = (attrs: Record<string, unknown>) => renderToString(React.createElement(HeroRender, { attrs, strings: STRINGS }));
const base = (style: string) => HERO_BASELINE_CASES[`${style}-schema-defaults`];
/** `text` with `part` removed exactly once (asserted to occur exactly once). */
const without = (text: string, part: string) => {
    expect(text.split(part).length - 1, `exactly once: ${part}`).toBe(1);
    return text.replace(part, "");
};
/** The class tokens of every `class="…"` in `html`. */
const classTokens = (html: string) => [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));

// The literals the render must emit (design § 6.5 table and § 6.2). Repeated here on purpose: the test pins the strings.
const TODAY_BTN = "inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary";
const PILL_BTN = "inline-flex items-center justify-center rounded-full text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary";
const EYEBROW_PAGE = "inline-block w-fit rounded-full border px-3 py-1 mb-6 text-xs font-semibold uppercase tracking-widest border-primary/30 text-primary";
const EYEBROW_INVERSE = "inline-block w-fit rounded-full border px-3 py-1 mb-6 text-xs font-semibold uppercase tracking-widest border-background/40 text-background";
// Ruling SL1B-COVER-EYEBROW: on cover the eyebrow follows the cover headline's class, with border-current.
const EYEBROW_COVER = (hl: string) => `inline-block w-fit rounded-full border px-3 py-1 mb-6 text-xs font-semibold uppercase tracking-widest border-current ${hl}`;
// Ruling SL1B-INVERSE-BUTTON: on the inverse panel the first button is today's string (per shape) + an edge.
const TODAY_BTN_INVERSE = "inline-flex items-center justify-center rounded-md text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary border border-background/40";
const PILL_BTN_INVERSE = "inline-flex items-center justify-center rounded-full text-sm font-medium text-primary-foreground shadow h-11 px-8 hover:opacity-90 bg-primary border border-background/40";
const OUTLINE = (shape: "rounded-md" | "rounded-full", tone: string) => `inline-flex items-center justify-center ${shape} border text-sm font-medium h-11 px-8 hover:opacity-90 ${tone}`;
const ROW_CENTERED = "flex flex-col md:flex-row gap-4 md:justify-center";
const ROW_START = "flex flex-col md:flex-row gap-4";
const PANEL_PLAIN = "relative z-10 order-2 lg:order-1 flex flex-col justify-center px-6 lg:px-12 py-12 lg:py-20";
const PANEL_INVERSE = `${PANEL_PLAIN} bg-foreground`;
const H1_SPLIT_PLAIN = "text-4xl lg:text-5xl font-black tracking-tight text-foreground mb-6";
const H1_SPLIT_INVERSE = "text-4xl lg:text-5xl font-black tracking-tight text-background mb-6";
const TEXT_SPLIT_PLAIN = "text-lg text-muted-foreground mb-8";
const TEXT_SPLIT_INVERSE = "text-lg text-background/80 mb-8";
const PRIMARY = (cls = TODAY_BTN, href = "/contact", text = "Get Started") => `<a href="${href}" class="${cls}">${text}</a>`;
const TODAY_BUTTON: Record<string, string> = { center: PRIMARY(), cover: PRIMARY(), split: `<div>${PRIMARY()}</div>` };

// ── Absent / null / blank → today's HTML ───────────────────────────────────────────────────────────────────────────

/** Every new attribute, as Tiptap stores it before the owner sets it (declared default `null`). */
const NULLS = { eyebrow: null, headlineAccent: null, headlineAccentColorToken: null, secondaryCtaText: null, secondaryCtaLink: null, stats: null, buttonShape: null, splitPanel: null };
/** Present but drawn as absent: blank texts, a token without an accent, a link without a text, items without a value,
 *  and the default choices of the two enums. */
const BLANKS = {
    eyebrow: "   ", headlineAccent: " \t ", headlineAccentColorToken: "primary", secondaryCtaText: "  ", secondaryCtaLink: "/shop",
    stats: [{ value: "  ", label: "Customers" }, { value: "", label: "" }], buttonShape: "rounded", splitPanel: "plain",
};
const EMPTIES = { eyebrow: "", headlineAccent: "", secondaryCtaText: "", secondaryCtaLink: "", stats: [] };
/** Stored values outside the schema (the backend does not validate block attributes): read as absent. */
const MALFORMED = { eyebrow: 7, headlineAccent: { text: "x" }, secondaryCtaText: ["x"], stats: "4 stores", buttonShape: "square", splitPanel: "dark" };

describe("hero — absent, null or blank options render today's HTML (§ 4), all four styles", () => {
    it("the baseline covers every style (precondition)", () => {
        for (const style of STYLES) expect(Object.keys(STATIC).filter((k) => k.startsWith(`${style}-`)).length).toBeGreaterThanOrEqual(9);
        expect(Object.keys(STATIC).sort()).toEqual(Object.keys(HERO_BASELINE_CASES).sort());
    });
    const variants: Record<string, Record<string, unknown>> = { absent: {}, null: NULLS, blank: BLANKS, empty: EMPTIES, malformed: MALFORMED };
    for (const [variant, extra] of Object.entries(variants)) {
        it(`${variant}: every baseline case renders byte-equal (static and streaming renderers)`, () => {
            for (const [name, attrs] of Object.entries(HERO_BASELINE_CASES)) {
                expect(staticHtml({ ...attrs, ...extra }), `${variant} ${name}`).toBe(STATIC[name]);
                expect(ssrHtml({ ...attrs, ...extra }), `${variant} ${name} (renderToString)`).toBe(SSR[name]);
            }
        });
    }
    it("splitPanel inverse on center, cover and minimal: no effect", () => {
        for (const [name, attrs] of Object.entries(HERO_BASELINE_CASES)) {
            if (attrs.style === "split") continue;
            expect(staticHtml({ ...attrs, splitPanel: "inverse" }), name).toBe(STATIC[name]);
        }
    });
    it("minimal: the second button, the numbers and the pill shape have no effect (they belong to center, split, cover)", () => {
        for (const [name, attrs] of Object.entries(HERO_BASELINE_CASES)) {
            if (attrs.style !== "minimal") continue;
            const extra = { secondaryCtaText: "More", secondaryCtaLink: "/more", stats: [{ value: "25+", label: "Years" }], buttonShape: "pill" };
            expect(staticHtml({ ...attrs, ...extra }), name).toBe(STATIC[name]);
        }
    });
});

// ── eyebrow ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("hero — eyebrow", () => {
    it("every style: a <p> directly above the <h1>, text trimmed; the only difference from today", () => {
        for (const style of STYLES) {
            const html = staticHtml({ ...base(style), eyebrow: "  Since 1998 " });
            const el = `<p class="${style === "cover" ? EYEBROW_COVER("text-white") : EYEBROW_PAGE}">Since 1998</p>`;
            expect(html, style).toContain(`${el}<h1 `);
            expect(without(html, el), style).toBe(STATIC[`${style}-schema-defaults`]);
            expect(without(ssrHtml({ ...base(style), eyebrow: "Since 1998" }), el), style).toBe(SSR[`${style}-schema-defaults`]);
        }
    });
    it("cover (ruling SL1B-COVER-EYEBROW): text and border follow the cover headline — default white, an explicit headline token its class", () => {
        expect(staticHtml({ ...base("cover"), eyebrow: "Since 1998" })).toContain(`<p class="${EYEBROW_COVER("text-white")}">Since 1998</p><h1 `);
        for (const [token, cls] of [["primary", "text-primary"], ["foreground", "text-foreground"], ["white", "text-white"]]) {
            const html = staticHtml({ ...base("cover"), headlineColorToken: token, eyebrow: "Since 1998" });
            expect(html, token).toContain(`<p class="${EYEBROW_COVER(cls)}">Since 1998</p><h1 class="text-5xl md:text-7xl font-black tracking-tight mb-6 drop-shadow-lg ${cls}">`);
            expect(classTokens(html), token).not.toContain("border-primary/30");
        }
    });
    it("cover: the accent keeps its § 4.2 default text-primary (not the headline's class; finding F-1B-COVER-ACCENT)", () => {
        expect(staticHtml({ ...base("cover"), headlineAccent: "x" })).toContain(`drop-shadow-lg text-white">Welcome to AMODX <span class="text-primary">x</span></h1>`);
    });
    it("split inverse: the inverse colours (text-background, border-background/40)", () => {
        const html = staticHtml({ ...base("split"), splitPanel: "inverse", eyebrow: "Heritage" });
        expect(html).toContain(`<p class="${EYEBROW_INVERSE}">Heritage</p><h1 `);
    });
});

// ── headlineAccent + headlineAccentColorToken ──────────────────────────────────────────────────────────────────────

const TOKEN_CLASS: Record<string, string> = {
    white: "text-white", foreground: "text-foreground", primary: "text-primary", "primary-foreground": "text-primary-foreground",
    "muted-foreground": "text-muted-foreground", "accent-foreground": "text-accent-foreground",
};

describe("hero — headline accent", () => {
    it("every style: a <span> inside the <h1> after the headline and one space; default class text-primary; the only difference", () => {
        for (const style of STYLES) {
            const html = staticHtml({ ...base(style), headlineAccent: " that feel like home " });
            const el = ` <span class="text-primary">that feel like home</span>`;
            expect(html, style).toContain(`Welcome to AMODX${el}</h1>`);
            expect(without(html, el), style).toBe(STATIC[`${style}-schema-defaults`]);
            // The streaming renderer separates the two adjacent texts with a comment; nothing else differs.
            expect(without(ssrHtml({ ...base(style), headlineAccent: "that feel like home" }), `<!-- -->${el}`), style).toBe(SSR[`${style}-schema-defaults`]);
        }
    });
    it("`auto` = absent token = the default class", () => {
        for (const style of STYLES) expect(staticHtml({ ...base(style), headlineAccent: "x", headlineAccentColorToken: "auto" })).toContain(`<span class="text-primary">x</span>`);
    });
    it("each allowed token → its class, in every style (the schema's enum is the list tested)", () => {
        const tokens = HeroSchema.shape.headlineAccentColorToken.unwrap().options.filter((t: string) => t !== "auto");
        expect(tokens.sort()).toEqual(Object.keys(TOKEN_CLASS).sort());
        for (const style of STYLES) for (const t of tokens) {
            expect(staticHtml({ ...base(style), headlineAccent: "x", headlineAccentColorToken: t }), `${style} ${t}`).toContain(`<span class="${TOKEN_CLASS[t]}">x</span>`);
        }
    });
    it("an unknown token → the default class (mirrors resolveTextClass: a value it does not know → the caller's default)", () => {
        expect(staticHtml({ ...base("center"), headlineAccent: "x", headlineAccentColorToken: "gold" })).toContain(`<span class="text-primary">x</span>`);
        expect(staticHtml({ ...base("split"), splitPanel: "inverse", headlineAccent: "x", headlineAccentColorToken: "gold" })).toContain(`<span class="text-background/70">x</span>`);
    });
    it("the schema accepts each token and refuses an unknown one", () => {
        expect(HeroSchema.safeParse({ headlineAccent: "x", headlineAccentColorToken: "muted-foreground" }).success).toBe(true);
        expect(HeroSchema.safeParse({ headlineAccent: "x", headlineAccentColorToken: "gold" }).success).toBe(false);
    });
});

// ── secondaryCtaText / secondaryCtaLink ────────────────────────────────────────────────────────────────────────────

describe("hero — second (outline) button", () => {
    const TONE: Record<string, string> = { center: "border-foreground text-foreground", split: "border-foreground text-foreground", cover: "border-current text-white" };
    const ROW: Record<string, string> = { center: ROW_CENTERED, split: ROW_START, cover: ROW_CENTERED };
    it("center, split, cover: one row holds the first button, then the outline button; the row replaces today's button slot and nothing else changes", () => {
        for (const style of ["center", "split", "cover"]) {
            const html = staticHtml({ ...base(style), secondaryCtaText: " Book a visit ", secondaryCtaLink: "/visit" });
            const row = `<div class="${ROW[style]}">${PRIMARY()}<a href="/visit" class="${OUTLINE("rounded-md", TONE[style])}">Book a visit</a></div>`;
            expect(html, style).toContain(row);
            expect(html.replace(row, TODAY_BUTTON[style]), style).toBe(STATIC[`${style}-schema-defaults`]);
        }
    });
    it("rule: the button shows when its text is non-blank; a blank or absent link → href \"#\"; a link without text → no button", () => {
        for (const link of [undefined, null, "", "   "]) {
            expect(staticHtml({ ...base("center"), secondaryCtaText: "More", secondaryCtaLink: link }), String(link)).toContain(`<a href="#" class="${OUTLINE("rounded-md", TONE.center)}">More</a>`);
        }
        expect(staticHtml({ ...base("center"), secondaryCtaLink: "/visit" })).toBe(STATIC["center-schema-defaults"]);
    });
    it("the link passes through the tenant URL helper RenderBlocks injects (`_getUrl`, SL-D14); without it the link is kept", () => {
        const html = staticHtml({ ...base("split"), secondaryCtaText: "More", secondaryCtaLink: "visit", _getUrl: (s: string) => `/_site/t1/${s.replace(/^\//, "")}` });
        expect(html).toContain(`<a href="/_site/t1/visit" class="${OUTLINE("rounded-md", TONE.split)}">More</a>`);
    });
    it("without a first button text, the row holds the outline button alone", () => {
        const html = staticHtml({ ...base("center"), ctaText: "", secondaryCtaText: "More", secondaryCtaLink: "/m" });
        expect(html).toContain(`<div class="${ROW_CENTERED}"><a href="/m" class="${OUTLINE("rounded-md", TONE.center)}">More</a></div>`);
    });
    it("cover: the outline button follows the cover headline token (border-current + the headline's class)", () => {
        const html = staticHtml({ ...base("cover"), headlineColorToken: "primary", secondaryCtaText: "More", secondaryCtaLink: "/m" });
        expect(html).toContain(`<a href="/m" class="${OUTLINE("rounded-md", "border-current text-primary")}">More</a>`);
    });
});

// ── stats ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("hero — numbers (stats)", () => {
    const GRID: Record<number, string> = {
        1: "mt-12 grid grid-cols-1 gap-6", 2: "mt-12 grid grid-cols-2 gap-6", 3: "mt-12 grid grid-cols-3 gap-6", 4: "mt-12 grid grid-cols-2 md:grid-cols-4 gap-6",
    };
    const VALUE = "text-2xl md:text-4xl font-black tracking-tight text-foreground";
    const LABEL = "text-sm text-muted-foreground";
    const ITEMS = [{ value: "25+", label: "Years" }, { value: "4", label: "Showrooms" }, { value: "10k", label: "Floors laid" }, { value: "4.9", label: "Rating" }];
    const item = (v: string, l: string | null, value = VALUE, label = LABEL) => `<div><p class="${value}">${v}</p>${l === null ? "" : `<p class="${label}">${l}</p>`}</div>`;
    it("1 to 4 items: one grid after the buttons, the grid class of § 6.2 per count; the only difference from today", () => {
        for (const style of ["center", "split", "cover"]) for (const n of [1, 2, 3, 4]) {
            const html = staticHtml({ ...base(style), stats: ITEMS.slice(0, n) });
            const [v, l] = style === "cover" ? ["text-2xl md:text-4xl font-black tracking-tight drop-shadow-md text-white", "text-sm drop-shadow-md text-white/90"] : [VALUE, LABEL];
            const grid = `<div class="${GRID[n]}">${ITEMS.slice(0, n).map((i) => item(i.value, i.label, v, l)).join("")}</div>`;
            expect(html, `${style} ${n}`).toContain(`${TODAY_BUTTON[style]}${grid}`);
            expect(without(html, grid), `${style} ${n}`).toBe(STATIC[`${style}-schema-defaults`]);
        }
    });
    it("an item with a blank value is skipped; a blank caption draws no caption; texts trimmed", () => {
        const html = staticHtml({ ...base("center"), stats: [{ value: " ", label: "Gone" }, { value: " 25+ ", label: "  " }, { value: "4", label: " Showrooms " }] });
        expect(html).toContain(`<div class="${GRID[2]}">${item("25+", null)}${item("4", "Showrooms")}</div>`);
        expect(html).not.toContain("Gone");
    });
    it("a fifth item is refused by the schema; a stored fifth item (no backend check) is not drawn — the first four are", () => {
        const five = [...ITEMS, { value: "5th", label: "Fifth" }];
        expect(HeroSchema.safeParse({ stats: ITEMS }).success).toBe(true);
        expect(HeroSchema.safeParse({ stats: five }).success).toBe(false);
        expect(HeroSchema.safeParse({ stats: [{ value: "1234567890123", label: "x" }] }).success).toBe(false); // value > 12
        expect(HeroSchema.safeParse({ stats: [{ value: "1", label: "x".repeat(41) }] }).success).toBe(false); // label > 40
        const html = staticHtml({ ...base("center"), stats: five });
        expect(html).toContain(`<div class="${GRID[4]}">`);
        expect(html).not.toContain("5th");
    });
});

// ── buttonShape ────────────────────────────────────────────────────────────────────────────────────────────────────

describe("hero — button shape", () => {
    it("pill: the first button's class is today's string with rounded-full for rounded-md; nothing else changes", () => {
        for (const style of ["center", "split", "cover"]) {
            const html = staticHtml({ ...base(style), buttonShape: "pill" });
            expect(html, style).toContain(`class="${PILL_BTN}"`);
            expect(html.replace(PILL_BTN, TODAY_BTN), style).toBe(STATIC[`${style}-schema-defaults`]);
        }
    });
    it("pill: both buttons rounded-full", () => {
        const html = staticHtml({ ...base("center"), buttonShape: "pill", secondaryCtaText: "More", secondaryCtaLink: "/m" });
        expect(html).toContain(`${PRIMARY(PILL_BTN)}<a href="/m" class="${OUTLINE("rounded-full", "border-foreground text-foreground")}">More</a>`);
        expect(classTokens(html)).not.toContain("rounded-md");
    });
});

// ── splitPanel: the three cases of § 6.5 ───────────────────────────────────────────────────────────────────────────

describe("hero — split inverse panel (§ 6.5)", () => {
    const EVERY = {
        ...base("split"), splitPanel: "inverse", eyebrow: "Heritage", headlineAccent: "since 1998", secondaryCtaText: "Our story",
        secondaryCtaLink: "/about", stats: [{ value: "25+", label: "Years" }], subheadlineRich: [{ text: "Bold", bold: true }, { text: " text" }],
    };
    /** The text panel: from its opening tag to the end of the section (it is the section's last child). */
    const panelOf = (html: string) => html.slice(html.indexOf(`<div class="${PANEL_INVERSE}">`), html.lastIndexOf("</section>"));

    it("case 3 (absent, plain): the HTML equals today's — the absent rows above; with only `inverse`, the four class swaps (panel, headline, text, first button) are the only difference", () => {
        const html = staticHtml({ ...base("split"), splitPanel: "inverse" });
        const back = html.replace(PANEL_INVERSE, PANEL_PLAIN).replace(H1_SPLIT_INVERSE, H1_SPLIT_PLAIN).replace(TEXT_SPLIT_INVERSE, TEXT_SPLIT_PLAIN)
            .replace(`class="${TODAY_BTN_INVERSE}"`, `class="${TODAY_BTN}"`);
        expect(back).toBe(STATIC["split-schema-defaults"]);
    });
    it("ruling SL1B-INVERSE-BUTTON: on the inverse panel the first button keeps fill and label and gains `border border-background/40` — rounded and pill; plain, absent and the other styles keep today's string", () => {
        expect(staticHtml({ ...base("split"), splitPanel: "inverse" })).toContain(`<div>${PRIMARY(TODAY_BTN_INVERSE)}</div>`);
        expect(staticHtml({ ...base("split"), splitPanel: "inverse", buttonShape: "pill" })).toContain(`<div>${PRIMARY(PILL_BTN_INVERSE)}</div>`);
        const both = staticHtml({ ...base("split"), splitPanel: "inverse", buttonShape: "pill", secondaryCtaText: "More", secondaryCtaLink: "/m" });
        expect(both).toContain(`<div class="${ROW_START}">${PRIMARY(PILL_BTN_INVERSE)}<a href="/m" class="${OUTLINE("rounded-full", "border-background text-background")}">More</a></div>`);
        for (const panel of [undefined, null, "plain"]) expect(staticHtml({ ...base("split"), splitPanel: panel }), String(panel)).toContain(`<div>${PRIMARY(TODAY_BTN)}</div>`);
        expect(staticHtml({ ...base("split"), splitPanel: "plain", buttonShape: "pill" })).toContain(`<div>${PRIMARY(PILL_BTN)}</div>`);
        for (const style of ["center", "cover"]) {
            const html = staticHtml({ ...base(style), splitPanel: "inverse", buttonShape: "pill" });
            expect(html, style).toContain(PRIMARY(PILL_BTN));
            expect(classTokens(html), style).not.toContain("border-background/40");
        }
    });
    for (const token of [undefined, "auto"]) {
        it(`case 1 (default tokens, accent token ${token ?? "absent"}): panel bg-foreground; nothing inside carries text-foreground or text-muted-foreground; headline text-background; accent text-background/70`, () => {
            const html = staticHtml({ ...EVERY, headlineAccentColorToken: token });
            const panel = panelOf(html);
            expect(panel.startsWith(`<div class="${PANEL_INVERSE}">`)).toBe(true);
            const tokens = classTokens(panel);
            expect(tokens).not.toContain("text-foreground");
            expect(tokens).not.toContain("text-muted-foreground");
            expect(tokens).not.toContain("border-foreground");
            expect(panel).toContain(`<h1 class="${H1_SPLIT_INVERSE}">Welcome to AMODX <span class="text-background/70">since 1998</span></h1>`);
            expect(panel).toContain(`<p class="${TEXT_SPLIT_INVERSE}"><strong>Bold</strong> text</p>`);
            expect(panel).toContain(`<p class="${EYEBROW_INVERSE}">Heritage</p>`);
            expect(panel).toContain(`<div class="${ROW_START}">${PRIMARY(TODAY_BTN_INVERSE)}<a href="/about" class="${OUTLINE("rounded-md", "border-background text-background")}">Our story</a></div>`);
            expect(panel).toContain(`<p class="text-2xl md:text-4xl font-black tracking-tight text-background">25+</p><p class="text-sm text-background/70">Years</p>`);
            // The first button keeps its own fill and label; it gains an edge (ruling SL1B-INVERSE-BUTTON, amends § 6.5).
            expect(panel).toContain(`class="${TODAY_BTN_INVERSE}"`);
        });
    }
    for (const [token, cls] of [["foreground", "text-foreground"], ["muted-foreground", "text-muted-foreground"], ["primary", "text-primary"]]) {
        it(`case 2 (explicit token ${token}): the accent keeps ${cls}; the headline keeps text-background; the panel keeps bg-foreground`, () => {
            const panel = panelOf(staticHtml({ ...EVERY, headlineAccentColorToken: token }));
            expect(panel.startsWith(`<div class="${PANEL_INVERSE}">`)).toBe(true);
            expect(panel).toContain(`<h1 class="${H1_SPLIT_INVERSE}">Welcome to AMODX <span class="${cls}">since 1998</span></h1>`);
        });
    }
    it("the schema: plain and inverse accepted; another value refused", () => {
        expect(HeroSchema.safeParse({ splitPanel: "inverse" }).success).toBe(true);
        expect(HeroSchema.safeParse({ splitPanel: "plain" }).success).toBe(true);
        expect(HeroSchema.safeParse({ splitPanel: "dark" }).success).toBe(false);
        expect(HeroSchema.safeParse({ buttonShape: "square" }).success).toBe(false);
    });
});

// ── every option at once (the reference sections 2 and 6) ─────────────────────────────────────────────────────────

describe("hero — the reference sections", () => {
    it("section 2 (cover): eyebrow, accent, two pill buttons, three numbers, in this order", () => {
        const html = staticHtml({
            ...base("cover"), imageSrc: "/floor.jpg", eyebrow: "Since 1998", headlineAccent: "for every room", buttonShape: "pill",
            secondaryCtaText: "Visit a showroom", secondaryCtaLink: "/showrooms", stats: [{ value: "25+", label: "Years" }, { value: "4", label: "Showrooms" }, { value: "10k", label: "Floors" }],
        });
        const order = ["Since 1998", "<h1 ", "for every room</span></h1>", "Get Started", "Visit a showroom", "25+", "Showrooms", "Floors"].map((t) => html.indexOf(t));
        expect(order.every((i) => i > -1)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
});

// ── the editor: options offered; a cleared option stores null ──────────────────────────────────────────────────────

describe("hero editor", () => {
    const renderEditor = (attrs: Record<string, unknown>) => renderToStaticMarkup(React.createElement(HeroEditor, {
        node: { attrs: { ...base("center"), ...NULLS, ...attrs } }, updateAttributes: () => {}, editor: { storage: {} },
    }));
    it("offers every option with its stored value; the text panel only on split; button options not on minimal", () => {
        const html = renderEditor({ style: "split", eyebrow: "Since 1998", headlineAccent: "home", secondaryCtaText: "More", secondaryCtaLink: "/m", stats: [{ value: "25+", label: "Years" }], splitPanel: "inverse", buttonShape: "pill" });
        for (const t of ["Label above the headline", "Headline second tone", "Second tone colour", "Second Button Text", "Second Button Link", "Button Shape", "Text Panel", "Numbers (up to 4", "Add number"]) expect(html, t).toContain(t);
        for (const v of ['value="Since 1998"', 'value="home"', 'value="More"', 'value="/m"', 'value="25+"', 'value="Years"', 'maxLength="12"', 'maxLength="40"']) expect(html, v).toContain(v);
        expect(renderEditor({ style: "center" })).not.toContain("Text Panel");
        const minimal = renderEditor({ style: "minimal" });
        for (const t of ["Second Button Text", "Button Shape", "Numbers (up to 4"]) expect(minimal, t).not.toContain(t);
        expect(minimal).toContain("Label above the headline");
        expect(renderEditor({ stats: [1, 2, 3, 4].map((n) => ({ value: String(n), label: "" })) })).not.toContain("Add number");
    });
    it("storedOption: blank text, empty list or the default choice → null (the attribute goes back to absent); other values unchanged", () => {
        for (const v of ["", "   ", "\t"]) expect(storedOption(v)).toBeNull();
        expect(storedOption([])).toBeNull();
        expect(storedOption("auto", "auto")).toBeNull();
        expect(storedOption("rounded", "rounded")).toBeNull();
        expect(storedOption("plain", "plain")).toBeNull();
        expect(storedOption("Since ")).toBe("Since ");
        expect(storedOption("pill", "rounded")).toBe("pill");
        expect(storedOption("inverse", "plain")).toBe("inverse");
        const stats = [{ value: "", label: "" }];
        expect(storedOption(stats)).toBe(stats);
    });
});
