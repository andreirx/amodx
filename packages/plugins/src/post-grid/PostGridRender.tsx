"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export function PostGridRender({ attrs, tenantId }: { attrs: any, tenantId?: string }) {
    const { headline, filterTag, limit, showImages, columns } = attrs;
    const [posts, setPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (tenantId) fetchPosts();
    }, [tenantId, filterTag, limit]);

    async function fetchPosts() {
        try {
            // We call the Renderer's internal API route.
            // This proxies the request to the database securely.
            const query = new URLSearchParams({
                tag: filterTag || "",
                limit: limit?.toString() || "6"
            });

            const res = await fetch(`/api/posts?${query.toString()}`, {
                headers: {
                    'x-tenant-id': tenantId || ''
                }
            });

            if (res.ok) {
                const data = await res.json();
                setPosts(data.items || []);
            }
        } catch (e) {
            console.error("Failed to load posts", e);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="py-12 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (posts.length === 0) return null;

    return (
        <section className="py-16 px-6 max-w-7xl mx-auto">
            {headline && <h2 className="text-3xl font-bold mb-10 tracking-tight">{headline}</h2>}

            <div className={`grid gap-8 ${columns === '2' ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                {posts.map((post: any) => (
                    <a key={post.id} href={post.slug} className="group block h-full flex flex-col">
                        {showImages && post.featuredImage && (
                            <div className="aspect-video rounded-xl overflow-hidden bg-muted mb-4 border border-border">
                                <img
                                    src={post.featuredImage}
                                    alt={post.title}
                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                />
                            </div>
                        )}
                        <div className="flex-1">
                            <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors leading-tight">
                                {post.title}
                            </h3>
                            {post.seoDescription && (
                                <p className="text-muted-foreground text-sm line-clamp-3 leading-relaxed">
                                    {post.seoDescription}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                            {post.tags && post.tags.slice(0, 2).map((t: string) => (
                                <span key={t} className="bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full uppercase tracking-wider text-[10px] font-medium">
                                    {t}
                                </span>
                            ))}
                        </div>
                    </a>
                ))}
            </div>
        </section>
    );
}
