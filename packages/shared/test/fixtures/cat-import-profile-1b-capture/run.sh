#!/usr/bin/env bash
# CAT-IMPORT-PROFILE-1B — capture the 1b golden from a base commit (design § 7.3 "1b golden").
# Usage: run.sh <base commit>   (from anywhere; writes packages/shared/test/fixtures/cat-import-profile-1b-baseline.json)
# 1. `git worktree add` the base commit OUTSIDE the repo tree (/tmp/CAT-IMPORT-PROFILE-1B-baseline);
# 2. link the main checkout's node_modules (root + renderer) into it — dependencies only, no source;
# 3. copy this harness into <worktree>/renderer/test/capture/ (+ the config to <worktree>/renderer/);
# 4. run the BASE `renderer/test/unit/facets.test.ts` (recorded through the alias) and the listing capture;
# 5. check the base source files are unmodified (git status of the worktree lists only the harness);
# 6. merge the records into the golden; remove the worktree (trap).
set -euo pipefail
BASE="${1:?base commit}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
WT=/tmp/CAT-IMPORT-PROFILE-1B-baseline
REC="$(mktemp -d /tmp/CAT-IMPORT-PROFILE-1B-records.XXXXXX)"
cleanup() { git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true; rm -rf "$WT" "$REC"; git -C "$REPO" worktree prune; }
trap cleanup EXIT
git -C "$REPO" worktree add --detach "$WT" "$BASE" >/dev/null
ln -s "$REPO/node_modules" "$WT/node_modules"
ln -s "$REPO/renderer/node_modules" "$WT/renderer/node_modules"
mkdir -p "$WT/renderer/test/capture"
cp "$HERE/recorder.ts" "$HERE/setup.ts" "$HERE/listing.capture.ts" "$WT/renderer/test/capture/"
cp "$REPO/packages/shared/test/cat-import-profile-1b-golden.ts" "$WT/renderer/test/capture/golden.ts"
cp "$REPO/renderer/test/unit/memory-dynamo.ts" "$WT/renderer/test/capture/memory-dynamo.ts"
cp "$HERE/vitest.capture.config.ts" "$WT/renderer/vitest.capture.config.ts"
echo "worktree status (only the harness and the node_modules links may appear):"
git -C "$WT" status --porcelain -uall | grep -v -F -e '?? renderer/test/capture/' -e '?? renderer/vitest.capture.config.ts' -e '?? node_modules' -e '?? renderer/node_modules' && { echo "BASE SOURCE MODIFIED"; exit 1; } || true
(cd "$WT/renderer" && CAPTURE_DIR="$REC" "$REPO/node_modules/.bin/vitest" run -c vitest.capture.config.ts)
node "$HERE/merge.mjs" "$REC" "$(git -C "$REPO" rev-parse "$BASE")" "$REPO/packages/shared/test/fixtures/cat-import-profile-1b-baseline.json"
shasum -a 256 "$REPO/packages/shared/test/fixtures/cat-import-profile-1b-baseline.json"
