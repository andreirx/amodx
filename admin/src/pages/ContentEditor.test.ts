import { describe, it, expect } from "vitest";
import {
    slugInLanguage, siteLanguagesOf, languageTagOfSlug, languageSelectValue, isSetMember, translationChoices, translationSetView,
    withTranslationChoice, choiceSelectValue, choiceFromSelectValue, choiceChangesSet, type ListedPage, type TranslationChoice,
} from "./ContentEditor";

/**
 * LANG-1A (docs/slices/lang-1.md § 6.2, § 10; review R-L1A-01, R-L1A-03) — the page editor's language rules, pure: the
 * language select rewrites the address prefix; the "Translation of" picker offers exactly the targets the backend would
 * join (`planTranslation`: not itself, not its own set, not its language, not a set that has a MEMBER in its language);
 * the set display applies the membership rule (key held now + membership item + string address; `published` = status
 * Published), and only PUBLISHED members that share a language raise the search-engine warning (neither is listed); `translationOf` is sent only for a
 * choice the editor made. Node environment, no DOM. `hasTranslationItem` is what content/list.ts gives a keyed page.
 */

const SITE = siteLanguagesOf({ locale: "en-US", languages: ["ro", "de", "RO", 5] });
const PAGES: ListedPage[] = [
    { nodeId: "en1", title: "About", slug: "/about", status: "Published", translationKey: "K1", hasTranslationItem: true },
    { nodeId: "ro1", title: "Despre", slug: "/ro/despre", status: "Published", translationKey: "K1", hasTranslationItem: true },
    { nodeId: "de1", title: "Über", slug: "/de/uber", status: "Draft" },
    { nodeId: "en2", title: "Contact", slug: "/contact" },
    { nodeId: "ro2", title: "Contact RO", slug: "/ro/contact" },
    { nodeId: "x", title: "No address" },
];
const ids = (pages: ListedPage[]) => pages.map((p) => p.nodeId);

