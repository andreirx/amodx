"use client";
import React, { useState } from "react";
import { Lock, Unlock, Download, Loader2 } from "lucide-react";

export function LeadMagnetRender({ attrs }: { attrs: any }) {
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [downloadUrl, setDownloadUrl] = useState("");

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
                    .execute(siteKey, { action: "lead_magnet" })
                    .then((token: string) => resolve(token))
                    .catch(() => resolve(null));
            });
        });
    };

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setStatus("loading");
        const formData = new FormData(e.target);
        const email = formData.get("email");

        // @ts-ignore
        const tenantId = typeof window !== 'undefined' ? window.AMODX_TENANT_ID : "";

        // Get reCAPTCHA token (null if not configured)
        const recaptchaToken = await getRecaptchaToken();

        try {
            const res = await fetch('/api/leads', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-tenant-id': tenantId
                },
                body: JSON.stringify({
                    email,
                    resourceId: attrs.resourceId,
                    tags: attrs.tags,
                    recaptchaToken
                })
            });

            const data = await res.json();

            if (data.downloadUrl) {
                setDownloadUrl(data.downloadUrl);
                setStatus("success");
            } else {
                setStatus("success");
            }
        } catch (err) {
            console.error(err);
            setStatus("error");
        }
    };

    if (status === "success" && downloadUrl) {
        return (
            <div className="my-8 p-8 bg-green-50 rounded-xl border border-green-200 text-center animate-in fade-in zoom-in-95 duration-300">
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Unlock className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-green-900 mb-2">Unlocked!</h3>
                <p className="text-sm text-green-700 mb-6">Your file is ready.</p>
                <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 transition-colors shadow-sm"
                >
                    <Download className="w-4 h-4" /> Download Now
                </a>
            </div>
        );
    }

    return (
        <div className="my-10 max-w-md mx-auto bg-card border-2 border-dashed border-primary/20 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
            {/* Header Area */}
            <div className="bg-muted/50 p-6 text-center border-b border-border">
                <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-3">
                    <Lock className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-foreground">{attrs.headline}</h3>
                <p className="text-sm text-muted-foreground mt-1">{attrs.description}</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-background">
                <div>
                    <label className="sr-only">Email</label>
                    <input
                        name="email"
                        type="email"
                        required
                        placeholder="name@example.com"
                        className="w-full px-4 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all placeholder:text-muted-foreground"
                    />
                </div>
                <button
                    type="submit"
                    disabled={status === "loading"}
                    className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {status === "loading" && <Loader2 className="w-4 h-4 animate-spin" />}
                    {status === "loading" ? "Unlocking..." : attrs.buttonText}
                </button>
            </form>
        </div>
    );
}
