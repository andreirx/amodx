import { NodeViewWrapper } from '@tiptap/react';
import { BarChart3 } from 'lucide-react';
import React from 'react';

const Input = ({ label, value, onChange, placeholder }: any) => (
    <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
        <input
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-500 outline-none"
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    </div>
);

const Select = ({ label, value, onChange, options }: any) => (
    <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
        <select
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-500 outline-none"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        >
            {options.map((opt: any) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
    </div>
);

export function AnalyticsEditor(props: any) {
    const { provider, trackingId, domain, customScript } = props.node.attrs;

    const update = (field: string, value: any) => {
        props.updateAttributes({ [field]: value });
    };

    return (
        <NodeViewWrapper className="my-6">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-purple-50 px-4 py-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-100 text-indigo-600">
                        <BarChart3 className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-gray-700">Analytics Tracker</span>
                    <span className="ml-auto text-[10px] text-gray-500 bg-white px-2 py-0.5 rounded-full">
                        GDPR Compliant
                    </span>
                </div>

                {/* Configuration */}
                <div className="p-4">
                    <Select
                        label="Provider"
                        value={provider}
                        onChange={(v: string) => update('provider', v)}
                        options={[
                            { value: 'google-analytics', label: 'Google Analytics 4' },
                            { value: 'plausible', label: 'Plausible Analytics' },
                            { value: 'custom', label: 'Custom Script' },
                        ]}
                    />

                    <Input
                        label={provider === 'google-analytics' ? 'Measurement ID (G-XXXXXXXXXX)' : 'Tracking ID'}
                        value={trackingId}
                        onChange={(v: string) => update('trackingId', v)}
                        placeholder={provider === 'google-analytics' ? 'G-XXXXXXXXXX' : 'your-tracking-id'}
                    />

                    {provider === 'plausible' && (
                        <Input
                            label="Domain"
                            value={domain}
                            onChange={(v: string) => update('domain', v)}
                            placeholder="example.com"
                        />
                    )}

                    {provider === 'custom' && (
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                Custom Script (JavaScript)
                            </label>
                            <textarea
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:border-indigo-500 outline-none"
                                value={customScript || ''}
                                onChange={(e) => update('customScript', e.target.value)}
                                rows={6}
                                placeholder="// Your custom analytics code here"
                            />
                        </div>
                    )}

                    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-xs text-amber-900 leading-relaxed">
                            <strong>GDPR Notice:</strong> Analytics scripts will only load if the visitor
                            has accepted cookies via the consent banner. Necessary tracking is always enabled.
                        </p>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
