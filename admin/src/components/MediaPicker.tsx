import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Image as ImageIcon, Film } from "lucide-react";
import { classifyMedia, matchesMediaFilter } from "@amodx/shared";

interface MediaPickerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (url: string) => void;
    /** Filter assets by media type. Default: "all". */
    mediaType?: "image" | "video" | "all";
}

export function MediaPicker({ open, onOpenChange, onSelect, mediaType = "all" }: MediaPickerProps) {
    const [assets, setAssets] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open && assets.length === 0) {
            loadAssets();
        }
    }, [open]);

    async function loadAssets() {
        setLoading(true);
        try {
            const res = await apiRequest("/assets");
            setAssets(res.items || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    const filtered = assets.filter(a => matchesMediaFilter(a, mediaType));
    const titleLabel = mediaType === "image" ? "Select Image" : mediaType === "video" ? "Select Video" : "Select Media";
    const emptyLabel = mediaType === "image"
        ? "No images found. Upload some in the Media Library first."
        : mediaType === "video"
            ? "No videos found. Upload some in the Media Library first."
            : "No media found. Upload some in the Media Library first.";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{titleLabel}</DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-1 min-h-0 border rounded-md bg-muted/10">
                    {loading ? (
                        <div className="flex h-full items-center justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 p-4">
                            {filtered.map((asset) => {
                                const kind = classifyMedia(asset);
                                const url = asset.publicUrl || asset.url;

                                return (
                                    <button
                                        key={asset.id}
                                        className="group relative aspect-square border rounded-lg overflow-hidden hover:ring-2 ring-primary focus:outline-none focus:ring-2"
                                        onClick={() => {
                                            onSelect(url);
                                            onOpenChange(false);
                                        }}
                                    >
                                        {kind === "image" ? (
                                            <img
                                                src={url}
                                                alt={asset.fileName || asset.filename}
                                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                            />
                                        ) : kind === "video" ? (
                                            <div className="w-full h-full flex flex-col items-center justify-center bg-muted gap-2">
                                                <Film className="w-8 h-8 text-muted-foreground" />
                                                <span className="text-[10px] text-muted-foreground font-medium">Video</span>
                                            </div>
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center bg-muted">
                                                <ImageIcon className="w-8 h-8 text-muted-foreground" />
                                            </div>
                                        )}
                                        <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1 text-[10px] text-white truncate text-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            {asset.fileName || asset.filename}
                                        </div>
                                    </button>
                                );
                            })}
                            {filtered.length === 0 && (
                                <div className="col-span-full py-10 text-center text-muted-foreground">
                                    {emptyLabel}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
