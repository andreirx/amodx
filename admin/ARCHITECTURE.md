# admin — ARCHITECTURE.md

## Role in the System

The admin panel SPA. Used by agency operators and client admins to manage content, products, strategy, leads, comments, media, team, and site settings. Communicates exclusively with the backend via HTTP API. Deployed as static files to S3 + CloudFront.

**Depends on:** packages/shared (types, theme presets), packages/plugins/admin (Tiptap editor extensions), backend (HTTP API)

## Internal Structure

```
src/
├── main.tsx                    # App entry: Amplify config, React root
├── App.tsx                     # React Router v7 routes + AppShell auth guard
├── index.css                   # Tailwind v4 imports
├── lib/
│   ├── api.ts                  # apiRequest() — fetch wrapper with auth, tenant header, error handling; a non-OK answer throws ApiError (message unchanged + status + parsed body)
│   ├── seoExtract.ts           # extractText()/findImage()/stripMarkdown() — SEO auto-extraction from a Tiptap block doc on save; walks rich-text AND markdown-atom blocks (attrs.content) in document order. Sole consumer: ContentEditor.tsx. Extracted from the page for a node-env test seam (see seoExtract.test.ts)
│   └── utils.ts                # cn() (clsx + tailwind-merge)
├── components/
│   ├── ui/                     # shadcn/ui primitives (Button, Input, Dialog, Select, Sheet, etc.)
│   ├── AdminLayout.tsx         # Master layout: sidebar, content area, global link datalist
│   ├── Sidebar.tsx             # Navigation menu, tenant switcher, logout
│   ├── editor/
│   │   ├── BlockEditor.tsx     # Tiptap editor wrapper with media picker injection
│   │   └── Toolbar.tsx         # Formatting toolbar + plugin insert buttons
│   ├── GlamPricelistImport.tsx # Products → Import → glam pricelist: form reducer (dry run bound to its input + profile choice), image copy loop (CAT-IMPORT-1, CAT-IMAGES-1, CAT-IMPORT-PROFILE-1C)
│   ├── GlamProfileEditor.tsx   # The producer's import profile: dry-run DTO types, ProfileEditor state + pure transitions, proposeProfile, hints; layout of the editor and the preview (CAT-IMPORT-PROFILE-1C)
│   ├── glamPreview.ts          # PURE preview assembly: cards, product page, 3 filter panels via @amodx/shared catalogListing / catalogListingPath / buildFacetListing (CAT-IMPORT-PROFILE-1C)
│   ├── MediaPicker.tsx         # Modal for selecting uploaded assets
│   ├── SmartLinkInput.tsx      # Autocomplete input for internal page links
│   └── TagInput.tsx            # Multi-tag input with suggestion autocomplete
├── contexts/
│   └── TenantContext.tsx       # TenantProvider: tenant list, selection, localStorage persistence
└── pages/
    ├── Login.tsx               # Cognito sign-in with forced password change flow
    ├── ContentList.tsx         # Page listing, create, WordPress import
    ├── ContentEditor.tsx       # Full page editor: blocks, metadata, SEO, versions, theme overrides
    ├── ContentGraph.tsx        # ReactFlow + Dagre visualization of internal links, orphan detection
    ├── Products.tsx            # Product listing table
    ├── ProductEditor.tsx       # Product form: pricing, inventory, images, Paddle/digital delivery
    ├── StrategyBoard.tsx       # Strategy document cards with quick-create dialog
    ├── StrategyEditor.tsx      # Block editor for strategy docs with tags
    ├── Signals.tsx             # Outbound lead signals list + detail side panel
    ├── MediaLibrary.tsx        # Asset grid gallery with copy-URL
    ├── Leads.tsx               # Lead table with CSV export
    ├── Comments.tsx            # Moderation queue with status control
    ├── Resources.tsx           # Private file manager for gated downloads
    ├── Users.tsx               # Team management with invite dialog and role assignment
    ├── Settings.tsx            # Site config: identity, theme, analytics, OAuth, Paddle, GDPR, nav
    └── AuditLog.tsx            # Activity feed with action icons
```

