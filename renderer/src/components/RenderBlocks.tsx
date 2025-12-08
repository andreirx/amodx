import React from "react";

// --- TIPTAP BLOCK COMPONENTS ---

const Paragraph = ({ content }: any) => {
    if (!content) return <p className="mb-4 h-4" />; // Empty paragraph spacer
    return (
        <p className="mb-4 text-lg leading-relaxed text-gray-700">
            {content.map((c: any, i: number) => {
                if (c.type === "text") {
                    // Handle simple formatting like bold/italic if passed in marks
                    let text = c.text;
                    if (c.marks) {
                        c.marks.forEach((m: any) => {
                            if (m.type === "bold") text = <strong key={i}>{text}</strong>;
                            if (m.type === "italic") text = <em key={i}>{text}</em>;
                            if (m.type === "link") text = <a href={m.attrs.href} key={i} className="text-blue-600 underline">{text}</a>;
                        });
                    }
                    return <span key={i}>{text}</span>;
                }
                return null;
            })}
        </p>
    );
};

const Heading = ({ content, attrs }: any) => {
    const text = content?.map((c: any) => c.text).join("") || "";
    // Tailwind v4 classes for typography
    if (attrs?.level === 1) return <h1 className="text-4xl font-black mb-6 mt-10 text-foreground tracking-tight">{text}</h1>;
    if (attrs?.level === 2) return <h2 className="text-3xl font-bold mb-4 mt-8 text-foreground tracking-tight">{text}</h2>;
    return <h3 className="text-2xl font-semibold mb-3 mt-6 text-foreground">{text}</h3>;
};

// --- LEGACY COMPONENTS (Optional) ---
const HeroBlock = ({ data }: { data: any }) => (
    <section className="py-20 px-6 text-center bg-muted/20 rounded-xl my-8">
        <h1 className="text-5xl font-bold mb-4 text-primary">
            {data.headline || "Welcome"}
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {data.subheadline}
        </p>
    </section>
);

// --- THE REGISTRY ---
const COMPONENTS: Record<string, React.FC<any>> = {
    // Tiptap Standard Blocks
    paragraph: Paragraph,
    heading: Heading,

    // Custom AMODX Blocks
    hero: HeroBlock,
};

export function RenderBlocks({ blocks }: { blocks: any[] }) {
    if (!blocks || !Array.isArray(blocks)) return null;

    return (
        <div className="prose prose-zinc dark:prose-invert max-w-none">
            {blocks.map((block, index) => {
                const Component = COMPONENTS[block.type];
                if (!Component) {
                    // Fallback for unknown blocks (helps debugging)
                    console.warn(`Unknown block type: ${block.type}`);
                    return null;
                }
                return <Component key={index} {...block} />;
            })}
        </div>
    );
}
