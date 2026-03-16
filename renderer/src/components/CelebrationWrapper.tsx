"use client";

import dynamic from "next/dynamic";

const CelebrationOverlay = dynamic(
    () => import("@amodx/effects/celebration").then(m => ({ default: m.CelebrationOverlay })),
    { ssr: false }
);

export function CelebrationWrapper() {
    return <CelebrationOverlay />;
}
