import React from 'react';

/**
 * RENDER_LOADERS — the block-type → lazy render-component registry.
 *
 * perf-1: each entry is a dynamic `import()` thunk, NOT an eager import. Consumers
 * (the renderer's RenderBlocks) wrap these with a code-splitting boundary
 * (`next/dynamic`) so a page downloads ONLY the render chunks for the block types it
 * actually renders. Previously this module eagerly imported all render components into
 * a single `RENDER_MAP`; because RenderBlocks is a client component, that pulled every
 * plugin (incl. highlight.js / marked / swiper) into one ~1.2 MB client chunk shipped
 * on every content page. See docs/slices/perf-1-unused-js.md.
 *
 * Framework-agnostic on purpose: the thunks are plain ESM `import()` — no Next.js or
 * renderer coupling — so the plugin package keeps the split-entry rule (render vs admin)
 * and the renderer owns the code-splitting mechanism.
 *
 * Each thunk resolves to `{ default: Component }` so it can be handed straight to a
 * loader that expects a default export (e.g. React.lazy / next/dynamic).
 */
export type RenderLoader = () => Promise<{ default: React.FC<any> }>;

export const RENDER_LOADERS: Record<string, RenderLoader> = {
    'hero': () => import('./hero/HeroRender').then(m => ({ default: m.HeroRender })),
    'videoHero': () => import('./video-hero/VideoHeroRender').then(m => ({ default: m.VideoHeroRender })),
    'pricing': () => import('./pricing/PricingRender').then(m => ({ default: m.PricingRender })),
    'image': () => import('./image/ImageRender').then(m => ({ default: m.ImageRender })),
    'contact': () => import('./contact/ContactRender').then(m => ({ default: m.ContactRender })),
    'video': () => import('./video/VideoRender').then(m => ({ default: m.VideoRender })),
    'leadMagnet': () => import('./lead-magnet/LeadMagnetRender').then(m => ({ default: m.LeadMagnetRender })),
    'cta': () => import('./cta/CtaRender').then(m => ({ default: m.CtaRender })),
    'features': () => import('./features/FeaturesRender').then(m => ({ default: m.FeaturesRender })),
    'testimonials': () => import('./testimonials/TestimonialsRender').then(m => ({ default: m.TestimonialsRender })),
    'columns': () => import('./columns/ColumnsRender').then(m => ({ default: m.ColumnsRender })),
    'table': () => import('./table/TableRender').then(m => ({ default: m.TableRender })),
    'html': () => import('./html/HtmlRender').then(m => ({ default: m.HtmlRender })),
    'faq': () => import('./faq/FaqRender').then(m => ({ default: m.FaqRender })),
    'postGrid': () => import('./post-grid/PostGridRender').then(m => ({ default: m.PostGridRender })),
    'carousel': () => import('./carousel/CarouselRender').then(m => ({ default: m.CarouselRender })),
    'codeBlock': () => import('./code-block/CodeBlockRender').then(m => ({ default: m.CodeBlockRender })),
    'reviewsCarousel': () => import('./reviews-carousel/ReviewsCarouselRender').then(m => ({ default: m.ReviewsCarouselRender })),
    'categoryShowcase': () => import('./category-showcase/CategoryShowcaseRender').then(m => ({ default: m.CategoryShowcaseRender })),
    'markdown': () => import('./markdown/MarkdownRender').then(m => ({ default: m.MarkdownRender })),
};
