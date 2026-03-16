# @amodx/effects — Internal Architecture

GPU effect system for AMODX. Provides WebGPU-based visual effects (backgrounds, glows, celebrations) as composable React components with automatic capability detection and graceful degradation.

## Entry Points

| Import Path | Contents | Safe For |
|-------------|----------|----------|
| `@amodx/effects` | Types, metadata, detection | All (admin, renderer, 3rd party) |
| `@amodx/effects/render` | EffectCanvas, GlowCanvas, PageEffectLayer | Renderer + plugin render only |
| `@amodx/effects/celebration` | CelebrationOverlay | Renderer only |

## File Map

```
src/
  index.ts              Root entry — re-exports types, metadata, detection
  types.ts              EffectPipeline interface, EffectMetadata, PipelineConfig
  metadata.ts           EFFECT_LIST — static array, manually maintained
  detection.ts          detectGpuTier() — lazy cached, SSR-safe
  render.ts             "use client" — EffectCanvas, GlowCanvas, PageEffectLayer
  celebration.ts        "use client" — CelebrationOverlay (self-contained lifecycle)

  shaders/
    index.ts            Barrel export
    aurora.ts           Aurora Borealis WGSL (noise-based flowing bands)
    plasma.ts           Plasma Globe WGSL (midpoint displacement arcs + bloom)
    caustics.ts         Water Caustics WGSL (Voronoi noise)
    glow.ts             HDR Glow WGSL (button bloom + arcs)
    confetti.ts         Confetti WGSL (compute + render pipeline)

  pipelines/
    index.ts            Barrel export
    map.ts              PIPELINE_MAP — static factory map, manually maintained
    base.ts             Shared GPU utilities (hex→float, surface config, etc.)
    (aurora.ts)         Pipeline implementations added per effect
```

## Adding a New Effect

1. Create shader: `src/shaders/myeffect.ts` — export WGSL as string constant
2. Create pipeline: `src/pipelines/myeffect.ts` — implement EffectPipeline interface
3. Register in `src/pipelines/map.ts` — add to PIPELINE_MAP
4. Register in `src/metadata.ts` — add to EFFECT_LIST
5. Export shader in `src/shaders/index.ts`

## GPU Capability Tiers

| Tier | Detection | Glow Multiplier | Canvas Format |
|------|-----------|-----------------|---------------|
| hdr-edr | display-p3 + rgba16float + extended tone mapping | 6.4x | rgba16float |
| hdr-srgb | display-p3, no extended luminance | 3.0x | preferred + display-p3 |
| sdr | Standard WebGPU | 1.0x | preferred + srgb |
| none | No WebGPU or prefers-reduced-motion | N/A | CSS fallback |

## Key Invariants

- Detection is **lazy** — only runs when an effect component first mounts
- Detection is **cached** at module level — one probe per page load max
- Each EffectCanvas owns its own GPUDevice — no shared state
- IntersectionObserver gates GPU init — off-screen effects don't run
- `prefers-reduced-motion` → tier = 'none' → no GPU work, no canvas
- All schema defaults are "none"/"false" → zero impact on existing sites

## Dependencies

Depends on: `@amodx/shared` (DTO types only)
Depended on by: `@amodx/plugins` (metadata import for admin dropdowns), `renderer` (render components)
