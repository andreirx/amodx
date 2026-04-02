import { useEffect, useState, useRef, useCallback } from "react";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/**
 * Persistent banner showing pending CDN cache invalidation status.
 *
 * Polls GET /system/invalidation every 15 seconds. When changes are pending,
 * shows a countdown to automatic cache flush with a "GO LIVE NOW" button.
 *
 * The countdown ticks client-side every second (cosmetic, not authoritative).
 * The server timestamp is the source of truth — client drift is corrected
 * on each poll cycle.
 *
 * States:
 *   - No pending changes → banner hidden (zero DOM footprint)
 *   - Changes pending → amber banner with countdown + "GO LIVE NOW" button
 *   - Flushing → banner shows "Publishing..." (disabled button)
 *   - Flush complete → banner disappears
 */

const POLL_INTERVAL_MS = 15_000; // 15 seconds

interface InvalidationStatus {
    pending: boolean;
    lastChangeAt?: string;
    goLiveAt?: string;
}

export function InvalidationBanner() {
    const { userRole } = useAuth();
    const [status, setStatus] = useState<InvalidationStatus | null>(null);
    const [remainingMs, setRemainingMs] = useState<number>(0);
    const [flushing, setFlushing] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const data: InvalidationStatus = await apiRequest("/system/invalidation");
            setStatus(data);

            if (data.pending && data.goLiveAt) {
                const remaining = new Date(data.goLiveAt).getTime() - Date.now();
                setRemainingMs(Math.max(0, remaining));
            } else {
                setRemainingMs(0);
            }
        } catch (err) {
            // Silently fail — banner is non-critical UI
            console.warn("[InvalidationBanner] Status fetch failed:", err);
        }
    }, []);

    // Poll loop — only for GLOBAL_ADMIN to avoid wasted API calls
    useEffect(() => {
        if (userRole !== "GLOBAL_ADMIN") return;
        fetchStatus();
        pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [fetchStatus, userRole]);

    // Client-side countdown (ticks every second)
    useEffect(() => {
        if (status?.pending && remainingMs > 0) {
            timerRef.current = setInterval(() => {
                setRemainingMs(prev => {
                    const next = prev - 1000;
                    return next > 0 ? next : 0;
                });
            }, 1000);
        } else {
            if (timerRef.current) clearInterval(timerRef.current);
        }

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [status?.pending, remainingMs > 0]);

    const handleFlush = async () => {
        setFlushing(true);
        try {
            await apiRequest("/system/invalidation", { method: "POST" });
            setStatus({ pending: false });
            setRemainingMs(0);
        } catch (err) {
            console.error("[InvalidationBanner] Flush failed:", err);
        } finally {
            setFlushing(false);
        }
    };

    // Only visible to GLOBAL_ADMIN — cache infrastructure is an operational
    // detail that confuses tenant editors who don't control deployments.
    if (userRole !== "GLOBAL_ADMIN") return null;

    // Don't render anything if no pending changes
    if (!status?.pending) return null;

    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const countdown = `${minutes}:${seconds.toString().padStart(2, "0")}`;

    return (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-amber-800">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span>
                    Changes pending {remainingMs > 0
                        ? <> &mdash; going live in <span className="font-mono font-semibold">{countdown}</span></>
                        : <> &mdash; going live shortly</>
                    }
                </span>
            </div>
            <button
                onClick={handleFlush}
                disabled={flushing}
                className="px-3 py-1 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                {flushing ? "Publishing..." : "GO LIVE NOW"}
            </button>
        </div>
    );
}
