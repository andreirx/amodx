# admin — ARCHITECTURE.md

## Role in the System

The admin panel SPA. Used by agency operators and client admins to manage content, products, strategy, leads, comments, media, team, and site settings. Communicates exclusively with the backend via HTTP API. Deployed as static files to S3 + CloudFront.

**Depends on:** packages/shared (types, theme presets), packages/plugins/admin (Tiptap editor extensions), backend (HTTP API)

**Site kinds and switches** (CAT-ADMIN-1, `docs/slices/cat-admin-1.md` § 3): a site is one of two kinds, chosen in
"Create New Site" and fixed for its life — **catalog** (`catalogMode`: products without any price, stock or ordering;
visitors send an interest list) or **non-catalog** (products with prices). A non-catalog site has two independent
switches, **commerce** (`commerceEnabled`: cart, checkout, orders) and **digital sales** (Paddle), and a catalog has
only the digital-sales switch (catalog + commerce is refused by the backend, 400). The admin follows this: the
sidebar's kind group is "Commerce" or "Catalog", "Digital sales" is its own group on every site, and the pages that
differ by kind (Products, Settings, WP Migration, Pricelist import) read `isCatalogMode` from `@amodx/shared`.

**Scheduling navigation** (SCHED-MENU-1, `docs/slices/sched-1.md` § 25; PROTOTYPE): independent of site kind and
commerce. `GET /tenants` adds only `schedulingEnabled` (strict `=== true`; absent/non-boolean → false), read by
TenantContext. Only enabled sites have the Scheduling section: Appointments → `/scheduling/planner`, Scheduling settings →
`/scheduling` (the Groups entry was removed by SCHED-GROUPS-REMOVE-1). Customers and other entries are unchanged. Settings
owns the scheduling switch next to Commerce (or Catalog) and a time-zone field when on: no inferred default zone,
the backend still requires an IANA zone to enable. Saving Settings uses the existing `refreshTenants`, rather than
the former browser reload, for both commerce and scheduling. TenantProvider selects directly from the fetched list
on initial load/refresh (the old selectTenant closure held the previous list); explicit site switches still reload.
This keeps the planner mail's path/query intact, also without a stored site. Settings.scheduling.test.ts mounts the
real provider, sidebar and pages with local HTTP/auth replacements: save on/off, failed save, retained limits,
Scheduling off/save bodies, and a fresh-browser planner link. The existing planner/login suite retains E18–E20.
Settings' existing markup captures are not re-taken: the preservation tests remove only the added off-state
scheduling card before their existing exclusions. Commerce/Catalog and the new card share one fragment slot so
the other controls retain their React `useId` paths. The page-local SettingsDraft accepts a partial scheduling
object for the initial explicit zone; the backend's existing schema supplies missing numeric defaults.

## Internal Structure

