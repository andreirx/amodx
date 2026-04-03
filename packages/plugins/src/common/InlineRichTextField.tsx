/**
 * InlineRichTextField — quarantined support module for inline rich text editing.
 *
 * Creates a standalone mini Tiptap 2.x editor instance with ONLY bold + italic marks.
 * Fully isolated from the outer page editor (no shared state, schema, or extensions).
 *
 * Data contract: reads/writes InlineTextSegment[] (Shape B) — framework-agnostic DTOs.
 * Tiptap is an implementation detail of this component, not a storage dependency.
 *
 * TECH DEBT: packages/plugins uses Tiptap 2.x while admin uses 3.x.
 * This component creates its own ProseMirror instance on 2.x.
 * See docs/TECH-DEBT.md for the version alignment plan.
 */

import React, { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import HardBreak from "@tiptap/extension-hard-break";
import History from "@tiptap/extension-history";

// ─── Shape B conversion ────────────────────────────────────

interface InlineTextSegment {
    text?: string;
    bold?: boolean;
    italic?: boolean;
    br?: boolean;
}

/** Convert Shape B segments → Tiptap JSON (single paragraph content array). */
function segmentsToTiptap(segments: InlineTextSegment[]): any {
    if (!segments || segments.length === 0) {
        return { type: "doc", content: [{ type: "paragraph" }] };
    }

    const content = segments.map(seg => {
        if (seg.br) return { type: "hardBreak" };
        const node: any = { type: "text", text: seg.text || "" };
        const marks: any[] = [];
        if (seg.bold) marks.push({ type: "bold" });
        if (seg.italic) marks.push({ type: "italic" });
        if (marks.length > 0) node.marks = marks;
        return node;
    });

    return { type: "doc", content: [{ type: "paragraph", content }] };
}

/** Extract text/hardBreak nodes from a single Tiptap paragraph node. */
function extractParaContent(para: any): InlineTextSegment[] {
    if (!para?.content) return [];
    return para.content
        .filter((node: any) => (node.type === "text" && node.text) || node.type === "hardBreak")
        .map((node: any) => {
            if (node.type === "hardBreak") return { br: true } as InlineTextSegment;
            const seg: InlineTextSegment = { text: node.text };
            if (node.marks) {
                for (const mark of node.marks) {
                    if (mark.type === "bold") seg.bold = true;
                    if (mark.type === "italic") seg.italic = true;
                }
            }
            return seg;
        });
}

/** Convert Tiptap JSON → Shape B segments.
 *  Flattens ALL paragraphs into one array, inserting { br: true } between them.
 *  This handles both hardBreak nodes (Shift+Enter) and multiple paragraphs (Enter). */
function tiptapToSegments(json: any): InlineTextSegment[] {
    const paragraphs = json?.content;
    if (!paragraphs || paragraphs.length === 0) return [];

    const segments: InlineTextSegment[] = [];
    paragraphs.forEach((para: any, i: number) => {
        if (i > 0) segments.push({ br: true });
        segments.push(...extractParaContent(para));
    });
    return segments;
}

/** Strip segments to plain text (line breaks become newlines). */
export function segmentsToPlainText(segments: InlineTextSegment[]): string {
    if (!segments) return "";
    return segments.map(s => s.br ? "\n" : (s.text || "")).join("");
}

// ─── Component ─────────────────────────────────────────────

interface Props {
    value: InlineTextSegment[] | undefined;
    fallbackText?: string;
    onChange: (segments: InlineTextSegment[], plainText: string) => void;
    placeholder?: string;
    className?: string;
}

/** Parse a legacy plain-text string into Tiptap content, converting <br>, <br/>, <br /> to hardBreak nodes. */
function plainTextToTiptapContent(text: string): any {
    if (!text) return { type: "doc", content: [{ type: "paragraph" }] };

    // Split on <br>, <br/>, <br /> variants
    const parts = text.split(/<br\s*\/?>/gi);
    const content: any[] = [];

    parts.forEach((part, i) => {
        if (part) content.push({ type: "text", text: part });
        if (i < parts.length - 1) content.push({ type: "hardBreak" });
    });

    return { type: "doc", content: [{ type: "paragraph", content: content.length > 0 ? content : undefined }] };
}

export function InlineRichTextField({ value, fallbackText, onChange, placeholder, className }: Props) {
    // Prevent feedback loops: skip setContent when the update originated from this editor.
    const internalUpdate = useRef(false);

    // Seed content: prefer rich segments, fall back to plain text for migration-on-edit.
    // Legacy fallback parses <br> tags in plain strings into hardBreak nodes.
    const initialContent = value && value.length > 0
        ? segmentsToTiptap(value)
        : plainTextToTiptapContent(fallbackText || "");

    const editor = useEditor({
        extensions: [
            Document,
            Paragraph,
            Text,
            Bold,
            Italic,
            HardBreak,  // Shift+Enter inserts a line break, serialized as { br: true }
            History,
        ],
        content: initialContent,
        onUpdate({ editor: ed }) {
            internalUpdate.current = true;
            const segments = tiptapToSegments(ed.getJSON());
            const plain = segmentsToPlainText(segments);
            onChange(segments, plain);
            // Reset flag after React processes the state update
            requestAnimationFrame(() => { internalUpdate.current = false; });
        },
    });

    // Sync from external prop changes (e.g. undo at the outer editor level).
    // Handles both rich segments and plain-text fallback for legacy blocks.
    useEffect(() => {
        if (!editor || internalUpdate.current) return;

        let targetContent: any;
        if (value && value.length > 0) {
            // Rich path: sync from segments
            const currentSegments = tiptapToSegments(editor.getJSON());
            if (JSON.stringify(currentSegments) === JSON.stringify(value)) return;
            targetContent = segmentsToTiptap(value);
        } else if (fallbackText !== undefined) {
            // Plain-text fallback: sync from legacy subheadline (parses <br> tags)
            const currentPlain = segmentsToPlainText(tiptapToSegments(editor.getJSON()));
            if (currentPlain === fallbackText) return;
            targetContent = plainTextToTiptapContent(fallbackText);
        } else {
            return;
        }

        editor.commands.setContent(targetContent);
    }, [value, fallbackText, editor]);

    if (!editor) return null;

    const isActive = (mark: string) => editor.isActive(mark);

    return (
        <div className={`inline-rich-text-field ${className || ""}`}>
            {/* Minimal toolbar */}
            <div className="flex items-center gap-0.5 mb-1">
                <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
                    className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-colors ${
                        isActive("bold") ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                    title="Bold (Cmd+B)"
                >
                    B
                </button>
                <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
                    className={`w-6 h-6 flex items-center justify-center rounded text-xs transition-colors ${
                        isActive("italic") ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                    title="Italic (Cmd+I)"
                >
                    <em>I</em>
                </button>
            </div>

            {/* Editor area */}
            <EditorContent
                editor={editor}
                className="w-full min-h-[36px] rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm shadow-sm transition-all focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[20px] [&_.ProseMirror_p]:m-0"
            />

            {/* Placeholder when empty */}
            {placeholder && editor.isEmpty && (
                <div className="pointer-events-none absolute text-sm text-gray-400 px-3 py-1.5" style={{ marginTop: "-32px" }}>
                    {placeholder}
                </div>
            )}
        </div>
    );
}
