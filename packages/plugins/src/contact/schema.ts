import { z } from 'zod';
import { EffectConfigSchema } from '@amodx/shared';

export const ContactSchema = z.object({
    headline: z.string().default("Get Access"),
    description: z.string().default("Enter your email to unlock this resource."),
    buttonText: z.string().default("Unlock Now"),
    successMessage: z.string().default("Success! Redirecting..."),
    tags: z.string().default("contact-form"),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
    buttonEffect: EffectConfigSchema.optional(),
});
