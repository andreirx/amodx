import { type Editor } from "@tiptap/react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Bold, Italic, List, ListOrdered, Heading1, Heading2, Quote, Undo, Redo,
    Link as LinkIcon, Check, X, FileText, Globe
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPluginList } from "@amodx/plugins/admin";
import { useTenant } from "@/context/TenantContext";

interface ToolbarProps {
    editor: Editor | null;
}

export function Toolbar({ editor }: ToolbarProps) {
    const { currentTenant } = useTenant();
    if (!editor) return null;

    const commerceEnabled = (currentTenant as any)?.commerceEnabled ?? false;
    const plugins = getPluginList().filter(p => !p.commerce || commerceEnabled);

    const [isLinking, setIsLinking] = useState(false);
    const [linkUrl, setLinkUrl] = useState("");
    const [selectedText, setSelectedText] = useState("");
    const [suggestions, setSuggestions] = useState<{title: string, slug: string}[]>([]);
    const [filteredSuggestions, setFilteredSuggestions] = useState<{title: string, slug: string}[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    const startLinking = () => {
        const { from, to, empty } = editor.state.selection;
        if (empty) {
            setSelectedText("(No text selected - will insert link)");
        } else {
            setSelectedText(editor.state.doc.textBetween(from, to, ' '));
        }

        const previousUrl = editor.getAttributes('link').href;
        setLinkUrl(previousUrl || "");

        const dataList = document.getElementById('amodx-links') as HTMLDataListElement;
        if (dataList) {
            const opts = Array.from(dataList.options).map(opt => ({
                slug: opt.value,
                title: opt.label || opt.text
            }));
            setSuggestions(opts);
            setFilteredSuggestions(opts);
        }

        setIsLinking(true);
    };

    useEffect(() => {
        if (!isLinking) return;
        if (!linkUrl) {
            setFilteredSuggestions(suggestions);
            return;
        }
        const lower = linkUrl.toLowerCase();
        setFilteredSuggestions(suggestions.filter(s =>
            s.title.toLowerCase().includes(lower) ||
            s.slug.toLowerCase().includes(lower)
        ));
    }, [linkUrl, isLinking, suggestions]);

    // UPDATED: Logic to handle insertion vs formatting
    const applyLink = (url: string, label?: string) => {
        if (!url) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
        } else {
            const { empty } = editor.state.selection;

            if (empty) {
                // 1. INSERT MODE (No selection)
                // Use the provided Label (Page Title) or fallback to the URL itself
                const textToInsert = label || url;

                editor.chain().focus()
                    .insertContent({
                        type: 'text',
                        text: textToInsert,
                        marks: [{ type: 'link', attrs: { href: url } }]
                    })
                    .insertContent(" ") // Add a space after so user can keep typing
                    .run();
            } else {
                // 2. FORMAT MODE (Selection exists)
                // Just apply the link attribute to existing text
                editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }
        }
        setIsLinking(false);
        setLinkUrl("");
    };

    const cancelLink = () => {
        setIsLinking(false);
        setLinkUrl("");
        editor.chain().focus().run();
    };

    if (isLinking) {
        return (
            <div className="relative border-b bg-background p-2 w-full animate-in fade-in slide-in-from-top-1 z-50">
                <div className="flex items-center gap-2">
                    <LinkIcon className="h-4 w-4 text-muted-foreground ml-2 shrink-0" />

                    <div className="flex-1 relative">
                        <div className="text-[10px] text-muted-foreground absolute -top-3 left-0 truncate max-w-[200px]">
                            {selectedText.startsWith("(") ? <span>Inserting:</span> : <span>Linking: <span className="font-medium text-foreground">{selectedText}</span></span>}
                        </div>

                        <Input
                            ref={inputRef}
                            autoFocus
                            value={linkUrl}
                            onChange={e => setLinkUrl(e.target.value)}
                            placeholder="Paste URL or select page..."
                            className="h-8 text-sm w-full"
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    // Try to find exact match for title if user typed a slug manually
                                    const match = suggestions.find(s => s.slug === linkUrl);
                                    applyLink(linkUrl, match?.title);
                                }
                                if (e.key === "Escape") cancelLink();
                            }}
                        />
                    </div>

                    <Button size="sm" variant="ghost" onClick={() => applyLink(linkUrl)} className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50" title="Apply">
                        <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelLink} className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" title="Cancel">
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="absolute top-full left-0 w-full mt-1 bg-popover border shadow-md rounded-md max-h-48 overflow-y-auto py-1">
                    {filteredSuggestions.length > 0 ? (
                        filteredSuggestions.map(page => (
                            <button
                                key={page.slug}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 group"
                                onClick={() => applyLink(page.slug, page.title)} // <--- Pass Title Here
                            >
                                <FileText className="h-3 w-3 text-muted-foreground group-hover:text-primary" />
                                <span className="truncate flex-1">{page.title}</span>
                                <span className="text-xs text-muted-foreground font-mono opacity-50">{page.slug}</span>
                            </button>
                        ))
                    ) : (
                        <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                            <Globe className="h-3 w-3" />
                            <span>External URL: Press Enter to save</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="border-b bg-transparent p-2 flex flex-wrap gap-1 sticky top-0 z-10">
            {/* ... Rest of toolbar (Headings, Bold, Italic...) remains exactly the same ... */}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleHeading({level: 1}).run()}
                className={cn(editor.isActive("heading", {level: 1}) && "bg-muted")}
            >
                <Heading1 className="h-4 w-4"/>
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleHeading({level: 2}).run()}
                className={cn(editor.isActive("heading", {level: 2}) && "bg-muted")}
            >
                <Heading2 className="h-4 w-4"/>
            </Button>

            <div className="w-px h-6 bg-border mx-1 self-center"/>

            <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={cn(editor.isActive("bold") && "bg-muted")}
            >
                <Bold className="h-4 w-4"/>
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={cn(editor.isActive("italic") && "bg-muted")}
            >
                <Italic className="h-4 w-4"/>
            </Button>

            <div className="w-px h-6 bg-border mx-1 self-center"/>

            <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={cn(editor.isActive("bulletList") && "bg-muted")}
            >
                <List className="h-4 w-4"/>
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={cn(editor.isActive("orderedList") && "bg-muted")}
            >
                <ListOrdered className="h-4 w-4"/>
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                className={cn(editor.isActive("blockquote") && "bg-muted")}
            >
                <Quote className="h-4 w-4"/>
            </Button>

            <div className="w-px h-6 bg-border mx-1 self-center"/>

            <Button
                variant="ghost"
                size="sm"
                onClick={startLinking}
                className={cn(editor.isActive("link") && "bg-muted text-blue-500")}
            >
                <LinkIcon className="h-4 w-4"/>
            </Button>

            <div className="w-px h-6 bg-border mx-1 self-center"/>

            <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().undo().run()}
                disabled={!editor.can().undo()}
            >
                <Undo className="h-4 w-4"/>
            </Button>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => editor.chain().focus().redo().run()}
                disabled={!editor.can().redo()}
            >
                <Redo className="h-4 w-4"/>
            </Button>

            <div className="w-px h-6 bg-border mx-1 self-center"/>

            {plugins.map((plugin) => (
                <Button
                    key={plugin.key}
                    variant="ghost"
                    size="sm"
                    onClick={() => editor.chain().focus().insertContent({ type: plugin.key }).run()}
                    className="text-purple-500 hover:text-purple-600 hover:bg-purple-50"
                    title={`Insert ${plugin.label}`}
                >
                    <plugin.icon className="h-4 w-4" />
                </Button>
            ))}
        </div>
    );
}
