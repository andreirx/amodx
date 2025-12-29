import {useEffect, useMemo, useState} from "react";
import {useParams, useNavigate, useBlocker} from "react-router-dom";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {Save, ArrowLeft, Loader2, Palette, X} from "lucide-react";
import { BlockEditor } from "@/components/editor/BlockEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Settings as SettingsIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { RotateCcw } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

// Helper to extract text from Tiptap JSON
const extractText = (blocks: any[]): string => {
    let text = "";
    const traverse = (node: any) => {
        if (node.type === 'text') text += node.text + " ";
        if (node.content) node.content.forEach(traverse);
    };
    blocks.forEach(traverse);
    return text.substring(0, 160).trim();
};

// Helper to find first image
const findImage = (blocks: any[]): string => {
    let src = "";
    const traverse = (node: any) => {
        if (src) return;
        if (node.type === 'image' && node.attrs?.src) src = node.attrs.src;
        if (node.content) node.content.forEach(traverse);
    };
    blocks.forEach(traverse);
    return src;
};

// IMPROVED COLOR COMPONENT
function ColorOverride({ label, value, onChange, onReset }: { label: string, value?: string, onChange: (v: string) => void, onReset: () => void }) {
    const isSet = value !== undefined && value !== "";

    return (
        <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</Label>
            <div className="flex gap-2 items-center h-9">
                {isSet ? (
                    <>
                        <div className="relative flex-1 h-full border rounded-md overflow-hidden">
                            <input
                                type="color"
                                className="absolute inset-0 w-[150%] h-[150%] -translate-x-[25%] -translate-y-[25%] cursor-pointer p-0 border-0"
                                value={value}
                                onChange={e => onChange(e.target.value)}
                            />
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                            onClick={onReset}
                            title="Remove Override (Use Global)"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </>
                ) : (
                    <Button
                        variant="outline"
                        className="w-full h-full text-xs text-muted-foreground font-normal border-dashed"
                        onClick={() => onChange("#7f7f7f")} // Starts editing
                        title="Click to override global color"
                    >
                        Inherited (Global)
                    </Button>
                )}
            </div>
        </div>
    );
}

// Defined initial state to avoid undefined errors
const DEFAULT_STATE = {
    title: "",
    slug: "",
    status: "Draft",
    commentsMode: "Hidden",
    blocks: [] as any[],
    seoTitle: "",
    seoDescription: "",
    seoKeywords: "",
    featuredImage: "",
    hideNav: false,
    hideFooter: false,
    themeOverride: {} as Record<string, string>
};

