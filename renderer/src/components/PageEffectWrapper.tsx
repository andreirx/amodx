"use client";

import dynamic from "next/dynamic";
import type { PageEffectConfig } from "@amodx/shared";

const PageEffectLayer = dynamic(
    () => import("@amodx/effects/render").then(m => ({ default: m.PageEffectLayer })),
    { ssr: false }
);

export function PageEffectWrapper({ effect }: { effect: PageEffectConfig }) {
    if (!effect || effect.type === "none") return null;
    return <PageEffectLayer effect={effect} />;
}
