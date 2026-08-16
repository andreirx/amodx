import { describe, it, expect } from "vitest";
import { extractText, findImage, stripMarkdown } from "./seoExtract";

// A markdown block as produced by the markdown plugin: atom node, prose in attrs.
const md = (content: string) => ({ type: "markdown", attrs: { content } });
// A rich-text paragraph, as Tiptap emits it.
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const imageNode = (src: string) => ({ type: "image", attrs: { src } });

// THE EXACT REPORTED BUG (acceptance criterion), pinned with ONE fixture: a page
// authored as a SINGLE big markdown block — prose AND an image ref living in
// attrs.content — must now yield BOTH a non-empty stripped seoDescription AND a
// featuredImage. The old inline helpers walked only rich-text nodes, so this one
// block produced an empty description AND no image at the same time.
describe("BUG-CASE: one big markdown block", () => {
    const blocks = [
        md(
            "## Our Handmade Rings\n\n" +
                "Each ring is **forged** from recycled gold. Read our [story](/about) to learn more.\n\n" +
                "![a ring](https://cdn.example.com/ring.jpg)",
        ),
    ];

    it("extractText → non-empty, syntax-stripped prose", () => {
        const out = extractText(blocks);
        expect(out.length).toBeGreaterThan(0);
        expect(out).toContain("Our Handmade Rings");
        expect(out).toContain("forged");
        expect(out).toContain("story"); // link text kept
        expect(out).not.toContain("/about"); // link URL dropped
        expect(out).not.toContain("##"); // heading marker stripped
        expect(out).not.toContain("**"); // emphasis marker stripped
    });

    it("findImage → the markdown image URL from the same block", () => {
        expect(findImage(blocks)).toBe("https://cdn.example.com/ring.jpg");
    });
});

describe("extractText", () => {
    it("markdown + rich-text mix preserves DOCUMENT ORDER (leading md first)", () => {
        const blocks = [md("# Alpha lead"), para("Bravo body")];
        const out = extractText(blocks);
        expect(out.indexOf("Alpha lead")).toBeLessThan(out.indexOf("Bravo body"));
    });

    it("rich-text before markdown keeps rich-text first", () => {
        const blocks = [para("First paragraph"), md("Second markdown")];
        const out = extractText(blocks);
        expect(out.indexOf("First paragraph")).toBeLessThan(out.indexOf("Second markdown"));
    });

    it("bounds output to ~160 chars", () => {
        const blocks = [md("word ".repeat(100))];
        expect(extractText(blocks).length).toBeLessThanOrEqual(160);
    });

    it("still handles pure rich-text pages (no regression)", () => {
        expect(extractText([para("Just prose here")])).toBe("Just prose here");
    });

    it("empty markdown block yields empty string", () => {
        expect(extractText([md("")])).toBe("");
    });
});

describe("findImage", () => {
    it("ignores title suffix in markdown image ref", () => {
        const blocks = [md('![alt](https://cdn.example.com/x.png "a title")')];
        expect(findImage(blocks)).toBe("https://cdn.example.com/x.png");
    });

    it("first image wins in DOCUMENT ORDER across md + image nodes", () => {
        const blocks = [
            md("no image here"),
            md("![first](https://cdn.example.com/first.jpg)"),
            imageNode("https://cdn.example.com/second.jpg"),
        ];
        expect(findImage(blocks)).toBe("https://cdn.example.com/first.jpg");
    });

    it("rich-text image node still found (no regression)", () => {
        expect(findImage([imageNode("https://cdn.example.com/rt.jpg")])).toBe("https://cdn.example.com/rt.jpg");
    });

    it("returns empty string when no image present", () => {
        expect(findImage([md("plain text"), para("more text")])).toBe("");
    });
});

describe("stripMarkdown", () => {
    it("strips headings, emphasis, code fences, inline code, lists, quotes, hr", () => {
        const out = stripMarkdown(
            "# Title\n\n> a quote\n\n- item one\n- item two\n\n---\n\n`inline` and **bold** and _em_\n\n```js\nconst x = 1;\n```\n\nend",
        );
        expect(out).not.toMatch(/[#>*_`]/);
        expect(out).not.toContain("---");
        expect(out).not.toContain("const x = 1;");
        expect(out).toContain("Title");
        expect(out).toContain("a quote");
        expect(out).toContain("item one");
        expect(out).toContain("inline");
        expect(out).toContain("bold");
        expect(out).toContain("end");
    });
});