```
src/
├── main.tsx                    # App entry: Amplify config, React root
├── App.tsx                     # React Router v7 routes + AppShell auth guard
├── index.css                   # Tailwind v4 imports
├── lib/
│   ├── api.ts                  # apiRequest() — fetch wrapper with auth, tenant header, error handling; a non-OK answer throws ApiError (message unchanged + status + parsed body)
│   ├── migrationUpload.ts      # MIGRATION-UPLOAD-1: uploadMigrationFile() — POST /import/upload-url, then the PUT of the export to the PRIVATE bucket; answers the `migration/<tenant>/…` key the importers read; a refused link throws the server's message. PutFile = the test seam (migrationUpload.test.ts)
│   ├── seoExtract.ts           # extractText()/findImage()/stripMarkdown() — SEO auto-extraction from a Tiptap block doc on save; walks rich-text AND markdown-atom blocks (attrs.content) in document order. Sole consumer: ContentEditor.tsx. Extracted from the page for a node-env test seam (see seoExtract.test.ts)
│   └── utils.ts                # cn() (clsx + tailwind-merge)
├── components/
│   ├── ui/                     # shadcn/ui primitives (Button, Input, Dialog, Select, Sheet, etc.)
│   ├── AdminLayout.tsx         # Master layout: sidebar, content area, global link datalist
│   ├── Sidebar.tsx             # Navigation menu, tenant switcher, logout
│   ├── editor/
│   │   ├── BlockEditor.tsx     # Tiptap editor wrapper with media picker injection
│   │   └── Toolbar.tsx         # Formatting toolbar + plugin insert buttons
│   ├── GlamPricelistImport.tsx # The pricelist import form (mounted by pages/CatalogImport.tsx since CAT-ADMIN-1): form reducer (dry run bound to its input + profile choice), image copy loop (CAT-IMPORT-1, CAT-IMAGES-1, CAT-IMPORT-PROFILE-1C)
│   ├── GlamProfileEditor.tsx   # The producer's import profile: dry-run DTO types, ProfileEditor state + pure transitions, proposeProfile, hints; layout of the editor and the preview (CAT-IMPORT-PROFILE-1C)
│   ├── glamPreview.ts          # PURE preview assembly: cards, product page, 3 filter panels via @amodx/shared catalogListing / catalogListingPath / buildFacetListing (CAT-IMPORT-PROFILE-1C; facet headings = the tenant's catalog texts, siteContextOf.facetLabels, LOCALE-1B)
│   ├── MediaPicker.tsx         # Modal for selecting uploaded assets
│   ├── SmartLinkInput.tsx      # Autocomplete input for internal page links
│   └── TagInput.tsx            # Multi-tag input with suggestion autocomplete
├── contexts/
│   └── TenantContext.tsx       # TenantProvider: tenant list, selection, localStorage persistence
└── pages/
    ├── Login.tsx               # Cognito sign-in with forced password change flow
    ├── ContentList.tsx         # Page listing, create, WordPress import
    ├── ContentEditor.tsx       # Full page editor: blocks, metadata, SEO, versions, theme overrides. LANG-1A (lang-1.md § 10; PROTOTYPE): with extra languages (GET /settings), a Language select that rewrites the address prefix, a "Translation of" picker over the content list offering exactly the pages the backend would join (not itself, not its own set, not its language, not a set with a member in its language; sends translationOf only for a choice made; null = "Not a translation"), the set shown as language → page by the § 6.2 membership rule (key held + `hasTranslationItem` from GET /content + an address; `published` = status Published; Draft/Archived members shown as not listed), the search-engine warning only for two PUBLISHED members in one language (neither is then listed) (`text-destructive`). Every decision on PageLanguage / TranslationChoice is an all-arms-return switch. Pure helpers pinned by ContentEditor.test.ts
    ├── ContentGraph.tsx        # ReactFlow + Dagre visualization of internal links, orphan detection
    ├── Products.tsx            # Product listing table; on a catalog (CAT-ADMIN-1 § 4.4): catalog subtitle, "Import a
    │                           #   pricelist" link to /catalog-import, no WooCommerce import, no price/stock columns
    ├── CatalogImport.tsx       # "Pricelist import" (catalog sites; CAT-ADMIN-1 § 4.3): the import contract in two
    │                           #   sentences + GlamPricelistImport unchanged; a non-catalog site: one sentence, no form
    ├── ProductEditor.tsx       # Product form: pricing, inventory, images, Paddle/digital delivery
    ├── CategoryEditor.tsx      # Category form; CATEGORY-CONTENT-1: "Page content" card = BlockEditor on form.blocks
    │                           #   (categoryFormOf: stored list or []), Save sends the whole form. State = ONE editing
    │                           #   session `{ session, id, tenantId, form }`, a new token per run of the load effect
    │                           #   (route id × tenant; each visit to "new" is a session); form, editor (key = session)
    │                           #   and Save show only when the session is for the route id AND the current tenant (no
    │                           #   form before the tenant is known); every change goes through `edit(forSession, …)`
    │                           #   (a functional update, applied only while the form is still that session's); a load
    │                           #   answer or parent list applies only to its own session. Tests: CategoryEditor.test.ts
    │                           #   runs the real component with a hook store and a model of the editor's document
    │                           #   (no DOM, no new dependency); every Save asserts saved blocks = shown document
    ├── StrategyBoard.tsx       # Strategy document cards with quick-create dialog
    ├── StrategyEditor.tsx      # Block editor for strategy docs with tags
    ├── Signals.tsx             # Outbound lead signals list + detail side panel
    ├── MediaLibrary.tsx        # Asset grid gallery with copy-URL
    ├── Leads.tsx               # Lead table with CSV export; newsletter consent + push state, "Send again" (NEWSLETTER-1)
    ├── Comments.tsx            # Moderation queue with status control
    ├── Resources.tsx           # Private file manager for gated downloads
    ├── Users.tsx               # Team management with invite dialog and role assignment
    ├── Settings.tsx            # Site config: identity, theme, analytics, OAuth, Paddle, GDPR on/off + position, nav;
    │                           #   "Language & Country" (locale-1a): Site language (LANGUAGE_PACKS → locale), Locale
    │                           #   (advanced) with its normalised value and a warning when a present value falls back
    │                           #   to en-US, Country apply = countryCode + currency only; the rules are the exported
    │                           #   pure helpers localeStatus / withSiteLanguage / withCountry (Settings.test.ts);
    │                           #   CAT-ADMIN-1 § 4.5: a catalog gets a "Catalog" card (no control) instead of
    │                           #   "Commerce", Product Search, and URL prefixes product/category/shop/search/interest
    │                           #   CDL-2: interest placeholder /my-list; a non-catalog site has the field "Confirmation
    │                           #   (after Checkout)" → urlPrefixes.checkoutConfirmation (default /confirmation)
    │                           #   CAT-QUOTE-1: "Contact channels" card (every kind: phone, WhatsApp, e-mail; on a
    │                           #   catalog only, ruling R3, "Send interest lists to" = "Visitor contact e-mail
    │                           #   (default)" → interestListEmail: null (removes it) or a separate address);
    │                           #   withContactForSave trims and drops empty channels; the Commerce Bar description
    │                           #   notes the fallback; the Catalog card names the destination. Settings.test.ts
    │                           #   compares the 3912c5d __markup__ captures minus exactly two named exclusions (the
    │                           #   card element, the Commerce Bar note), with controls (ruling CQ-ADMIN-PRESERVATION = A)
    │                           #   CAT-THEME-1: Typography gets TypographyDetails (nav font, additional weights as
    │                           #   checkboxes 100–900 except 400/700, heading weight); the Theme card's Palette gets
    │                           #   ThemeColorDetails (Muted Text, Hairlines), the light tab ShapeAndCards (shape preset,
    │                           #   card image, category line); Navbar & Layout: HEADER_/PAGE_WIDTH_OPTIONS (+1440,
    │                           #   1600, 1920) and FooterWidthControl ("Same as header" → footer {}). Every group is
    │                           #   native/Input (no useId) and the LAST child of its parent; clearing removes the key.
    │                           #   The two __markup__ captures were RE-TAKEN once from 0865ac6 (they hold the CQ
    │                           #   additions now); Settings.test.ts compares them minus exactly the four groups.
    │                           #   Round 2 (R-CT-3): every Typography-card control reads `activeConfig`, the theme
    │                           #   `updateTheme` writes (`withThemeKey`: light → theme, dark → darkTheme).
    │                           #   BULK-PURGE-FOOTER-1: FooterColorControls (Footer Colours: Background, Text — the
    │                           #   palette's ColorInput; empty = theme default) right after FooterWidthControl, both in
    │                           #   ONE fragment slot of the card (useId width follows the parent's child count);
    │                           #   withFooterKey sets/removes one footer key and keeps the others. Compared minus
    │                           #   exactly five groups now; captures not re-taken.
    │                           #   HEADER-COLOURS-1: HeaderColorControls (Header Colours: Background, Text; same
    │                           #   help line) first in the same fragment slot, before FooterWidthControl;
    │                           #   withHeaderKey sets/removes one header colour key and keeps the other header keys.
    │                           #   Compared minus exactly six groups; captures not re-taken.
    │                           #   SHOP-LOOK-1A: HeaderTaglineAndCategoryBarControls (Tagline; Category Bar: pick from
    │                           #   GET /categories, order up/down, remove; ≤ 12) first in the same fragment slot, and
    │                           #   FooterBrandAndColumnsControls (Footer Brand Text; Footer Columns: ≤ 4 headings,
    │                           #   ≤ 12 links each) last. withHeaderKey / withFooterKey also take tagline,
    │                           #   categoryBarIds / brandText, columns; "" or an empty list removes the key. The page
    │                           #   loads the categories beside the settings (`categories`, null until loaded). Compared
    │                           #   minus exactly eight groups; captures not re-taken.
    │                           #   LANG-1A (lang-1.md § 10; PROTOTYPE): LanguageListControls, the last child of the
    │                           #   "Language & Country" card content (default language read only, extra languages with
    │                           #   English names, add/remove, the shared languageSettingsProblem messages, the help
    │                           #   text and "A change to the language list can take a few minutes to show on every
    │                           #   page."); removing a language removes its lists and sends `[]` / `{}` (top-level
    │                           #   merge). With extra languages, MenuLanguageSelect in the Navigation Menu and Footer
    │                           #   Links headers: Default edits navLinks / footerLinks as before; a language edits
    │                           #   navLinksByLang[l] / footerLinksByLang[l]; "Use the default menu" removes that list.
    │                           #   Compared minus exactly this one group (withoutLang1a); captures not re-taken.
    ├── Labels.tsx              # The tenant locale table (locale-1a; every tenant, System section): Site group,
    │                           #   "Cookie banner & legal links" (saved into gdpr / legalLinks, other fields kept),
    │                           #   locale-1b: "Catalog" (catalog tenants, catalogStrings; cdl-1: the "Import labels"
    │                           #   card and the four interest-mail keys) and "Product pages & search"
    │                           #   (commerce + catalog tenants, the shared commerce keys); a count key has one input
    │                           #   per plural category of the tenant's language (countInputs / setCountText);
    │                           #   commerce cards (commerce tenants; locale-1d: one card per page — product buying,
    │                           #   header, cart, checkout ×5, account, order confirmation, order tracking — with the
    │                           #   80 commerce-only keys); locale-1c: Site group card "Content Blocks" (the 26
    │                           #   block-chrome keys) and `showcaseEmpty` in "Product pages & search"; content-only
    │                           #   tenants get "Product showcase block" (showcaseEmpty, outOfStock; ruling R4);
    │                           #   CAT-QUOTE-1: Catalog card "Request a quote" (the 7 quote* keys);
    │                           #   ORDER-CONFIRM-1: `pricesChanged` in "Checkout - Payment & Submit" (the order
    │                           #   handler sends it in its 409 `message`; not in the checkout's strings prop);
    │                           #   SCHED-LABELS-1: "Booking" (every tenant, last; bookingStrings): one input per
    │                           #   booking key from bookingInputs() — English text as label, the standard text of
    │                           #   the site language as placeholder, "Must keep: {…}"; two cards (pages, err* keys);
    │                           #   one line when scheduling is off;
    │                           #   visibleSections() decides the sections per tenant kind (one input per key);
    │                           #   placeholders = language defaults; Reset per
    │                           #   section; one input per key (Labels.test.ts reads the page's inputs and pins them
    │                           #   to each Reset's scope); pure save helpers pinned by Labels.test.ts.
    │                           #   Sidebar.test.ts: Labels in the System section for every tenant (server render)
    ├── Migration.tsx           # WP Migration: Media → Products → Pages; a catalog has Media → Pages (CAT-ADMIN-1 § 4.6); MIGRATION-UPLOAD-1: the media and pages steps upload through lib/migrationUpload.ts (never /assets); the pages step drops its key after a complete import and on a 404
    ├── FormSubmissions.tsx     # Submissions of one form; the interest-list system form is titled "Interest lists" and (CDL-1) shows fixed English column headers by field id (`fieldHeader`)
    ├── OrderDetail.tsx         # One order: items, totals, customer, payment, status, tracking, history. PAY-1: the
    │                           #   Payment card offers "Mark as paid" (pending, or field absent) or "Mark as refunded"
    │                           #   (paid), none for refunded/null/other (paymentAction); confirm() (the text promises
    │                           #   no mail delivery), then PUT /orders/{id}
    │                           #   { paymentStatus } and the order is read again; a 409 alerts the server's reason
    │                           #   (paymentErrorText). OrderDetail.test.ts: pure-logic tests of both helpers
    ├── OrderEmails.tsx         # Order mail templates per template key (TEMPLATE_KEYS: the 7 statuses + `paid`, PAY-1;
    │                           #   TEMPLATE_LABELS, TEMPLATE_DESCRIPTIONS, activeKey); the page's DEFAULT_TEMPLATES
    │                           #   text differs from backend getDefaultTemplates() (known)
    ├── Scheduling.tsx          # SCHED-1D1 (docs/slices/sched-1.md § 4.1, § 10.3, § 11.1; PROTOTYPE): the minimal
    │                           #   scheduling screen, English. GET /settings decides: schedulingEnabled off → a short
    │                           #   "Scheduling is off for this site." sentence and a Settings link, no form or switch
    │                           #   (initial settings-read failure → error only, not an unsupported off-state claim);
    │                           #   on → Scheduling settings (time zone, hold, change cutoff,
    │                           #   reminder, booking horizon), Resources (GET/POST/PUT/DELETE
    │                           #   /scheduling/admin/resources; "Create calendar link" = feed secret, T only, URL shown
    │                           #   once), Mail templates (the six keys; defaults from GET
    │                           #   /scheduling/admin/email-templates — no copy in the page). Saves through PUT /settings
    │                           #   with ONLY scheduling or schedulingEmailConfig, never schedulingEnabled
    │                           #   (settingsPayload: shared SchedulingSettingsSchema + required time zone;
    │                           #   templatesPayload: an override only for a key that
    │                           #   differs from its default, weekAhead without sendToCustomer). Save buttons hidden for
    │                           #   editors (PUT /settings is TENANT_ADMIN; apiRequest signs out on 403). DELETE answers
    │                           #   204: deleteRequest treats apiRequest's JSON SyntaxError after a 2xx as success.
    │                           #   SCHED-1G3: on + no integrations.contactEmail (absent or "", the backend's rule) →
    │                           #   one warning line: the weekly planner mail and the owner copies of booking mails
    │                           #   are not sent until a contact address is set; link to /settings (Notifications).
    │                           #   needsContactAddressWarning decides; the address comes from the same GET /settings.
    │                           #   Scheduling.test.ts: pure-logic tests of the payload, error-text and warning helpers.
    │                           #   Sidebar: group "Scheduling" only when schedulingEnabled (SCHED-MENU-1, above)
    │                           #   SCHED-1E2: the header links to the week planner and to services/weekly hours.
    ├── SchedulingPlanner.tsx   # SCHED-1E2 (docs/slices/sched-1.md § 23, § 10.3; PROTOTYPE): the week planner of one
    │                           #   resource. GET …/resources/{r}/week?start=<Monday> drawn as a Monday-Sunday grid:
    │                           #   open / taken / removed-by-a-day-edit / closed stretches (weekView: each ELAPSED
    │                           #   minute since local midnight classified from the answer's intervals, so a 23- or
    │                           #   25-hour day keeps every real minute once; window bounds in a spring gap start at
    │                           #   the gap end; on a clock-change day the times carry their UTC offset and the column
    │                           #   marks its own hours). Each kind has a fill, a pattern or border AND a word. Bookings:
    │                           #   a block of true height in the grid, and below each day a list with ref, time,
    │                           #   customer, service, "Held until", "⚠ Outside hours", Details and Move (the list does
    │                           #   not depend on the block's height). The horizon: "Last day visitors can book", later
    │                           #   days marked. Per day: Edit hours, Day off, Weekly hours (PUT …/days, from = to);
    │                           #   "Edit a range of dates"; "Copy this week to the next N weeks" (POST …/days/copy-week);
    │                           #   "+ Appointment" (every service: visitor eligibility does not limit the admin, § 5.2)
    │                           #   and "Move" through AppointmentDialog (POST /scheduling/admin/appointments, POST
    │                           #   …/move-slot with the rev read by GET …/bookings/{id}). The edit answer's outsideHours
    │                           #   refs are listed. Times in WeekPlanDTO.timezone, never the browser's; "this week"
    │                           #   from GET /settings scheduling.timezone. URL query: tenant, week, resource.
    │                           #   The weekly mail's link ?tenant=&week= (§ 23.5): plannerAccess waits for the tenant
    │                           #   list, then show / switch once (selectTenant reloads) / "You do not have access to
    │                           #   this site." — no scheduling request unless "show", also after in-app navigation.
    │                           #   useSelectionData(key, fetch) (one rule for every scheduling page): an answer
    │                           #   is applied only when it answers the hook's latest request, and data is returned only
    │                           #   for the current selection key (tenant, resource, week, booking); writes take their
    │                           #   target from the data shown; dialogs, notices and errors carry the key they belong to.
    │                           #   SharedUnionLinks: each copied DTO union the admin switches on is tied to its shared
    │                           #   union (Same<…>), with a @ts-expect-error witness that a fifth variant fails (row A14).
    │                           #   Pure helpers exported here are used by the two pages below. SchedulingPlanner.test.ts
    │                           #   (jsdom): rows E15, E17-E21, E24 (incl. the page mounted with the link and the Login
    │                           #   flows) and the review-0 regressions (late answers, in-app navigation, clock
    │                           #   changes, 5- and 30-minute bookings, a manual appointment outside visitor eligibility).
    ├── SchedulingAppointments.tsx # SCHED-1E2: services (GET/POST/PUT/DELETE /scheduling/admin/services; servicePayload
    │                           #   = shared ServiceSchema) and the weekly hours of each resource (GET/PUT …/availability;
    │                           #   rulesPayload = shared AvailabilityRuleSchema); lists and hours through
    │                           #   useSelectionData; edited rows belong to the resource they were loaded for. DELETE
    │                           #   204: its own deleteRequest (a copy of Scheduling.tsx's).
    ├── SchedulingAppointmentsBooking.tsx # SCHED-1E2: one booking (GET /scheduling/admin/bookings/{id}, through
    │                           #   useSelectionData) with its history (historyLine, exhaustive over the four actions),
    │                           #   Cancel (POST …/cancel) and Move (a confirmed appointment; the planner's
    │                           #   AppointmentDialog); the page reads the booking again after each. Opened from a
    │                           #   planner entry. SchedulingAppointments.test.ts (jsdom): pure helpers of both pages and
    │                           #   the review-0 R1 regressions of both.
    │                           #   SCHED-GROUPS-REMOVE-1 removed the group pages (SchedulingCourses, SchedulingRoster) and
    │                           #   their tests; their code is on branch archive/group-scheduling-2026-11.
    ├── AuditLog.tsx            # Activity feed with action icons
    └── __markup__/             # CAT-ADMIN-1: react-dom/server captures of Products, Settings, Migration, FormSubmissions
                                #   taken at 3912c5d; the *.test.ts of each page compares a non-catalog render to them
                                #   byte for byte (toMatchFileSnapshot; never run `vitest -u` to "fix" a difference)
```

