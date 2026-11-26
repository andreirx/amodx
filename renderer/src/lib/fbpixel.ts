/**
 * Sends events only when window.fbq exists (the loader can queue before the SDK arrives).
 * FBPixelLoader (mounted by FBPixel) installs it only after marketing consent. Events before that are dropped, not replayed.
 * This presence check does not unload an already installed pixel or implement consent revocation.
 */

declare global {
    interface Window {
        fbq?: (...args: any[]) => void;
    }
}

export function trackFBEvent(eventName: string, params?: Record<string, any>) {
    if (typeof window !== "undefined" && window.fbq) {
        window.fbq("track", eventName, params);
    }
}
