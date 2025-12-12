import React from "react";

export function ImageRender({ attrs }: { attrs: any }) {
    if (!attrs.src) return null;

    const { src, alt, caption, width } = attrs;

    // Layout Classes
    const containerClass = width === 'full' ? 'w-full' : 'max-w-4xl mx-auto';

    return (
        <figure className={`my-8 ${containerClass}`}>
            <img
                src={src}
                alt={alt || "Image"}
                className="w-full h-auto rounded-lg shadow-sm"
                loading="lazy"
            />
            {caption && (
                <figcaption className="text-center text-sm text-muted-foreground mt-2 italic">
                    {caption}
                </figcaption>
            )}
        </figure>
    );
}
