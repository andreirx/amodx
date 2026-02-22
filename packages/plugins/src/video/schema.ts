import { z } from 'zod';

export const VideoSchema = z.object({
    url: z.string().default(""), // YouTube/Vimeo URL
    caption: z.string().optional(),
    width: z.enum(["centered", "wide", "full"]).default("centered"),
    autoplay: z.boolean().default(false),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
