"use client"; // <--- Add this

import React from "react";
import dynamic from "next/dynamic";
import { RENDER_LOADERS } from "@amodx/plugins/render";
import { FULL_BLEED_DEFAULTS } from "@amodx/shared";
import { useTenantUrl } from "@/lib/routing"; // Import
import Link from "next/link"; // Use Next Link for prefetching

// perf-1: wrap each plugin render loader in a code-splitting boundary ONCE, at module
// scope (stable component identity — never rebuild these per render, or blocks would
// remount on every parent update). `ssr: true` keeps the block in the server-rendered
// HTML (identical output, no CLS), while the client only downloads the render chunk for
// block types actually present on the page. Was: a static RENDER_MAP that pulled all 20
// plugin renders (+ highlight.js / marked / swiper) into one ~1.2 MB client chunk on
// every content page. See docs/slices/perf-1-unused-js.md.
const PLUGIN_COMPONENTS: Record<string, React.ComponentType<any>> = Object.fromEntries(
    Object.entries(RENDER_LOADERS).map(([type, loader]) => [type, dynamic(loader, { ssr: true })])
);

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
    ...PLUGIN_COMPONENTS // Plugins (lazy, code-split per block type)
};

// Accept tenantId + contentMaxWidth (prose width) + siteMaxWidth (shell width)
export function RenderBlocks({ blocks, tenantId, contentMaxWidth, siteMaxWidth, basePath }: { blocks: any[], tenantId?: string, contentMaxWidth?: string, siteMaxWidth?: string, basePath?: string }) {
    const { getUrl: clientGetUrl } = useTenantUrl();

    // Prefer server-provided basePath (SSR-correct) over client-side hook detection.
    // useTenantUrl relies on usePathname() which returns the REWRITTEN path after middleware,
    // losing the /_site/ prefix. The server-side basePath from getPreviewBase() is authoritative.
    const getUrl = basePath
        ? (slug: string) => {
            if (!slug) return "#";
            if (slug.startsWith("http")) return slug;
            const clean = slug.startsWith("/") ? slug : `/${slug}`;
            if (clean.startsWith(basePath)) return clean;
            return `${basePath}${clean}`;
        }
        : clientGetUrl;

    if (!blocks || !Array.isArray(blocks)) return null;

    return (
        <>
            {blocks.map((block, index) => {
                const Component = PLUGIN_COMPONENTS[block.type]; // e.g. PostGridRender (lazy)

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

                // Inject getUrl so plugins that construct internal links
                // (e.g. CategoryShowcase product/category links) can prefix them
                // correctly on both server and client, including /_site/ preview paths.
                newAttrs._getUrl = getUrl;

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
