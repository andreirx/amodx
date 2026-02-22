import { z } from 'zod';

export const ImageSchema = z.object({
    src: z.string().default(""),
    alt: z.string().default(""), // For SEO
    title: z.string().optional(), // Tooltip text
    caption: z.string().optional(), // Visible text below image
    width: z.enum(["full", "wide", "centered"]).default("full"),
    aspectRatio: z.string().default("auto"), // "16/9", "4/3", "1/1"
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
