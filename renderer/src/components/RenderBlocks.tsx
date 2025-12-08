import React from "react";

// 1. Define the Blocks (We can move these to separate files later)
const HeroBlock = ({ data }: { data: any }) => (
    <section className="py-20 px-6 text-center">
        <h1 className="text-5xl font-bold mb-4" style={{ color: 'var(--primary)' }}>
            {data.headline || "Welcome"}
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            {data.subheadline}
        </p>
    </section>
);

const TextBlock = ({ data }: { data: any }) => (
    <section className="prose prose-lg mx-auto px-6 py-8">
        <div dangerouslySetInnerHTML={{ __html: data.html }} />
    </section>
);

// 2. The Registry
const COMPONENTS: Record<string, React.FC<any>> = {
    hero: HeroBlock,
    text: TextBlock,
    // Add 'cta', 'gallery', 'form' here later
};

// 3. The Renderer Component
export function RenderBlocks({ blocks }: { blocks: any[] }) {
    if (!blocks || !Array.isArray(blocks)) return null;

    return (
        <>
            {blocks.map((block, index) => {
                const Component = COMPONENTS[block.type];
                if (!Component) {
                    console.warn(`Unknown block type: ${block.type}`);
                    return null;
                }
                return <Component key={block.id || index} data={block.data} />;
            })}
        </>
    );
}
