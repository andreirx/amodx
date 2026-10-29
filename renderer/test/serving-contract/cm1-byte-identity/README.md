# CM1-BYTE-IDENTITY — Layer 1 evidence (slice `cat-mode-1`)

Spec: `docs/slices/catalog-mode-1.md` § 3.6; comparison contract amended by § 8.19 "CM1-A1" (human ruling B,
2026-10-29). Code: `../cm1-byte-identity.mjs`. Rows: `cm1-*` in `../contract.test.mjs`.

| Directory | What | Used by |
|---|---|---|
| `baseline/` | The renderer at commit `de4ad52` — the commit `cat-mode-1` starts from — answering every CM1 request of the commerce (18), content (14) and catalog (19) fixture tenants (`../fixtures.mjs`, `CM1`): `<tenant>/<file>.body`, `index.json` (build id; per URL the path, status, Content-Type), `client-modules.json` (that build's client-module id → module path map, read from its `*_client-reference-manifest.js` files). | rows `cm1-identity-commerce`, `cm1-identity-content`, `cm1-control` |
| `candidate/` | The same capture set from the `cat-mode-1` tree, written by the gate run recorded in `docs/slices/cat-mode-1.md` § 7 (`CM1_CAPTURE_DIR=… npm run test:serving`). The 32 commerce/content captures are the "after" side of the identity comparison; the 19 catalog captures are the evidence for the negative grep (oracle 5). Not read by any row (each run captures afresh). | the slice record |

## How `baseline/` was produced (EXECUTED 2026-10-29, cycle 3)

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
changes those bytes on purpose, it re-captures `baseline/` from its own start commit with the procedure above and
records the change in its slice document. Never widen a canonicalisation to make a row pass.
