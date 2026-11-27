import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Image as ImageIcon, Film, Check } from "lucide-react";
import { classifyMedia, matchesMediaFilter } from "@amodx/shared";

/**
 * The picker's two modes (GALLERY-1, ruling 5), one per callback, so a caller names exactly one:
 *  - `onSelect`: one click picks one asset and closes the picker (every caller before GALLERY-1; unchanged);
 *  - `onSelectMany`: clicks mark and unmark assets; "Add" gives the marked addresses in the order they were marked and
 *    closes the picker (the gallery block, through `BlockEditor`'s `pickManyFn`).
 */
type MediaPickerProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Filter assets by media type. Default: "all". */
    mediaType?: "image" | "video" | "all";
} & (
    | { onSelect: (url: string) => void; onSelectMany?: never }
    | { onSelectMany: (urls: string[]) => void; onSelect?: never }
);

/** `marked` with `url` added at the end, or removed when it is already marked. */
function toggledMark(marked: string[], url: string): string[] {
    return marked.includes(url) ? marked.filter((u) => u !== url) : [...marked, url];
}

export function MediaPicker({ open, onOpenChange, onSelect, onSelectMany, mediaType = "all" }: MediaPickerProps) {
    const [assets, setAssets] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [marked, setMarked] = useState<string[]>([]);

    useEffect(() => {
        if (open && assets.length === 0) {
            loadAssets();
        }
        if (open) setMarked([]);   // each opening of the multi-select mode starts with nothing marked
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
    const titleLabel = onSelectMany
        ? (mediaType === "image" ? "Select Images" : mediaType === "video" ? "Select Videos" : "Select Media")
        : (mediaType === "image" ? "Select Image" : mediaType === "video" ? "Select Video" : "Select Media");
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
                                const position = marked.indexOf(url);

                                return (
                                    <button
                                        key={asset.id}
                                        aria-pressed={onSelectMany ? position >= 0 : undefined}
                                        className={`group relative aspect-square border rounded-lg overflow-hidden hover:ring-2 ring-primary focus:outline-none focus:ring-2${position >= 0 ? " ring-2" : ""}`}
                                        onClick={() => {
                                            if (onSelectMany) {
                                                setMarked((m) => toggledMark(m, url));
                                                return;
                                            }
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
                                        {position >= 0 && (
                                            <span className="absolute right-1 top-1 flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
                                                <Check className="h-3 w-3" aria-hidden="true" />{position + 1}
                                            </span>
                                        )}
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
                {onSelectMany && (
                    <DialogFooter>
                        <Button
                            type="button"
                            disabled={marked.length === 0}
                            onClick={() => {
                                onSelectMany(marked);
                                onOpenChange(false);
                            }}
                        >
                            {marked.length === 1 ? "Add 1 item" : `Add ${marked.length} items`}
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
