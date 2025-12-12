import React from 'react';
import { HeroRender } from './hero/HeroRender';
import { PricingRender } from './pricing/PricingRender';
import { ImageRender } from './image/ImageRender';
import { ContactRender } from './contact/ContactRender';

export const RENDER_MAP: Record<string, React.FC<any>> = {
    'hero': HeroRender,
    'pricing': PricingRender,
    'image': ImageRender,
    'contact': ContactRender,
};
