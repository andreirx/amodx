"use client";

import { useState } from "react";

export function ProductImageGallery({ mainImage, additionalImages, title }: {
    mainImage: string;
    additionalImages: string[];
    title: string;
}) {
    const allImages = [mainImage, ...additionalImages].filter(Boolean);
    const [activeIndex, setActiveIndex] = useState(0);
    const activeImage = allImages[activeIndex] || mainImage;

    if (!mainImage) return null;

    return (
        <div className="space-y-3">
            {/* Main image */}
            <div className="aspect-square bg-muted rounded-lg overflow-hidden relative group">
                <img
                    src={activeImage}
                    alt={title}
                    className="w-full h-full object-cover transition-opacity duration-200"
                />
                {/* Navigation arrows for mobile */}
                {allImages.length > 1 && (
                    <>
                        <button
                            onClick={() => setActiveIndex(i => (i - 1 + allImages.length) % allImages.length)}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 border border-border shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        </button>
                        <button
                            onClick={() => setActiveIndex(i => (i + 1) % allImages.length)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 border border-border shadow flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </>
                )}
                {/* Image counter */}
                {allImages.length > 1 && (
                    <span className="absolute bottom-2 right-2 bg-background/80 text-foreground text-xs px-2 py-0.5 rounded-full border border-border">
                        {activeIndex + 1} / {allImages.length}
                    </span>
                )}
            </div>

            {/* Thumbnails */}
            {allImages.length > 1 && (
                <div className="grid grid-cols-5 gap-2">
                    {allImages.map((img, i) => (
                        <button
                            key={i}
                            onClick={() => setActiveIndex(i)}
                            className={`aspect-square bg-muted rounded overflow-hidden border-2 transition-colors ${
                                i === activeIndex ? 'border-primary' : 'border-transparent hover:border-primary/30'
                            }`}
                        >
                            <img src={img} alt="" className="w-full h-full object-cover" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
