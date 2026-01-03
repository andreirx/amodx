import React, { useState, useRef, useEffect } from "react";
import { X, Plus, Tag } from "lucide-react";

interface TagInputProps {
    value: string[];
    onChange: (tags: string[]) => void;
    availableTags?: string[]; // List of all tags in the system
    placeholder?: string;
}

export function TagInput({ value = [], onChange, availableTags = [], placeholder }: TagInputProps) {
    const [inputValue, setInputValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Filter available tags that aren't already selected
    const suggestions = availableTags
        .filter(t => !value.includes(t))
        .filter(t => t.toLowerCase().includes(inputValue.toLowerCase()));

    const addTag = (tag: string) => {
        const trimmed = tag.trim();
        if (trimmed && !value.includes(trimmed)) {
            onChange([...value, trimmed]);
        }
        setInputValue("");
        setIsFocused(false);
    };

    const removeTag = (tagToRemove: string) => {
        onChange(value.filter(t => t !== tagToRemove));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            // If there's an exact match in suggestions, use it (case sensitive preference?)
            // Otherwise add what the user typed
            addTag(inputValue);
        }
        if (e.key === "Backspace" && !inputValue && value.length > 0) {
            removeTag(value[value.length - 1]);
        }
    };

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsFocused(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="relative space-y-2" ref={containerRef}>
            <div className="flex flex-wrap gap-2 p-2 border rounded-md bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background border-input">
                {value.map(tag => (
                    <span key={tag} className="flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded text-xs font-medium">
                        {tag}
                        <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
                <input
                    type="text"
                    className="flex-1 bg-transparent outline-none text-sm min-w-[120px] placeholder:text-muted-foreground h-6"
                    placeholder={value.length === 0 ? (placeholder || "Add tags...") : ""}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onKeyDown={handleKeyDown}
                />
            </div>

            {/* DROPDOWN SUGGESTIONS */}
            {isFocused && (inputValue || suggestions.length > 0) && (
                <div className="absolute top-full left-0 w-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in zoom-in-95">
                    {/* 1. Existing Suggestions */}
                    {suggestions.map(tag => (
                        <button
                            key={tag}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                            onClick={() => addTag(tag)}
                        >
                            <Tag className="h-3 w-3 opacity-50" />
                            {tag}
                        </button>
                    ))}

                    {/* 2. Create New Option */}
                    {inputValue && !suggestions.includes(inputValue) && (
                        <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-primary"
                            onClick={() => addTag(inputValue)}
                        >
                            <Plus className="h-3 w-3" />
                            Create "{inputValue}"
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
