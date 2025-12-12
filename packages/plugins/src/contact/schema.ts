import { z } from 'zod';

export const ContactSchema = z.object({
    headline: z.string().default("Get Access"),
    description: z.string().default("Enter your email to unlock this resource."),
    buttonText: z.string().default("Unlock Now"),
    successMessage: z.string().default("Success! Redirecting..."),
    tags: z.string().default("contact-form"),
});
