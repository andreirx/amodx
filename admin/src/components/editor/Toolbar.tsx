import { type Editor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
    Bold,
    Italic,
    List,
    ListOrdered,
    Heading1,
    Heading2,
    Quote,
    Undo,
    Redo
} from "lucide-react";
import { Link as LinkIcon, Unlink } from "lucide-react"; // Rename import to avoid collision
import { cn } from "@/lib/utils";

interface ToolbarProps {
    editor: Editor | null;
}

export function Toolbar({ editor }: ToolbarProps) {
    if (!editor) return null;

    return (
        <div className="border-b bg-transparent p-2 flex flex-wrap gap-1 sticky top-0 z-10">

            {/* Headings */}
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

            {/* Formatting */}
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

            {/* Lists */}
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

            {/* Links */}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                    const previousUrl = editor.getAttributes('link').href;
                    const url = window.prompt('URL', previousUrl);

                    // cancelled
                    if (url === null) return;

                    // empty
                    if (url === '') {
                        editor.chain().focus().extendMarkRange('link').unsetLink().run();
                        return;
                    }

                    // update
                    editor.chain().focus().extendMarkRange('link').setLink({href: url}).run();
                }}
                className={cn(editor.isActive("link") && "bg-muted text-blue-500")}
            >
                <LinkIcon className="h-4 w-4"/>
            </Button>

            <div className="w-px h-6 bg-border mx-1 self-center"/>

            {/* History */}
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
        </div>
    );
}
