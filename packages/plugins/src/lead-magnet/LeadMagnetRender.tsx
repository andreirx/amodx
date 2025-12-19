"use client";
import React, { useState } from "react";
import { Lock, Unlock, Download, Loader2 } from "lucide-react";

export function LeadMagnetRender({ attrs }: { attrs: any }) {
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [downloadUrl, setDownloadUrl] = useState("");

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        setStatus("loading");
        const formData = new FormData(e.target);
        const email = formData.get("email");

        // @ts-ignore
        const tenantId = typeof window !== 'undefined' ? window.AMODX_TENANT_ID : "";

        try {
            // POST to Leads API
            const res = await fetch('/api/leads', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-tenant-id': tenantId
                },
                body: JSON.stringify({
                    email,
                    resourceId: attrs.resourceId, // <--- Request the file
                    tags: attrs.tags
                })
            });

            const data = await res.json();

            if (data.downloadUrl) {
                setDownloadUrl(data.downloadUrl);
                setStatus("success");
                // Optional: Auto-trigger download?
                // window.location.href = data.downloadUrl;
            } else {
                // Should technically be success (lead saved) but no file found
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
        <div className="my-10 max-w-md mx-auto bg-white border-2 border-dashed border-indigo-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
            <div className="bg-indigo-50/50 p-6 text-center border-b border-indigo-100">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Lock className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">{attrs.headline}</h3>
                <p className="text-sm text-gray-500 mt-1">{attrs.description}</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                    <label className="sr-only">Email</label>
                    <input
                        name="email"
                        type="email"
                        required
                        placeholder="name@example.com"
                        className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                    />
                </div>
                <button
                    type="submit"
                    disabled={status === "loading"}
                    className="w-full py-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {status === "loading" && <Loader2 className="w-4 h-4 animate-spin" />}
                    {status === "loading" ? "Unlocking..." : attrs.buttonText}
                </button>
            </form>
        </div>
    );
}
