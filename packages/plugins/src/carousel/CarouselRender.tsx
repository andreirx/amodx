"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCoverflow, Pagination, Navigation } from 'swiper/modules';

import 'swiper/css';
import 'swiper/css/effect-coverflow';
import 'swiper/css/pagination';
import 'swiper/css/navigation';

const ASPECT_CLASSES: Record<string, string> = {
    vertical: "aspect-[3/4]",
    horizontal: "aspect-video",
    square: "aspect-square",
};

export function CarouselRender({ attrs }: { attrs: any }) {
    const { headline, items, style, cardFormat = "vertical" } = attrs;
    const safeItems = items || [];

    // Swiper overrides for coverflow mode
    const swiperStyles = `
        .swiper {
            width: 100%;
            padding-top: 50px;
            padding-bottom: 50px;
        }
        .swiper-slide {
            background-position: center;
            background-size: cover;
            width: 300px;
        }
        @media (min-width: 768px) {
            .swiper-slide {
                width: 600px;
            }
        }
        .swiper-pagination-bullet {
            background: currentColor;
            opacity: 0.5;
        }
        .swiper-pagination-bullet-active {
            opacity: 1;
        }
    `;

    return (
        <section className="py-20 overflow-hidden">
            {headline && (
                <div className="max-w-7xl mx-auto px-6 mb-8">
                    <h2 className="text-3xl font-bold tracking-tight">{headline}</h2>
                </div>
            )}

            {style === 'coverflow' ? (
                <>
                    <style>{swiperStyles}</style>
                    <Swiper
                        effect={'coverflow'}
                        grabCursor={true}
                        centeredSlides={true}
                        slidesPerView={'auto'}
                        initialSlide={1}
                        coverflowEffect={{
                            rotate: 40,
                            stretch: 0,
                            depth: 100,
                            modifier: 1,
                            slideShadows: false,
                        }}
                        pagination={{ clickable: true }}
                        modules={[EffectCoverflow, Pagination]}
                    >
                        {safeItems.map((item: any) => (
                            <SwiperSlide key={item.id}>
                                <CoverflowCard item={item} />
                            </SwiperSlide>
                        ))}
                    </Swiper>
                </>
            ) : (
                <div className="max-w-7xl mx-auto px-6">
                    <Swiper
                        spaceBetween={24}
                        slidesPerView={1}
                        breakpoints={{
                            640: { slidesPerView: 2 },
                            1024: { slidesPerView: cardFormat === "horizontal" ? 3 : 4 },
                            1280: { slidesPerView: cardFormat === "horizontal" ? 3 : 5 },
                        }}
                        pagination={{ clickable: true }}
                        navigation={true}
                        modules={[Pagination, Navigation]}
                    >
                        {safeItems.map((item: any) => (
                            <SwiperSlide key={item.id}>
                                <StandardCard item={item} aspectClass={ASPECT_CLASSES[cardFormat] || ASPECT_CLASSES.vertical} />
                            </SwiperSlide>
                        ))}
                    </Swiper>
                </div>
            )}
        </section>
    );
}

/** Standard card — clean, no shadow, image zoom on hover, text below. */
function StandardCard({ item, aspectClass }: { item: any; aspectClass: string }) {
    const Wrapper = item.link && item.link !== "#" ? "a" : "div";
    const wrapperProps = item.link && item.link !== "#" ? { href: item.link } : {};

    return (
        <Wrapper {...wrapperProps} className="block group">
            {/* Image with hover zoom */}
            <div className={`${aspectClass} overflow-hidden rounded-lg bg-muted`}>
                {item.image ? (
                    <img
                        src={item.image}
                        alt={item.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        No image
                    </div>
                )}
            </div>
            {/* Text below image */}
            {(item.title || item.description) && (
                <div className="mt-3 space-y-0.5">
                    {item.title && <h3 className="text-sm font-semibold leading-tight">{item.title}</h3>}
                    {item.description && <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>}
                </div>
            )}
        </Wrapper>
    );
}

/** Coverflow card — existing cinematic style with overlay text and shadow. */
function CoverflowCard({ item }: { item: any }) {
    return (
        <a href={item.link} className="block group h-full bg-card border border-border rounded-xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300">
            <div className="aspect-video bg-muted overflow-hidden relative">
                {item.image ? (
                    <img src={item.image} alt={item.title} className="w-full h-full object-cover select-none" />
                ) : (
                    <div className="w-full h-full bg-secondary/30 flex items-center justify-center text-muted-foreground font-mono text-xs select-none">
                        NO IMAGE
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-90" />
                <div className="absolute bottom-0 left-0 right-0 p-6 text-white text-left">
                    <h3 className="text-2xl font-bold mb-2 leading-none">{item.title}</h3>
                    <p className="text-white/70 text-sm line-clamp-2 font-light">{item.description}</p>
                </div>
            </div>
            <div className="bg-card p-3 flex justify-between items-center border-t border-border/50">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">View</span>
                <span className="text-primary group-hover:translate-x-1 transition-transform">
                    <ArrowRight className="w-4 h-4" />
                </span>
            </div>
        </a>
    );
}
