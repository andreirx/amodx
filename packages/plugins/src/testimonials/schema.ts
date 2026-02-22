import { z } from 'zod';

const TestimonialItem = z.object({
    id: z.string(),
    quote: z.string().default("AMODX changed my agency forever."),
    author: z.string().default("Happy Client"),
    role: z.string().default("CEO, TechCorp"),
    avatar: z.string().optional(), // URL
});

export const TestimonialsSchema = z.object({
    headline: z.string().default("Trusted by Builders"),
    subheadline: z.string().default("See what others are saying."),
    items: z.array(TestimonialItem).default([
        { id: '1', quote: "The deployment speed is insane.", author: "Jane Doe", role: "CTO" },
        { id: '2', quote: "Finally, no more plugin updates.", author: "John Smith", role: "Agency Owner" },
    ]),
    style: z.enum(["grid", "slider", "minimal"]).default("grid"),
    blockWidth: z.enum(["content", "wide", "full"]).default("full"),
});
