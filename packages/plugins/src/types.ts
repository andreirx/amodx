import { Node } from '@tiptap/core';
import { z } from 'zod';
import React from 'react';
import { LucideIcon } from 'lucide-react';
import type { BlockStrings } from '@amodx/shared';

export interface PluginDefinition {
    key: string; // e.g. "hero"
    label: string; // e.g. "Hero Section"
    icon: LucideIcon;
    schema: z.ZodObject<any>;

    // If true, only shown in the block inserter when commerceEnabled is true
    commerce?: boolean;

    // The Admin Tiptap Extension
    editorExtension: Node;

    // The Frontend React Component. LOCALE-1C (ruling LOCALE1C-REGISTRY-TYPE = A): `strings` = the block texts of the
    // tenant's locale table (`blockStrings` of @amodx/shared), which RenderBlocks always passes; required — a block has
    // no English fallback. A renderer without fixed texts simply does not read it.
    renderComponent: React.FC<{ attrs: any; tenantId?: string; strings: BlockStrings }>;
}
