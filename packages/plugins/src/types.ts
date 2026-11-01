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

    // CAT-ADMIN-2 (docs/slices/cat-admin-1.md § 4.7): the site kinds whose block inserter offers this block. Absent or
    // empty = offered on every site. "commerce" = a non-catalog site with commerceEnabled; "catalog" = a catalog site.
    // Read by the admin toolbar only; the renderer renders every registered block regardless.
    offeredOn?: readonly ("commerce" | "catalog")[];

    // The Admin Tiptap Extension
    editorExtension: Node;

    // The Frontend React Component. LOCALE-1C (ruling LOCALE1C-REGISTRY-TYPE = A): `strings` = the block texts of the
    // tenant's locale table (`blockStrings` of @amodx/shared), which RenderBlocks always passes; required — a block has
    // no English fallback. A renderer without fixed texts simply does not read it.
    renderComponent: React.FC<{ attrs: any; tenantId?: string; strings: BlockStrings }>;
}
