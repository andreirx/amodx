import { z } from 'zod';

export const PricingSchema = z.object({
    title: z.string().default("Founder's Circle"),
    price: z.string().default("$299"),
    interval: z.string().default("one-time"),
    features: z.string().default("Source Code\nUnlimited Sites\nDiscord Access"), // Simple text area for V1
    buttonText: z.string().default("Join the Forge"),
    buttonLink: z.string().default("#"),
    recommended: z.boolean().default(false),
});
