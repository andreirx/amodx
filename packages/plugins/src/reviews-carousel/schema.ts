import { z } from 'zod';

const ReviewItem = z.object({
    id: z.string(),
    name: z.string().default("Customer Name"),
    avatarUrl: z.string().optional(),
    date: z.string().default(""),
    rating: z.number().min(1).max(5).default(5),
    text: z.string().default(""),
    source: z.enum(["google", "facebook", "manual"]).default("google"),
});

export const ReviewsCarouselSchema = z.object({
    headline: z.string().default("Customer Reviews"),
    items: z.array(ReviewItem).default([
        { id: '1', name: "Maria Popescu", date: "2025-01-15", rating: 5, text: "Excellent products!", source: "google" },
        { id: '2', name: "Ion Ionescu", date: "2025-01-10", rating: 5, text: "Great quality and fast delivery.", source: "google" },
    ]),
    showSource: z.boolean().default(true),
    autoScroll: z.boolean().default(false),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
