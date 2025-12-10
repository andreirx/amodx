import { HeroPlugin } from './hero';
import { PricingPlugin } from './pricing';
import { PluginDefinition } from './types';

const REGISTRY: PluginDefinition[] = [
    HeroPlugin,
    PricingPlugin,
];

export const getExtensions = () => REGISTRY.map(p => p.editorExtension);

export const getPluginList = () => REGISTRY.map(p => ({
    key: p.key,
    label: p.label,
    icon: p.icon
}));
