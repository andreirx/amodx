/**
 * Lazy-loaded effect canvas for block background effects.
 *
 * Uses React.lazy to ensure @amodx/effects GPU code (shaders, pipelines,
 * WebGPU lifecycle) is only bundled into a separate chunk. The chunk is
 * downloaded ONLY when a block actually has an effect configured.
 *
 * If effect is "none", null, or undefined — renders nothing and the
 * dynamic import never fires. Zero impact on pages without effects.
 *
 * This component is imported by plugin render components (SSR context).
 * React.lazy + Suspense works correctly across the server/client boundary:
 * on the server, the "use client" module is serialized as a client reference;
 * on the client, the chunk loads and hydrates.
 */

import React, { Suspense, lazy } from "react";
import type { EffectConfig } from "@amodx/shared";

const EffectCanvas = lazy(() =>
    import("@amodx/effects/render").then(m => ({ default: m.EffectCanvas }))
);

export function LazyEffectCanvas({ effect }: { effect?: EffectConfig | null }) {
    if (!effect || effect.type === "none") return null;

    return (
        <Suspense fallback={null}>
            <EffectCanvas effect={effect} />
        </Suspense>
    );
}
