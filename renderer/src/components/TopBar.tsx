import { Phone, Mail } from "lucide-react";
import { sanitizeInlineHtml } from "@/lib/sanitize";

interface TopBarProps {
    content?: string;
    quickContactPhone?: string;
    quickContactEmail?: string;
    contentMaxWidth?: string;
}

export function TopBar({ content, quickContactPhone, quickContactEmail, contentMaxWidth = "max-w-7xl" }: TopBarProps) {
    return (
        <div className="bg-primary text-primary-foreground text-xs py-2 px-4">
            <div className={`${contentMaxWidth} mx-auto flex items-center justify-between`}>
                {content ? (
                    <span dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(content) }} />
                ) : (
                    <span />
                )}
                <div className="flex items-center gap-4">
                    {quickContactPhone && (
                        <a href={`tel:${quickContactPhone}`} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
                            <Phone className="h-3 w-3" />
                            <span>{quickContactPhone}</span>
                        </a>
                    )}
                    {quickContactEmail && (
                        <a href={`mailto:${quickContactEmail}`} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
                            <Mail className="h-3 w-3" />
                            <span>{quickContactEmail}</span>
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
