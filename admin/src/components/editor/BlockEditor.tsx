import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { getExtensions } from "@amodx/plugins/admin";
import { Toolbar } from "./Toolbar";
import type { AnyExtension } from "@tiptap/core";
import { uploadFile } from "@/lib/upload";

interface BlockEditorProps {
    initialContent?: any;
    onChange: (json: any) => void;
}

export function BlockEditor({ initialContent, onChange }: BlockEditorProps) {

    const editor = useEditor({
        extensions: [
            StarterKit,
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
        // FIX: Cast storage to any to allow injection
        onBeforeCreate({ editor }) {
            const storage = editor.storage as any;
            if (storage.image) {
                storage.image.uploadFn = uploadFile;
            }
        },
        onUpdate: ({ editor }) => {
            onChange(editor.getJSON().content || []);
        },
    });

    return (
        <div className="group flex flex-col relative min-h-[500px]">
            {/*
                Sticky Toolbar
                - 'sticky': Sticks to the nearest scrolling ancestor (the <main> div in ContentEditor).
                - 'top-0': Sticks to the top.
                - 'z-10': Stays above text.
            */}
            <div className="sticky top-0 z-10 mx-auto w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b mb-4 py-2 transition-all">
                <Toolbar editor={editor} />
            </div>

            <div className="flex-1 cursor-text">
                <EditorContent editor={editor} />
            </div>
        </div>
    );
}
