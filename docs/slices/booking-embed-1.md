# BOOKING-EMBED-1 — a guesthouse page shows an external booking service

Status: **PLANNED (draft 2026-11-20, not ratified) — the service is not named yet (BOOKING-SERVICE)**. Track:
content. Depends: none. Named client: satulbanului. Replaces `stay-1` part B by the human's direction
(2026-11-20): room booking is done by an existing service that the site integrates; AMODX does not build stays.

## The problem

A booking service gives the owner a widget: a script tag, or a frame address, or a link. AMODX can place raw
HTML through the `html` block, which writes its content unsanitised (`packages/plugins/src/html/HtmlRender.tsx:7-20`)
and cannot run a `<script>` given that way (`docs/ROADMAP.md`, STATIC row: "its innerHTML path cannot execute
page `<script>` at all"). So a frame may work today and a script widget does not. Nothing was tried.

## What must be known first (from the client)

1. Which service (BOOKING-SERVICE). Its embed kinds: frame, script, plain link.
2. If it can show the four languages of the site, and how the language is passed.
3. If availability or prices must appear on the site's own pages, or only inside the widget.

## Scope (shape; completed when the service is named)

1. A block `bookingEmbed`: the service is chosen from a closed list (one entry at first), with the fields that
   service needs (property id, language from the page language of `lang-1`). The block builds the frame or
   script address from validated ids; the owner never pastes HTML.
2. Frame embeds: `sandbox` and `allow` attributes written per service; a fixed-height placeholder so the page
   does not jump.
3. Script embeds: loaded only on pages that hold the block, after the cookie consent the service's cookies need.
4. A plain "Book now" button block with the service's deep link as the fallback (needs no slice if the existing
   button block is enough).

## Decision BOOKING-SERVICE

The client names the service. The operator then reads its embed documentation and completes this file. If the
service offers only a link, this slice is not needed and is closed as such.

## Non-scope

Availability, prices, payments or guests stored in AMODX. Channel management. The request form of `stay-1` part
A stays available as a separate small slice for owners with no booking service.

## Exit criterion

A room page on staging shows the service's booking widget in the page's language and a test booking reaches the
service.
