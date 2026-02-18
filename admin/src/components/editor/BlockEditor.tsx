import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { getExtensions } from "@amodx/plugins/admin";
import { Toolbar } from "./Toolbar";
import type { AnyExtension } from "@tiptap/core";
import { uploadFile } from "@/lib/upload";
import { useState } from "react";
import { MediaPicker } from "@/components/MediaPicker";
import { apiRequest } from "@/lib/api"; // <--- Now valid here

interface BlockEditorProps {
    initialContent?: any;
    onChange: (json: any) => void;
}

export function BlockEditor({ initialContent, onChange }: BlockEditorProps) {
    const [pickerOpen, setPickerOpen] = useState(false);

    // Parentheses around the function type allow 'null' as a state value
    const [pickerCallback, setPickerCallback] = useState<((url: string) => void) | null>(null);

    const openPicker = (callback: (url: string) => void) => {
        // We pass a function that RETURNS the callback, so React doesn't execute the callback immediately as an updater
        setPickerCallback(() => callback);
        setPickerOpen(true);
    };

    const handleSelect = (url: string) => {
        if (pickerCallback) pickerCallback(url);
        setPickerOpen(false);
        setPickerCallback(null);
    };

    // DEFINE THE TAG FETCHER
    const handleFetchTags = async (callback: (tags: string[]) => void) => {
        try {
            const res = await apiRequest("/content");
            const allTags = new Set<string>();
            (res.items || []).forEach((item: any) => {
                if (Array.isArray(item.tags)) {
                    item.tags.forEach((t: string) => allTags.add(t));
                }
            });
            callback(Array.from(allTags).sort());
        } catch (e) {
            console.error("Failed to fetch tags for editor", e);
            callback([]);
        }
    };

    const editor = useEditor({
        extensions: [
            StarterKit.configure({ codeBlock: false }),
            Placeholder.configure({ placeholder: "Write something amazing..." }),
            Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https' }),
            ...(getExtensions() as AnyExtension[]),
        ],
        content: initialContent && initialContent.length > 0
            ? { type: "doc", content: initialContent }
            : undefined,
        editorProps: {
            attributes: {
                class: "prose prose-zinc dark:prose-invert max-w-none focus:outline-none min-h-[300px] p-4",
            },
        },
        onBeforeCreate({ editor }) {
            const storage = editor.storage as any;

            // Image Handlers
            if (storage.image) {
                storage.image.uploadFn = uploadFile;
                storage.image.pickFn = openPicker;
            }
            // Hero Handlers (reuses image logic)
            if (storage.hero) {
                storage.hero.uploadFn = uploadFile;
                storage.hero.pickFn = openPicker;
            }

            // NEW: PostGrid Handlers
            if (storage.postGrid) {
                storage.postGrid.fetchTagsFn = handleFetchTags;
            }

            // Category Showcase Handlers
            if (storage.categoryShowcase) {
                storage.categoryShowcase.fetchCategoriesFn = async () => {
                    try {
                        const res = await apiRequest("/categories");
                        return res.items || [];
                    } catch (e) {
                        console.error("Failed to fetch categories for editor", e);
                        return [];
                    }
                };
            }
        },
        onUpdate: ({ editor }) => {
            onChange(editor.getJSON().content || []);
        },
    });

    return (
        <div className="group flex flex-col relative min-h-[500px]">
            {/* Sticky Toolbar */}
            <div className="sticky top-0 z-10 mx-auto w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b mb-4 py-2 transition-all">
                <Toolbar editor={editor} />
            </div>

            <div className="flex-1 cursor-text">
                <EditorContent editor={editor} />
            </div>

            {/* Media Picker Dialog */}
            <MediaPicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onSelect={handleSelect}
            />
        </div>
    );
}
