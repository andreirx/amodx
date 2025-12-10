import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { getExtensions } from "@amodx/plugins/admin";
import { Toolbar } from "./Toolbar";
import type {AnyExtension} from "@tiptap/core";

interface BlockEditorProps {
    initialContent?: any;
    onChange: (json: any) => void;
}

export function BlockEditor({ initialContent, onChange }: BlockEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit,
            Placeholder.configure({
                placeholder: "Write something amazing...",

            }),
            Link.configure({
                openOnClick: false, // Better for editing
                autolink: true,
                defaultProtocol: 'https',
            }),
            ...(getExtensions() as AnyExtension[]),
        ],
        // If we have blocks, wrap them in a 'doc' object for Tiptap
        content: initialContent && initialContent.length > 0
            ? { type: "doc", content: initialContent }
            : undefined,
        editorProps: {
            attributes: {
                // Tailwind classes for the editor canvas
                class: "prose prose-zinc dark:prose-invert max-w-none focus:outline-none min-h-[300px] p-4",
            },
        },
        onUpdate: ({ editor }) => {
            // Extract the JSON tree
            const json = editor.getJSON();
            // Pass the 'content' array back up (ignoring the root 'doc' wrapper)
            onChange(json.content || []);
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