export default function ContentEditor() {
    const { id } = useParams();
    const navigate = useNavigate();

    // Store the CLEAN state (from server)
    const [serverState, setServerState] = useState<typeof DEFAULT_STATE | null>(null);

    // Store the DIRTY state (current edits)
    const [form, setForm] = useState(DEFAULT_STATE);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [manualSeo, setManualSeo] = useState(false);

    // Calculate dirty state
    const isDirty = useMemo(() => {
        if (!serverState) return false;
        return JSON.stringify(serverState) !== JSON.stringify(form);
    }, [serverState, form]);

    // 1. Browser Navigation Protection (Close Tab / Refresh)
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = "You have unsaved changes.";
            }
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [isDirty]);

    // 2. Client Router Protection (React Router)
    // NOTE: Requires data router (createBrowserRouter) usually, but basic blocker works in newer v6
    const blocker = useBlocker(
        ({ currentLocation, nextLocation }) => isDirty && currentLocation.pathname !== nextLocation.pathname
    );

    useEffect(() => {
        if (id) loadContent(id);
    }, [id]);

    async function loadContent(nodeId: string) {
        try {
            const data = await apiRequest(`/content/${nodeId}`);

            // Map API response to Form State
            const state = {
                title: data.title || "",
                slug: data.slug || "",
                status: data.status || "Draft",
                commentsMode: data.commentsMode || "Hidden",
                blocks: data.blocks || [],
                seoTitle: data.seoTitle || "",
                seoDescription: data.seoDescription || "",
                seoKeywords: data.seoKeywords || "",
                featuredImage: data.featuredImage || "",
                hideNav: data.hideNav || false,
                hideFooter: data.hideFooter || false,
                themeOverride: data.themeOverride || {}
            };

            setForm(state);
            setServerState(state); // Sync clean state

            if (data.seoTitle || data.seoDescription) setManualSeo(true);

        } catch (err) {
            console.error(err);
            alert("Failed to load content");
        } finally {
            setLoading(false);
        }
    }

    async function save() {
        if (!id) return;

        let finalSeoTitle = form.seoTitle;
        let finalSeoDesc = form.seoDescription;
        let finalImg = form.featuredImage;

        if (!manualSeo) {
            if (!finalSeoTitle) finalSeoTitle = form.title;
            if (!finalSeoDesc) finalSeoDesc = extractText(form.blocks);
            if (!finalImg) finalImg = findImage(form.blocks);
        }

        try {
            setSaving(true);
            const payload = {
                ...form,
                seoTitle: finalSeoTitle,
                seoDescription: finalSeoDesc,
                featuredImage: finalImg,
            };

            await apiRequest(`/content/${id}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });

            // Update clean state
            setServerState(payload);
            // Re-fetch to ensure sync (e.g. if slug changed backend side)
            await loadContent(id);
            window.dispatchEvent(new Event("amodx:refresh-links"));

        } catch (err: any) {
            alert("Failed to save: " + err.message);
        } finally {
            setSaving(false);
        }
    }

    // --- Helpers ---
    const update = (key: keyof typeof DEFAULT_STATE, val: any) => {
        setForm(prev => ({ ...prev, [key]: val }));
    };

    const updateTheme = (key: string, val: string) => {
        setForm(prev => ({
            ...prev,
            themeOverride: { ...prev.themeOverride, [key]: val }
        }));
    };

    const resetThemeKey = (key: string) => {
        const newTheme = { ...form.themeOverride };
        delete newTheme[key];
        update("themeOverride", newTheme);
    };

    const resetAllDesign = () => {
        if (confirm("Remove all design overrides?")) {
            setForm(prev => ({ ...prev, themeOverride: {}, hideNav: false, hideFooter: false }));
        }
    };

    if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

            {/* BLOCKER DIALOG */}
            {blocker.state === "blocked" && (
                <Dialog open={true} onOpenChange={() => blocker.reset()}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Unsaved Changes</DialogTitle>
                            <DialogDescription>
                                You have unsaved changes. Are you sure you want to leave?
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => blocker.reset()}>Cancel</Button>
                            <Button variant="destructive" onClick={() => blocker.proceed()}>Discard & Leave</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            <header className="flex-none flex items-center justify-between px-6 py-3 border-b bg-card z-20">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
                        <ArrowLeft className="h-4 w-4"/>
                    </Button>
                    <div className="flex flex-col">
                        <Select value={form.status} onValueChange={v => update("status", v)}>
                            <SelectTrigger className={`h-8 w-[140px] font-medium ${form.status === 'Published' ? 'text-green-600 bg-green-50 border-green-200' : 'text-muted-foreground'}`}>
                                <SelectValue/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Draft">Draft</SelectItem>
                                <SelectItem value="Published">Published</SelectItem>
                                <SelectItem value="Archived">Archived</SelectItem>
                            </SelectContent>
                        </Select>
                        {isDirty ? (
                            <span className="text-[10px] font-bold text-amber-600 animate-pulse">● Unsaved Changes</span>
                        ) : (
                            <span className="text-[10px] text-muted-foreground">All changes saved</span>
                        )}
                    </div>
                    <div className="flex gap-2 mb-1">
                        <Select value={form.commentsMode} onValueChange={v => update("commentsMode", v)}>
                            <SelectTrigger className="h-8 w-[110px] text-xs">
                                <SelectValue placeholder="Comments"/>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Enabled">Comments On</SelectItem>
                                <SelectItem value="Locked">Locked (Read)</SelectItem>
                                <SelectItem value="Hidden">Disabled</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* SEO SHEET */}
                    <Sheet>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm">
                                <SettingsIcon className="mr-2 h-4 w-4"/> Settings
                            </Button>
                        </SheetTrigger>
                        <SheetContent>
                            <SheetHeader><SheetTitle>Page Configuration</SheetTitle></SheetHeader>
                            <div className="space-y-6 py-6 overflow-y-auto h-full pb-20">
                                {/* Design Overrides */}
                                <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
                                    <div className="flex items-center justify-between border-b pb-2">
                                        <h4 className="text-sm font-semibold flex items-center gap-2">
                                            <Palette className="w-4 h-4 text-primary"/> Design
                                        </h4>
                                        {(Object.keys(form.themeOverride).length > 0 || form.hideNav || form.hideFooter) && (
                                            <Button variant="ghost" size="sm" onClick={resetAllDesign} className="h-6 text-[10px] text-red-500">
                                                <RotateCcw className="w-3 h-3 mr-1"/> Reset
                                            </Button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                                            <input type="checkbox" checked={form.hideNav} onChange={e => update("hideNav", e.target.checked)} className="rounded" />
                                            Hide Navbar
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                                            <input type="checkbox" checked={form.hideFooter} onChange={e => update("hideFooter", e.target.checked)} className="rounded" />
                                            Hide Footer
                                        </label>
                                    </div>
                                    <div className="space-y-3">
                                        <Label className="text-xs font-semibold">Colors</Label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <ColorOverride label="Primary" value={form.themeOverride.primaryColor} onChange={v => updateTheme("primaryColor", v)} onReset={() => resetThemeKey("primaryColor")} />
                                            <ColorOverride label="Background" value={form.themeOverride.backgroundColor} onChange={v => updateTheme("backgroundColor", v)} onReset={() => resetThemeKey("backgroundColor")} />
                                            <ColorOverride label="Text" value={form.themeOverride.textColor} onChange={v => updateTheme("textColor", v)} onReset={() => resetThemeKey("textColor")} />
                                            <ColorOverride label="Surface" value={form.themeOverride.surfaceColor} onChange={v => updateTheme("surfaceColor", v)} onReset={() => resetThemeKey("surfaceColor")} />
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <Label className="text-xs font-semibold">Typography</Label>
                                        <div className="space-y-2">
                                            <Input className="h-8 text-xs" placeholder="Headings Font (e.g. Inter)" value={form.themeOverride.fontHeading || ""} onChange={e => updateTheme("fontHeading", e.target.value)} />
                                            <Input className="h-8 text-xs" placeholder="Body Font (e.g. Lato)" value={form.themeOverride.fontBody || ""} onChange={e => updateTheme("fontBody", e.target.value)} />
                                        </div>
                                    </div>
                                </div>

                                {/* SEO */}
                                <div className="space-y-4">
                                    <h4 className="text-sm font-semibold border-b pb-1">SEO</h4>
                                    <div className="space-y-2">
                                        <Label>Keywords</Label>
                                        <Input value={form.seoKeywords} onChange={e => update("seoKeywords", e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>SEO Title</Label>
                                        <Input value={form.seoTitle} onChange={e => { update("seoTitle", e.target.value); setManualSeo(true); }} placeholder={form.title} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Description</Label>
                                        <Textarea value={form.seoDescription} onChange={e => { update("seoDescription", e.target.value); setManualSeo(true); }} rows={4} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Featured Image</Label>
                                        <Input value={form.featuredImage} onChange={e => { update("featuredImage", e.target.value); setManualSeo(true); }} />
                                    </div>
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>

                    <Button onClick={save} disabled={saving || !isDirty}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                        Save
                    </Button>
                </div>
            </header>

            <main className="flex-1 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-4xl mx-auto w-full p-8 pb-32">
                        <div className="space-y-6 mb-8">
                            <div className="space-y-2">
                                <Label className="text-muted-foreground">Page Title</Label>
                                <Input
                                    value={form.title}
                                    onChange={(e) => update("title", e.target.value)}
                                    className="text-4xl font-black h-auto py-2 border-transparent hover:border-input focus:border-input px-0 bg-transparent shadow-none rounded-none border-b focus-visible:ring-0"
                                    placeholder="Untitled Page"
                                />
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>URL:</span>
                                <span className="font-mono bg-muted/50 px-2 py-0.5 rounded">/</span>
                                <Input
                                    value={form.slug.replace(/^\//, '')}
                                    onChange={(e) => update("slug", e.target.value)}
                                    className="font-mono h-auto py-0.5 px-1 w-auto min-w-[200px] border-transparent hover:border-input focus:border-input bg-transparent shadow-none"
                                />
                            </div>
                        </div>

                        <BlockEditor
                            key={id} // Force remount on ID change
                            initialContent={serverState?.blocks} // Pass CLEAN blocks initially
                            onChange={(newBlocks) => update("blocks", newBlocks)}
                        />
                    </div>
                </div>
            </main>
        </div>
    );
}
