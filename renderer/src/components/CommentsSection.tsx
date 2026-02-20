"use client";

import { useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { MessageSquare, Send, Lock } from "lucide-react";

interface Comment {
    id: string;
    authorName: string;
    authorImage?: string;
    content: string;
    createdAt: string;
}

export function CommentsSection({ pageId, mode, contentMaxWidth = "max-w-4xl" }: { pageId: string, mode?: "Enabled" | "Locked" | "Hidden", contentMaxWidth?: string }) {
    const { data: session } = useSession();
    const [comments, setComments] = useState<Comment[]>([]);
    const [newComment, setNewComment] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // SAFETY: Default to Hidden if mode is missing/undefined
    const safeMode = mode || "Hidden";

    // Fetch Comments
    useEffect(() => {
        if (safeMode === "Hidden") return;

        // Use Global Tenant ID
        // @ts-ignore
        const tenantId = typeof window !== 'undefined' ? window.AMODX_TENANT_ID : "";

        fetch(`/api/comments?pageId=${pageId}`, {
            headers: { 'x-tenant-id': tenantId }
        })
            .then(async (res) => {
                if (!res.ok) {
                    console.error("Failed to load comments", res.status);
                    return { items: [] };
                }
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") !== -1) {
                    return res.json();
                }
                return { items: [] };
            })
            .then(data => setComments(data.items || []))
            .catch(err => console.error("Comment fetch error:", err));
    }, [pageId, safeMode]);

    const handleSubmit = async (e: any) => {
        e.preventDefault();
        if (!newComment.trim()) return;
        setSubmitting(true);

        // @ts-ignore
        const tenantId = window.AMODX_TENANT_ID;

        try {
            await fetch('/api/comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
                body: JSON.stringify({
                    pageId,
                    content: newComment,
                })
            });
            setNewComment("");
            // Optimistic update or refetch could go here
        } catch (e) {
            alert("Failed to post");
        } finally {
            setSubmitting(false);
        }
    };

    if (safeMode === "Hidden") return null;

    return (
        <section className={`${contentMaxWidth} mx-auto py-12 px-6 border-t border-border mt-12`}>
            <h3 className="text-2xl font-bold mb-8 flex items-center gap-2">
                <MessageSquare className="w-6 h-6" />
                Discussion ({comments.length})
            </h3>

            {/* LIST */}
            <div className="space-y-6 mb-10">
                {comments.map(comment => (
                    <div key={comment.id} className="flex gap-4">
                        <img
                            src={comment.authorImage || "https://ui-avatars.com/api/?name=" + comment.authorName}
                            alt={comment.authorName}
                            className="w-10 h-10 rounded-full"
                        />
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm">{comment.authorName}</span>
                                <span className="text-xs text-muted-foreground">{new Date(comment.createdAt).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm leading-relaxed">{comment.content}</p>
                        </div>
                    </div>
                ))}
                {comments.length === 0 && <p className="text-muted-foreground italic">No comments yet. Be the first!</p>}
            </div>

            {/* FORM */}
            {safeMode === "Locked" ? (
                <div className="p-4 bg-muted/50 rounded-lg text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                    <Lock className="w-4 h-4" /> Comments are closed for this post.
                </div>
            ) : (
                <>
                    {session ? (
                        <form onSubmit={handleSubmit} className="flex gap-4">
                            <img
                                src={session.user?.image || ""}
                                className="w-10 h-10 rounded-full"
                            />
                            <div className="flex-1">
                                <textarea
                                    value={newComment}
                                    onChange={e => setNewComment(e.target.value)}
                                    placeholder="Write a comment..."
                                    className="w-full p-3 rounded-lg border border-input bg-background min-h-[100px] focus:ring-2 focus:ring-primary outline-none"
                                />
                                <div className="mt-2 flex justify-end">
                                    <button
                                        disabled={submitting}
                                        className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 flex items-center gap-2"
                                    >
                                        <Send className="w-4 h-4" /> Post
                                    </button>
                                </div>
                            </div>
                        </form>
                    ) : (
                        <div className="p-8 bg-muted/20 rounded-xl text-center border border-dashed border-border">
                            <h4 className="font-medium mb-2">Join the conversation</h4>
                            <button
                                onClick={() => signIn("google")}
                                className="bg-white text-gray-800 border border-gray-300 px-4 py-2 rounded-md font-medium text-sm hover:bg-gray-50 transition-colors shadow-sm inline-flex items-center gap-2"
                            >
                                <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                                Sign in with Google
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
