/**
 * FB Pixel helper — safely fires events only when the pixel SDK is loaded
 * (respects cookie consent since FBPixel component only loads when consent is given).
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
