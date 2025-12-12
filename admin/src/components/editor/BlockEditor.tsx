import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { getExtensions } from "@amodx/plugins/admin";
import { Toolbar } from "./Toolbar";
import type { AnyExtension } from "@tiptap/core";
import { apiRequest } from "@/lib/api";

interface BlockEditorProps {
    initialContent?: any;
    onChange: (json: any) => void;
}

export function BlockEditor({ initialContent, onChange }: BlockEditorProps) {

    // THE UPLOAD FUNCTION
    const uploadFile = async (file: File): Promise<string> => {
        try {
            const res = await apiRequest('/assets', {
                method: 'POST',
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type,
                    size: file.size
                })
            });

            await fetch(res.uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type }
            });

            return res.publicUrl;
        } catch (e) {
            console.error("Upload Error", e);
            throw e;
        }
    };

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
        <div className="border rounded-md bg-card shadow-sm overflow-hidden flex flex-col min-h-[500px]">
            <Toolbar editor={editor} />
            <div className="flex-1 overflow-y-auto">
                <EditorContent editor={editor} />
            </div>
        </div>
    );
}
