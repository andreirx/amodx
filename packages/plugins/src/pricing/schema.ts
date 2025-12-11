import { z } from 'zod';

const PlanSchema = z.object({
    id: z.string(),
    title: z.string(),
    price: z.string(),
    interval: z.string(),
    features: z.string(),
    buttonText: z.string(),
    highlight: z.boolean(),
});

export const PricingSchema = z.object({
    headline: z.string().default("Simple Pricing"),
    subheadline: z.string().default("Choose the plan that fits your needs."),
    plans: z.array(PlanSchema).default([
        {
            id: '1',
            title: 'Starter',
            price: '$29',
            interval: 'mo',
            features: 'Feature 1\nFeature 2',
            buttonText: 'Start',
            highlight: false
        },
        {
            id: '2',
            title: 'Pro',
            price: '$99',
            interval: 'mo',
            features: 'Everything in Starter\nPriority Support',
            buttonText: 'Go Pro',
            highlight: true
        }
    ]),
});
