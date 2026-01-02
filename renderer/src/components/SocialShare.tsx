"use client";

import { usePathname } from "next/navigation";
import { Twitter, Linkedin, Facebook, Mail, Link as LinkIcon, Check } from "lucide-react";
import { useState } from "react";

export function SocialShare({ title }: { title: string }) {
    const pathname = usePathname();
    const [copied, setCopied] = useState(false);

    // Safety check for SSR
    if (typeof window === 'undefined') return null;

    const url = window.location.origin + pathname;
    const text = encodeURIComponent(title);
    const link = encodeURIComponent(url);

    const copyLink = () => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex items-center gap-2 my-8 pt-8 border-t border-border">
            <span className="text-sm font-medium text-muted-foreground mr-2">Share:</span>

            <a
                href={`https://twitter.com/intent/tweet?text=${text}&url=${link}`}
                target="_blank" rel="noreferrer"
                className="p-2 rounded-full bg-muted hover:bg-black hover:text-white transition-colors"
                title="Share on X"
            >
                <Twitter className="w-4 h-4" />
            </a>

            <a
                href={`https://www.linkedin.com/shareArticle?mini=true&url=${link}&title=${text}`}
                target="_blank" rel="noreferrer"
                className="p-2 rounded-full bg-muted hover:bg-[#0077b5] hover:text-white transition-colors"
                title="Share on LinkedIn"
            >
                <Linkedin className="w-4 h-4" />
            </a>

            <a
                href={`https://www.facebook.com/sharer/sharer.php?u=${link}`}
                target="_blank" rel="noreferrer"
                className="p-2 rounded-full bg-muted hover:bg-[#1877f2] hover:text-white transition-colors"
                title="Share on Facebook"
            >
                <Facebook className="w-4 h-4" />
            </a>

            <a
                href={`mailto:?subject=${text}&body=Check this out: ${link}`}
                className="p-2 rounded-full bg-muted hover:bg-gray-600 hover:text-white transition-colors"
                title="Share via Email"
            >
                <Mail className="w-4 h-4" />
            </a>

            <button
                onClick={copyLink}
                className="p-2 rounded-full bg-muted hover:bg-primary hover:text-primary-foreground transition-colors ml-auto"
                title="Copy Link"
            >
                {copied ? <Check className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
            </button>
        </div>
    );
}
