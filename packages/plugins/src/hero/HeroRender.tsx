import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function HeroRender({ attrs }: { attrs: any }) {
    const {
        headline = "Welcome to AMODX",
        subheadline = "The operating system for modern agencies.",
        ctaText = "Get Started",
        ctaLink = "#",
        style = "center"
    } = attrs || {};

    if (style === "minimal") {
        return (
            <section className="py-24 max-w-4xl mx-auto">
                <h1 className="text-6xl font-black tracking-tighter text-foreground mb-6">
                    {headline}
                </h1>
                {subheadline && (
                    <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl">
                        {subheadline}
                    </p>
                )}
            </section>
        );
    }

    if (style === "split") {
        return (
            <section className="py-20 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div>
                    <h1 className="text-5xl font-bold tracking-tight text-foreground mb-6">
                        {headline}
                    </h1>
                    {subheadline && (
                        <p className="text-lg text-muted-foreground mb-8">
                            {subheadline}
                        </p>
                    )}
                    {ctaText && (
                        <a href={ctaLink} className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-10 px-8 hover:opacity-90">
                            {ctaText}
                        </a>
                    )}
                </div>
                <div className="bg-muted aspect-video rounded-xl flex items-center justify-center border-2 border-dashed">
                    <span className="text-muted-foreground">Image Placeholder</span>
                </div>
            </section>
        );
    }

    // Center
    return (
        <section className="py-24 text-center max-w-5xl mx-auto">
            <h1 className="text-5xl md:text-7xl font-black tracking-tight text-foreground mb-6">
                {headline}
            </h1>
            {subheadline && (
                <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
                    {subheadline}
                </p>
            )}
            {ctaText && (
                <a href={ctaLink} className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground h-11 px-8 hover:opacity-90">
                    {ctaText}
                </a>
            )}
        </section>
    );
}