## Routing

React Router v7. `AppShell` in `App.tsx` guards all routes with `getCurrentUser()` from Amplify.

| Path | Component | Description |
|------|-----------|-------------|
| `/login` | Login | Public, unauthenticated |
| `/` | ContentList | Dashboard / page listing |
| `/graph` | ContentGraph | Content link visualization |
| `/content/:id` | ContentEditor | Page editor |
| `/products` | Products | Product listing |
| `/products/:id` | ProductEditor | Product editor |
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
| `/settings` | Settings | Site configuration |

## State Management

- **TenantContext** (React Context): manages tenant list, current selection (persisted in localStorage as `AMODX_TENANT_ID`), auto-ejects from detail pages on tenant switch
- **Page-level state**: each editor uses local `useState`. No Redux or Zustand.
- **Dirty-state protection**: ContentEditor and StrategyEditor use `useBlocker()` + `beforeunload` to warn about unsaved changes
- **Custom events**: `amodx:refresh-links` dispatched by ContentList, listened by AdminLayout to update the global link datalist

## Glam pricelist import and the import profile (`components/GlamPricelistImport.tsx`, `GlamProfileEditor.tsx`, `glamPreview.ts`)

Catalog sites only (mounted by `pages/Products.tsx`). The backend (`POST /import/glam-pricelist`) decides every rule;
the admin collects the input, shows the dry run, and guarantees that "Confirm the import" sends EXACTLY the request the
shown report was made for. Design: `docs/slices/cat-import-profile-1.md` § 5, § 6; record `docs/slices/cat-import-profile-1c.md`.

- **One reducer** (`glamFormReducer`). State: the input, `revision` (bumped by every input change, profile edits
  included — each withdraws the shown report), `preview` = `{ revision, input, choice, report, context }`, and
  `profile` = the editor (`ProfileEditor`, a sum: `not-loaded` | `unsupported` | `editing { base, working, facts,
  otherImport }`). The file or the producer changing resets the editor (a profile is per producer).
- **Requests.** `checkRequest`: first check WITHOUT `profileChoice` (loads the stored profile, or the default); then
  "Previzualizează" with `profileChoice = { working, baseRevision }` (`baseRevision` = the stored revision the editor
  loaded, `null` = none). `confirmRequest`: the preview's input and choice — for the first check, the profile that check
  was planned with (`confirmChoiceOf`); none when the stored profile is `unsupported` (§ 3.3: take the proposal first).
- **409 "changed by another import"** (`profileChangedRefusal` reads `ApiError.body.storedRevision`): the report is
  withdrawn, a reload dry run without a choice refreshes the editor's base and KEEPS the user's working profile; the
  user takes the stored one or keeps theirs, then previews again (§ 6.6).
- **Every answer that reports the stored state refreshes the editor**: the execution's 200 and its 503 "incomplete"
  (written, profile saved) carry `profile` and `sheets`; `editorAfterImport` takes both, so sheets a profile change
  made `stale` are listed at once (§ 6.3).
- **Preview** (`glamPreview.ts`, pure): base sets = `catalogListing(siteProducts ∪ publishedDrafts(drafts), scope, today)` for the
  producer category, one collection and the shop; panel = `buildFacetListing(base, f, catalogListingPath(prefixes,
  slug))` — the renderer's own functions and inputs. `prefixes = urlPrefixes || URL_PREFIX_DEFAULTS` from
  `GET /settings`; found category slugs from `GET /categories` (the dry run names them by id). A value click follows
  the panel's own href (`selectionOfHref`). The chosen product and collection are checked against the report they are
  shown with (`effectivePreviewChoice`). The look is approximate: the ruled notice and every § 5.3 limit
  (`FIDELITY_LIMITS`) are shown. The prose is shown as text (`proseParagraphs`, pure, reverses the importer's `<p>` +
  escape format), never injected as HTML. Copy that restates a rule owned elsewhere (`FILTER_MODE_HELP`,
  `VARIANT_MODE_HELP`, `FACET_VISIBILITY_HELP`, `SAVE_RULE`) is an exported constant scoped to the step it restates and
  pinned by units next to counterexamples computed by the owning module (`buildFacetListing`); the backend's acceptance
  rule is not restated (`movedNotice` is bounded: the import "poate fi refuzat").
