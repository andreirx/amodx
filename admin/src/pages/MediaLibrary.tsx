import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { useTenant } from "@/context/TenantContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Image as ImageIcon, Copy, Film } from "lucide-react";
import { classifyMedia } from "@amodx/shared";

export default function MediaLibrary() {
    const { currentTenant } = useTenant();
    const [assets, setAssets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (currentTenant) loadAssets();
    }, [currentTenant?.id]);

    async function loadAssets() {
        setLoading(true);
        try {
            const res = await apiRequest("/assets");
            setAssets(res.items);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    if (!currentTenant) return <div>Select a site</div>;
    if (loading) return <div className="p-8"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="p-8 space-y-6">
            <h1 className="text-3xl font-bold">Media Library</h1>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {assets.map((asset) => {
                    const kind = classifyMedia(asset);
                    const url = asset.publicUrl || asset.url;

                    return (
                        <Card key={asset.id} className="group relative overflow-hidden">
                            <div className="aspect-square bg-muted flex items-center justify-center relative">
                                {kind === "image" ? (
                                    <img src={url} alt={asset.fileName || asset.filename} className="w-full h-full object-cover" />
                                ) : kind === "video" ? (
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gray-900">
                                        <Film className="h-8 w-8 text-gray-400" />
                                        <span className="text-[10px] text-gray-400 font-medium uppercase">Video</span>
                                    </div>
                                ) : (
                                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                )}

                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    <Button size="icon" variant="secondary" onClick={() => navigator.clipboard.writeText(url)}>
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                            <div className="p-2 text-xs truncate font-medium border-t">
                                {asset.fileName}
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}
