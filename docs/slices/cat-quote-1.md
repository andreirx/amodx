# CAT-QUOTE-1 — "Cere ofertă" on every catalog product, and one place for the tenant's contact channels (SPEC, draft)

Status: **RATIFIED 2026-11-01** (human: CQ-D1 = A, CQ-D2 = A; § 6). Facts read in the tree at `215ee53`.

## 1. The human's direction (2026-11-01, quoted)

> "we need an immediate "cere oferta" button on each product that should provide a mailto, whatsapp and call number
> options in a popup (all of which are probably also needed in the commerce settings), and we can also keep the add
> to list "ma intereseaza" but in a low key way, with their list and contact put in an email towards the admin or
> commercial email address or whatever we have per tenant."

## 2. Facts (OBSERVED)

| Fact | Where |
|---|---|
| The tenant's contact channels are stored in four places, none complete: Top Bar `quickContactPhone` / `quickContactEmail` (every site); Commerce Bar `phone`, `whatsappNumber`, `ctaButton {text,url}` (shops only, `commerceBar.enabled && commerceEnabled`); the floating Quick contact `{ type: phone\|whatsapp\|email, value, label }` (one channel); Notifications `integrations.contactEmail`, `orderProcessingEmail`. | `packages/shared/src/index.ts:115-128, 130-146, 450-451, 1031-1037`; `renderer/src/app/[siteId]/layout.tsx:165-170, 175-190, 285-290` |
| The floating Quick contact already builds the three link kinds: `tel:`, `https://wa.me/<digits>`, `mailto:`. | `renderer/src/components/QuickContact.tsx:15-18` |
| The catalog product page slot holds the variant presenter, the "Mă interesează" toggle (page variant) and the spec table. | `renderer/src/components/SitePage.tsx:1116-1124` |
| The interest list's submission is e-mailed to `integrations.contactEmail`; no address → stored, logged, no mail. The mail holds the items and the visitor's name, e-mail, phone, message. | `backend/src/interest/public.ts:33, 277-299`; `docs/slices/cat-interest-1.md` § 2 item 6 |
| The interest texts are catalog keys in the tenant locale table (Labels → Catalog → Interest list). | `packages/shared/src/index.ts:814-830` |

## 3. The design

1. **One "Contact channels" card in Settings** (every site kind): phone, WhatsApp number, e-mail for visitors.
   Stored as `contactChannels: { phone?, whatsapp?, email? }` on the tenant. The Top Bar, the Commerce Bar and the
   Quick contact keep their own fields and bytes (no live site changes); each gets a one-line note "defaults from
   Contact channels when empty" — a later cleanup can retire the copies once every tenant has moved. Reason: a
   migration of the four stores is not needed for the feature and would touch every live tenant's record.
2. **"Cere ofertă ↗" on the catalog product page**, above the variant presenter: a button that opens a small dialog
   with up to three actions — Call (`tel:`), WhatsApp (`wa.me`, the message pre-filled with the product title and
   the selected variant), E-mail (`mailto:` with subject = the product title, body = the product URL and the variant).
   A channel with no value is not shown; no channel at all → the button is not rendered. The texts (button, dialog
   title, the three actions, the pre-filled message) are new catalog keys in the locale table, RO values proposed in
   the packet. The same component is offered to shops as an opt-in later (not here: the commerce product page's slot is
   the cart button; a second button there is a product decision for the human).
3. **"Mă interesează" low-key**: the page toggle becomes a text link under the "Cere ofertă" button (same component,
   `variant="link"`); the card toggle on the listings stays as it is (it is already small). The interest widget in
   the header stays.
4. **The list's e-mail destination**: a setting on the Contact channels card, "Send interest lists to": the visitor
   e-mail (default, = today's `contactEmail` behaviour) or a separate address (`interestListEmail`). The mail body is
   unchanged (items + contact). No platform fallback (as ratified).

## 4. Decisions

- **CQ-D1 — one card and a new field vs reuse of the scattered fields.** PROBLEM: the three channels exist but in
  four partial stores. OPTIONS: **A** a new `contactChannels` store + the card; the bars and the quick contact fall
  back to it when their own field is empty (REWARD: one place to fill for a new tenant, no live record migrated;
  RISK: a fifth store until the cleanup). **B** the popup reads the existing fields in a fixed order (commerce bar →
  top bar → quick contact → notifications) (REWARD: no schema change; RISK: a catalog has no commerce bar, so the
  WhatsApp number has no home at all without A). RECOMMENDED: A.
- **CQ-D2 — the popup on shops.** PROBLEM: the human says the channels are "probably also needed in the commerce
  settings". OPTIONS: **A** the card is for every site now; the product-page button is catalog-only in this slice
  (REWARD: no change to povesti's product page bytes; RISK: a shop wants it later → a small follow-up). **B** the
  button on shops too, opt-in per tenant (REWARD: one slice; RISK: a new element on the commerce product page needs
  the byte-identity proof and a placement decision next to the cart button). RECOMMENDED: A.

## 5. Allocation (packet, after ratification)

shared: the schema fields and the catalog keys (+ RO); renderer: `SitePage.tsx` (catalog slot), a new
`QuoteRequest.tsx` client component, `app/[siteId]/layout.tsx` (fallbacks, bytes unchanged when the own fields are
set — proven by the shop byte-identity suite), `InterestShortlist.tsx` (`variant="link"`); backend:
`interest/public.ts` (the destination), `tenant/settings.ts` (limits); admin: `Settings.tsx` (the card), Labels
(the keys); tests; the record. Non-scope: the four existing stores' removal.

## 6. Ratification (2026-11-01)

Human, verbatim: "A, A, …" — CQ-D1 = A (a `contactChannels` store + the Contact channels card; the bars and the quick
contact fall back to it), CQ-D2 = A (the product-page button catalog-only in this slice; the card for every site).
Queue: after `cat-import-gallery-1`, before `cat-theme-1`.
