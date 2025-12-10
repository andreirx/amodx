import React from "react";
import { RENDER_MAP } from "@amodx/plugins/render";

// --- 1. CORE TEXT COMPONENTS (Your Original Code) ---

const Paragraph = ({ content }: any) => {
    if (!content) return <p className="mb-4 h-4" />;
    return (
        <p className="mb-4 text-lg leading-relaxed text-gray-700">
            {content.map((c: any, i: number) => {
                if (c.type === "text") {
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
    if (attrs?.level === 1) return <h1 className="text-4xl font-black mb-6 mt-10 text-foreground tracking-tight">{text}</h1>;
    if (attrs?.level === 2) return <h2 className="text-3xl font-bold mb-4 mt-8 text-foreground tracking-tight">{text}</h2>;
    return <h3 className="text-2xl font-semibold mb-3 mt-6 text-foreground">{text}</h3>;
};

// --- 2. THE REGISTRY ---
// Combine Core Text blocks with Dynamic Plugin blocks
const COMPONENTS: Record<string, React.FC<any>> = {
    paragraph: Paragraph,
    heading: Heading,
    ...RENDER_MAP
};

// --- 3. THE RENDERER ---
export function RenderBlocks({ blocks }: { blocks: any[] }) {
    if (!blocks || !Array.isArray(blocks)) return null;

    return (
        <div className="flex flex-col">
            {/* Note: We removed the global 'prose' wrapper here */}

            {blocks.map((block, index) => {
                const Component = COMPONENTS[block.type];

                if (!Component) {
                    console.warn(`Unknown block type: ${block.type}`);
                    return null;
                }

                // CASE A: Text Blocks -> Wrap in Prose for typography
                if (block.type === 'paragraph' || block.type === 'heading') {
                    return (
                        <div key={index} className="prose prose-zinc dark:prose-invert max-w-4xl mx-auto w-full px-6">
                            <Component {...block} />
                        </div>
                    );
                }

                // CASE B: Structural Blocks (Hero) -> Render Full Width
                // We pass {...block} which includes { attrs: {...} }
                // The Plugin component expects { attrs } props, so this matches.
                return <Component key={index} {...block} />;
            })}
        </div>
    );
}
