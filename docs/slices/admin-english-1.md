# ADMIN-ENGLISH-1 — the catalog import screens speak English (implementation record)

Status: IMPLEMENTED 2026-11-14 (builder, round 1 after review 0: rulings AE-QUOTE-ORACLE and AE-RECORD), uncommitted,
awaiting review. Start: `main` at `8eb1aac`, tree clean.
Track: admin (catalog import). Depends: none. Source plan: none — the builder packet of 2026-11-14 and the human
direction are the plan. Maturity: unchanged (text only).

Ratified by the human on 2026-11-14: "those Romanian texts that were made for the catalog import are NOT OK … in the
meantime we should have all text in there in English" and "let's go for admin-english".

## 1. Purpose, scope, non-scope

- **Risk retired.** The catalog import screens (pricelist form, profile editor, preview), the audit titles of the two
  import routes and the MCP `import_glam_pricelist` report showed Romanian text. That breaks the standing rule: the admin
  interface is English; visitor text comes from the tenant's language table; stored data keeps its language.
- **Scope.** A text replacement in the allocated files (packet § 4). Every replaced text is in § 3.
- **Non-scope.** No translation mechanism, table, key file or helper (admin language packs are a later, separate track).
  No stored data, data recognition, behaviour, state shape, request/response field, report structure or exported name
  changes (packet rules 2, 3). Nothing under `renderer/`, `packages/`, `infra/`.
- **Architectural boundaries.** No boundary is crossed: texts change inside the existing modules. No new module, type or
  dependency. No DynamoDB access changes.
- **Migration / deployment.** None for data. Deploy admin + backend (+ the MCP server for its users); rollback = revert
  the commit. Staging steps: packet § 5 (operator).

## 2. Wording decisions (decided locally, one line each — the human reviews them in § 3)

- **"Sheet", not "list".** In this feature Romanian "listă" means one pricelist sheet. The English UI and MCP report
  already call it "Sheet" (the form field, "Sheets not current"), so every "listă" became "sheet".
- **"Taken address"** for "adresă ocupată" (a slug another product or category holds), everywhere.
- **"Value guard"** for "filtrul de valori" (the code/price line refusal): the MCP report already says "refused by the
  value guard".
- **Filter mode options** "automat / mereu / niciodată" → "auto / always / never" — the same words as their stored
  values (`auto`, `always`, `never`); the help texts name them the same way.
- **Counts.** Rule 6: no new plural logic. Sentences put the count after a label ("Products: 3", "rows: 201",
  "values: 82", "products: 3 of 10") so they read correctly for any count. The one existing plural branch
  (`tool-shapes.ts:131`, `product` / `products`) is kept as it is.
- **Quotes (ruling AE-QUOTE-ORACLE, round 1).** A quotation in a text this slice wrote uses the marks of the existing
  English texts of its file, never `„ ”`. `GlamPricelistImport.tsx` (existing `“…”` at 768, 887, 903) and the files
  with no earlier English quotation (`GlamProfileEditor.tsx`, `glamPreview.ts`, `tool-shapes.ts`) use the ruling's
  `“ ”`. Ten quotations moved from straight `"…"` (round 0) to `“…”`. `index.ts` is the exception: its existing English
  tool descriptions quote values with single quotes (`'disabled'`, `'scroll'`, `'blog, news'`), so `variant_name` uses
  `'Variantă'`. The three existing English texts with `“…”` stay byte-identical (rule 5).
