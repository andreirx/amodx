import React from 'react';
import { HeroRender } from './hero/HeroRender';
import { PricingRender } from './pricing/PricingRender';

// The Map used by the Next.js Renderer
export const RENDER_MAP: Record<string, React.FC<any>> = {
    'hero': HeroRender,
    'pricing': PricingRender,
};
