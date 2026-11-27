# What a move of satulbanului to AMODX needs — DRAFT PLAN

Copied 2026-11-18 from `satulbanului/docs/amodx-slices/README.md` (written by the satulbanului session). Status:
**draft, not ratified**. The move itself is not decided; this file and its four slice drafts exist so that the
gaps are on record if a multi-language content site is taken on.

Evidence basis: one read-only pass over the amodx sources on 2026-11-18 (`main` at `3388999`). A builder reads
each `file:line` again before relying on it. Nothing was run against staging or production.

## The gaps and what closes each one

| Gap for this site | Closed by | Size | Needs a ruling first |
|---|---|---|---|
| Photo galleries with a viewer (25 gallery pages, about 1,100 photos) | `docs/slices/gallery-1.md` | small, plugin-local | no |
| The 17 old WordPress addresses must redirect | `docs/slices/redirect-1.md` | small, one backend route pair | no |
| Four languages on one domain, `hreflang`, a menu per language | `docs/slices/lang-1.md` (specification, then 4 build slices) | large, touches the renderer of every live tenant | **yes — LANG1-SCOPE; it changes a ratified statement of `locale-1.md`** |
| Booking a room for a date range | `docs/slices/stay-1.md` (A: request form now; B: amendment to Track D) | A: small; B: behind Tracks B and C | **yes — STAY1-GUEST-IDENTITY, STAY1-PRICE** |

Order proposed by the draft: `gallery-1` → `redirect-1` → `stay-1` part A → `lang-1`. The first three are useful
to every tenant and carry no ruling. `lang-1` decides if this site can move at all.

## Recorded without a slice

- **Trailing slash.** Next answers `/x/` with a 308 to `/x` before the middleware runs
  (`renderer/test/serving-bundle/bundle.test.mjs:492-493`). The canonical address on AMODX has no end slash
  (`normalizePageAddressOrKeepRaw`, `renderer/src/components/site-page/addresses.ts`). One permanent redirect per old address is normal for search engines.
  `trailingSlash: true` would change every address of every live tenant. Not proposed.
- **Photo sizes.** The image optimiser is parked (OPENNEXT1-IMAGE = A). The site's photos are already converted
  to two widths; `gallery-1` stores both addresses per photo. No platform image pipeline is needed for this site.
- **Import.** The site's pages exist as blocks in `satulbanului/content/site.json`. The move is a script in that
  repository that writes pages through the AMODX API or the MCP server. The WordPress importer does not fit
  (flattens addresses `backend/src/import/wordpress.ts:194-195`, posts and pages only, no language).
- **Structured data.** `SitePage` (`SitePage.tsx`, the schema generator) writes one JSON-LD object per page from `schemaType`.
  `LodgingBusiness`, `HotelRoom`, `TouristAttraction`, `FAQPage` and breadcrumbs are not there. No slice yet.
- **Static HTML track.** `docs/plan-static-html-pages.md` serves uploaded HTML in a sandboxed frame. A framed
  page is not indexed as the tenant's own page, so that track does not fit a site that lives from search.

## Update 2026-11-20 (human)

- Languages: LANG1-SCOPE = A (`docs/slices/lang-1.md` § 8).
- Booking: an external booking service integrated in the site (`docs/slices/booking-embed-1.md`); `stay-1` part
  B withdrawn.
- The joint order with the second client's slices: `docs/plan-courses-group-sessions.md` § 5.
