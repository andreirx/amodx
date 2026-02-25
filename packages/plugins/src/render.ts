import React from 'react';
import { HeroRender } from './hero/HeroRender';
import { PricingRender } from './pricing/PricingRender';
import { ImageRender } from './image/ImageRender';
import { ContactRender } from './contact/ContactRender';
import { VideoRender } from "./video/VideoRender";
import { LeadMagnetRender } from "./lead-magnet/LeadMagnetRender";
import { CtaRender } from "./cta/CtaRender";
import { FeaturesRender } from "./features/FeaturesRender";
import { TestimonialsRender } from "./testimonials/TestimonialsRender";
import { ColumnsRender } from './columns/ColumnsRender';
import { TableRender } from './table/TableRender';
import { HtmlRender } from './html/HtmlRender';
import { FaqRender } from "./faq/FaqRender";
import { PostGridRender } from "./post-grid/PostGridRender";
import { CarouselRender } from './carousel/CarouselRender';
import { CodeBlockRender } from './code-block/CodeBlockRender';
import { ReviewsCarouselRender } from './reviews-carousel/ReviewsCarouselRender';
import { CategoryShowcaseRender } from './category-showcase/CategoryShowcaseRender';
import { MarkdownRender } from './markdown/MarkdownRender';

export const RENDER_MAP: Record<string, React.FC<any>> = {
    'hero': HeroRender,
    'pricing': PricingRender,
    'image': ImageRender,
    'contact': ContactRender,
    'video': VideoRender,
    'leadMagnet': LeadMagnetRender,
    'cta': CtaRender,
    'features': FeaturesRender,
    'testimonials': TestimonialsRender,
    'columns': ColumnsRender,
    'table': TableRender,
    'html': HtmlRender,
    'faq': FaqRender,
    'postGrid': PostGridRender,
    'carousel': CarouselRender,
    'codeBlock': CodeBlockRender,
    'reviewsCarousel': ReviewsCarouselRender,
    'categoryShowcase': CategoryShowcaseRender,
    'markdown': MarkdownRender
};
