import React from "react";

export function HtmlRender({ attrs }: { attrs: any }) {
    const { content } = attrs;

    if (!content) return null;

    return (
        <div
            className="my-8 raw-html-embed"
            dangerouslySetInnerHTML={{ __html: content }}
        />
    );
}