- **Publication (CAT-IMAGE-GATE-1).** The editor's checkbox "Publică și produsele fără imagine" sets
  `publishWithoutImages: true` (unchecked = the member removed, so the default stays the default). The backend writes
  each draft's `status`; the preview reads it through `draftPublication` (`active` → published; `draft` with an option
  image address → shown as published after the copy, card marked "imagine de copiat"; `draft` without one → hidden,
  listed apart) — the one place the preview's input departs from the renderer's, because the copy runs after the
  import and no preview can know which links work (`PUBLICATION_NOTICE`). The check and import reports show the
  backend's `publication` (`PublicationLines`); the image section counts `productsPublished` and lists the products
  that stay hidden (`hiddenProducts`: the latest batch's `hiddenWithoutImage`, rows from the import report, and a
  cause sum `failed | no-image-address | unknown` — "no image address" only when the same sheet's import report shows
  it; without evidence the cause is `unknown`, never an absence claim). "Copiază imaginile" resumes the outcomes
  recorded so far (`start` with `resume: true`); the copy after an import starts fresh (new products); a batch for
  another `importSource` discards the recorded outcomes.
- **Tests** (node, no DOM): `GlamPricelistImport.test.ts` (reducer, proposal over BOEN's measured `specKeys`, edits, the
  409 path), `glamPreview.test.ts` (§ 5.5 assembly rows, no-copy rows, near-budget rows). The components only lay out
  what these pure functions return.
- Maturity: PROTOTYPE (enters with this slice; MATURE after the design § 7.5 staging evidence).

## API Client (`lib/api.ts`)

`apiRequest(path, options?)` handles:
- Auth: fetches Amplify session, attaches ID token as `Authorization: Bearer` header
- Tenant: reads `AMODX_TENANT_ID` from localStorage, sends as `x-tenant-id` header
- Config: checks `window.AMODX_CONFIG` (runtime, from `/config.json`) before `import.meta.env` (build-time)
- Error handling: 401/403 triggers sign-out and redirect to `/login`; any other non-OK answer throws `ApiError` — `message` = `API Error (<status>): <error>` (as before), plus `status` and the parsed JSON `body` (`null` when not JSON)
- File uploads: POST to `/assets` returns presigned URL, then client PUTs binary directly to S3

## Tiptap Editor Integration

`BlockEditor.tsx` wraps the Tiptap editor:
- Loads extensions from `getExtensions()` (`@amodx/plugins/admin`)
- Injects storage callbacks: `uploadFn`, `pickFn` (media), `fetchTagsFn` (post grid tags)
- `Toolbar.tsx` renders formatting buttons + dynamic plugin insert buttons from `getPluginList()`
- `MediaPicker.tsx` opens as a dialog to browse/select uploaded assets

## Auth Flow

1. `main.tsx` configures Amplify with Cognito userPoolId + clientId (from runtime config or env)
2. `Login.tsx` calls `signIn()`, handles `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` challenge
3. `AppShell` checks `getCurrentUser()` before rendering authenticated routes
4. `apiRequest()` extracts ID token from `fetchAuthSession()` for every API call

## Build

- Dev: `npm run dev` (Vite)
- Build: `npm run build` (tsc -b && vite build)
- Lint: `npm run lint` (ESLint with React hooks + refresh plugins)
- Path alias: `@/*` → `./src/*`
- Tailwind v4 via `@tailwindcss/vite` plugin
- UI components follow shadcn/ui patterns (Radix + Tailwind + CVA)
