"use client"; // <--- Add this

import React from "react";
import { RENDER_MAP } from "@amodx/plugins/render";
import { FULL_BLEED_DEFAULTS } from "@amodx/shared";
import { useTenantUrl } from "@/lib/routing"; // Import
import Link from "next/link"; // Use Next Link for prefetching

// --- RECURSIVE HELPER ---
const RenderChildren = ({ content }: { content: any[] }) => {
    if (!content) return null;
    return <RenderBlocks blocks={content} />;
};

// --- CORE COMPONENTS ---
const Paragraph = ({ content }: any) => {
    const { getUrl } = useTenantUrl(); // Hook
    if (!content) return <p className="mb-4 h-4" />;
    return (
        <p className="mb-4 leading-7 text-foreground/90">
            {content.map((c: any, i: number) => {
                if (c.type === "text") {
                    let text: React.ReactNode = c.text;
                    if (c.marks) {
                        c.marks.forEach((m: any) => {
                            if (m.type === "bold") text = <strong key={i} className="font-bold">{text}</strong>;
                            if (m.type === "italic") text = <em key={i} className="italic">{text}</em>;
                            if (m.type === "link") {
                                // FIX: Use Next Link + getUrl
                                text = (
                                    <Link
                                        href={getUrl(m.attrs.href)}
                                        key={i}
                                        className="text-primary underline underline-offset-4 hover:opacity-80"
                                    >
                                        {text}
                                    </Link>
                                );
                            }
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
    if (attrs?.level === 1) return <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl mb-6 mt-10">{text}</h1>;
    if (attrs?.level === 2) return <h2 className="scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0 mb-4 mt-8">{text}</h2>;
    if (attrs?.level === 3) return <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight mb-3 mt-6">{text}</h3>;
    return <h4 className="scroll-m-20 text-xl font-semibold tracking-tight mb-2 mt-4">{text}</h4>;
};

// NEW: Lists & Quotes
const BulletList = ({ content }: any) => <ul className="my-6 ml-6 list-disc [&>li]:mt-2"><RenderChildren content={content} /></ul>;
const OrderedList = ({ content }: any) => <ol className="my-6 ml-6 list-decimal [&>li]:mt-2"><RenderChildren content={content} /></ol>;
const ListItem = ({ content }: any) => <li><RenderChildren content={content} /></li>;
const Blockquote = ({ content }: any) => <blockquote className="mt-6 border-l-2 border-primary pl-6 italic text-muted-foreground"><RenderChildren content={content} /></blockquote>;
const HorizontalRule = () => <hr className="my-8 border-border" />;

const CORE_COMPONENTS: Record<string, React.FC<any>> = {
    paragraph: Paragraph,
    heading: Heading,
    bulletList: BulletList,
    orderedList: OrderedList,
    listItem: ListItem,
    blockquote: Blockquote,
    horizontalRule: HorizontalRule,
    ...RENDER_MAP // Plugins
};

// Accept tenantId + contentMaxWidth (prose width) + siteMaxWidth (shell width)
export function RenderBlocks({ blocks, tenantId, contentMaxWidth, siteMaxWidth }: { blocks: any[], tenantId?: string, contentMaxWidth?: string, siteMaxWidth?: string }) {
    const { getUrl } = useTenantUrl();

    if (!blocks || !Array.isArray(blocks)) return null;

    return (
        <>
            {blocks.map((block, index) => {
                const Component = RENDER_MAP[block.type]; // e.g. PostGridRender

                // Fallback for core types not in plugin map (paragraph, heading...)
                const CoreComponent = (CORE_COMPONENTS as any)[block.type];
                const FinalComponent = Component || CoreComponent;

                if (!FinalComponent) return null;

                // Clone attrs to inject fixed URLs
                const newAttrs = { ...block.attrs };

                // Auto-fix known link fields
                if (newAttrs.ctaLink) newAttrs.ctaLink = getUrl(newAttrs.ctaLink);
                if (newAttrs.buttonLink) newAttrs.buttonLink = getUrl(newAttrs.buttonLink);

                // For Pricing: Plans array
                if (newAttrs.plans) {
                    newAttrs.plans = newAttrs.plans.map((p: any) => ({
                        ...p,
                        buttonLink: getUrl(p.buttonLink)
                    }));
                }

                const rendered = <FinalComponent key={index} {...block} attrs={newAttrs} tenantId={tenantId} />;

                // Width wrapping (only at top-level — recursive RenderChildren calls don't pass contentMaxWidth)
                if (contentMaxWidth) {
                    // Per-block blockWidth attr > FULL_BLEED_DEFAULTS fallback > "content" default
                    const effectiveWidth = block.attrs?.blockWidth ||
                        (FULL_BLEED_DEFAULTS.has(block.type) ? "full" : "content");

                    if (effectiveWidth === "wide") {
                        return (
                            <div key={index} className={`${siteMaxWidth || "max-w-7xl"} mx-auto px-6`}>
                                {rendered}
                            </div>
                        );
                    }
                    if (effectiveWidth === "content") {
                        return (
                            <div key={index} className={`${contentMaxWidth} mx-auto px-6`}>
                                {rendered}
                            </div>
                        );
                    }
                    // "full" — no wrapper
                    return rendered;
                }

                return rendered;
            })}
        </>
    );
}
