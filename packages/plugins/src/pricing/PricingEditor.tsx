import { NodeViewWrapper } from '@tiptap/react';
import { Plus, Trash2, GripVertical, Star } from 'lucide-react';
import React from 'react';

const Input = ({ label, value, onChange, className = "" }: any) => (
    <div className="space-y-1">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <input
            className={`w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-blue-500 outline-none transition-colors ${className}`}
            value={value}
            onChange={e => onChange(e.target.value)}
        />
    </div>
);

const TextArea = ({ label, value, onChange }: any) => (
    <div className="space-y-1">
        {label && <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</label>}
        <textarea
            className="w-full h-20 bg-white border border-gray-200 rounded p-2 text-sm focus:border-blue-500 outline-none transition-colors font-mono"
            value={value}
            onChange={e => onChange(e.target.value)}
        />
    </div>
);

export function PricingEditor(props: any) {
    const { headline, subheadline, plans } = props.node.attrs;

    // SAFETY CHECK: If plans is undefined, default to empty array
    // This prevents the white screen of death
    const safePlans = Array.isArray(plans) ? plans : [];

    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const updatePlan = (index: number, field: string, value: any) => {
        const newPlans = [...plans];
        newPlans[index] = { ...newPlans[index], [field]: value };
        update('plans', newPlans);
    };

    const addPlan = () => {
        const newPlan = {
            id: crypto.randomUUID(),
            title: 'New Plan',
            price: '$0',
            interval: 'mo',
            features: 'Feature 1',
            buttonText: 'Sign Up',
            highlight: false
        };
        update('plans', [...plans, newPlan]);
    };

    const removePlan = (index: number) => {
        const newPlans = plans.filter((_: any, i: number) => i !== index);
        update('plans', newPlans);
    };

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-gray-50/50 rounded-xl p-6 shadow-sm">

                {/* Header Section */}
                <div className="mb-8 space-y-4 max-w-lg">
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-1 rounded">Pricing Section</span>
                    <Input
                        value={headline}
                        onChange={(v: string) => update('headline', v)}
                        className="font-bold text-lg"
                    />
                    <Input
                        value={subheadline}
                        onChange={(v: string) => update('subheadline', v)}
                    />
                </div>

                {/* Plans Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {safePlans.map((plan: any, i: number) => (
                        <div key={plan.id} className={`relative p-4 rounded-lg border-2 bg-white transition-all ${plan.highlight ? 'border-blue-500 ring-2 ring-blue-500/10' : 'border-gray-100'}`}>

                            {/* Toolbar */}
                            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-50">
                                <button
                                    onClick={() => updatePlan(i, 'highlight', !plan.highlight)}
                                    className={`p-1 rounded transition-colors ${plan.highlight ? 'text-yellow-500 bg-yellow-50' : 'text-gray-300 hover:text-gray-500'}`}
                                    title="Highlight Plan"
                                >
                                    <Star className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => removePlan(i)}
                                    className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <Input label="Plan Name" value={plan.title} onChange={(v: string) => updatePlan(i, 'title', v)} />
                                <div className="flex gap-2">
                                    <Input label="Price" value={plan.price} onChange={(v: string) => updatePlan(i, 'price', v)} />
                                    <Input label="Period" value={plan.interval} onChange={(v: string) => updatePlan(i, 'interval', v)} />
                                </div>
                                <TextArea label="Features" value={plan.features} onChange={(v: string) => updatePlan(i, 'features', v)} />
                                <Input label="Button" value={plan.buttonText} onChange={(v: string) => updatePlan(i, 'buttonText', v)} />
                            </div>
                        </div>
                    ))}

                    {/* Add Button */}
                    <button
                        onClick={addPlan}
                        className="flex flex-col items-center justify-center h-full min-h-[300px] rounded-lg border-2 border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all group"
                    >
                        <div className="w-12 h-12 rounded-full bg-white border border-gray-200 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <Plus className="w-6 h-6 text-gray-400 group-hover:text-blue-500" />
                        </div>
                        <span className="mt-3 text-sm font-medium text-gray-500 group-hover:text-blue-600">Add Plan</span>
                    </button>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
