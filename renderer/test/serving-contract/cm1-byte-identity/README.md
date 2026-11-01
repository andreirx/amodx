# CM1-BYTE-IDENTITY — Layer 1 evidence (slice `cat-mode-1`)

Spec: `docs/slices/catalog-mode-1.md` § 3.6; comparison contract amended by § 8.19 "CM1-A1" (human ruling B,
2026-10-29). Code: `../cm1-byte-identity.mjs`. Rows: `cm1-*` in `../contract.test.mjs`.

| Directory | What | Used by |
|---|---|---|
| `baseline/` | The strict byte baseline of rows `cm1-identity-commerce` / `cm1-identity-content`: the renderer of the `cmrc-counties-1` tree answering every CM1 request of the commerce (18), content (14) and catalog (19) fixture tenants (`../fixtures.mjs`, `CM1`). Same layout as before: `<tenant>/<file>.body`, `index.json` (build id; per URL the path, status, Content-Type), `client-modules.json`. Advanced by `locale-1a`, `locale-1b` and `cmrc-counties-1` (history below). | rows `cm1-identity-commerce`, `cm1-identity-content` |
| `control-de4ad52/` | The original baseline: the renderer at commit `de4ad52` (the commit `cat-mode-1` starts from), same layout. Kept unchanged when `locale-1a` advanced `baseline/`, because row `cm1-control` needs the pre-catalog-mode catalog bodies to prove that the detector sees a change. | row `cm1-control` |
| `candidate/` | The same capture set from the `cat-mode-1` tree, written by the gate run recorded in `docs/slices/cat-mode-1.md` § 7 (`CM1_CAPTURE_DIR=… npm run test:serving`). The 32 commerce/content captures are the "after" side of the identity comparison; the 19 catalog captures are the evidence for the negative grep (oracle 5). Not read by any row (each run captures afresh). | the slice record |

## How the de4ad52 set (now `control-de4ad52/`) was produced (EXECUTED 2026-10-29, cycle 3)

```bash
git worktree add --detach /tmp/CAT-MODE-1-baseline de4ad52
cp -cR node_modules /tmp/CAT-MODE-1-baseline/node_modules                 # APFS clone; @amodx/* links are relative,
for d in renderer packages/plugins packages/shared; do                    # so they resolve to the worktree's packages
  cp -cR $d/node_modules /tmp/CAT-MODE-1-baseline/$d/node_modules; done
cd /tmp/CAT-MODE-1-baseline && npm run build -w packages/shared && npm run build -w packages/effects \
  && npm run build -w packages/plugins                                     # de4ad52's own shared + plugins (no _catalogMode)
cp <tree>/renderer/test/serving-contract/{fixtures.mjs,ddb-stub.mjs,cm1-byte-identity.mjs} \
   renderer/test/serving-contract/                                          # same stub data on both sides
cd renderer && node test/serving-contract/cm1-byte-identity.mjs capture <tree>/renderer/test/serving-contract/cm1-byte-identity/baseline
git -C <tree> worktree remove --force /tmp/CAT-MODE-1-baseline
```

`harness.mjs` and `no-dotenv.cjs` were byte-identical in the two trees (`diff -q`), so both sides were built and
served the same way (`next build` + `next start`, credential-free, against the in-process DynamoDB stub).

## The comparison (CM1-A1)

Applied to both sides by `maskBody`, each counted and printed **per compared URL** by the identity rows:
1. flight chunks joined (the `self.__next_f.push` scripts removed from the HTML, decoded, joined);
2. flight rows compared as a sorted set — the HTML outside the payload is compared unsorted, byte for byte;
3. client-reference identity kept: each `I[` row is removed and every `"$L<id>"` use becomes
   `"$L<module path>#<export>"` through the side's own `client-modules.json` (row `cm1-rewire` proves that pointing
   an element at another component, or a row at another module, turns the comparison red). When the encoder outlines
   the export name into its own string row (`21:"ProductImageGallery"`, referenced as `"$21"`), the reference is
   resolved to the name and that row is removed with its client reference — only when nothing else references it
   (`clientRefExportRows`; cycle 3);
4. the footer year `© <four digits>` (from the clock);
plus the ratified masks: `/_next/static/…` asset paths and the build id.

**Not compared** (stated, CM1-A1): the order of rows inside the hydration payload, where the stream cut it into
chunks, and the four digits of the footer year. Why: two builds of ONE tree differed only there (EXECUTED, 5 of 46
bodies, build-0); with the canonicalisations, three independent builds of the current tree differ on 0 of 51 URLs and
each matches the baseline on all 32 commerce/content URLs (cycle 3).

## When a `cm1-identity-*` row fails

