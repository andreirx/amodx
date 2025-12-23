import React from 'react';
import { HeroRender } from './hero/HeroRender';
import { PricingRender } from './pricing/PricingRender';
import { ImageRender } from './image/ImageRender';
import { ContactRender } from './contact/ContactRender';
import {VideoRender} from "./video/VideoRender";
import {LeadMagnetRender} from "./lead-magnet/LeadMagnetRender";
import {CtaRender} from "./cta/CtaRender";
import {FeaturesRender} from "./features/FeaturesRender";
import {TestimonialsRender} from "./testimonials/TestimonialsRender";
import { ColumnsPlugin } from './columns';
import { TablePlugin } from './table';

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
    columns: ColumnsPlugin.renderComponent,
    table: TablePlugin.renderComponent,
};
