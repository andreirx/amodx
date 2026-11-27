// Settings page: the colour field of the theme palette and the header and footer colours.
// Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Input } from "@/components/ui/input";

export function ColorInput({ label, value, onChange }: { label: string, value?: string, onChange: (v: string) => void }) {
    return (
        <div className="flex items-center gap-2">
            <div className="relative w-8 h-8 rounded-full overflow-hidden border shadow-sm shrink-0">
                <input type="color" className="absolute inset-0 w-[150%] h-[150%] -translate-x-1/4 -translate-y-1/4 cursor-pointer p-0 border-0" value={value || "#ffffff"} onChange={e => onChange(e.target.value)} />
            </div>
            <div className="flex-1">
                <Input className="h-8 text-xs font-mono uppercase" value={value || ""} onChange={e => onChange(e.target.value)} />
            </div>
            <span className="text-[10px] text-muted-foreground w-16 text-right truncate">{label}</span>
        </div>
    );
}
