# CACHE-4b: Tag-based ISR revalidation — listing pages refresh when their content changes

- **Status:** WITHDRAWN 2026-08-08 (human) — the freshness gap it targeted is closed to an acceptable degree by cache-7 (SWR self-heal, seconds) + cache-4a (instant path purge). Tag-precision "refresh every page showing X" is not worth the OpenNext dependency; opennext-1 stays a pure image fix. Original block reason below stands as the technical record.
- **Superseded status:** BLOCKED-DEFERRED 2026-08-07 — OpenNext 3.1.3 does not persist custom tags
  for App Router full-route cache entries (`generateStaticParams()=>[]` routes produce
  APP_PAGE entries; `adapters/cache.js:209-213` derives tags only for FETCH/legacy PAGE).
  So `revalidateTag()` has no path mapping to resolve — the mechanism is INERT on the
  installed adapter, verified in node_modules source. Building it would be dormant
  capability + false "it refreshes" assurance (VISION violation). Re-attempt AFTER
  opennext-1 upgrades the adapter and its App Router tag behavior is re-verified.
- **Track:** CACHE (implementation wave slice 3)
- **Depends:** cache-4a (committed); cache-7 (SHIPPED — background revalidation works)

## The gap this closes

cache-2 purges the CHANGED page precisely; cache-7 made SWR grid pages self-heal on a
short timer. What's still missing is the direct edge: "this product/article changed →
refresh every page that RENDERS it" — listing pages, category showcases, post grids on
arbitrary pages. Today they heal by timer (grids) or nightly (everything else). The
tag-cache DynamoDB table + /api/revalidate tag support + revalidateTag() have been
provisioned-but-unused since the original design (doc §Known Gaps 5).

## Scope

1. Renderer: when a cacheable page render consumes a collection (getPosts w/ tag,
   getProductsByCategory, getActiveProducts, reviews), TAG the page (Next cacheTag /
   OpenNext tag cache) with structured tags: `posts:<tenantId>:<tag>`,
   `products:<tenantId>:<categoryId>`, `product:<tenantId>:<productId>`,
   `reviews:<tenantId>:<productId>`. Enumerate every collection-consuming render path
   from SitePage.tsx (OBSERVED file:line list) — the tag vocabulary is the contract,
   document it in caching-architecture.
2. Backend: content/product/category/review mutations call revalidateTag() with the
   affected tags (alongside the cache-4a path invalidation). The existing
   revalidateTag helper is dead code today — wire it; renderer /api/revalidate tag
   branch already exists.
3. Interaction with cache-4a: tag purge refreshes ISR; the page's CloudFront path may
   still be edge-cached — decide + document the Layer-1 story for tag-derived
   refreshes (candidate: tag resolution yields the affected PATHS via the tag table,
   and those paths join the cache-4a fast lane; if path resolution from tags is not
   available in open-next 3.1.3's tag cache, STOP and report the measured options).
4. Verify against the INSTALLED open-next 3.1.3 tag-cache implementation (DDB table
   schema, what revalidateTag actually writes/reads) — source-cited, not assumed.
5. Serving-contract suite: add tag-refresh assertions (edit → tagged listing page
   serves fresh) to test:serving.

## Non-scope

Per-tenant distributions; SVG/anything REV; no CDK (the tag table exists — if any
infra change is needed, STOP and surface).

## DoD / evidence

Tag vocabulary table (OBSERVED render paths); unit tests for tag derivation; serving
suite green incl. new assertions; mutation check (untag a path → assertion fails);
operator staging probe: edit a product → category page fresh within seconds.
