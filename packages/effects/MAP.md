# @amodx/effects — Internal Architecture

GPU effect system for AMODX. Provides WebGPU-based visual effects as composable React components with automatic capability detection and graceful degradation.

## Unified Effect Architecture

Any effect type (aurora, plasma, caustics, cellular, clouds, glow) can be applied in any context:
- **Background**: opaque canvas behind content (z-0). Used by `LazyEffectCanvas` in plugin render components.
- **Button overlay**: opaque canvas behind a semi-transparent button. Used by `ButtonEffectWrap` in plugin render components. The button's `bg-primary` becomes `bg-primary/85` when the effect is active (controlled via `--btn-bg-alpha` CSS variable). Text gets stroke + shadow protection via `--btn-text-stroke`.
- **Page-level**: full-viewport fixed canvas behind all page content. Used by `PageEffectWrapper` in renderer layout.

The compositing mode is a **wrapper concern**, not an effect concern. The `EffectCanvas` component is the same in all three contexts.

## Entry Points

| Import Path | Contents | Safe For |
|-------------|----------|----------|
| `@amodx/effects` | Types, metadata, detection | All (admin, renderer, 3rd party) |
| `@amodx/effects/render` | EffectCanvas, PageEffectLayer | Renderer + plugin render only |
| `@amodx/effects/celebration` | CelebrationOverlay | Renderer only |

## File Map

```
src/
  index.ts              Root entry — re-exports types, metadata, detection
  types.ts              EffectPipeline interface, EffectMetadata, PipelineConfig
  metadata.ts           EFFECT_LIST — static array, manually maintained
  detection.ts          detectGpuTier() — lazy cached, SSR-safe
  render.tsx            "use client" — EffectCanvas (unified), PageEffectLayer
  celebration.ts        "use client" — CelebrationOverlay (self-contained lifecycle)

  shaders/
    index.ts            Barrel export
    aurora.ts           Aurora Borealis WGSL (noise-based flowing bands)
    plasma.ts           Plasma Globe WGSL (midpoint displacement arcs + bloom)
    caustics.ts         Water Caustics WGSL (Voronoi noise)
    glow.ts             HDR Caustics WGSL (domain-warped simplex noise)
    cellular.ts         Cellular Noise WGSL (Voronoi cells)
    clouds.ts           Clouds WGSL (domain-warped fractal noise)
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
4. Register in `src/metadata.ts` — add to EFFECT_LIST with `scopes: ["background", "button"]`
5. Export shader in `src/shaders/index.ts`

Effect is immediately available in both background and button dropdowns. No render component changes needed.

## EffectCanvas Props

| Prop | Type | Default | Purpose |
|------|------|---------|---------|
| `effect` | `EffectConfig \| PageEffectConfig` | required | Effect configuration |
| `className` | `string` | `""` | Extra CSS class on container div |
| `pointerMode` | `"canvas" \| "document"` | `"canvas"` | Canvas-level (backgrounds) or document-level (button overlays) pointer tracking |
| `onActive` | `(active: boolean) => void` | — | Fires when pipeline activates/deactivates. Used by ButtonEffectWrap for fallback. |

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
- `onActive(true)` only fires after successful pipeline init — pixel-perfect fallback

## Backward Compatibility

Old blocks store `glow: { enabled, color, intensity }`. New blocks store `buttonEffect: { type, colors, speed, intensity, ... }`. The `resolveButtonEffect()` helper in `@amodx/plugins/common` normalizes both formats for render components. On next admin save, the block self-heals to the new format.

## Dependencies

Depends on: `@amodx/shared` (DTO types only)
Depended on by: `@amodx/plugins` (metadata import for admin dropdowns), `renderer` (render components)
