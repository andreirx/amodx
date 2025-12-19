import React from "react";

export function VideoRender({ attrs }: { attrs: any }) {
    if (!attrs.url) return null;

    const { url, width, caption, autoplay } = attrs;

    // Simple Embed Logic (YouTube/Vimeo)
    // A robust impl would use regex to extract ID.
    // For MVP, we assume user pastes embed URL or we use a basic iframe if detected.

    // Basic YouTube ID extraction
    let embedUrl = url;
    const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
    if (ytMatch) {
        embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=${autoplay ? 1 : 0}`;
    }

    let containerClass = "my-8 rounded-xl overflow-hidden shadow-lg aspect-video bg-black ";
    if (width === 'centered') containerClass += "max-w-4xl mx-auto";
    if (width === 'wide') containerClass += "max-w-6xl mx-auto";
    if (width === 'full') containerClass += "w-full";

    return (
        <figure className={width === 'full' ? "w-full" : "px-4"}>
            <div className={containerClass}>
                <iframe
                    src={embedUrl}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                />
            </div>
            {caption && <figcaption className="text-center text-sm text-muted-foreground mt-2">{caption}</figcaption>}
        </figure>
    );
}
