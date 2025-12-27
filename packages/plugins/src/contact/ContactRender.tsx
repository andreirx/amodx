"use client";
import React, { useState } from "react";

export function ContactRender({ attrs }: { attrs: any }) {
    const [status, setStatus] = useState("idle");

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setStatus("loading");

        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        // @ts-ignore
        const tenantId = typeof window !== 'undefined' ? window.AMODX_TENANT_ID : "";

        try {
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-tenant-id': tenantId
                },
                body: JSON.stringify({ ...data, tags: attrs.tags })
            });

            if (!response.ok) throw new Error("Failed");
            setStatus("success");
        } catch (err) {
            console.error(err);
            setStatus("error");
        }
    };

    if (status === "success") {
        return (
            <div className="p-6 bg-green-50 text-green-800 rounded-xl border border-green-200 text-center animate-in fade-in">
                <h3 className="font-semibold text-lg mb-1">Message Sent!</h3>
                <p className="text-sm opacity-80">{attrs.successMessage || "We'll get back to you shortly."}</p>
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
                    <label className="block text-sm font-medium mb-1.5 text-foreground">Name</label>
                    <input
                        name="name"
                        type="text"
                        required
                        className="w-full px-4 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1.5 text-foreground">Email</label>
                    <input
                        name="email"
                        type="email"
                        required
                        className="w-full px-4 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1.5 text-foreground">Message</label>
                    <textarea
                        name="message"
                        required
                        rows={4}
                        className="w-full px-4 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"
                    />
                </div>
            </div>

            <button
                type="submit"
                disabled={status === "loading"}
                className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm mt-2"
            >
                {status === "loading" ? "Sending..." : attrs.buttonText}
            </button>
        </form>
    );
}
