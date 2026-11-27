import { z } from 'zod';

/**
 * NEWSLETTER-1 (docs/slices/newsletter-1.md, scope item 1) — the `newsletter` block: a headline, a text, an email field,
 * a consent box and a button; the signup goes to the tenant's lead list and, when the site is connected, to MailerLite.
 * A new block with no stored instances, so its attributes carry ordinary defaults. The visitor texts of the form (field
 * label and placeholder, the consent line, the button, the thanks and failure texts) are NOT attributes: they come from
 * the tenant's locale table through the renderer's server pass (`prepareBlocks`, `_newsletter`). `buttonText` = the
 * owner's own button label; blank = the locale text.
 */
export const NewsletterBlockSchema = z.object({
    headline: z.string().default(""),
    description: z.string().default(""),
    buttonText: z.string().default(""),
    blockWidth: z.enum(["content", "wide", "full"]).default("content"),
});
