import { z } from 'zod';

const FaqItem = z.object({
    id: z.string(),
    question: z.string().default("Question?"),
    answer: z.string().default("Answer.")
});

export const FaqSchema = z.object({
    headline: z.string().default("Frequently Asked Questions"),
    items: z.array(FaqItem).default([
        { id: '1', question: "Is this free?", answer: "Yes, for the basic plan." },
        { id: '2', question: "Can I cancel?", answer: "Anytime." }
    ])
});
