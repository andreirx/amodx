import { HeroRender } from './hero/HeroRender';
import { PluginDefinition } from './types';

// We redefine the registry map manually or split the definition object
// To stay clean, let's export a map directly.

export const RENDER_MAP: Record<string, React.FC<any>> = {
    'hero': HeroRender,
    // other plugins go here too
};
