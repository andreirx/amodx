"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCoverflow, Pagination, Navigation } from 'swiper/modules';

// Import Swiper styles
import 'swiper/css';
import 'swiper/css/effect-coverflow';
import 'swiper/css/pagination';
import 'swiper/css/navigation';

export function CarouselRender({ attrs }: { attrs: any }) {
    const { headline, items, style } = attrs;
    const safeItems = items || [];

    // Global styles for Swiper to override default theme
    // We inject this style tag locally to control the bullets and width
    const swiperStyles = `
        .swiper {
            width: 100%;
            padding-top: 50px;
            padding-bottom: 50px;
        }
        .swiper-slide {
            background-position: center;
            background-size: cover;
            width: 300px; /* Mobile Width */
        }
        @media (min-width: 768px) {
            .swiper-slide {
                width: 600px; /* Desktop Width */
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
        <section className="py-20 bg-muted/10 border-y border-border/50 overflow-hidden">
            <style>{swiperStyles}</style>

            {headline && (
                <div className="max-w-7xl mx-auto px-6 mb-8 text-center">
                    <h2 className="text-3xl font-bold tracking-tight">{headline}</h2>
                </div>
            )}

            {style === 'coverflow' ? (
                <Swiper
                    effect={'coverflow'}
                    grabCursor={true}
                    centeredSlides={true}
                    slidesPerView={'auto'}
                    initialSlide={1} // Start on the second item if exists
                    coverflowEffect={{
                        rotate: 40,      // Angle
                        stretch: 0,      // Spacing
                        depth: 100,      // 3D Depth
                        modifier: 1,     // Effect multiplier
                        slideShadows: false, // CSS shadows are cleaner than canvas shadows
                    }}
                    pagination={{ clickable: true }}
                    modules={[EffectCoverflow, Pagination]}
                    className="mySwiper"
                >
                    {safeItems.map((item: any) => (
                        <SwiperSlide key={item.id}>
                            <CardItem item={item} />
                        </SwiperSlide>
                    ))}
                </Swiper>
            ) : (
                // STANDARD GRID (Fallback to simple Swiper row)
                <div className="max-w-7xl mx-auto px-6">
                    <Swiper
                        spaceBetween={30}
                        slidesPerView={1}
                        breakpoints={{
                            640: { slidesPerView: 2 },
                            1024: { slidesPerView: 3 },
                        }}
                        pagination={{ clickable: true }}
                        modules={[Pagination]}
                    >
                        {safeItems.map((item: any) => (
                            <SwiperSlide key={item.id}>
                                <CardItem item={item} />
                            </SwiperSlide>
                        ))}
                    </Swiper>
                </div>
            )}
        </section>
    );
}

function CardItem({ item }: { item: any }) {
    return (
        <a href={item.link} className="block group h-full bg-card border border-border rounded-xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300">
            {/* Aspect Video */}
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
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    View
                </span>
                <span className="text-primary group-hover:translate-x-1 transition-transform">
                    <ArrowRight className="w-4 h-4" />
                </span>
            </div>
        </a>
    );
}