- **MCP `variant_name` description.** The example "Culoare" became "Color" (an example in an English sentence); the
  default is quoted as the stored value, `'Variantă'` (rule 2; the file's quote marks). The admin placeholder `Variantă, Culoare, Format…` stays
  (rule 2), so the two now give different examples. If the human wants the examples to match, the change is one word.
- **The "may" bound.** `movedNotice` was bounded by "poate" (it does not restate the backend's acceptance rule); the
  English is bounded by "may" ("The import may be refused"), and the unit's counterexample checks for "will be refused |
  accepted only".

## 3. Old Romanian text → new English text

Rebuilt in round 1 (ruling AE-RECORD) from the bytes, not from the edit lists: both HEAD (`git show HEAD:<file>`) and
the candidate were parsed with the TypeScript compiler (5.9.3), and every shown text was taken as one complete unit:

- a string or template literal, whole, with its interpolations (`${…}`) and nested templates;
- a `+` chain of strings, joined into one message (a text that spans several source lines is joined, not cropped);
- a run of JSX children — text, `{…}` expressions and inline `<b>` — between two other elements, whole, whitespace
  collapsed as the browser shows it. An attribute text (`title=`, `placeholder=`) is its own unit, so a tooltip and its
  button are two rows.

The code skeleton of HEAD and the candidate is identical (round 0 check; reviewer's AST check), so unit *i* of HEAD is
unit *i* of the candidate. Every unit whose text differs is one row below: the table is the complete list of changed
texts, not a selection. The same text at two places (e.g. "Use the proposal") is two rows, one per place. "New text at"
is the line where the unit starts in the candidate. Code inside a text (`${…}`, `{…}`, `<b>`) is unchanged; only the
words around it changed. Rows S = shown texts; rows C = comments that named a control by its old text (rule 4),
given as the complete enclosing sentence. Rule (round 3, closes review-1 AE-RECORD): a comment row runs from the end
of the previous sentence (or the start of the comment) to the next sentence end (or the end of the comment); a sentence
ends only at `.` `!` `?` followed by a space and a new sentence — never at `;` or `:`; consecutive `//` lines are one
comment. "New text at" is the line where that sentence starts. Both ends of all 14 comment sentences were checked
against the comment text of HEAD and the candidate. Comment rows are numbered in line order.

#### `admin/src/components/glamPreview.ts`

| # | New text at | Old text (HEAD) | New text (candidate) |
|---|---|---|---|
| S1 | `glamPreview.ts:133` | `` Opțiunea „Publică și produsele fără imagine” este oprită: fiecare produs importat este ascuns până la copierea imaginilor și devine public când una dintre imaginile lui principale se copiază pe site. Previzualizarea nu poate ști care adrese de imagine vor funcționa: arată toate produsele care au o imagine principală în fișier, marcate „imagine de copiat”. Un produs ale cărui imagini principale nu se pot copia rămâne ascuns (imaginile suplimentare nu publică un produs). `` | `` The option “Also publish products without an image” is off: each imported product is hidden until the images are copied, and becomes public when one of its main images is copied to the site. The preview cannot know which image addresses will work: it shows all products that have a main image in the file, marked “image to copy”. A product whose main images cannot be copied stays hidden (extra images do not publish a product). `` |
| S2 | `glamPreview.ts:134` | `` imagine de copiat `` | `` image to copy `` |
| S3 | `glamPreview.ts:135` | `` ascuns până la copierea imaginilor `` | `` hidden until the images are copied `` |
| S4 | `glamPreview.ts:227` | `` ${ref.slug} (nouă) `` | `` ${ref.slug} (new) `` |
| S5 | `glamPreview.ts:228` | `` ${ref.slug} (adresă ocupată) `` | `` ${ref.slug} (address taken) `` |
| S6 | `glamPreview.ts:251` | `` Setările sau categoriile site-ului nu au putut fi citite. `` | `` The site's settings or categories could not be read. `` |
| S7 | `glamPreview.ts:262` | `` Categoria ${ref.id} nu este în lista de categorii a site-ului. `` | `` Category ${ref.id} is not in the site's category list. `` |
| S8 | `glamPreview.ts:270` | `` Adresa categoriei „${ref.slug}” este ocupată de altă categorie; importul nu poate rula. `` | `` The category address “${ref.slug}” is taken by another category; the import cannot run. `` |
| S9 | `glamPreview.ts:295` | `` aspect aproximativ — datele și filtrele sunt exacte pentru adresa publică a site-ului `` | `` approximate look — the data and the filters are exact for the site's public address `` |
| S10 | `glamPreview.ts:302` | `` Aspectul nu este al site-ului: tema, fonturile și așezarea paginilor nu sunt aplicate aici. Valorile, numerele, ordinea și vizibilitatea filtrelor sunt cele pe care site-ul le calculează pentru aceleași date, pe adresa publică. `` | `` The look is not the site's: the theme, the fonts and the page layout are not applied here. The values, the counts, the order and the visibility of the filters are those the site calculates for the same data, at the public address. `` |
| S11 | `glamPreview.ts:303` | `` Datele sunt cele de la momentul verificării. Produsele schimbate între timp de alți utilizatori sau de alt import și prefixele de adresă schimbate după verificare nu apar aici; importul citește din nou produsele, categoriile și profilul salvat. `` | `` The data is from the time of the check. Products changed since then by other users or by another import, and address prefixes changed after the check, do not show here; the import reads the products, the categories and the saved profile again. `` |
| S12 | `glamPreview.ts:304` | `` Data de disponibilitate se compară cu ziua UTC, ca pe site. O perioadă care începe sau se termină între verificare și vizita pe site nu este reflectată aici. `` | `` The availability date is compared with the UTC day, as on the site. A period that starts or ends between the check and the visit to the site is not shown here. `` |
| S13 | `glamPreview.ts:305` | `` Limita de lungime a adresei este exactă pentru adresa publică a site-ului. Pe adresele de previzualizare (/_site/<id>/…) adresele sunt mai lungi, așa că o valoare aproape de limită poate fi activă aici și inactivă acolo. `` | `` The address length limit is exact for the site's public address. On the preview addresses (/_site/<id>/…) the addresses are longer, so a value near the limit can be active here and inactive there. `` |
| S14 | `glamPreview.ts:306` | `` Imaginile sunt adresele producătorului: copierea lor pe site vine după import, iar unele pot apărea aici rupte. `` | `` The images are the producer's addresses: they are copied to the site after the import, and some can show as broken here. `` |

Comments that named a control by its old text (rule 4) — the changed sentence, complete:

| # | New text at | Old sentence (HEAD) | New sentence (candidate) |
|---|---|---|---|
| C1 | `glamPreview.ts:25` | `` The preview cannot know which image links will work, so it shows the state after a copy in which every link works: a `draft` product with a MAIN-image address (an option `imageLink`, column 9) is shown as published and marked "imagine de copiat" (`draftPublication` = `after-copy`); a `draft` product without one stays hidden and is listed apart (`hidden`) — also when it has extra images (column 13, CAT-IMPORT-GALLERY-1), which never publish a product. `` | `` The preview cannot know which image links will work, so it shows the state after a copy in which every link works: a `draft` product with a MAIN-image address (an option `imageLink`, column 9) is shown as published and marked "image to copy" (`draftPublication` = `after-copy`); a `draft` product without one stays hidden and is listed apart (`hidden`) — also when it has extra images (column 13, CAT-IMPORT-GALLERY-1), which never publish a product. `` |
| C2 | `glamPreview.ts:72` | `` CAT-IMAGE-GATE-1: published only once one of its images is copied ("imagine de copiat"). `` | `` CAT-IMAGE-GATE-1: published only once one of its images is copied ("image to copy"). `` |
| C3 | `glamPreview.ts:287` | `` The selection a panel link leads to: the `f` of its href (the canonical `formatSelection` form the site's links carry), `""` for a link without one (the bare path: "Șterge filtrele", or the last value removed). `` | `` The selection a panel link leads to: the `f` of its href (the canonical `formatSelection` form the site's links carry), `""` for a link without one (the bare path: "Clear filters", or the last value removed). `` |

#### `admin/src/components/GlamPricelistImport.tsx`

| # | New text at | Old text (HEAD) | New text (candidate) |
|---|---|---|---|
| S15 | `GlamPricelistImport.tsx:387` | `` The site changed no product in the last request and ${r.progress.remainingSources} image(s) are left. Try "Copiază imaginile" again later. `` | `` The site changed no product in the last request and ${r.progress.remainingSources} image(s) are left. Try “Copy images” again later. `` |
| S16 | `GlamPricelistImport.tsx:523` | `` Fără adresă de imagine principală (coloana 9) în fișier. `` | `` No main image address (column 9) in the file. `` |
| S17 | `GlamPricelistImport.tsx:532` | `` Cauza nu este cunoscută în această sesiune: fie rândul nu are adresă de imagine principală, fie imaginile lui principale au eșuat la o copiere anterioară. Importați lista din nou și copiați imaginile ca să vedeți adresele care eșuează. `` | `` The cause is not known in this session: either the row has no main image address, or its main images failed in an earlier copy. Import the sheet again and copy the images to see the addresses that fail. `` |
| S18 | `GlamPricelistImport.tsx:621` | `` Profilul producătorului a fost schimbat de alt import (revizia ${changed.storedRevision ?? "—"}) după ce l-ați încărcat. Nimic nu a fost schimbat. Profilul salvat se reîncarcă; alegeți profilul și previzualizați din nou. `` | `` The producer's profile was changed by another import (revision ${changed.storedRevision ?? "—"}) after you loaded it. Nothing was changed. The saved profile is reloading; choose the profile and preview again. `` |
| S19 | `GlamPricelistImport.tsx:664` | `` Previzualizează `` | `` Preview `` |
| S20 | `GlamPricelistImport.tsx:671` | `` Listă de prețuri (glam) `` | `` Pricelist (glam) `` |
| S21 | `GlamPricelistImport.tsx:718` | `` Copiază imaginile `` | `` Copy images `` |
| S22 | `GlamPricelistImport.tsx:726` | `` Acest raport nu poate fi importat: profilul salvat nu poate fi aplicat. Folosiți propunerea de mai jos și previzualizați. `` | `` This report cannot be imported: the saved profile cannot be applied. Use the proposal below and preview. `` |
| S23 | `GlamPricelistImport.tsx:784` | `` Produse publicate acum (o imagine principală a lor s-a copiat): <b>{state.totals.productsPublished}</b> `` | `` Products published now (one of their main images was copied): <b>{state.totals.productsPublished}</b> `` |
| S24 | `GlamPricelistImport.tsx:785` | `` Produse care rămân ascunse — nicio imagine principală copiată: <b>{state.totals.hidden.length}</b> `` | `` Products that stay hidden — no main image copied: <b>{state.totals.hidden.length}</b> `` |
| S25 | `GlamPricelistImport.tsx:791` | `` Aceste produse rămân ascunse pe site: nicio imagine principală a lor nu s-a copiat (imaginile suplimentare nu publică un produs). Adăugați în fișier adrese de imagine principală care funcționează și importați-l din nou. O imagine adăugată în editorul produsului se pierde la următorul import al listei. `` | `` These products stay hidden on the site: none of their main images was copied (extra images do not publish a product). Add main image addresses that work to the file and import it again. An image added in the product editor is lost at the next import of the sheet. `` |
| S26 | `GlamPricelistImport.tsx:797` | `` ({h.slug}{h.rows.length > 0 ? `, rândurile ${h.rows.join(", ")}` : ""}) `` | `` ({h.slug}{h.rows.length > 0 ? `, rows ${h.rows.join(", ")}` : ""}) `` |
| S27 | `GlamPricelistImport.tsx:853` | `` ${c.previousSlug} → ${c.slug} (rândul ${c.rowIndex}; adresa este a unui produs ${c.heldBy === null ? "fără sursă de import" : `din ${c.heldBy}`}) `` | `` ${c.previousSlug} → ${c.slug} (row ${c.rowIndex}; the address belongs to a product ${c.heldBy === null ? "without an import source" : `from ${c.heldBy}`}) `` |
| S28 | `GlamPricelistImport.tsx:854` | `` adresa nouă este adresa ocupată, urmată de numele foii și/sau de un număr `` | `` the new address is the taken address, followed by the sheet's name and/or a number `` |
| S29 | `GlamPricelistImport.tsx:856` | `` Adrese de produs schimbate, pentru că sunt deja ale altor produse de pe site — ${rule} (${list.length}): ${items.join(", ")}. La import lista poate diferi dacă produsele altor foi se schimbă între timp. `` | `` Product addresses changed because they already belong to other products on the site — ${rule} (${list.length}): ${items.join(", ")}. At the import the list can differ if the products of other sheets change in the meantime. `` |
| S30 | `GlamPricelistImport.tsx:857` | `` Adrese de produs schimbate, pentru că erau deja ale altor produse de pe site — ${rule} (${list.length}): ${items.join(", ")}. `` | `` Product addresses changed because they already belonged to other products on the site — ${rule} (${list.length}): ${items.join(", ")}. `` |
| S31 | `GlamPricelistImport.tsx:944` | `` Fără adresă de imagine principală (coloana 9) în fișier — rămân ascunse dacă nu adăugați imagini principale în fișier (${none.length}) `` | `` No main image address (column 9) in the file — these stay hidden unless you add main images to the file (${none.length}) `` |
| S32 | `GlamPricelistImport.tsx:945` | `` Fără adresă de imagine principală (coloana 9) în fișier — publicate fără imagine principală (${none.length}) `` | `` No main image address (column 9) in the file — published without a main image (${none.length}) `` |
| S33 | `GlamPricelistImport.tsx:948` | `` {p.title} ({p.slug}) — rândurile {p.rowIndexes.join(", ")} `` | `` {p.title} ({p.slug}) — rows {p.rowIndexes.join(", ")} `` |
| S34 | `GlamPricelistImport.tsx:957` | `` {dryRun ? "Ar porni ascunse" : "Pornesc ascunse"}: <b>{publication.startHidden}</b> produse — fiecare devine public când una dintre imaginile lui principale se copiază pe site. Dacă copierea se oprește, apăsați din nou „Copiază imaginile”. `` | `` {dryRun ? "Products that would start hidden" : "Products that start hidden"}: <b>{publication.startHidden}</b> — each becomes public when one of its main images is copied to the site. If the copy stops, press “Copy images” again. `` |
| S35 | `GlamPricelistImport.tsx:966` | `` Profilul publică și produsele fără imagine principală: toate produsele sunt publicate la import. `` | `` The profile also publishes products without a main image: all products are published at the import. `` |

Comments that named a control by its old text (rule 4) — the changed sentence, complete:

| # | New text at | Old sentence (HEAD) | New sentence (candidate) |
|---|---|---|---|
| C4 | `GlamPricelistImport.tsx:24` | `` "Copiază imaginile" starts the same copy for a producer/sheet without an import in this session. `` | `` "Copy images" starts the same copy for a producer/sheet without an import in this session. `` |
| C5 | `GlamPricelistImport.tsx:28` | `` CAT-IMAGE-GATE-1 (docs/slices/cat-image-gate-1.md § 3 items 4, 6) — an import without "Publică și produsele fără imagine" writes every product hidden; the copy publishes each product whose image copies. `` | `` CAT-IMAGE-GATE-1 (docs/slices/cat-image-gate-1.md § 3 items 4, 6) — an import without "Also publish products without an image" writes every product hidden; the copy publishes each product whose image copies. `` |
| C6 | `GlamPricelistImport.tsx:40` | `` CAT-IMPORT-PROFILE-1C — the producer's import profile (docs/slices/cat-import-profile-1.md § 5, § 6): the first "Check the file" loads the stored profile (or the default) into the editor (`ProfileEditor`, a member of this form's state); "Previzualizează" sends a dry run with `profileChoice` = { the edited profile, the loaded stored revision }; "Confirm the import" sends the snapshot the shown preview was made for. `` | `` CAT-IMPORT-PROFILE-1C — the producer's import profile (docs/slices/cat-import-profile-1.md § 5, § 6): the first "Check the file" loads the stored profile (or the default) into the editor (`ProfileEditor`, a member of this form's state); "Preview" sends a dry run with `profileChoice` = { the edited profile, the loaded stored revision }; "Confirm the import" sends the snapshot the shown preview was made for. `` |
| C7 | `GlamPricelistImport.tsx:309` | `` `resume` (CIG-R3): keep the outcomes recorded so far ("Copiază imaginile" again on the same sheet). `` | `` `resume` (CIG-R3): keep the outcomes recorded so far ("Copy images" again on the same sheet). `` |
| C8 | `GlamPricelistImport.tsx:519` | `` The cause in words (Romanian, § 3 item 4). `` | `` The cause in words (§ 3 item 4; English since ADMIN-ENGLISH-1). `` |

#### `admin/src/components/GlamProfileEditor.tsx`

| # | New text at | Old text (HEAD) | New text (candidate) |
|---|---|---|---|
| S36 | `GlamProfileEditor.tsx:295` | `` Profilul salvat s-a schimbat de când l-ați încărcat (acum: ${storedRevision === null ? "niciun profil" : `revizia ${storedRevision}`}). Importul poate fi refuzat; dacă este refuzat, nu se schimbă nimic și profilul salvat se reîncarcă pentru a alege între cele două. `` | `` The saved profile changed since you loaded it (now: ${storedRevision === null ? "no profile" : `revision ${storedRevision}`}). The import may be refused; if it is refused, nothing changes and the saved profile is reloaded so you can choose between the two. `` |
| S37 | `GlamProfileEditor.tsx:303` | `` Profilul se salvează doar printr-un import: un import acceptat salvează profilul previzualizat dacă diferă de cel salvat (revizia crește cu 1); dacă este identic, revizia rămâne. Cât timp nu este salvat niciun profil, profilul implicit nu se salvează: importul rămâne fără profil. Celelalte liste ale producătorului se schimbă doar când sunt importate din nou. `` | `` The profile is saved only by an import: an accepted import saves the previewed profile if it differs from the saved one (the revision goes up by 1); if it is identical, the revision stays. While no profile is saved, the default profile is not saved: the import stays without a profile. The producer's other sheets change only when they are imported again. `` |
| S38 | `GlamProfileEditor.tsx:311` | `` Filtrele de atribute — automat: filtrul este oferit pe o pagină când, fără produsele marcate „niciodată”, cel puțin 2 produse ale paginii au cheia, cea mai frecventă valoare este la cel puțin 2 dintre ele și sunt cel mult 40 de valori; mereu: este oferit pe orice pagină unde un produs importat cu acest profil are cheia, chiar dacă aceste condiții nu sunt îndeplinite; niciodată: produsele importate cu acest profil nu contribuie la oferirea filtrului și valorile lor nu sunt propuse, dar ele rămân găsite și numărate când o valoare este aleasă. `` | `` Attribute filters — auto: the filter is offered on a page when, without the products marked “never”, at least 2 products of the page have the key, the most frequent value is on at least 2 of them and there are at most 40 values; always: it is offered on any page where a product imported with this profile has the key, even if these conditions are not met; never: the products imported with this profile do not count toward offering the filter and their values are not proposed, but they are still found and counted when a value is chosen. `` |
| S39 | `GlamProfileEditor.tsx:318` | `` Filtrul variantelor — automat: este oferit pe orice pagină, fără regula repetării; niciodată: variantele produselor importate cu acest profil nu sunt propuse, dar aceste produse rămân găsite și numărate când o variantă este aleasă. `` | `` Variant filter — auto: it is offered on any page, without the repeat rule; never: the variants of the products imported with this profile are not proposed, but these products are still found and counted when a variant is chosen. `` |
| S40 | `GlamProfileEditor.tsx:323` | `` Oprit (implicit): fiecare produs importat rămâne ascuns până când una dintre imaginile lui se copiază pe site; produsele fără nicio imagine copiată rămân ascunse și apar în raportul imaginilor. Pornit: toate produsele sunt publicate la import, cu sau fără imagine. `` | `` Off (default): each imported product stays hidden until one of its images is copied to the site; the products with no copied image stay hidden and show in the image report. On: all products are published at the import, with or without an image. `` |
| S41 | `GlamProfileEditor.tsx:325` | `` Pe pagină, un filtru este afișat dacă are deja o valoare aleasă, sau dacă este oferit și cel puțin una dintre valorile propuse nu este la toate produsele paginii. `` | `` On a page, a filter is shown if it already has a chosen value, or if it is offered and at least one of the proposed values is not on all products of the page. `` |
| S42 | `GlamProfileEditor.tsx:520` | `` listă cu virgule în ${k.commaRows} rânduri `` | `` comma-separated list (rows: ${k.commaRows}) `` |
| S43 | `GlamProfileEditor.tsx:521` | `` diferă între opțiuni în ${k.variantLevelProducts} produse `` | `` differs between options (products: ${k.variantLevelProducts}) `` |
| S44 | `GlamProfileEditor.tsx:522` | `` egal cu eticheta variantei (fără spații și „mm”) în ${k.equalToFormat}/${k.rows} rânduri `` | `` equal to the variant label (without spaces and “mm”) in ${k.equalToFormat}/${k.rows} rows `` |
| S45 | `GlamProfileEditor.tsx:523` | `` egal cu colecția din coloana 0 (fără spații și „mm”) în ${k.equalToCollection}/${k.rows} rânduri `` | `` equal to the collection in column 0 (without spaces and “mm”) in ${k.equalToCollection}/${k.rows} rows `` |
| S46 | `GlamProfileEditor.tsx:524` | `` o singură valoare `` | `` only one value `` |
| S47 | `GlamProfileEditor.tsx:525` | `` regula repetării nu l-ar oferi ca filtru pentru produsele acestui fișier (${k.distinctValues} valori) `` | `` the repeat rule would not offer it as a filter for the products of this file (values: ${k.distinctValues}) `` |
| S48 | `GlamProfileEditor.tsx:526` | `` ${k.refused.length} linii refuzate de filtrul de valori (cod sau preț) `` | `` lines refused by the value guard (code or price): ${k.refused.length} `` |
| S49 | `GlamProfileEditor.tsx:588` | `` importată fără profil `` | `` imported without a profile `` |
| S50 | `GlamProfileEditor.tsx:589` | `` importată cu profilul salvat (revizia ${s.revisions.join(", ")}) `` | `` imported with the saved profile (revision ${s.revisions.join(", ")}) `` |
| S51 | `GlamProfileEditor.tsx:590` | `` importată cu un profil mai vechi (revizia ${s.revisions.join(", ")}) `` | `` imported with an older profile (revision ${s.revisions.join(", ")}) `` |
| S52 | `GlamProfileEditor.tsx:591` | `` amestecată (revizii: ${s.revisions.join(", ") \|\| "—"}; ${s.unstamped} produse fără profil) `` | `` mixed (revisions: ${s.revisions.join(", ") \|\| "—"}; products without a profile: ${s.unstamped}) `` |
| S53 | `GlamProfileEditor.tsx:624` | `` Fiecare nume din fișier este un produs `` | `` Each name in the file is a product `` |
| S54 | `GlamProfileEditor.tsx:625` | `` Numărul de la sfârșitul numelui, când există, devine eticheta variantei `` | `` The number at the end of the name, when there is one, becomes the variant label `` |
| S55 | `GlamProfileEditor.tsx:626` | `` Numele fără numărul final; varianta din coloana format `` | `` The name without the final number; the variant from the format column `` |
| S56 | `GlamProfileEditor.tsx:648` | `` automat `` | `` auto `` |
| S57 | `GlamProfileEditor.tsx:649` | `` mereu `` | `` always `` |
| S58 | `GlamProfileEditor.tsx:650` | `` niciodată `` | `` never `` |
| S59 | `GlamProfileEditor.tsx:662` | `` Profilul de import al producătorului {editor.facts.producer} `` | `` Import profile of producer {editor.facts.producer} `` |
| S60 | `GlamProfileEditor.tsx:664` | `` Profilul salvat (revizia {editor.revision}) folosește setări pe care acest importator nu le poate aplica: {editor.reason}. Nu poate fi deschis aici. Porniți de la propunere; un import cu profilul ales aici îl înlocuiește, dacă între timp alt import nu a salvat alt profil. `` | `` The saved profile (revision {editor.revision}) uses settings that this importer cannot apply: {editor.reason}. It cannot be opened here. Start from the proposal; an import with the profile chosen here replaces it, if no other import saved another profile in the meantime. `` |
| S61 | `GlamProfileEditor.tsx:668` | `` Folosește propunerea `` | `` Use the proposal `` |
| S62 | `GlamProfileEditor.tsx:690` | `` Profilul de import al producătorului {facts.producer} `` | `` Import profile of producer {facts.producer} `` |
| S63 | `GlamProfileEditor.tsx:696` | `` Profilul a fost schimbat de alt import (revizia {editor.otherImport.storedRevision ?? "—"}). Mai jos este profilul dvs.; alegeți profilul salvat sau păstrați-l pe al dvs., apoi apăsați „Previzualizează” din nou. `` | `` The profile was changed by another import (revision {editor.otherImport.storedRevision ?? "—"}). Below is your profile; choose the saved profile or keep yours, then press “Preview” again. `` |
| S64 | `GlamProfileEditor.tsx:702` | `` Fiecare cheie devine atribut, cu eticheta egală cu cheia; gruparea și colecția rămân implicite `` | `` Each key becomes an attribute, with the label equal to the key; the grouping and the collection stay at the default `` |
| S65 | `GlamProfileEditor.tsx:703` | `` Folosește propunerea `` | `` Use the proposal `` |
| S66 | `GlamProfileEditor.tsx:707` | `` Folosește profilul salvat (revizia {stored.revision}) `` | `` Use the saved profile (revision {stored.revision}) `` |
| S67 | `GlamProfileEditor.tsx:715` | `` Ce este un produs `` | `` What a product is `` |
| S68 | `GlamProfileEditor.tsx:720` | `` {names.endsInNumber} din {names.products} produse au numele terminat într-un număr. `` | `` Products whose name ends in a number: {names.endsInNumber} of {names.products}. `` |
| S69 | `GlamProfileEditor.tsx:723` | `` De unde vine colecția `` | `` Where the collection comes from `` |
| S70 | `GlamProfileEditor.tsx:726` | `` Coloana colecției din fișier `` | `` The collection column of the file `` |
| S71 | `GlamProfileEditor.tsx:727` | `` Cheia „{k.key}” ({k.distinctValues} valori, {k.rows} rânduri) `` | `` Key “{k.key}” (values: {k.distinctValues}, rows: {k.rows}) `` |
| S72 | `GlamProfileEditor.tsx:728` | `` Cheia „{collectionKey}” `` | `` Key “{collectionKey}” `` |
| S73 | `GlamProfileEditor.tsx:730` | `` Coloana colecției are {collections.values} valori. `` | `` Values in the collection column: {collections.values}. `` |
| S74 | `GlamProfileEditor.tsx:731` | `` Un rând fără această cheie, sau cu o valoare refuzată de filtrul de valori, primește ca colecție numele listei. `` | `` A row without this key, or with a value refused by the value guard, gets the sheet's name as its collection. `` |
| S75 | `GlamProfileEditor.tsx:739` | `` Publică și produsele fără imagine `` | `` Also publish products without an image `` |
| S76 | `GlamProfileEditor.tsx:747` | `` Filtrele coloanelor `` | `` Column filters `` |
| S77 | `GlamProfileEditor.tsx:756` | `` variantele `` | `` variants `` |
| S78 | `GlamProfileEditor.tsx:770` | `` Listele producătorului pe site `` | `` The producer's sheets on the site `` |
| S79 | `GlamProfileEditor.tsx:774` | `` {sheetId(s.importSource)}{s.importSource === facts.importSource ? " (această listă)" : ""} — {s.products} produse, {sheetStateText(s)} `` | `` {sheetId(s.importSource)}{s.importSource === facts.importSource ? " (this sheet)" : ""} — products: {s.products}, {sheetStateText(s)} `` |
| S80 | `GlamProfileEditor.tsx:780` | `` Aceste liste au fost importate cu un profil mai vechi sau fără profil: {reimport.map((s) => sheetId(s.importSource)).join(", ")} — importați-le din nou. `` | `` These sheets were imported with an older profile or without a profile: {reimport.map((s) => sheetId(s.importSource)).join(", ")} — import them again. `` |
| S81 | `GlamProfileEditor.tsx:802` | `` Niciun profil salvat pentru acest producător. `` | `` No saved profile for this producer. `` |
| S82 | `GlamProfileEditor.tsx:803` | `` Profil salvat: revizia {base.revision}. `` | `` Saved profile: revision {base.revision}. `` |
| S83 | `GlamProfileEditor.tsx:805` | `` Profilul salvat (revizia {base.revision}) folosește setări pe care acest importator nu le poate aplica: {base.reason}; un import cu profilul de mai jos îl înlocuiește, dacă între timp alt import nu a salvat alt profil. `` | `` The saved profile (revision {base.revision}) uses settings that this importer cannot apply: {base.reason}; an import with the profile below replaces it, if no other import saved another profile in the meantime. `` |
| S84 | `GlamProfileEditor.tsx:813` | `` Fișierul nu are linii de specificații de forma „cheie: valoare”. `` | `` The file has no specification lines of the form “key: value”. `` |
| S85 | `GlamProfileEditor.tsx:819` | `` Cheia din fișier `` | `` Key in the file `` |
| S86 | `GlamProfileEditor.tsx:820` | `` Fapte măsurate (ultima verificare) `` | `` Measured facts (last check) `` |
| S87 | `GlamProfileEditor.tsx:821` | `` Devine `` | `` Becomes `` |
| S88 | `GlamProfileEditor.tsx:822` | `` Eticheta pe site `` | `` Label on the site `` |
| S89 | `GlamProfileEditor.tsx:823` | `` Împărțire `` | `` Split `` |
| S90 | `GlamProfileEditor.tsx:824` | `` Filtru `` | `` Filter `` |
| S91 | `GlamProfileEditor.tsx:845` | `` {fact.rows} rânduri, {fact.products} produse, {fact.distinctValues} valori (cea mai des: {fact.maxValueHolders} produse) `` | `` Rows: {fact.rows}, products: {fact.products}, values: {fact.distinctValues} (most frequent value — products: {fact.maxValueHolders}) `` |
| S92 | `GlamProfileEditor.tsx:846` | `` ex.: {fact.samples.join(" · ")} `` | `` e.g. {fact.samples.join(" · ")} `` |
| S93 | `GlamProfileEditor.tsx:849` | `` nu apare în acest fișier `` | `` not in this file `` |
| S94 | `GlamProfileEditor.tsx:852` | `` sursa colecției `` | `` collection source `` |
| S95 | `GlamProfileEditor.tsx:854` | `` atribut `` | `` attribute `` |
| S96 | `GlamProfileEditor.tsx:855` | `` doar în text `` | `` text only `` |
| S97 | `GlamProfileEditor.tsx:856` | `` nerevizuit `` | `` not reviewed `` |
| S98 | `GlamProfileEditor.tsx:866` | `` valoare întreagă `` | `` whole value `` |
| S99 | `GlamProfileEditor.tsx:867` | `` împarte la virgulă `` | `` split at commas `` |
| S100 | `GlamProfileEditor.tsx:912` | `` Previzualizare — nimic nu a fost scris încă `` | `` Preview — nothing has been written yet `` |
| S101 | `GlamProfileEditor.tsx:921` | `` {count} produse{count > cards.length ? ` — primele ${cards.length}` : ""} `` | `` Products: {count}{count > cards.length ? ` — the first ${cards.length}` : ""} `` |
| S102 | `GlamProfileEditor.tsx:937` | `` Pagina produsului `` | `` Product page `` |
| S103 | `GlamProfileEditor.tsx:948` | `` Rămân ascunse — fără adresă de imagine principală (coloana 9) în fișier ({hidden.length}); se publică doar dacă adăugați imagini principale în fișier `` | `` Stay hidden — no main image address (column 9) in the file ({hidden.length}); published only if you add main images to the file `` |
| S104 | `GlamProfileEditor.tsx:957` | `` Filtrele, după import `` | `` The filters, after the import `` |
| S105 | `GlamProfileEditor.tsx:960` | `` Categoria producătorului: ${categoryLabel(producerId, context)} `` | `` Producer category: ${categoryLabel(producerId, context)} `` |
| S106 | `GlamProfileEditor.tsx:961` | `` Fișierul nu are niciun produs. `` | `` The file has no product. `` |
| S107 | `GlamProfileEditor.tsx:968` | `` Colecția: ${categoryLabel(collectionId, context)} `` | `` Collection: ${categoryLabel(collectionId, context)} `` |
| S108 | `GlamProfileEditor.tsx:970` | `` Nicio colecție separată de categoria producătorului. `` | `` No collection separate from the producer category. `` |
| S109 | `GlamProfileEditor.tsx:972` | `` Magazinul `` | `` Shop `` |
| S110 | `GlamProfileEditor.tsx:984` | `` Fără imagini. `` | `` No images. `` |
| S111 | `GlamProfileEditor.tsx:1015` | `` Descriere (textul publicat) `` | `` Description (the published text) `` |
| S112 | `GlamProfileEditor.tsx:1021` | `` Prea multe filtre selectate — eliminați unul `` | `` Too many filters selected — remove one `` |
| S113 | `GlamProfileEditor.tsx:1039` | `` {panel.path} — {listing.items.length} din {panel.baseCount} produse `` | `` {panel.path} — products: {listing.items.length} of {panel.baseCount} `` |
| S114 | `GlamProfileEditor.tsx:1041` | `` Filtrele din adresă sunt prea lungi și nu au fost aplicate. `` | `` The filters in the address are too long and were not applied. `` |
| S115 | `GlamProfileEditor.tsx:1050` | `` Șterge filtrele `` | `` Clear filters `` |
| S116 | `GlamProfileEditor.tsx:1054` | `` Niciun filtru nu este afișat pe această pagină. `` | `` No filter is shown on this page. `` |

Comments that named a control by its old text (rule 4) — the changed sentence, complete:

| # | New text at | Old sentence (HEAD) | New sentence (candidate) |
|---|---|---|---|
| C9 | `GlamProfileEditor.tsx:22` | `` Copy is Romanian. `` | `` Copy is English (ADMIN-ENGLISH-1). `` |
| C10 | `GlamProfileEditor.tsx:158` | `` What "Importă" may send for the report of a dry run WITHOUT a choice: the profile that report was planned with, and its stored revision (§ 6.2 "the execution is sent with the stored profile as profileChoice and baseRevision = its revision"; the default with `null`). `` | `` What "Import" may send for the report of a dry run WITHOUT a choice: the profile that report was planned with, and its stored revision (§ 6.2 "the execution is sent with the stored profile as profileChoice and baseRevision = its revision"; the default with `null`). `` |
| C11 | `GlamProfileEditor.tsx:286` | `` A rule the admin cannot execute (the backend's acceptance rule) is not restated: the sentence is bounded ("poate") instead. `` | `` A rule the admin cannot execute (the backend's acceptance rule) is not restated: the sentence is bounded ("may") instead. `` |
| C12 | `GlamProfileEditor.tsx:350` | `` CAT-IMAGE-GATE-1: the checkbox "Publică și produsele fără imagine". `` | `` CAT-IMAGE-GATE-1: the checkbox "Also publish products without an image". `` |
| C13 | `GlamProfileEditor.tsx:886` | `` CAT-IMAGE-GATE-1: cards, the product page choice and the panels show only the products the site would publish (`publishedDrafts`: a product waiting for its image copy is marked "imagine de copiat"); the products without a MAIN-image address (column 9; extras never publish) are listed apart as hidden (`hiddenDrafts`). `` | `` CAT-IMAGE-GATE-1: cards, the product page choice and the panels show only the products the site would publish (`publishedDrafts`: a product waiting for its image copy is marked "image to copy"); the products without a MAIN-image address (column 9; extras never publish) are listed apart as hidden (`hiddenDrafts`). `` |

#### `backend/src/import/glam-pricelist.ts`

| # | New text at | Old text (HEAD) | New text (candidate) |
|---|---|---|---|
| S117 | `glam-pricelist.ts:312` | `` Listă de prețuri ${plan.upload.producer} / ${plan.upload.sheet} `` | `` Pricelist ${plan.upload.producer} / ${plan.upload.sheet} `` |

#### `backend/src/import/glam-images.ts`

| # | New text at | Old text (HEAD) | New text (candidate) |
|---|---|---|---|
| S118 | `glam-images.ts:239` | `` Imagini ${producer} / ${sheet} `` | `` Images ${producer} / ${sheet} `` |

#### `tools/mcp-server/src/tool-shapes.ts`

| # | New text at | Old text (HEAD) | New text (candidate) |
|---|---|---|---|
| S119 | `tool-shapes.ts:98` | `` Profil: ${report.profile.source}, ${report.profile.revision === null ? "fără revizie" : `revizia ${report.profile.revision}`} `` | `` Profile: ${report.profile.source}, ${report.profile.revision === null ? "no revision" : `revision ${report.profile.revision}`} `` |
| S120 | `tool-shapes.ts:112` | `` ${x.slug} (rândurile ${x.rowIndexes.join(", ")}) `` | `` ${x.slug} (rows ${x.rowIndexes.join(", ")}) `` |
| S121 | `tool-shapes.ts:113` | `` , și încă ${pub.withoutImageAddress.length - 10} `` | `` , and ${pub.withoutImageAddress.length - 10} more `` |
| S122 | `tool-shapes.ts:116` | `` ${report.dryRun ? "Ar porni ascunse" : "Pornesc ascunse"}: ${pub.startHidden} produse — fiecare devine public când copierea imaginilor („Copiază imaginile” în admin) copiază una dintre imaginile lui. Acest instrument nu copiază imagini: fără copiere, produsele rămân ascunse. `` | `` ${report.dryRun ? "Products that would start hidden" : "Products that start hidden"}: ${pub.startHidden} — each becomes public when the image copy (“Copy images” in admin) copies one of its images. This tool does not copy images: without a copy, the products stay hidden. `` |
| S123 | `tool-shapes.ts:117` | `` Fără adresă de imagine în fișier (rămân ascunse dacă nu adăugați imagini în fișier): ${pub.withoutImageAddress.length} — ${listed} `` | `` No image address in the file (these stay hidden unless you add images to the file): ${pub.withoutImageAddress.length} — ${listed} `` |
| S124 | `tool-shapes.ts:120` | `` Profilul publică și produsele fără imagine: niciun produs nu pornește ascuns. `` | `` The profile also publishes products without an image: no product starts hidden. `` |
| S125 | `tool-shapes.ts:121` | `` Publicate fără adresă de imagine în fișier: ${pub.withoutImageAddress.length} — ${listed} `` | `` Published without an image address in the file: ${pub.withoutImageAddress.length} — ${listed} `` |
| S126 | `tool-shapes.ts:131` | `` Adrese ${report.dryRun ? "care ar fi schimbate" : "schimbate"} (adresa era deja a altui produs; adresa nouă este adresa ocupată, urmată de numele foii și/sau de un număr): ${report.crossSheetSuffixed.length} ${report.crossSheetSuffixed.length === 1 ? "produs" : "produse"} `` | `` Addresses ${report.dryRun ? "that would be changed" : "changed"} (the address already belonged to another product; the new address is the taken address, followed by the sheet's name and/or a number): ${report.crossSheetSuffixed.length} ${report.crossSheetSuffixed.length === 1 ? "product" : "products"} `` |

Comments that named a control by its old text (rule 4) — the changed sentence, complete:

| # | New text at | Old sentence (HEAD) | New sentence (candidate) |
|---|---|---|---|
| C14 | `tool-shapes.ts:109` | `` CAT-IMAGE-GATE-1 § 3 item 7: this tool does not copy images (follow-up CAT-IMAGES-MCP-1), so hidden products stay hidden until someone runs the copy ("Copiază imaginile" in admin, or POST /import/glam-pricelist/images). `` | `` CAT-IMAGE-GATE-1 § 3 item 7: this tool does not copy images (follow-up CAT-IMAGES-MCP-1), so hidden products stay hidden until someone runs the copy ("Copy images" in admin, or POST /import/glam-pricelist/images). `` |

#### `tools/mcp-server/src/index.ts`

| # | New text at | Old text (HEAD) | New text (candidate) |
|---|---|---|---|
| S127 | `index.ts:1147` | `` What the variants are, e.g. Format, Culoare (default: Variantă) `` | `` What the variants are, e.g. Format, Color (default: 'Variantă') `` |

#### Architecture documents (rule 5: one name per control)

| File:line | Old | New |
|---|---|---|
| `admin/ARCHITECTURE.md:158` | "Previzualizează" | "Preview" |
| `admin/ARCHITECTURE.md:178` | the import "poate fi refuzat" | the import "may be refused" |
| `admin/ARCHITECTURE.md:179` | "Publică și produsele fără imagine" | "Also publish products without an image" |
| `admin/ARCHITECTURE.md:182` | "imagine de copiat" | "image to copy" |
| `admin/ARCHITECTURE.md:188` | "Copiază imaginile" | "Copy images" |
| `admin/ARCHITECTURE.md:198` | ("imagine principală", column 9) | ("main image", column 9) |
| `tools/mcp-server/ARCHITECTURE.md:16` | "Profil: <source>, revizia <n>" | "Profile: <source>, revision <n>" |

The required control names (rule 5) and where each now appears: "Copy images" (`GlamPricelistImport.tsx:24, 309, 387,
718, 958`, `tool-shapes.ts:110, 116`, `admin/ARCHITECTURE.md:188`); "Preview" (`GlamPricelistImport.tsx:42, 664`,
`GlamProfileEditor.tsx:697`, `admin/ARCHITECTURE.md:158`); "Import" (`GlamProfileEditor.tsx:158`, a comment);
"Also publish products without an image" (`glamPreview.ts:133`, `GlamPricelistImport.tsx:28`,
`GlamProfileEditor.tsx:350, 739`, `admin/ARCHITECTURE.md:179`); "Use the proposal" (`GlamProfileEditor.tsx:668, 703`);
"Clear filters" (`GlamProfileEditor.tsx:1050`, `glamPreview.ts:288`).

## 4. Romanian lines that stay (ORACLE-AE-1 prints exactly these)

Oracle as corrected by ruling AE-QUOTE-ORACLE (2026-11-14): the character class is `[ăâîșțĂÂÎȘȚşţ„]`. The Romanian
OPENING mark `„` is the evidence of a Romanian quotation; `”` alone is not (it also closes the English pair `“ ”`).

```
grep -nE "[ăâîșțĂÂÎȘȚşţ„]" admin/src/components/GlamPricelistImport.tsx admin/src/components/GlamProfileEditor.tsx \
  admin/src/components/glamPreview.ts tools/mcp-server/src/tool-shapes.ts tools/mcp-server/src/index.ts \
  backend/src/import/glam-pricelist.ts backend/src/import/glam-images.ts
```

| File:line | Text | Reason |
|---|---|---|
| `GlamPricelistImport.tsx:110` | `variantName: "Variantă"` | Rule 2: the form's initial option name, written to products and shown to visitors (`DEFAULT_VARIANT_NAME`). |
| `GlamPricelistImport.tsx:703` | `placeholder="Variantă, Culoare, Format…"` | Rule 2: named by the packet; examples of the stored option name. |
| `GlamProfileEditor.tsx:334` | `COLUMN_ATTRIBUTE_KEYS = ["colecție", "unitate", "împachetare", "comandă minimă"]` | Rule 2: stored attribute keys (backend `glam/profile.ts:28-31`). |
| `GlamProfileEditor.tsx:563` | comment naming the key `colecție` | Rule 4: a comment naming a data key stays. |
| `tool-shapes.ts:52` | comment: the backend defaults it to "Variantă" | Names the data value `DEFAULT_VARIANT_NAME` (rule 2). |
| `index.ts:1147` | `(default: 'Variantă')` | Rule 2: the sentence names the stored default, quoted as it is. |

`backend/src/import/glam-pricelist.ts` and `glam-images.ts`: no line printed. No Romanian quotation mark `„` remains.
The three existing English texts with `“…”` (`GlamPricelistImport.tsx:768, 887, 903`) are byte-identical to HEAD and
are no oracle hits under the corrected class.

## 5. Out-of-allocation hits (listed, NOT edited)

Basis: `grep -nE "[ăâîșțĂÂÎȘȚşţ„”]"` over `admin/src` (all `.ts`/`.tsx` except tests), `backend/src/import`,
`tools/mcp-server/src`, plus a word grep for diacritic-free Romanian (`produs(e)`, `imagine/i`, `fara`, `randul`,
`profilul`, `nu este/poate/se`, `pentru`, `adresa`, …) over the same trees (EXECUTED). A grep is a subset claim, not a
proof of completeness: a Romanian word outside both patterns would be missed.

| File:line | Text | Assessment |
|---|---|---|
| `admin/src/pages/ProductEditor.tsx:883` | `example.com/produs/{form.slug \|\| "product-slug"}` | Shown admin text (search-result preview). Uses a fixed Romanian path segment, not the tenant's product prefix (default `/product`). Candidate for a later slice. |
| `admin/src/pages/Settings.tsx:1582-1583` | `(e.g. "/produs" or "/product")` | English sentence quoting example paths; not a Romanian text. No change proposed. |
| `admin/src/pages/Settings.tsx:1344`, `DeliverySettings.tsx:402, 450` | placeholders with "București" | Rule 2 (named by the packet). |
| `admin/src/pages/Settings.tsx:1592` | `placeholder="/produs"` | Rule 2: the placeholders in `Settings.tsx` are excluded by the packet. The human ruled (2026-11-14) that the Settings / Delivery example placeholders become English in the follow-up slice directly after this one. |
| `admin/src/pages/Settings.tsx:1655` | `placeholder="/lista-mea"` | Same as above. |
| `admin/src/lib/csv-headers.ts`, `backend/src/import/woocommerce.ts` | WooCommerce header maps | Rule 2. |
| `admin/src/pages/FormSubmissions.tsx:117` | comment naming the stored form name "Listă de interes" | Data name; comment. |
| `backend/src/import/glam/{parse,group,map,profile}.ts` | column-header comments, `column: "colecție" \| "produs"`, `DEFAULT_VARIANT_NAME`, `MONEY_WORDS` | Rule 2 (data recognition). The skipped-row `column` member is not shown by the admin (`SKIP_REASONS` shows the reason only) nor by the MCP report. |

Backend messages that the screens or the MCP report show (`glam-pricelist.ts`, `glam-images.ts`, `glam/profile.ts`
`error:` / `reason:` strings): all English (OBSERVED by grep of each `error:` / `reason:` literal).

## 6. Tests changed (expected text only)

- `admin/src/components/glamPreview.test.ts` — 14 expectations pin the new texts (including "the UTC day", which the
  diacritics grep missed and the test run found).
- `admin/src/components/GlamPricelistImport.test.ts` — 31 expectations pin the new texts. Negative counterexamples keep
  their meaning in English: `/will be refused|accepted only/`, `/a value (that )?all (the )?products have (does not
  appear|is not shown)/`, `"can differ"`, `/^No main image address/`. `not.toMatch(/la sfârșit|at the end/)` (line 815)
  is unchanged: it already checks the English form. Four test TITLES named the old copy and would no longer say what the
  test proves: `('poate')` → `('may')`, `automat =` → `auto =`, `mereu overrides` → `always overrides`, `(Romanian)` →
  `(English)`; plus two comments (`"Copiază imaginile"`, `"Previzualizează"`, `(mereu)`). Test data in Romanian
  (`Esență`, `colecție`, `Variantă`, RO facet labels) is data and unchanged.
- `backend/test/unit/glam-images-handler.test.ts:121` — `"Imagini BOEN / PL"` → `"Images BOEN / PL"`.
- `backend/test/unit/glam-profile-golden.test.ts` — the golden preservation test compares every import against a
  BASE capture (`fixtures/glam/cat-import-profile-1-baseline.json`), which holds the audit title
  `"Listă de prețuri <producer> / <sheet>"`. The fixture is not allocated and is, by its contract, a base capture; so it
  stays byte-identical. The test now maps exactly that one member — `target.title` of each captured audit call — to
  `"Pricelist <producer> / <sheet>"` and throws if a captured title is not in the old form. Every other byte is still
  compared. One line: `withEnglishAuditTitles` — test-local function; user: the golden comparison (one call, 4 cases);
  axis: none, it encodes the single intended delta from the base capture; rejected simpler alternative: editing the
  base-capture fixture (not allocated, and it would stop being a base capture).
- `tools/mcp-server/test/tool-shapes.test.ts` — 15 expectations pin the new report texts (absence checks: `"hidden"`,
  `"No image address"`, `"1 products"`, `/at the end/`, `"sheet's name"`).
- `admin/src/pages/Products.test.ts` — pins no replaced text (the admin suite passed unchanged): not edited.
- Round 1 (quote marks, ruling AE-QUOTE-ORACLE): three of the expectations above now pin `“…”` instead of `"…"` —
  `glamPreview.test.ts` `/“image to copy”/`; `GlamPricelistImport.test.ts` the `(without spaces and “mm”)` hint and
  `without the products marked “never”, …`. No count changed.

No test deleted, skipped or weakened.

## 7. Evidence

Round 1 changed source bytes (quotation marks), so every gate below ran again on the FINAL bytes (round 1, 2026-11-14).
Logs: `.agent-manager/slices/ADMIN-ENGLISH-1/gate-logs-r1/` (operational, gitignored).
Round 2 (revision iteration 1) changed only this record (two citation lines, comment-row order): no source byte
changed after the round-1 gate run (checked by file times against `gate-logs-r1/g1.log`), so the table below is the
evidence for the final source bytes. Re-run in round 2 on the same tree: the corrected oracle (six § 4 lines), the scope
/ routes / dependency diffs (empty), `git diff --check` (exit 0), G7 admin 241/241, G9 MCP 13/13 — EXECUTED.
Round 3 (revision iteration 2) changed only this record (the 14 comment rows of § 3, now complete sentences): again no
source byte changed after the round-1 gate run; re-checked in round 3: the corrected oracle, the scope / routes /
dependency diffs, `git diff --check`, `git status` — EXECUTED.

| Check | Command | Result (final bytes) | Label |
|---|---|---|---|
| G1 | `npm --prefix "<repo>" run build` | exit 0 | EXECUTED |
| G2 | `npm --prefix "<repo>" run typecheck` | exit 0 | EXECUTED |
| G3 | `npm --prefix "<repo>/packages/shared" test` | 285/285, exit 0 | EXECUTED |
| G4 | `npm --prefix "<repo>/packages/plugins" test` | 204/204, exit 0 | EXECUTED |
| G5 | `npm --prefix "<repo>/renderer" test` | 398/398, exit 0 | EXECUTED |
| G6 | `npm --prefix "<repo>/renderer" run test:serving` | pass 104, fail 0, exit 0 | EXECUTED |
| G7 | `npm --prefix "<repo>/admin" run test:unit` | 241/241, exit 0 | EXECUTED |
| G8 | `npm --prefix "<repo>/backend" run test:unit` | 1266 passed, 1 skipped (the golden CAPTURE, `skipIf(!CAPTURE_GOLDEN_TO)`, by design), exit 0 | EXECUTED |
| G9 | `npm --prefix "<repo>/tools/mcp-server" test` | route coverage OK, 13/13, exit 0 | EXECUTED |
| G10 | `git -C "<repo>" diff --check` | exit 0 | EXECUTED |
| routes.json | `git diff --stat -- tools/mcp-server/routes.json` | empty | EXECUTED |
| Scope | `git diff --stat -- renderer packages infra` | empty | EXECUTED |
| Dependencies | `git diff --stat -- '*package.json' '*package-lock.json'` | empty | EXECUTED |
| Status | `git status --porcelain -uall` | only the allocated paths of packet § 4 | EXECUTED |
| ORACLE-AE-1 (corrected) | the § 4 grep, class `[ăâîșțĂÂÎȘȚşţ„]` | prints exactly the six § 4 lines | EXECUTED (builder pre-run; the oracle is the operator's) |
| No behaviour change | TypeScript AST of HEAD vs tree, 7 source files: node kinds, identifiers and numbers, with string / template / JSX-text CONTENT dropped | 6 files identical; `GlamProfileEditor.tsx` differs only in `JsxText` nodes at 720, 845, 921, 1039 (English word order puts a label before an interpolation, e.g. `{count} produse` → `Products: {count}`); with `JsxText` nodes removed it is identical | EXECUTED |
| § 3 completeness | AST units of HEAD vs tree (method in § 3) | 127 shown texts and 14 comment sentences differ; all are rows of § 3 | EXECUTED |
| Golden negative control | the golden test before the title mapping was added (round 0) | 4 cases failed, diff shown on the audit `title` lines; with the mapping all 4 pass, so every other compared byte is equal | EXECUTED (round 0) |
| Staging (packet § 5) | operator | — | NOT RUN (operator, after review) |

`<repo>` = `/Users/apple/Documents/APLICATII BIJUTERIE/amodx`. No `git stash`, no commit, no data write; `cd backend &&
npm test` (staging DynamoDB) not run.

## 8. Definition of done, exit criterion, references

- Done when: § 3 wording is approved by the human, the gates of § 7 pass on the reviewed tree, and staging (packet § 5)
  shows the new control names in the deployed admin bundle and an unchanged dry-run report structure.
- Exit criterion: the catalog import feature is English end to end in the admin and the MCP report; a later admin
  language-pack track starts from English source texts.
- References: builder packet ADMIN-ENGLISH-1 (2026-11-14); `docs/slices/locale-1.md` § 1.1 ("admin stays in English"),
  § 10 (common gates); `docs/slices/cat-image-gate-1.md`, `cat-import-profile-1.md` (the features whose copy this
  translates; not edited).

## 9. Operator closeout (2026-11-14)

- **Review.** Three rounds (builder `claude-opus-5-5`, reviewer `gpt-6.1-sol`): escalate → revise → revise → approved.
  No round found a source defect. Rulings: AE-QUOTE-ORACLE (the packet's oracle named `”` as Romanian; it is also the
  English closing mark — corrected class `[ăâîșțĂÂÎȘȚşţ„]`), AE-RECORD (§ 3 rows complete).
- **Operator gates (EXECUTED on the approved tree).** The ten common gates each exit 0: shared 285, plugins 204,
  renderer 398, serving 104/104, admin 241, backend 1266 (1 skipped), MCP 13. Allocation: 15 paths, all allocated;
  `renderer`, `packages`, `infra`, dependency files and `routes.json` unchanged. The corrected ORACLE-AE-1 prints exactly
  the six lines of § 4.
- **Staging (EXECUTED).** `cdk diff -c stage=staging`: code assets only (one API Lambda — `GlamPricelistImportFunc`
  serves both import routes — the admin bundle, the renderer rebuild); no IAM, no parameter, no new resource. Deployed.
  The deployed admin bundle (5 script files) contains "Copy images", "Clear filters", "Use the proposal", "Also publish
  products without an image" and does not contain "Copiază imaginile", "Previzualizează", "Folosește propunerea",
  "Listă de prețuri (glam)". "Șterge filtrele" is still in the bundle: it is the Romanian language pack value
  `facetsClear` (`packages/shared/src/language-packs/ro.ts:242`, shown on the Labels page) — visitor text, not admin
  text. A dry-run import of BOEN `Creation.csv` on tenant `glam-staging` answered 200 with the same report keys.
- **Not proven.** (1) The audit titles on a deployed import: a dry run writes no audit entry; the unit tests pin both
  titles. (2) The 51-URL renderer comparison of packet § 5 was not run: the capture tool was lost with the operator's
  scratch directory, and this slice changes no renderer or shared source (the diff of those trees is empty); three
  `glam-staging` URLs answered as before (200, 200, 307).
- **Wording.** § 3 is the human's review table; a wording change after this commit is a one-line edit each.
- **Human rulings of 2026-11-14 that follow this slice:** the Settings / Delivery / product-editor example
  placeholders become English (`admin-english-2`, next); the attribute names of § 4, the default variant name and the
  interest-list form name, labels and mail come from the tenant's language pack at import time (option A; design
  slice `catalog-data-labels-1`); the WooCommerce header maps stay.
