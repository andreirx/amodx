import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
    Radar, ExternalLink, RefreshCw, ChevronRight, X,
    MessageSquare, Globe, Flame,
} from "lucide-react";
import type { Signal } from "@amodx/shared";

const SOURCE_ICONS: Record<string, string> = {
    Reddit: "🟠",
    Twitter: "🐦",
    LinkedIn: "🔵",
    Web: "🌐",
};

const STATUS_COLORS: Record<string, string> = {
    New: "bg-blue-100 text-blue-800",
    Drafted: "bg-amber-100 text-amber-800",
    Replied: "bg-green-100 text-green-800",
    Dismissed: "bg-muted text-muted-foreground",
};

export default function Signals() {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Signal | null>(null);
    const [draftReply, setDraftReply] = useState("");
    const [saving, setSaving] = useState(false);
    const [filterStatus, setFilterStatus] = useState<string>("all");

    useEffect(() => {
        loadSignals();
    }, []);

    async function loadSignals() {
        setLoading(true);
        try {
            const data = await apiRequest("/signals");
            setSignals(data.items || []);
        } catch (e) {
            console.error("Failed to load signals:", e);
        } finally {
            setLoading(false);
        }
    }

    function openDetail(signal: Signal) {
        setSelected(signal);
        setDraftReply(signal.draftReply || "");
    }

    async function updateSignal(id: string, updates: Record<string, unknown>) {
        setSaving(true);
        try {
            await apiRequest(`/signals/${id}`, {
                method: "PUT",
                body: JSON.stringify(updates),
            });
            await loadSignals();
            if (selected?.id === id) {
                setSelected((prev) => prev ? { ...prev, ...updates } as Signal : null);
            }
        } catch (e) {
            console.error("Failed to update signal:", e);
        } finally {
            setSaving(false);
        }
    }

    const filtered = filterStatus === "all"
        ? signals
        : signals.filter((s) => s.status === filterStatus);

    return (
        <div className="flex h-full">
            {/* MAIN LIST */}
            <div className={`flex-1 p-6 overflow-auto ${selected ? "hidden md:block" : ""}`}>
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <Radar className="h-6 w-6 text-primary" />
                        <h1 className="text-2xl font-bold">Signals</h1>
                        <span className="text-sm text-muted-foreground">
                            {filtered.length} signal{filtered.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                    <Button variant="outline" size="sm" onClick={loadSignals} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>

                {/* STATUS FILTER */}
                <div className="flex gap-2 mb-4">
                    {["all", "New", "Drafted", "Replied", "Dismissed"].map((s) => (
                        <Button
                            key={s}
                            variant={filterStatus === s ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFilterStatus(s)}
                        >
                            {s === "all" ? "All" : s}
                        </Button>
                    ))}
                </div>

                {loading && signals.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">Loading signals...</div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                        <Radar className="h-12 w-12 mx-auto mb-4 opacity-30" />
                        <p>No signals found.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filtered.map((signal) => (
                            <button
                                key={signal.id}
                                onClick={() => openDetail(signal)}
                                className={`w-full text-left p-4 rounded-lg border transition-colors hover:bg-muted/50 ${
                                    selected?.id === signal.id ? "border-primary bg-muted/30" : "border-border"
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    {/* Pain Score Badge */}
                                    <div className={`flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold ${
                                        signal.painScore >= 8 ? "bg-red-100 text-red-700" :
                                        signal.painScore >= 5 ? "bg-amber-100 text-amber-700" :
                                        "bg-muted text-muted-foreground"
                                    }`}>
                                        {signal.painScore}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-base">{SOURCE_ICONS[signal.source] || "🌐"}</span>
                                            <span className="font-medium truncate">{signal.title}</span>
                                            {signal.walletSignal && (
                                                <span title="Wallet signal"><Flame className="h-4 w-4 text-orange-500 shrink-0" /></span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[signal.status]}`}>
                                                {signal.status}
                                            </span>
                                            {signal.author && <span>by {signal.author}</span>}
                                            <span>{new Date(signal.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>

                                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* DETAIL SHEET (side panel) */}
            {selected && (
                <div className="w-full md:w-[480px] border-l bg-card overflow-auto">
                    <div className="sticky top-0 bg-card border-b p-4 flex items-center justify-between z-10">
                        <h2 className="font-semibold truncate">{selected.title}</h2>
                        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="p-4 space-y-6">
                        {/* META */}
                        <div className="flex flex-wrap gap-2">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[selected.status]}`}>
                                {selected.status}
                            </span>
                            <span className="px-2 py-1 rounded-full text-xs bg-muted">
                                {SOURCE_ICONS[selected.source]} {selected.source}
                            </span>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                selected.painScore >= 8 ? "bg-red-100 text-red-700" :
                                selected.painScore >= 5 ? "bg-amber-100 text-amber-700" :
                                "bg-muted text-muted-foreground"
                            }`}>
                                Pain: {selected.painScore}/10
                            </span>
                            {selected.walletSignal && (
                                <span className="px-2 py-1 rounded-full text-xs bg-orange-100 text-orange-700">
                                    <Flame className="h-3 w-3 inline mr-1" />Wallet
                                </span>
                            )}
                        </div>

                        {/* URL */}
                        <a
                            href={selected.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-primary hover:underline"
                        >
                            <Globe className="h-4 w-4" />
                            View original
                            <ExternalLink className="h-3 w-3" />
                        </a>

                        {/* ANALYSIS */}
                        <div>
                            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                                <Radar className="h-4 w-4" /> AI Analysis
                            </h3>
                            <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                                {selected.analysis}
                            </p>
                        </div>

                        {/* CONTENT SNAPSHOT */}
                        <div>
                            <h3 className="text-sm font-medium mb-2">Content Snapshot</h3>
                            <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg max-h-48 overflow-auto whitespace-pre-wrap">
                                {selected.contentSnapshot}
                            </p>
                        </div>

                        {/* DRAFT REPLY */}
                        <div>
                            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                                <MessageSquare className="h-4 w-4" /> Draft Reply
                            </h3>
                            <textarea
                                value={draftReply}
                                onChange={(e) => setDraftReply(e.target.value)}
                                rows={6}
                                className="w-full text-sm border rounded-lg p-3 resize-y bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                                placeholder="Write your reply here..."
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                className="mt-2"
                                disabled={saving}
                                onClick={() => updateSignal(selected.id, { draftReply })}
                            >
                                Save Draft
                            </Button>
                        </div>

                        {/* ACTIONS */}
                        <div className="flex gap-2 pt-4 border-t">
                            {selected.status !== "Replied" && (
                                <Button
                                    size="sm"
                                    onClick={() => updateSignal(selected.id, { status: "Replied" })}
                                    disabled={saving}
                                >
                                    Mark Replied
                                </Button>
                            )}
                            {selected.status !== "Dismissed" && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateSignal(selected.id, { status: "Dismissed" })}
                                    disabled={saving}
                                >
                                    Dismiss
                                </Button>
                            )}
                            {selected.status === "Dismissed" && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateSignal(selected.id, { status: "New" })}
                                    disabled={saving}
                                >
                                    Reopen
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
