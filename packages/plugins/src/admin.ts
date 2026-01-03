import { HeroPlugin } from './hero';
import { PricingPlugin } from './pricing';
import { ImagePlugin } from './image';
import { ContactPlugin } from './contact';
import { PluginDefinition } from './types';
import {VideoPlugin} from "./video";
import {LeadMagnetPlugin} from "./lead-magnet";
import {CtaPlugin} from "./cta";
import {FeaturesPlugin} from "./features";
import {TestimonialsPlugin} from "./testimonials";
import { ColumnsPlugin } from './columns';
import { TablePlugin } from './table';
import { HtmlPlugin } from './html';
import {FaqPlugin} from "./faq";
import {PostGridPlugin} from "./post-grid";

const REGISTRY: PluginDefinition[] = [
    HeroPlugin,
    PricingPlugin,
    ImagePlugin,
    ContactPlugin,
    VideoPlugin,
    LeadMagnetPlugin,
    CtaPlugin,
    FeaturesPlugin,
    TestimonialsPlugin,
    ColumnsPlugin,
    TablePlugin,
    HtmlPlugin,
    FaqPlugin,
    PostGridPlugin
];


export const getExtensions = () => REGISTRY.map(p => p.editorExtension);

export const getPluginList = () => REGISTRY.map(p => ({
    key: p.key,
    label: p.label,
    icon: p.icon
}));
