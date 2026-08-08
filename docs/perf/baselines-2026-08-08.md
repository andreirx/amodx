# Performance baselines — 2026-08-08 (reference measurement)

Method: local Lighthouse (same engine as pagespeed.web.dev) via the repo's Playwright
Chromium; mobile emulation, simulated throttling; pages warmed (2 requests) before
measurement so the CACHED serving path is what is measured. Command pattern recorded in
the session; rerun the same way for comparable numbers.

**Measurement rules (tenant-facing guidance):**
- ALWAYS benchmark the live domain — `/_site/` (preview) and `/tenant/` (test mode) are
  deliberately uncached and can never score well by design.
- Run twice; first run pays cold-cache warming.

| Site | Score | FCP | LCP | TBT | CLS | Transfer |
|---|---|---|---|---|---|---|
| bijup.com | 79 | 1.5 s | 4.6 s | 240 ms | 0.004 | Total size was 1,165 KiB |
| blog.bijup.com | 77 | 1.5 s | 4.9 s | 240 ms | 0.021 | Total size was 1,235 KiB |
| amodx.net | 73 | 0.9 s | 7.0 s | 230 ms | 0.03 | Total size was 1,435 KiB |

## Platform findings (identical across all three sites)

1. **Serving is healthy**: FCP <=1.5s (cache track working), CLS ~0, TBT ~240ms.
2. **LCP is the drag everywhere (4.6-7.0s vs 2.5s target)**: hero images ship at upload
   size; the image optimizer is broken/PARKED (opennext-1) — this baseline is the first
   quantified cost of that parking. Interim lever: author-side image discipline.
3. **~1s unused JavaScript on every site** → `perf-1` (platform-wide code-splitting;
   this benchmark is its before/after gate).