A tenant without `catalogMode` now renders different bytes. If that is a regression, fix it. If a later slice
changes those bytes on purpose (the procedure of `docs/slices/locale-1.md` § 8.5, first used by `locale-1a`): it
captures its start commit once with the procedure above into its own immutable `before/`, commits the exact list of
differences (`expected-diff.json`, each with its category) and a row that checks it, and only then re-captures
`baseline/` from its own candidate tree and adds a line to the history below. Never widen a canonicalisation to make a
row pass.

## Baseline history

| Date | Slice | `baseline/` captured from | Reviewed reason for the byte change |
|---|---|---|---|
| 2026-10-29 | `cat-mode-1` | commit `de4ad52` (the set is now `control-de4ad52/`) | — (first baseline) |
| 2026-10-31 | `locale-1a` | the `locale-1a` candidate tree, with `node test/serving-contract/cm1-byte-identity.mjs capture test/serving-contract/cm1-byte-identity/baseline` (run from `renderer/`) | `../locale-1/1a/expected-diff.json`: against the immutable start-commit capture `../locale-1/1a/before/` (from `5841a86`), the en-US commerce and content URLs differ ONLY by category-2 added string props (`Navbar`, `SocialShare`, `CommentsSection` receive their site keys), and the catalog `/shop` pages also by one category-1 pager consolidation (`Page <!-- -->1<!-- --> of <!-- -->2` → `Page 1 of 2`); the visible text is equal (rows `loc1-text-*`, `loc1-diff-1a`; `docs/slices/locale-1a.md`). |
| 2026-11-01 | `locale-1b` | the `locale-1b` candidate tree, with `node test/serving-contract/cm1-byte-identity.mjs capture test/serving-contract/cm1-byte-identity/baseline` (run from `renderer/`) | `../locale-1/1b/expected-diff.json`: against the immutable start-commit capture `../locale-1/1b/before/` (from `4e98f98`), the en-US commerce and content URLs differ ONLY by category-1 count consolidations (`3<!-- --> product<!-- -->s` → `3 products`, `{n} result{s}` likewise) and category-2 string props (the SearchBar's `labels` `$undefined` → the resolved texts; the cart and checkout views' `strings` gain the 21 shared keys of 1b); the visible text is equal (rows `loc1-text-*`, `loc1-diff-1b`; `docs/slices/locale-1b.md`). The catalog captures in this set also show L-EN-CAT (the catalog tenant is not an identity subject). |
| 2026-11-01 | `cmrc-counties-1` | the `cmrc-counties-1` candidate tree, with `node test/serving-contract/cm1-byte-identity.mjs capture test/serving-contract/cm1-byte-identity/baseline` (run from `renderer/`), after its check existed | `../cmrc-counties-1/expected-diff.json` (operator ruling CMRC-COUNTIES-BASELINE: this README's procedure): against the immutable start-commit capture `../cmrc-counties-1/before/` (from `959f288`, made with the procedure above; equal to the previous `baseline/` on all 51 URLs under CM1-A1, EXECUTED), the commerce and content URLs differ ONLY on commerce `/checkout`, in the `CheckoutPageView` prop `defaultRegions` — the 42 county names of the RO country pack (the former `"RO"` fallback) → `[]` (the tenant's real country, `EN`, has no regions; the free-text field it selects renders on the client only). Checked by row `cmrc-counties-diff` (CM1-A1 exactly). The same change is also listed in `../locale-1/1b/expected-diff.json` for row `loc1-diff-1b`. Visible text equal (rows `loc1-text-*`). The catalog captures of this set (not identity subjects) equal `before/` under CM1-A1 except `/category/floors`, the known payload-row variation of that page (F-CATALOG-RSC-ORDER); under the locale resolved-tree comparison it is equal with no listed difference (EXECUTED on this set). |

The `cm1-identity-*` rows keep the CM1-A1 canonicalisations exactly. The locale rows (`loc1-diff-*`) add ONE ruled
comparison on top of CM1-A1 for the payload: since `locale-1b` the resolved-tree comparison (`../locale-1/proof.mjs`
`resolveFlight`; operator ruling LOCALE1B-ROW-CUT = A, 2026-11-01), which replaced the `locale-1a` row renumbering
(LOCALE1A-ROW-IDS = A, 2026-10-31) — every outlined row is resolved into the place that references it, so row labels and
the encoder's size-based row cuts are ignored, nothing else; it does not apply here.

Rule for the next slice (`docs/slices/locale-1.md` § 8.5 rule 5): it starts from this `baseline/`; its own byte changes need its
own `expected-diff.json` against its own start-commit capture, and only then may it re-capture `baseline/`.
