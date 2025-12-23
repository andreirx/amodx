import { z } from 'zod';

const FeatureItem = z.object({
    id: z.string(),
    title: z.string().default("Feature Title"),
    description: z.string().default("Feature description goes here."),
    icon: z.string().default("Check"), // Lucide icon name
});

export const FeaturesSchema = z.object({
    headline: z.string().default("Key Features"),
    subheadline: z.string().default("Everything you need to scale."),
    items: z.array(FeatureItem).default([
        { id: '1', title: 'Speed', description: 'Blazing fast load times.', icon: 'Zap' },
        { id: '2', title: 'Security', description: 'Enterprise-grade protection.', icon: 'Shield' },
        { id: '3', title: 'Scale', description: 'Grow without limits.', icon: 'TrendingUp' },
    ]),
    columns: z.enum(["2", "3", "4"]).default("3"),
});
