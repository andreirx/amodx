import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Lock, Upload } from "lucide-react";

export default function Resources() {
    const { currentTenant } = useTenant();
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (currentTenant) loadResources();
    }, [currentTenant?.id]);

    async function loadResources() {
        setLoading(true);
        try {
            const res = await apiRequest("/resources/list");
            setItems(res.items);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        if (!e.target.files?.[0]) return;
        setUploading(true);
        const file = e.target.files[0];

        try {
            // Custom Upload Logic for Private Resources
            const res = await apiRequest('/resources/upload', {
                method: 'POST',
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type,
                    size: file.size
                })
            });

            await fetch(res.uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type }
            });

            await loadResources(); // Refresh
        } catch (err: any) {
            alert("Upload failed");
        } finally {
            setUploading(false);
        }
    }

    if (!currentTenant) return <div className="p-8 text-muted-foreground">Select a site.</div>;

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Private Resources</h1>
                    <p className="text-muted-foreground">Gated content for lead magnets and products.</p>
                </div>
                <div className="relative">
                    <Button disabled={uploading}>
                        {uploading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Upload className="mr-2 h-4 w-4" />}
                        Upload File
                    </Button>
                    <input
                        type="file"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={handleUpload}
                    />
                </div>
            </div>

            {loading ? (
                <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {items.map((item) => (
                        <Card key={item.id} className="group relative overflow-hidden bg-card border-border">
                            <div className="p-4 flex items-start gap-4">
                                <div className="bg-purple-100 p-3 rounded-lg text-purple-600">
                                    <Lock className="w-6 h-6" />
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <p className="font-medium truncate" title={item.fileName}>{item.fileName}</p>
                                    <p className="text-xs text-muted-foreground mt-1">{new Date(item.createdAt).toLocaleDateString()}</p>
                                </div>
                            </div>
                            <div className="bg-muted/30 p-2 border-t flex justify-between items-center">
                                <span className="text-xs font-mono text-muted-foreground px-2">ID: {item.id.substring(0,8)}...</span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        navigator.clipboard.writeText(item.id);
                                        alert("Resource ID Copied! Paste this into Lead Magnet blocks.");
                                    }}
                                >
                                    <Copy className="h-4 w-4 mr-2" /> Copy ID
                                </Button>
                            </div>
                        </Card>
                    ))}
                    {items.length === 0 && (
                        <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl text-muted-foreground">
                            No private resources uploaded.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
