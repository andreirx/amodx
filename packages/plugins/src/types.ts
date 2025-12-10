import { Node } from '@tiptap/core';
import { z } from 'zod';
import React from 'react';
import { LucideIcon } from 'lucide-react';

export interface PluginDefinition {
    key: string; // e.g. "hero"
    label: string; // e.g. "Hero Section"
    icon: LucideIcon;
    schema: z.ZodObject<any>;

    // The Admin Tiptap Extension
    editorExtension: Node;

    // The Frontend React Component
    renderComponent: React.FC<{ attrs: any }>;
}
