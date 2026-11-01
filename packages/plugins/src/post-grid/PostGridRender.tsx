"use client";

import React, { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import type { BlockStrings } from "@amodx/shared";

/**
 * Why the browser fetch of the posts failed (LOCALE-1C). An HTTP error answer shows the `postsLoadFailed` text with its
 * status, exactly as resolved (a stored "" renders an empty error box, § 5.2 pattern D); a thrown error shows its own
 * message, as before. The error box is chosen by the failure, never by testing a translated text.
 */
type PostsLoadFailure = { kind: "status"; status: number } | { kind: "thrown"; message: string };

function failureText(failure: PostsLoadFailure, template: string): string {
    switch (failure.kind) {
        // The only placeholder of `postsLoadFailed`; every occurrence is filled, as `fillTemplate` of @amodx/shared does.
        case "status": return template.split("{status}").join(String(failure.status));
        case "thrown": return failure.message;
    }
}

/**
 * LOCALE-1C: the fixed texts come from `strings` (the tenant's locale table; RenderBlocks always gives it).
 * Post dates use `strings.dateLocale` — present only for a tenant that is not en-US, so an en-US tenant keeps the runtime
 * default (§ 3.4, § 16.2 item 4).
 */
export function PostGridRender({ attrs, tenantId, strings }: { attrs: any, tenantId?: string, strings: BlockStrings }) {
    const { headline, filterTag, limit, showImages, columns, layout, prefetchedPosts, serverDomain } = attrs;

    // Initialize state with PRE-FETCHED data if available
    const [posts, setPosts] = useState<any[]>(prefetchedPosts || []);
    const [loading, setLoading] = useState(!prefetchedPosts); // Only load if no data
    const [failure, setFailure] = useState<PostsLoadFailure | null>(null);
    const [host, setHost] = useState(serverDomain || ""); // Use server domain if available

    useEffect(() => {
        if (typeof window !== 'undefined' && !host) {
            setHost(window.location.host);
        }
    }, []);

    useEffect(() => {
        // Only fetch if we don't have data, or if props change (editor usage)
        if (!prefetchedPosts && tenantId) {
            fetchPosts();
        }
    }, [tenantId, filterTag, limit]);

    async function fetchPosts() {
        setLoading(true);
        try {
            const tagParam = filterTag ? filterTag.trim() : "";
            const limitParam = (!limit && limit !== 0) ? "6" : limit.toString();
            const query = new URLSearchParams({ tag: tagParam, limit: limitParam });

            const res = await fetch(`/api/posts?${query.toString()}`, {
                headers: { 'x-tenant-id': tenantId || '' }
            });

            if (res.ok) {
                const data = await res.json();
                setPosts(data.items || []);
            } else {
                setFailure({ kind: "status", status: res.status });
            }
        } catch (e: any) {
            // As before: a thrown error with an empty message shows no error box (and clears an earlier one).
            setFailure(e.message ? { kind: "thrown", message: String(e.message) } : null);
        } finally {
            setLoading(false);
        }
    }

    // SSR HANDLING:
    // If we have posts (prefetched), render them immediately.
    // If we are loading and have no posts, show spinner.
    if (loading && posts.length === 0) {
        return (
            <div className="py-12 flex justify-center opacity-50">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (failure) {
        return (
            <div className="py-8 text-center text-red-500 bg-red-50 rounded-lg mx-4">
                <p className="text-sm">{failureText(failure, strings.postsLoadFailed)}</p>
            </div>
        );
    }

    if (posts.length === 0) {
        return (
            <div className="py-12 text-center border-2 border-dashed border-muted rounded-xl mx-4">
                <p className="text-muted-foreground text-sm">{strings.postsEmpty}</p>
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
                                    <img
                                        src={post.featuredImage}
                                        alt={post.title}
                                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                    />
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
                                    {new Date(post.createdAt).toLocaleDateString(strings.dateLocale)}
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
                                    <img src={post.featuredImage} alt={post.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                                </div>
                            )}
                            <div className="flex-1">
                                <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors leading-tight">
                                    {post.title}
                                </h3>
                                {post.seoDescription && <p className="text-muted-foreground text-sm line-clamp-3">{post.seoDescription}</p>}
                            </div>
                            <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>{new Date(post.createdAt).toLocaleDateString(strings.dateLocale)}</span>
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
