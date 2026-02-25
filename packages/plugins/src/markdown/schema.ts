import { z } from 'zod';

export const MarkdownSchema = z.object({
    content: z.string().default(""),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
