import { z } from 'zod';

export const HtmlSchema = z.object({
    content: z.string().default("<!-- Paste your embed code here -->"),
    isSandboxed: z.boolean().default(false), // Optional security wrapper
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
