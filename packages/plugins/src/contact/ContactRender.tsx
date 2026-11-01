"use client";
import React, { useState } from "react";
import { ButtonEffectWrap } from "../common/ButtonEffectWrap";
import { resolveButtonEffect } from "../common/resolveButtonEffect";
import type { BlockStrings } from "@amodx/shared";

/**
 * LOCALE-1C: the form's fixed texts come from `strings` (the tenant's locale table; RenderBlocks always gives it). The
 * block's own `successMessage` wins over `contactSentDetail`.
 */
export function ContactRender({ attrs, strings }: { attrs: any; strings: BlockStrings }) {
    const [status, setStatus] = useState("idle");
    const [errorMessage, setErrorMessage] = useState("");
    const buttonEffect = resolveButtonEffect(attrs);

    // Get reCAPTCHA token if configured
    const getRecaptchaToken = async (): Promise<string | null> => {
        if (typeof window === "undefined") return null;
        // @ts-ignore
        const siteKey = window.AMODX_RECAPTCHA_KEY;
        if (!siteKey) return null;
        // @ts-ignore
        const grecaptcha = window.grecaptcha;
        if (!grecaptcha) return null;

        return new Promise((resolve) => {
            grecaptcha.ready(() => {
                grecaptcha
                    .execute(siteKey, { action: "contact_form" })
                    .then((token: string) => resolve(token))
                    .catch(() => resolve(null));
            });
        });
    };

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setStatus("loading");
        setErrorMessage("");

        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        // @ts-ignore
        const tenantId = typeof window !== 'undefined' ? window.AMODX_TENANT_ID : "";

        // Get reCAPTCHA token (null if not configured)
        const recaptchaToken = await getRecaptchaToken();

        // LOCALE-1C (§ 5.2 pattern D): the shown text is chosen by what the SERVER answered, never by testing a table
        // text — an error answer without a text shows `contactSendFailed` exactly as resolved (a stored "" stays empty).
        let failedWithoutText = false;
        try {
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-tenant-id': tenantId
                },
                body: JSON.stringify({ ...data, tags: attrs.tags, recaptchaToken })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                failedWithoutText = !err.error;
                throw new Error(err.error || strings.contactSendFailed);
            }
            setStatus("success");
        } catch (err: any) {
            console.error(err);
            setErrorMessage(failedWithoutText ? strings.contactSendFailed : err.message || strings.errorTryAgain);
            setStatus("error");
        }
    };

    if (status === "success") {
        return (
            <div className="p-6 bg-green-50 text-green-800 rounded-xl border border-green-200 text-center animate-in fade-in">
                <h3 className="font-semibold text-lg mb-1">{strings.contactSent}</h3>
                <p className="text-sm opacity-80">{attrs.successMessage || strings.contactSentDetail}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto p-1">
            <div className="text-center mb-8">
                <h3 className="text-2xl font-bold tracking-tight mb-2">{attrs.headline}</h3>
                <p className="text-muted-foreground">{attrs.description}</p>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium mb-1.5 text-foreground">{strings.contactName}</label>
                    <input
                        name="name"
                        type="text"
                        required
                        className="w-full px-4 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1.5 text-foreground">{strings.contactEmail}</label>
                    <input
                        name="email"
                        type="email"
                        required
                        className="w-full px-4 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1.5 text-foreground">{strings.contactMessage}</label>
                    <textarea
                        name="message"
                        required
                        rows={4}
                        className="w-full px-4 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"
                    />
                </div>
            </div>

            {errorMessage && (
                <p className="text-sm text-red-600 text-center">{errorMessage}</p>
            )}

            <ButtonEffectWrap effect={buttonEffect} className="block mt-2">
                <button
                    type="submit"
                    disabled={status === "loading"}
                    className="w-full py-3 rounded-lg font-semibold text-primary-foreground bg-primary hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm"
                >
                    {status === "loading" ? strings.contactSending : attrs.buttonText}
                </button>
            </ButtonEffectWrap>
        </form>
    );
}
