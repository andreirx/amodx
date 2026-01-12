"use client";

import React, { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";

export function PostGridRender({ attrs, tenantId }: { attrs: any, tenantId?: string }) {
    const { headline, filterTag, limit, showImages, columns, layout } = attrs;
    const [posts, setPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [host, setHost] = useState("");
    const [isMounted, setIsMounted] = useState(false);

    // 1. SAFEGUARD: Wait for Client Mount
    useEffect(() => {
        setIsMounted(true);
        if (typeof window !== 'undefined') setHost(window.location.host);
    }, []);

    // 2. FETCH: Only run if mounted and tenantId exists
    useEffect(() => {
        if (!isMounted || !tenantId) return;
        fetchPosts();
    }, [isMounted, tenantId, filterTag, limit]);

    async function fetchPosts() {
        try {
            const tagParam = filterTag ? filterTag.trim() : "";
            // Logic: If limit is 0/null/undefined, send 0 (backend treats 0 as Infinity)
            const limitParam = (!limit && limit !== 0) ? "6" : limit.toString();

            const query = new URLSearchParams({ tag: tagParam, limit: limitParam });
            const res = await fetch(`/api/posts?${query.toString()}`, {
                headers: { 'x-tenant-id': tenantId || '' }
            });

            if (res.ok) {
                const data = await res.json();
                setPosts(data.items || []);
            } else {
                setError(`API ${res.status}`);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    // 3. SERVER RENDER: Render NOTHING (or skeleton) to match initial client HTML
    if (!isMounted) return null;

    // 4. CLIENT RENDER
    if (loading) {
        return (
            <div className="py-12 flex justify-center opacity-50">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (posts.length === 0) {
        return (
            <div className="py-12 text-center border border-dashed rounded-xl mx-auto max-w-2xl bg-muted/20">
                <p className="text-muted-foreground text-sm">No posts found.</p>
                {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
            </div>
        );
    }

    return (
        <section className="py-16 px-6 max-w-7xl mx-auto">
            {headline && <h2 className="text-3xl font-bold mb-10 tracking-tight">{headline}</h2>}

            {layout === 'list' ? (
                // GOOGLE LIST STYLE
                <div className="max-w-3xl mx-auto space-y-8">
                    {posts.map((post: any) => (
                        <a key={post.id} href={post.slug} className="group flex gap-6 items-start">
                            {showImages && post.featuredImage && (
                                <div className="w-32 h-24 shrink-0 rounded-lg overflow-hidden border border-border bg-muted">
                                    <img src={post.featuredImage} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                    <span className="truncate">{host}{post.slug}</span>
                                </div>
                                <h3 className="text-lg font-semibold text-blue-600 group-hover:underline decoration-blue-600 mb-1 leading-snug">
                                    {post.title}
                                </h3>
                                {post.seoDescription && (
                                    <p className="text-sm text-foreground/80 line-clamp-2 leading-relaxed">
                                        {post.seoDescription}
                                    </p>
                                )}
                                <div className="mt-1 text-xs text-muted-foreground">
                                    {new Date(post.createdAt).toLocaleDateString()}
                                </div>
                            </div>
                        </a>
                    ))}
                </div>
            ) : (
                // GRID CARD STYLE
                <div className={`grid gap-8 ${columns === '2' ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                    {posts.map((post: any) => (
                        <a key={post.id} href={post.slug} className="group block h-full flex flex-col">
                            {showImages && post.featuredImage && (
                                <div className="aspect-video rounded-xl overflow-hidden bg-muted mb-4 border border-border">
                                    <img src={post.featuredImage} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                </div>
                            )}
                            <div className="flex-1">
                                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors leading-tight">
                                    {post.title}
                                </h3>
                                {post.seoDescription && <p className="text-muted-foreground text-sm line-clamp-3">{post.seoDescription}</p>}
                            </div>
                            <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                                {post.tags && post.tags.slice(0, 2).map((t: string) => (
                                    <span key={t} className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full uppercase tracking-wider text-[10px] font-medium">{t}</span>
                                ))}
                            </div>
                        </a>
                    ))}
                </div>
            )}
        </section>
    );
}
