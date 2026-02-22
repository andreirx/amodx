import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Mail } from 'lucide-react';
import { ContactSchema } from './schema';
import { ContactEditor } from './ContactEditor';
import { ContactRender } from './ContactRender';
import { PluginDefinition } from '../types';

export const ContactPlugin: PluginDefinition = {
    key: 'contact',
    label: 'Contact Form',
    icon: Mail,
    schema: ContactSchema,

    editorExtension: Node.create({
        name: 'contact',
        group: 'block',
        atom: true,

        addAttributes() {
            return {
                headline: { default: 'Get in Touch' },
                description: { default: 'Send us a message.' },
                buttonText: { default: 'Send Message' },
                successMessage: { default: 'Thanks! We will be in touch.' },
                tags: { default: 'contact-form' },
                blockWidth: { default: 'content' },
            };
        },

        parseHTML() { return [{ tag: 'app-contact' }]; },
        renderHTML({ HTMLAttributes }) { return ['app-contact', mergeAttributes(HTMLAttributes)]; },
        addNodeView() { return ReactNodeViewRenderer(ContactEditor); },
    }),

    renderComponent: ContactRender
};