describe("ContentEditor — languages (LANG-1A)", () => {
    it("L1A-ADMIN-EDITOR: the site languages come from the shared read rule; the default from the locale", () => {
        expect(SITE).toEqual({ languages: ["ro", "de"], defaultSubtag: "en" });
        expect(siteLanguagesOf({})).toEqual({ languages: [], defaultSubtag: "en" });
        expect(siteLanguagesOf(null)).toEqual({ languages: [], defaultSubtag: "en" });
    });

    it("L1A-ADMIN-EDITOR: the language select rewrites the address prefix; its value per page language", () => {
        expect(slugInLanguage("/about", SITE.languages, "ro")).toBe("/ro/about");
        expect(slugInLanguage("about", SITE.languages, "ro")).toBe("/ro/about");
        expect(slugInLanguage("/ro/about", SITE.languages, null)).toBe("/about");
        expect(slugInLanguage("/ro/about", SITE.languages, "de")).toBe("/de/about");
        expect(slugInLanguage("/ro", SITE.languages, null)).toBe("/");
        expect(slugInLanguage("/", SITE.languages, "ro")).toBe("/ro");
        expect(slugInLanguage("/romania", SITE.languages, "ro")).toBe("/ro/romania");
        expect(languageTagOfSlug("ro/despre", SITE)).toBe("ro");
        expect(languageTagOfSlug("/about", SITE)).toBe("en");
        expect(languageSelectValue({ kind: "default" })).toBe("");
        expect(languageSelectValue({ kind: "extra", subtag: "ro" })).toBe("ro");
    });

    it("L1A-ADMIN-EDITOR: the picker offers exactly the join targets — not itself, its own set, its language, pages without an address, or a set with a member in its language", () => {
        // ro2 (Romanian): en1's set K1 has the member ro1 → en1 hidden; ro1 is Romanian → hidden.
        expect(ids(translationChoices(PAGES, { nodeId: "ro2", slug: "/ro/contact" }, SITE))).toEqual(["de1", "en2"]);
        // de1 (German): K1 has no German member → en1 and ro1 offered.
        expect(ids(translationChoices(PAGES, { nodeId: "de1", slug: "/de/uber" }, SITE))).toEqual(["en1", "ro1", "en2", "ro2"]);
        // The language is the address being edited: en2 renamed to /de/… now hides the German page.
        expect(ids(translationChoices(PAGES, { nodeId: "en2", slug: "/de/kontakt" }, SITE))).toEqual(["en1", "ro1", "ro2"]);
        // ro1 is in K1: en1 (its own set) is not offered — the backend would do nothing.
        expect(ids(translationChoices(PAGES, { nodeId: "ro1", slug: "/ro/despre" }, SITE))).toEqual(["de1", "en2"]);
    });

    it("L1A-ADMIN-EDITOR: missing membership — a page holding K without its item is not a member: it neither hides the set from the picker nor shows in the set", () => {
        // The reviewer's probe: only TRANSLATION#K#en1 exists; ro9 holds K without its item. The backend would join ro2 to K.
        const pages: ListedPage[] = [
            { nodeId: "en1", slug: "/about", status: "Published", translationKey: "K", hasTranslationItem: true },
            { nodeId: "ro9", slug: "/ro/x", status: "Published", translationKey: "K", hasTranslationItem: false },
            { nodeId: "ro2", slug: "/ro/contact" },
        ];
        expect(isSetMember(pages[1], "K")).toBe(false);
        expect(ids(translationChoices(pages, { nodeId: "ro2", slug: "/ro/contact" }, SITE))).toEqual(["en1"]);
        expect(translationSetView(pages, { nodeId: "en1", slug: "/about", status: "Published" }, SITE).members.map((m) => m.page.nodeId)).toEqual(["en1"]);
        // The page itself without its item is in no set.
        expect(translationSetView(pages, { nodeId: "ro9", slug: "/ro/x", status: "Published" }, SITE)).toEqual({ members: [], sharedTags: [] });
    });

    it("L1A-ADMIN-EDITOR: stale key — an item for an old key does not make a member (the list flags the page's CURRENT key only)", () => {
        // ro9's item is for K, but ro9 now holds K2 and has no K2 item: content/list.ts gives hasTranslationItem false.
        const pages: ListedPage[] = [
            { nodeId: "en1", slug: "/about", status: "Published", translationKey: "K", hasTranslationItem: true },
            { nodeId: "ro9", slug: "/ro/x", status: "Published", translationKey: "K2", hasTranslationItem: false },
            { nodeId: "ro2", slug: "/ro/contact" },
        ];
        expect(isSetMember(pages[1], "K")).toBe(false);
        expect(isSetMember(pages[1], "K2")).toBe(false);
        expect(ids(translationChoices(pages, { nodeId: "ro2", slug: "/ro/contact" }, SITE))).toEqual(["en1"]);
    });

    it("L1A-ADMIN-EDITOR: Draft and Archived members — shown, not listed, no search-engine warning; they still block the picker (C3 counts them)", () => {
        const pages: ListedPage[] = [
            { nodeId: "en1", slug: "/about", status: "Published", translationKey: "K", hasTranslationItem: true },
            { nodeId: "ro1", slug: "/ro/despre", status: "Published", translationKey: "K", hasTranslationItem: true },
            { nodeId: "ro3", slug: "/ro/ciorna", status: "Draft", translationKey: "K", hasTranslationItem: true },
            { nodeId: "de3", slug: "/de/alt", status: "Archived", translationKey: "K", hasTranslationItem: true },
            { nodeId: "de4", slug: "/de/neu" },
        ];
        const view = translationSetView(pages, { nodeId: "en1", slug: "/about", status: "Published" }, SITE);
        expect(view.members.map((m) => [m.page.nodeId, m.tag, m.published])).toEqual([
            ["en1", "en", true], ["ro1", "ro", true], ["ro3", "ro", false], ["de3", "de", false],
        ]);
        expect(view.sharedTags).toEqual([]);
        // The Archived German member blocks another German page (the backend's C3 counts it: it can be published again).
        expect(ids(translationChoices(pages, { nodeId: "de4", slug: "/de/neu" }, SITE))).not.toContain("en1");
    });

    it("L1A-ADMIN-EDITOR: two Published members in one language → that language is marked; the page's own edits count", () => {
        const pages: ListedPage[] = [
            { nodeId: "en1", slug: "/about", status: "Published", translationKey: "K", hasTranslationItem: true },
            { nodeId: "ro1", slug: "/ro/despre", status: "Published", translationKey: "K", hasTranslationItem: true },
            { nodeId: "ro3", slug: "/ro/alt", status: "Published", translationKey: "K", hasTranslationItem: true },
        ];
        expect(translationSetView(pages, { nodeId: "en1", slug: "/about", status: "Published" }, SITE).sharedTags).toEqual(["ro"]);
        // ro3 being unpublished in the editor (status Draft, unsaved) ends the clash; ro1 moved to /despre makes an English one.
        expect(translationSetView(pages, { nodeId: "ro3", slug: "/ro/alt", status: "Draft" }, SITE).sharedTags).toEqual([]);
        expect(translationSetView(pages, { nodeId: "ro1", slug: "/despre", status: "Published" }, SITE).sharedTags).toEqual(["en"]);
    });

    it("L1A-ADMIN-EDITOR: the choice — select value and back, dirty state, and translationOf sent only for a choice made", () => {
        const choices: TranslationChoice[] = [{ kind: "unchanged" }, { kind: "leave" }, { kind: "join", nodeId: "en1" }];
        for (const c of choices) expect(choiceFromSelectValue(choiceSelectValue(c))).toEqual(c);
        expect(choices.map(choiceChangesSet)).toEqual([false, true, true]);
        const payload = { title: "T", slug: "/ro/t" };
        expect(withTranslationChoice(payload, { kind: "unchanged" })).toEqual(payload);
        expect(Object.hasOwn(withTranslationChoice(payload, { kind: "unchanged" }), "translationOf")).toBe(false);
        expect(withTranslationChoice(payload, { kind: "leave" })).toEqual({ ...payload, translationOf: null });
        expect(withTranslationChoice(payload, { kind: "join", nodeId: "en1" })).toEqual({ ...payload, translationOf: "en1" });
    });
});
