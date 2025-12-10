import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CreditCard } from 'lucide-react';
import { PricingSchema } from './schema';
import { PricingEditor } from './PricingEditor';
import { PricingRender } from './PricingRender';
import { PluginDefinition } from '../types';

export const PricingPlugin: PluginDefinition = {
    key: 'pricing',
    label: 'Pricing Table',
    icon: CreditCard,
    schema: PricingSchema,
    editorExtension: Node.create({
        name: 'pricing',
        group: 'block',
        atom: true,
        addAttributes() {
            return {
                title: { default: 'Founder Plan' },
                price: { default: '$299' },
                interval: { default: 'lifetime' },
                features: { default: 'Source Code\nCommunity Access' },
                buttonText: { default: 'Buy Now' },
                buttonLink: { default: '#' },
                recommended: { default: false },
            };
        },
        parseHTML() { return [{ tag: 'app-pricing' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-pricing', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(PricingEditor); },
    }),
    renderComponent: PricingRender
};
