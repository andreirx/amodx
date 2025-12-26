import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { BarChart3 } from 'lucide-react';
import { AnalyticsSchema } from './schema';
import { AnalyticsEditor } from './AnalyticsEditor';
import { AnalyticsRender } from './AnalyticsRender';
import { PluginDefinition } from '../types';

export const AnalyticsPlugin: PluginDefinition = {
    key: 'analytics',
    label: 'Analytics Tracker',
    icon: BarChart3,
    schema: AnalyticsSchema,

    editorExtension: Node.create({
        name: 'analytics',
        group: 'block',
        atom: true,
        addAttributes() {
            return {
                provider: { default: 'google-analytics' },
                trackingId: { default: '' },
                domain: { default: '' },
                customScript: { default: '' },
            };
        },
        parseHTML() { return [{ tag: 'app-analytics' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-analytics', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(AnalyticsEditor); },
    }),

    renderComponent: AnalyticsRender
};
