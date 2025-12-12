import React from "react";

export function ImageRender({ attrs }: { attrs: any }) {
    if (!attrs.src) return null;

    const { src, alt, caption, width } = attrs;

    let containerClass = "my-6 rounded-lg overflow-hidden ";

    // Tiptap/Plugin logic for alignment (if you add 'align' attr to schema later)
    // For now, map 'width' to layout behaviors
    if (width === 'centered') containerClass += "mx-auto max-w-md block";
    else if (width === 'wide') containerClass += "w-full max-w-4xl mx-auto block";
    else if (width === 'full') containerClass += "w-full block";

    // If you want actual text wrapping (float), you need an 'align' prop in schema.
    // Assuming you stick to block-level images for now as defined in schema.

    return (
        <figure className={containerClass}>
            <img
                src={src}
                alt={alt || "Image"}
                className="w-full h-auto object-cover"
                loading="lazy"
            />
            {caption && (
                <figcaption className="text-center text-xs text-muted-foreground mt-2 italic">
                    {caption}
                </figcaption>
            )}
        </figure>
    );
}