## Routing

React Router v7. `AppShell` in `App.tsx` guards all routes with `getCurrentUser()` from Amplify. A signed-out user is
sent to `/login?next=<path and query>` (`loginPathFor`, SCHED-1E2); after the password sign-in and after the
new-password step `Login.tsx` goes to `next` when `isSafeReturnPath` accepts it (path only, one leading `/`, no `//`,
no `\`, no control or whitespace character, ≤ 2000 characters), else to `/`. A 401/403 from `apiRequest` still goes to
plain `/login` (no `next`).

SCHED-APPT-FIXES-1: the final `*` child of the guarded shell shows **Page not found** and a **Go to start page**
link to `/`. It uses the normal AdminLayout/menu; the guard still runs first for signed-out visitors, preserving
the requested path/query in `next`. There is no new `errorElement`: page render errors are not handled by this
not-found screen. `appRoutes` is the same table passed to `createBrowserRouter`, exported for headless matching and
guard/layout tests in `App.test.ts`; known routes are unchanged.

| Path | Component | Description |
|------|-----------|-------------|
| `/login` | Login | Public, unauthenticated |
| `/` | ContentList | Dashboard / page listing |
| `/graph` | ContentGraph | Content link visualization |
| `/content/:id` | ContentEditor | Page editor |
| `/products` | Products | Product listing |
| `/products/:id` | ProductEditor | Product editor |
| `/catalog-import` | CatalogImport | Pricelist import (catalog sites; CAT-ADMIN-1) |
| `/forms/:id/submissions` | FormSubmissions | A form's submissions; `/forms/interest-list/submissions` = the catalog's "Interest lists" |
| `/strategy` | StrategyBoard | Strategy docs |
| `/strategy/:id` | StrategyEditor | Strategy editor |
| `/signals` | Signals | Outbound lead signals |
| `/media` | MediaLibrary | Asset gallery |
| `/leads` | Leads | Form submissions |
| `/comments` | Comments | Comment moderation |
| `/audit` | AuditLog | Activity history |
| `/resources` | Resources | Private files |
| `/users` | Users | Team management |
| `/email` | Email | Guided DNS for mailbox providers + read-only DNS checker (slice `email-2`). Provider selector, copyable record table (static / domain-derived / console-generated rows), MX destructive-advice warning, per-record check verdict (theme-token status via icon, not colour). Reads `EMAIL_PROVIDER_RECIPES` from `@amodx/shared`; POSTs `/email/dns-check`. |
| `/scheduling` | Scheduling | Scheduling settings, resources, mail templates (SCHED-1D1); a short "not enabled" state when `schedulingEnabled` is off |
| `/scheduling/appointments` | SchedulingAppointments | Services and weekly hours per resource (SCHED-1E2) |
| `/scheduling/planner` | SchedulingPlanner | Week planner of one resource; query `tenant`, `week`, `resource`; the target of the weekly mail's link (SCHED-1E2) |
| `/scheduling/bookings/:bookingId` | SchedulingAppointmentsBooking | One booking: details, history, cancel, move (SCHED-1E2) |
| `/settings` | Settings | Site configuration |

## State Management

- **TenantContext** (React Context): manages tenant list, current selection (persisted in localStorage as `AMODX_TENANT_ID`), auto-ejects from detail pages on tenant switch
- **Page-level state**: each editor uses local `useState`. No Redux or Zustand.
- **Dirty-state protection**: ContentEditor and StrategyEditor use `useBlocker()` + `beforeunload` to warn about unsaved changes
- **Custom events**: `amodx:refresh-links` dispatched by ContentList, listened by AdminLayout to update the global link datalist

## Glam pricelist import and the import profile (`components/GlamPricelistImport.tsx`, `GlamProfileEditor.tsx`, `glamPreview.ts`)

Catalog sites only (mounted by `pages/CatalogImport.tsx`, route `/catalog-import`, since CAT-ADMIN-1; before, by `pages/Products.tsx`). The backend (`POST /import/glam-pricelist`) decides every rule;
the admin collects the input, shows the dry run, and guarantees that "Confirm the import" sends EXACTLY the request the
shown report was made for. Design: `docs/slices/cat-import-profile-1.md` § 5, § 6; record `docs/slices/cat-import-profile-1c.md`.

- **One reducer** (`glamFormReducer`). State: the input, `revision` (bumped by every input change, profile edits
  included — each withdraws the shown report), `preview` = `{ revision, input, choice, report, context }`, and
  `profile` = the editor (`ProfileEditor`, a sum: `not-loaded` | `unsupported` | `editing { base, working, facts,
  otherImport }`). The file or the producer changing resets the editor (a profile is per producer).
- **Requests.** `checkRequest`: first check WITHOUT `profileChoice` (loads the stored profile, or the default); then
  "Preview" with `profileChoice = { working, baseRevision }` (`baseRevision` = the stored revision the editor
  loaded, `null` = none). `confirmRequest`: the preview's input and choice — for the first check, the profile that check
  was planned with (`confirmChoiceOf`); none when the stored profile is `unsupported` (§ 3.3: take the proposal first).
- **409 "changed by another import"** (`profileChangedRefusal` reads `ApiError.body.storedRevision`): the report is
  withdrawn, a reload dry run without a choice refreshes the editor's base and KEEPS the user's working profile; the
  user takes the stored one or keeps theirs, then previews again (§ 6.6).
- **Every answer that reports the stored state refreshes the editor**: the execution's 200 and its 503 "incomplete"
  (written, profile saved) carry `profile` and `sheets`; `editorAfterImport` takes both, so sheets a profile change
  made `stale` are listed at once (§ 6.3).
- **Labels** (CDL-1, `docs/slices/catalog-data-labels-1.md` § 4.3, § 4.7, § 5.3). `GlamInput.labels` ("site" default |
  "file") is part of the checked input: the `labels` event bumps the revision and withdraws the preview like any edit,
  and the import sends the choice of the last preview (`requestBody` always sends `labels`). The two sets are shown side
  by side from the latest dry run (`labelSets` = the editor's `facts.labels`, kept while the choice changes). The editor
  holds no column words: `pruneModes` (via `applyProfileEdit(profile, edit, columns)`), `collectionHint` and the "Column
  filters" row read `facts.labels[facts.labels.used]` — one source, the backend. `otherLabelsLine` states the other
  lists that hold other labels (nothing blocks). The option name starts empty: the backend writes the site's default.
  A new file starts with "site" again (the choice is not kept). An `unsupported` stored profile is unsupported for the
  label set it was checked under: when the choice differs from `facts.labels.used`, `checkRequest` allows a check
  without `profileChoice` that re-reads the stored profile under the new labels (nothing replaced; it loads if supported).
- **Preview** (`glamPreview.ts`, pure): base sets = `catalogListing(siteProducts ∪ publishedDrafts(drafts), scope, today)` for the
  producer category, one collection and the shop; panel = `buildFacetListing(base, f, catalogListingPath(prefixes,
  slug), facetLabels)` — the renderer's own functions and inputs. `prefixes = urlPrefixesOf(urlPrefixes)` (CDL-2: the renderer's `mapTenant` rule) and
  `facetLabels` (the tenant's `catalog.facetProducer` / `facetVariantDefault`, `resolveLocaleStrings`, locale-1b) from
  `GET /settings`; found category slugs from `GET /categories` (the dry run names them by id). A value click follows
  the panel's own href (`selectionOfHref`). The chosen product and collection are checked against the report they are
  shown with (`effectivePreviewChoice`). The look is approximate: the ruled notice and every § 5.3 limit
  (`FIDELITY_LIMITS`) are shown. The prose is shown as text (`proseParagraphs`, pure, reverses the importer's `<p>` +
  escape format), never injected as HTML. Copy that restates a rule owned elsewhere (`FILTER_MODE_HELP`,
  `VARIANT_MODE_HELP`, `FACET_VISIBILITY_HELP`, `SAVE_RULE`) is an exported constant scoped to the step it restates and
  pinned by units next to counterexamples computed by the owning module (`buildFacetListing`); the backend's acceptance
  rule is not restated (`movedNotice` is bounded: the import "may be refused").
- **Publication (CAT-IMAGE-GATE-1).** The editor's checkbox "Also publish products without an image" sets
  `publishWithoutImages: true` (unchecked = the member removed, so the default stays the default). The backend writes
  each draft's `status`; the preview reads it through `draftPublication` (`active` → published; `draft` with an option
  image address → shown as published after the copy, card marked "image to copy"; `draft` without one → hidden,
  listed apart) — the one place the preview's input departs from the renderer's, because the copy runs after the
  import and no preview can know which links work (`PUBLICATION_NOTICE`). The check and import reports show the
  backend's `publication` (`PublicationLines`); the image section counts `productsPublished` and lists the products
  that stay hidden (`hiddenProducts`: the latest batch's `hiddenWithoutImage`, rows from the import report, and a
  cause sum `failed | no-image-address | unknown` — "no image address" only when the same sheet's import report shows
  it; without evidence the cause is `unknown`, never an absence claim). "Copy images" resumes the outcomes
  recorded so far (`start` with `resume: true`); the copy after an import starts fresh (new products); a batch for
  another `importSource` discards the recorded outcomes.
- **Extra images (CAT-IMPORT-GALLERY-1).** A 13-column file: the check and import reports show the backend's
  `gallery` counts (`galleryLine`: rows, addresses, dropped non-http(s) parts). In the image section a holding is a
  (product, option) main image or a (product, option, address) extra (`extra: true`; `holderKey`); the extras are
  counted apart (`imageCounts(totals, "extras")`, shown only when the copy reported one) and `remainingExtras` joins
  the progress line. An extra is not a variant's main image and never publishes: the variant failure list
  (`imageProblems`) and the hidden causes (`hiddenProducts`) read main holdings (`mainHoldings`); lost extras have their
  own list with URL, reason and rows (`extraImageProblems`, `extraHoldings`). Every publication / hidden statement
  names the MAIN image ("main image", column 9) — also the preview (`GlamProfileEditor.tsx` hidden list,
  `glamPreview.ts` `PUBLICATION_NOTICE` and `draftPublication` comments; no field renamed). The product editor (`pages/ProductEditor.tsx`
  `buildProductPayload`) sends an option's `additionalImageLinks` unchanged whenever non-empty, with or without a main
  image (it never shows or edits them): the update replaces the variants and derives the gallery from them.
- **Tests** (node, no DOM): `GlamPricelistImport.test.ts` (reducer, proposal over BOEN's measured `specKeys`, edits, the
  409 path), `glamPreview.test.ts` (§ 5.5 assembly rows, no-copy rows, near-budget rows). The components only lay out
  what these pure functions return.
- Maturity: PROTOTYPE (enters with this slice; MATURE after the design § 7.5 staging evidence).

## API Client (`lib/api.ts`)

`apiRequest(path, options?)` handles:
- Auth: fetches Amplify session, attaches ID token as `Authorization: Bearer` header
- Tenant: reads `AMODX_TENANT_ID` from localStorage, sends as `x-tenant-id` header
- Config: checks `window.AMODX_CONFIG` (runtime, from `/config.json`) before `import.meta.env` (build-time)
- URL join (SCHED-APPT-FIXES-1): strips trailing `/` from the base and leading `/` from the path, then joins with one
  `/` at the fetch site. Base subpaths and request queries stay intact; `lib/api.test.ts` tests the actual request.
- Error handling: 401/403 triggers sign-out and redirect to `/login`; any other non-OK answer throws `ApiError` — `message` = `API Error (<status>): <error>` (as before), plus `status` and the parsed JSON `body` (`null` when not JSON)
- File uploads: POST to `/assets` returns presigned URL, then client PUTs binary directly to S3

## Tiptap Editor Integration

LANDING-1: ContentEditor's existing `hideNav` checkbox reads "Hide top bar, commerce bar and navigation";
`hideFooter` reads "Hide site footer". The persisted field names, loading, saving and reset behaviour stay unchanged.
No new switch is added. Their renderer contract and A1–A5 evidence are in `docs/slices/landing-1.md`.

`BlockEditor.tsx` wraps the Tiptap editor (users: `ContentEditor`, `StrategyEditor`, `CategoryEditor`):
- Loads extensions from `getExtensions()` (`@amodx/plugins/admin`)
- Injects storage callbacks: `uploadFn`, `pickFn` (media), `fetchTagsFn` (post grid tags), `fetchCategoriesFn` (the
  tenant's categories, `GET /categories`: one function for `categoryShowcase` and `categoryGrid`, SHOP-LOOK-1C),
  `fetchFormsFn` (the tenant's custom forms, `GET /forms` — the list the Forms page shows; for the `form` block's
  picker, SHOP-LOOK-1E; a failed call → `[]`), `pickManyFn` (the media picker in its multi-select mode, for the `gallery`
  block, GALLERY-1). Test: `formBlockPicker.test.ts` mounts the real `BlockEditor` in jsdom
  (`apiRequest` replaced) and reads the picker's options
- The pending pick is one value, `PickRequest` = `{ mode: "one", onPick(url) }` (`pickFn`: image, hero) or
  `{ mode: "many", onPick(urls) }` (`pickManyFn`: gallery); `MediaPicker` gets `onSelect` or `onSelectMany` to match.
  Test: `galleryPicker.test.ts` (real `BlockEditor` + real `MediaPicker`, jsdom): several images marked in one step and
  added in the order marked; unmark; the single pick of the image block unchanged
- `FormSubmissions.shop-look-1e.test.ts` (jsdom): the submissions page shows a submission in the shape the corrected
  public submit handler stores (`data` keyed by label; `submitterEmail` at the top level). A label-keyed checkbox value
  reads `true` / `false` (the `Yes` / `No` form is used only for id-keyed values; finding F-1E-SUBMISSIONS-CHECKBOX)
- `Toolbar.tsx` renders formatting buttons + dynamic plugin insert buttons from `getPluginList()`, filtered by
  `offeredPlugins()` (CAT-ADMIN-2: the site kind is "catalog" by `isCatalogMode`, else "commerce" by `commerceEnabled`,
  else none; a block is offered when its `offeredOn` is empty or holds the kind), and `AdminLayout.tsx` loads product
  and category link suggestions on a commerce or a catalog site
- `MediaPicker.tsx` opens as a dialog to browse/select uploaded assets. Two modes, one per callback prop (a union type, so
  a caller names exactly one): `onSelect` — one click picks and closes (every caller before GALLERY-1, unchanged);
  `onSelectMany` — clicks mark and unmark (`aria-pressed`, the order number on the tile), "Add N items" gives the marked
  addresses in the order marked and closes

## Auth Flow

1. `main.tsx` configures Amplify with Cognito userPoolId + clientId (from runtime config or env)
2. `Login.tsx` calls `signIn()`, handles `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` challenge, then goes to a safe
   `next` or `/` (see Routing)
3. `AppShell` checks `getCurrentUser()` before rendering authenticated routes
4. `apiRequest()` extracts ID token from `fetchAuthSession()` for every API call

## Build

- Dev: `npm run dev` (Vite)
- Build: `npm run build` (tsc -b && vite build)
- Lint: `npm run lint` (ESLint with React hooks + refresh plugins)
- Path alias: `@/*` → `./src/*`
- Tailwind v4 via `@tailwindcss/vite` plugin
- UI components follow shadcn/ui patterns (Radix + Tailwind + CVA)
