"use client";
import React from "react";
import type { NewsletterTexts } from "@amodx/shared";
import { NewsletterForm } from "./NewsletterForm";

/**
 * NEWSLETTER-1 — the `newsletter` block on the public site. The visitor texts come from the renderer's server pass
 * (`prepareBlocks` in `renderer/src/components/SitePage.tsx`): `attrs._newsletter` = `newsletterTexts` of the tenant's
 * locale table. No `_newsletter` (no server pass: the admin preview) → the block draws nothing, because a consent box
 * without the tenant's consent line records no consent. Headline and text above the form, each only when not blank.
 */

const TEXT_KEYS = ["locale", "email", "emailPlaceholder", "consent", "subscribe", "subscribing", "thanks", "failed"] as const;

/** The server pass's `_newsletter`, or null when it is absent or not of that shape. */
function preparedTexts(value: unknown): NewsletterTexts | null {
    if (typeof value !== "object" || value === null) return null;
    const t = value as Record<string, unknown>;
    return TEXT_KEYS.every((k) => typeof t[k] === "string") && (t.consent as string) !== "" ? (t as unknown as NewsletterTexts) : null;
}

const textOf = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

export function NewsletterRender({ attrs }: { attrs: any }) {
    const texts = preparedTexts(attrs._newsletter);
    if (!texts) return null;
    const headline = textOf(attrs.headline);
    const description = textOf(attrs.description);
    return (
        <section className="my-12 max-w-md mx-auto">
            {(headline !== null || description !== null) && (
                <div className="text-center mb-6">
                    {headline !== null && <h2 className="text-2xl font-bold mb-2">{headline}</h2>}
                    {description !== null && <p className="text-muted-foreground">{description}</p>}
                </div>
            )}
            <NewsletterForm texts={texts} buttonText={typeof attrs.buttonText === "string" ? attrs.buttonText : undefined} />
        </section>
    );
}
