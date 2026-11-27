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

/** The pick a block asked for (GALLERY-1, ruling 5): one asset (`pickFn`: image, hero) or several in one step
 *  (`pickManyFn`: gallery). Each mode carries the callback of its own result type. */
type PickRequest =
    | { mode: "one"; onPick: (url: string) => void }
    | { mode: "many"; onPick: (urls: string[]) => void };

export function BlockEditor({ initialContent, onChange }: BlockEditorProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerMediaType, setPickerMediaType] = useState<"image" | "video" | "all">("all");
    const [pickRequest, setPickRequest] = useState<PickRequest | null>(null);

    // Parameterized picker: plugins call openPicker(callback, { mediaType: "video" })
    const openPicker = (callback: (url: string) => void, opts?: { mediaType?: "image" | "video" | "all" }) => {
        setPickerMediaType(opts?.mediaType || "all");
        setPickRequest({ mode: "one", onPick: callback });
        setPickerOpen(true);
    };
    // GALLERY-1: the same picker in its multi-select mode; the callback receives the picked addresses in picked order.
    const openManyPicker = (callback: (urls: string[]) => void, opts?: { mediaType?: "image" | "video" | "all" }) => {
        setPickerMediaType(opts?.mediaType || "all");
        setPickRequest({ mode: "many", onPick: callback });
        setPickerOpen(true);
    };

    const handleSelect = (url: string) => {
        if (pickRequest?.mode === "one") pickRequest.onPick(url);
        setPickerOpen(false);
        setPickRequest(null);
    };
    const handleSelectMany = (urls: string[]) => {
        if (pickRequest?.mode === "many") pickRequest.onPick(urls);
        setPickerOpen(false);
        setPickRequest(null);
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

            // Photo gallery (GALLERY-1): several images in one pick
            if (storage.gallery) {
                storage.gallery.pickManyFn = openManyPicker;
            }

            // NEW: PostGrid Handlers
            if (storage.postGrid) {
                storage.postGrid.fetchTagsFn = handleFetchTags;
            }

            // Category Showcase and Category Grid (SHOP-LOOK-1C) Handlers: the tenant's category list
            const fetchCategories = async () => {
                try {
                    const res = await apiRequest("/categories");
                    return res.items || [];
                } catch (e) {
                    console.error("Failed to fetch categories for editor", e);
                    return [];
                }
            };
            if (storage.categoryShowcase) {
                storage.categoryShowcase.fetchCategoriesFn = fetchCategories;
            }
            if (storage.categoryGrid) {
                storage.categoryGrid.fetchCategoriesFn = fetchCategories;
            }

            // Custom Form (SHOP-LOOK-1E) Handler: the tenant's forms, the list the Forms page shows (`GET /forms`)
            if (storage.form) {
                storage.form.fetchFormsFn = async () => {
                    try {
                        const res = await apiRequest("/forms");
                        return res.items || [];
                    } catch (e) {
                        console.error("Failed to fetch forms for editor", e);
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
            {pickRequest?.mode === "many" ? (
                <MediaPicker
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    onSelectMany={handleSelectMany}
                    mediaType={pickerMediaType}
                />
            ) : (
                <MediaPicker
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    onSelect={handleSelect}
                    mediaType={pickerMediaType}
                />
            )}
        </div>
    );
}
