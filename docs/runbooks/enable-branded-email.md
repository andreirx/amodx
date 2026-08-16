# Runbook: enabling branded email for a commerce tenant

**Status:** procedure documented 2026-08-16; the automation (email-2a) is
DEFERRED-UNTIL-NEEDED. The FIRST commerce tenant with their own domain who wants
order/transactional mail sent from their own address triggers the email-2a build —
budget ~a scheduling conversation, not an emergency (fallback behavior is safe).

## What "branded email" means here

Today every tenant's transactional mail (order confirmations, form notifications) is
sent from the shared platform identity `contact@bijuterie.software`, with the SHOP'S
NAME as the display name (shipped 2026-08-01): customers see `"Shop Name"
<contact@bijuterie.software>`. Branded email upgrades this to `orders@theirshop.ro` —
DKIM-signed as the tenant's own domain.

## What exists vs what email-2a must build

| Piece | State |
|---|---|
| Display-name branding | SHIPPED (all six send sites) |
| DNS checker UI (expected-vs-published, per record) | SHIPPED (email-2, Settings→Email) |
| Per-tenant `sendFromDomain` field + verification state machine | NOT BUILT (email-2a) |
| SES identity creation per tenant + send-site switch-over | NOT BUILT (email-2a) |
| Reply-To handling | DEFERRED until a reply-address contract exists (D-EMAIL-6.4) |

**Important:** branded sending CANNOT be enabled today by configuration alone — the six
send sites read the platform identity; per-tenant sending requires email-2a's code.
This runbook documents the full procedure so scoping/selling it is concrete.

## The procedure (once email-2a exists)

### Admin (agency) side
1. In the tenant's settings, set `sendFromDomain` (e.g. `theirshop.ro` or
   `mail.theirshop.ro`) + the local part (e.g. `orders`). This is a DEDICATED field —
   never the routing `domain` (ratified D-EMAIL-1: editing site routing must not break
   mail identity).
2. AmodX creates the SES email identity for that domain (email-2a automates via SES
   API; until then it would be manual in the AWS console — but see "Cannot be enabled
   today" above). SES generates **3 DKIM CNAME records**.
3. The tenant's Settings→Email page now shows those 3 CNAMEs + an SPF TXT
   (`include:amazonses.com`) + a recommended DMARC TXT — in the SAME
   expected-vs-published checker UI shipped in email-2.

### Tenant side
4. Publish the shown records in their DNS (wherever their domain is managed — the
   email-2 provider recipes page already teaches this workflow). NOTE: these records
   coexist with their mailbox provider's records (different selectors/hosts); nothing
   about their existing mailboxes changes. If their domain already has an SPF record,
   the SES include is ADDED to it (one SPF record per domain — the checker warns).

### Automatic from there
5. SES polls DNS; the identity moves `pending → verified` (typically minutes-to-hours).
   The tenant's Email page shows the state.
6. On `verified`, AmodX switches that tenant's sends to the branded identity. Until
   then — and any time verification LAPSES — sends FALL BACK to the platform identity
   automatically: mail never breaks mid-setup (ratified lifecycle, D-EMAIL-1).
7. The deliverability health card (email-3, builds with/after email-2a) shows ongoing
   DKIM/DMARC status per tenant.

## What the customer's customer sees

Before: `"Biju Shop" <contact@bijuterie.software>` — after: `"Biju Shop"
<orders@bijushop.ro>`, DKIM-aligned with the shop's domain (better inbox placement,
brand-consistent). Replies: NOT configured (deferred) — replies go wherever the
receiving mail client sends them (the From address, which the tenant must be told may
not be monitored) until Reply-To ships with an explicit tenant-configured address.

## Costs & cautions
- SES per-identity cost: none for identities themselves at this scale; sending costs
  are negligible at current volume (~0-2 sends/day account-wide).
- The SES account is shared with the business's CRM app (mocheta.com — internal, by
  design): one suppression list, one reputation, one quota across both. A bounce storm
  in either affects both. Revisit isolation only if volumes conflict.
- Tenant DNS mistakes are the main support surface — the checker UI exists precisely
  to make expected-vs-published visible.
