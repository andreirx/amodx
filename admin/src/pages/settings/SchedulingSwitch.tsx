// Settings page: the Scheduling card (the switch and the time zone).
// A new setting of this section goes in this file. Moved from Settings.tsx by REFACTOR-SETTINGS-1 (moves only).
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import type { SettingsDraft } from "./draft";

/** The "Scheduling" card: the switch and, when on, the time zone (editable by an admin only). */
export function SchedulingSwitchCard({ config, setConfig, isAdmin }: { config: SettingsDraft; setConfig: (c: SettingsDraft) => void; isAdmin: boolean }) {
    return (
        <Card data-scheduling-switch>
            <CardHeader>
                <CardTitle>Scheduling</CardTitle>
                <CardDescription>Enable individual appointments, confirmed by an emailed link.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={config.schedulingEnabled === true} disabled={!isAdmin}
                        onChange={e => setConfig({ ...config, schedulingEnabled: e.target.checked })}
                        className="rounded border-input h-5 w-5" />
                    <span className="font-medium text-sm">Enable scheduling</span>
                </label>
                {config.schedulingEnabled === true && (
                    <div className="space-y-2">
                        <Label htmlFor="settings-scheduling-timezone">Scheduling time zone</Label>
                        <Input id="settings-scheduling-timezone" value={config.scheduling?.timezone ?? ""} disabled={!isAdmin}
                            placeholder="Europe/Bucharest"
                            onChange={e => setConfig({ ...config, scheduling: { ...config.scheduling, timezone: e.target.value } })} />
                        <p className="text-xs text-muted-foreground">Required to turn scheduling on; use an IANA time zone such as Europe/Bucharest.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
