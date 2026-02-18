"use client";

import React, { useRef, useState, useEffect } from "react";

const INITIAL_COLORS = [
    "#e74c3c", "#3498db", "#2ecc71", "#9b59b6", "#f39c12",
    "#1abc9c", "#e67e22", "#c0392b", "#2980b9", "#27ae60",
];

function getInitialColor(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return INITIAL_COLORS[Math.abs(hash) % INITIAL_COLORS.length];
}

function StarDisplay({ rating }: { rating: number }) {
    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(i => (
                <svg key={i} className={`w-4 h-4 ${i <= rating ? 'text-amber-400' : 'text-gray-200'}`} fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
            ))}
        </div>
    );
}

const GoogleBadge = () => (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
);

const FacebookBadge = () => (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="#1877F2" xmlns="http://www.w3.org/2000/svg">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
);

function formatDate(dateStr: string) {
    if (!dateStr) return "";
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" });
    } catch {
        return dateStr;
    }
}

function ReviewCard({ item, showSource }: { item: any; showSource: boolean }) {
    const initial = item.name?.charAt(0)?.toUpperCase() || "?";
    const color = getInitialColor(item.name || "");

    return (
        <div className="min-w-[280px] max-w-[320px] shrink-0 snap-start bg-background rounded-xl border border-border p-5 space-y-3">
            {/* Header: Avatar + Name + Source */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                    {item.avatarUrl ? (
                        <img src={item.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ backgroundColor: color }}>
                            {initial}
                        </div>
                    )}
                    <div>
                        <p className="font-semibold text-sm leading-tight">{item.name}</p>
                        {item.date && <p className="text-xs text-muted-foreground">{formatDate(item.date)}</p>}
                    </div>
                </div>
                {showSource && item.source === "google" && <GoogleBadge />}
                {showSource && item.source === "facebook" && <FacebookBadge />}
            </div>

            {/* Stars + verified */}
            <div className="flex items-center gap-2">
                <StarDisplay rating={item.rating} />
                {item.source === "google" && (
                    <svg className="w-4 h-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                )}
            </div>

            {/* Review text */}
            {item.text && <p className="text-sm text-foreground leading-relaxed line-clamp-4">{item.text}</p>}
        </div>
    );
}

export function ReviewsCarouselRender({ attrs }: { attrs: any }) {
    const { headline, items = [], showSource, autoScroll } = attrs;
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(true);

    if (!items.length) return null;

    const checkScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        setCanScrollLeft(el.scrollLeft > 0);
        setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
    };

    useEffect(() => {
        checkScroll();
        const el = scrollRef.current;
        if (el) el.addEventListener('scroll', checkScroll, { passive: true });
        return () => el?.removeEventListener('scroll', checkScroll);
    }, []);

    useEffect(() => {
        if (!autoScroll || items.length <= 1) return;
        const interval = setInterval(() => {
            const el = scrollRef.current;
            if (!el) return;
            if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 10) {
                el.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                el.scrollBy({ left: 320, behavior: 'smooth' });
            }
        }, 4000);
        return () => clearInterval(interval);
    }, [autoScroll, items.length]);

    const scroll = (dir: number) => {
        scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
    };

    return (
        <section className="my-12">
            {headline && <h2 className="text-2xl md:text-3xl font-bold text-center mb-8">{headline}</h2>}

            <div className="relative">
                {/* Left arrow */}
                {canScrollLeft && (
                    <button onClick={() => scroll(-1)} className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-background border border-border shadow-md flex items-center justify-center hover:bg-muted transition-colors -ml-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                )}

                {/* Scrollable container */}
                <div ref={scrollRef} className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-1 py-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {items.map((item: any) => (
                        <ReviewCard key={item.id} item={item} showSource={showSource} />
                    ))}
                </div>

                {/* Right arrow */}
                {canScrollRight && (
                    <button onClick={() => scroll(1)} className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-background border border-border shadow-md flex items-center justify-center hover:bg-muted transition-colors -mr-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                )}
            </div>
        </section>
    );
}
