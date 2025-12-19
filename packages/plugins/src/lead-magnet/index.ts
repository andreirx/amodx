import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Lock } from 'lucide-react';
import { LeadMagnetSchema } from './schema';
import { LeadMagnetEditor } from './LeadMagnetEditor';
import { LeadMagnetRender } from './LeadMagnetRender';
import { PluginDefinition } from '../types';

export const LeadMagnetPlugin: PluginDefinition = {
    key: 'leadMagnet',
    label: 'Lead Magnet (Gated)',
    icon: Lock,
    schema: LeadMagnetSchema,

    editorExtension: Node.create({
        name: 'leadMagnet',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: 'Unlock Resource' },
                description: { default: 'Enter your email to download.' },
                buttonText: { default: 'Unlock' },
                resourceId: { default: '' },
                fileName: { default: '' },
                tags: { default: 'lead-magnet' },
            };
        },

        parseHTML() {
            return [{ tag: 'app-lead-magnet' }];
        },

        renderHTML({ HTMLAttributes }) {
            return ['app-lead-magnet', mergeAttributes(HTMLAttributes)];
        },

        addNodeView() {
            return ReactNodeViewRenderer(LeadMagnetEditor);
        },
    }),

    renderComponent: LeadMagnetRender
};
