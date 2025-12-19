import { HeroPlugin } from './hero';
import { PricingPlugin } from './pricing';
import { ImagePlugin } from './image';
import { ContactPlugin } from './contact';
import { PluginDefinition } from './types';
import {VideoPlugin} from "./video";
import {LeadMagnetPlugin} from "./lead-magnet";

const REGISTRY: PluginDefinition[] = [
    HeroPlugin,
    PricingPlugin,
    ImagePlugin,
    ContactPlugin,
    VideoPlugin,
    LeadMagnetPlugin
];


export const getExtensions = () => REGISTRY.map(p => p.editorExtension);

export const getPluginList = () => REGISTRY.map(p => ({
    key: p.key,
    label: p.label,
    icon: p.icon
}));
