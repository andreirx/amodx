"use client";
import React, { useState } from "react";

export function ContactRender({ attrs }: { attrs: any }) {
    const [status, setStatus] = useState("idle");

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setStatus("loading");

        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());

        // Get Tenant ID from Global Scope (Still needed for the header)
        // @ts-ignore
        const tenantId = typeof window !== 'undefined' ? window.AMODX_TENANT_ID : "";

        try {
            // RELATIVE FETCH -> Hits renderer/src/app/api/leads/route.ts
            const response = await fetch('/api/leads', {
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
            <div className="p-4 bg-green-50 text-green-700 rounded border border-green-200 text-center animate-in fade-in">
                <p className="font-medium">{attrs.successMessage}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto">
            <div className="text-center mb-6">
                <h3 className="text-xl font-bold">{attrs.headline}</h3>
                <p className="text-muted-foreground text-sm">{attrs.description}</p>
            </div>

            <div>
                <label className="sr-only">Email</label>
                <input
                    name="email"
                    type="email"
                    required
                    placeholder="name@example.com"
                    className="w-full px-4 py-2 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                />
            </div>

            <button
                type="submit"
                disabled={status === "loading"}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
                {status === "loading" ? "Sending..." : attrs.buttonText}
            </button>
        </form>
    );
}
