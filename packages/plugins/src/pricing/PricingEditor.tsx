import { NodeViewWrapper } from '@tiptap/react';
import { CreditCard, Plus, Trash2, Star } from 'lucide-react';
import React from 'react';

const Input = ({ value, onChange, placeholder }: any) => (
    <input
        className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-emerald-500 outline-none"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

const TextArea = ({ value, onChange, placeholder }: any) => (
    <textarea
        className="w-full h-20 bg-white border border-gray-200 rounded p-2 text-sm focus:border-emerald-500 outline-none resize-none"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
    />
);

export function PricingEditor(props: any) {
    const { headline, subheadline, plans } = props.node.attrs;
    const safePlans = Array.isArray(plans) ? plans : [];
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    const updatePlan = (index: number, field: string, value: any) => {
        const newPlans = [...safePlans];
        newPlans[index] = { ...newPlans[index], [field]: value };
        update('plans', newPlans);
    };
    const addPlan = () => update('plans', [...safePlans, { id: crypto.randomUUID(), title: 'New', price: '$0', interval: 'mo', features: '', buttonText: 'Go', buttonLink: '#', highlight: false }]);
    const removePlan = (index: number) => update('plans', safePlans.filter((_: any, i: number) => i !== index));

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center border-b border-gray-100 bg-gray-50/50 px-4 py-3 gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-50 text-emerald-600">
                        <CreditCard className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Pricing Table</span>
                </div>

                <div className="p-5">
                    <div className="mb-6 space-y-2">
                        <Input value={headline} onChange={(v: string) => update('headline', v)} placeholder="Headline" />
                        <Input value={subheadline} onChange={(v: string) => update('subheadline', v)} placeholder="Subheadline" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {safePlans.map((plan: any, i: number) => (
                            <div key={plan.id} className={`p-4 rounded-lg border bg-white relative group ${plan.highlight ? 'border-emerald-500 ring-1 ring-emerald-500/20' : 'border-gray-200'}`}>
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => updatePlan(i, 'highlight', !plan.highlight)} className={`p-1 rounded ${plan.highlight ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`}>
                                        <Star className="w-4 h-4 fill-current" />
                                    </button>
                                    <button onClick={() => removePlan(i)} className="p-1 text-gray-300 hover:text-red-500">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    <Input value={plan.title} onChange={(v: string) => updatePlan(i, 'title', v)} placeholder="Plan Name" />
                                    <div className="flex gap-2">
                                        <Input value={plan.price} onChange={(v: string) => updatePlan(i, 'price', v)} placeholder="Price" />
                                        <Input value={plan.interval} onChange={(v: string) => updatePlan(i, 'interval', v)} placeholder="/mo" />
                                    </div>
                                    <TextArea value={plan.features} onChange={(v: string) => updatePlan(i, 'features', v)} placeholder="Features (1 per line)" />
                                    <div className="pt-2 border-t border-gray-100 space-y-2">
                                        <Input value={plan.buttonText} onChange={(v: string) => updatePlan(i, 'buttonText', v)} placeholder="Btn Text" />
                                        <Input value={plan.buttonLink} onChange={(v: string) => updatePlan(i, 'buttonLink', v)} placeholder="URL" />
                                    </div>
                                </div>
                            </div>
                        ))}
                        <button onClick={addPlan} className="min-h-[250px] border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center text-emerald-600 hover:bg-emerald-50/30 transition-all">
                            <Plus className="w-6 h-6 mb-1" />
                            <span className="text-xs font-bold">Add Plan</span>
                        </button>
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    );
}
