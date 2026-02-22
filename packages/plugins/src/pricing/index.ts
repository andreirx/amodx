import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CreditCard } from 'lucide-react';
import { PricingSchema } from './schema';
import { PricingEditor } from './PricingEditor';
import { PricingRender } from './PricingRender';
import { PluginDefinition } from '../types';

export const PricingPlugin: PluginDefinition = {
    key: 'pricing',
    label: 'Pricing Section',
    icon: CreditCard,
    schema: PricingSchema,

    editorExtension: Node.create({
        name: 'pricing',
        group: 'block',
        atom: true, // It's a single unit

        addAttributes() {
            return {
                headline: {
                    default: 'Simple Pricing',
                },
                subheadline: {
                    default: 'Choose the plan that fits your needs.',
                },
                // CRITICAL FIX: Define the 'plans' attribute with a default array
                plans: {
                    default: [
                        {
                            id: '1',
                            title: 'Starter',
                            price: '$29',
                            interval: 'mo',
                            features: 'Feature 1\nFeature 2',
                            buttonText: 'Start',
                            highlight: false
                        },
                        {
                            id: '2',
                            title: 'Pro',
                            price: '$99',
                            interval: 'mo',
                            features: 'Everything in Starter\nPriority Support',
                            buttonText: 'Go Pro',
                            highlight: true
                        }
                    ],
                },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() {
            return [{ tag: 'app-pricing' }];
        },

        renderHTML({ HTMLAttributes }) {
            return ['app-pricing', mergeAttributes(HTMLAttributes)];
        },

        addNodeView() {
            return ReactNodeViewRenderer(PricingEditor);
        },
    }),

    renderComponent: PricingRender
};
