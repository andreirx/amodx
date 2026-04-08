import { NodeViewWrapper } from '@tiptap/react';
import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { BlockWidthControl } from '../BlockWidthControl';
import { EffectControls } from '../common/EffectControls';

// ... Standard Inputs ...
const Input = ({ value, onChange, placeholder }: any) => (
    <input className="w-full h-8 bg-white border border-gray-200 rounded px-2 text-sm focus:border-blue-500 outline-none" value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
);
const TextArea = ({ value, onChange, placeholder }: any) => (
    <textarea className="w-full h-16 bg-white border border-gray-200 rounded p-2 text-sm focus:border-blue-500 outline-none resize-none" value={value || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
);

export function FeaturesEditor(props: any) {
    const { headline, subheadline, items, columns, blockWidth, layout, iconSize } = props.node.attrs;
    const safeItems = Array.isArray(items) ? items : [];
    const update = (field: string, value: any) => props.updateAttributes({ [field]: value });

    // ... addItem, removeItem, updateItem helpers ...
    const updateItem = (i: number, f: string, v: any) => { const n = [...safeItems]; n[i] = {...n[i], [f]: v}; update('items', n); };
    const addItem = () => update('items', [...safeItems, { id: crypto.randomUUID(), title: 'Feature', description: '...', icon: 'Check' }]);
    const removeItem = (i: number) => update('items', safeItems.filter((_: any, idx: number) => idx !== i));

    return (
        <NodeViewWrapper className="my-8">
            <div className="border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-blue-50 text-blue-600">
                            <LayoutGrid className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Feature Grid</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <BlockWidthControl value={blockWidth} onChange={v => update('blockWidth', v)} />
                        <div className="w-px h-4 bg-gray-200" />
                        <select className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium focus:border-blue-500" value={columns} onChange={e => update('columns', e.target.value)}>
                            <option value="2">2 Cols</option>
                            <option value="3">3 Cols</option>
                            <option value="4">4 Cols</option>
                            <option value="5">5 Cols</option>
                            <option value="6">6 Cols</option>
                        </select>
                        <select className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium focus:border-blue-500" value={layout || 'stacked'} onChange={e => update('layout', e.target.value)}>
                            <option value="stacked">Stacked</option>
                            <option value="inline">Inline</option>
                        </select>
                        <select className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs font-medium focus:border-blue-500" value={iconSize || 'md'} onChange={e => update('iconSize', e.target.value)}>
                            <option value="sm">Icon S</option>
                            <option value="md">Icon M</option>
                            <option value="lg">Icon L</option>
                        </select>
                    </div>
                </div>

                <div className="p-5">
                    <div className="mb-6 space-y-2">
                        <Input value={headline} onChange={(v: string) => update('headline', v)} placeholder="Headline (leave empty to hide)" />
                        <Input value={subheadline} onChange={(v: string) => update('subheadline', v)} placeholder="Subheadline (leave empty to hide)" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {safeItems.map((item: any, i: number) => (
                            <div key={item.id || i} className="bg-white border border-gray-200 rounded-lg p-3 relative group">
                                <button onClick={() => removeItem(i)} className="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <select className="w-32 h-8 bg-white border border-gray-200 rounded px-1 text-xs" value={item.icon} onChange={e => updateItem(i, 'icon', e.target.value)}>
                                            <optgroup label="General">
                                                {["Check", "CheckCircle", "Star", "Award", "Trophy", "ThumbsUp", "Smile", "Heart", "Sparkles", "Gem", "Crown"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                            <optgroup label="Performance">
                                                {["Zap", "Rocket", "TrendingUp", "Gauge", "Timer", "Activity", "BarChart3", "Target"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                            <optgroup label="Security & Trust">
                                                {["Shield", "ShieldCheck", "Lock", "KeyRound", "Eye", "Fingerprint", "BadgeCheck"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                            <optgroup label="Communication">
                                                {["MessageCircle", "Mail", "Phone", "Send", "Bell", "Megaphone", "Radio"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                            <optgroup label="People & Social">
                                                {["Users", "UserCheck", "Handshake", "HeartHandshake", "CircleUserRound", "Building2"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                            <optgroup label="Commerce">
                                                {["ShoppingCart", "CreditCard", "Wallet", "Receipt", "Package", "Truck", "Store", "Gift", "Percent", "BadgeDollarSign"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                            <optgroup label="Tech & Tools">
                                                {["Globe", "Wifi", "Cloud", "Database", "Server", "Code", "Cpu", "Monitor", "Smartphone", "Settings", "Wrench", "Puzzle"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                            <optgroup label="Content & Media">
                                                {["Image", "Video", "Camera", "FileText", "BookOpen", "Palette", "Layers", "Layout", "PenTool"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                            <optgroup label="Nature & Time">
                                                {["Sun", "Moon", "Leaf", "TreePine", "Droplets", "Flame", "Clock", "Calendar", "MapPin", "Mountain", "Waves"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                            <optgroup label="Arrows & Navigation">
                                                {["ArrowRight", "ArrowUpRight", "MoveRight", "RefreshCw", "Repeat", "RotateCw", "Compass", "Navigation"].map(o => <option key={o} value={o}>{o}</option>)}
                                            </optgroup>
                                        </select>
                                        <Input value={item.title} onChange={(v: string) => updateItem(i, 'title', v)} placeholder="Title" />
                                    </div>
                                    <TextArea value={item.description} onChange={(v: string) => updateItem(i, 'description', v)} placeholder="Description" />
                                </div>
                            </div>
                        ))}
                        <button onClick={addItem} className="min-h-[100px] border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center text-blue-500 hover:bg-blue-50 transition-colors"><Plus className="w-5 h-5" /></button>
                    </div>

                    <EffectControls
                        effect={props.node.attrs.effect}
                        onChange={v => update('effect', v)}
                    />
                </div>
            </div>
        </NodeViewWrapper>
    );
}
