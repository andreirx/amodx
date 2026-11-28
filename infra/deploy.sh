#!/usr/bin/env bash
# Deploy (or diff) one stage with the renderer's three public build variables set.
#
#   ./deploy.sh prod            show the diff, ask, then deploy
#   ./deploy.sh prod diff       show the diff only
#   ./deploy.sh staging         same, for the staging stage
#   COMMERCE_WRITE_FREEZE_TENANTS=<id,id> ./deploy.sh staging
#                               CMRC-2B (docs/slices/cmrc-2b.md): freeze the commerce writes of these tenants. The list
#                               is the CDK context commerceWriteFreezeTenants; without the variable it is empty (no
#                               tenant frozen), so every deploy that does not name it releases a freeze.
#
# Why this script exists: the renderer build bakes NEXT_PUBLIC_API_URL, NEXT_PUBLIC_USER_POOL_ID and
# NEXT_PUBLIC_USER_POOL_CLIENT_ID into the bundle. A deploy without them ships a renderer that cannot reach the API.
# The values are the Outputs of the stage's own deployed stack, so the script reads them from there. They are not
# printed. A first deploy of a new stage has no stack yet: deploy once by hand, then use this script.
#
# Cleanup: after a diff or a deploy that ended well, the script removes old build output from cdk.out. Every run
# writes each bundled function and the site to cdk.out/asset.<content hash> and nothing ever removes one (18 GB by
# 2026-11-21). Entries older than 24 hours are removed: none of them belongs to this run, and a second run at the same
# time (another stage) keeps its own fresh entries. A removed entry that is still current is written again by the
# next run. A direct `npx cdk ...` does not clean.
set -euo pipefail

stage="${1:-}"
action="${2:-deploy}"
region="${AWS_REGION:-eu-central-1}"

case "$stage" in
  prod)    stack="AmodxStack";         cdk_args=("AmodxStack") ;;
  staging) stack="AmodxStack-staging"; cdk_args=(-c stage=staging --all) ;;
  *) echo "usage: ./deploy.sh <prod|staging> [diff]" >&2; exit 2 ;;
esac
case "$action" in
  deploy|diff) ;;
  *) echo "usage: ./deploy.sh <prod|staging> [diff]" >&2; exit 2 ;;
esac
freeze="${COMMERCE_WRITE_FREEZE_TENANTS:-}"
cdk_args+=(-c "commerceWriteFreezeTenants=$freeze")

output() {
  aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}

NEXT_PUBLIC_API_URL="$(output ApiApiUrlF2D81078)"
NEXT_PUBLIC_USER_POOL_ID="$(output PublicPoolId)"
NEXT_PUBLIC_USER_POOL_CLIENT_ID="$(output PublicClientId)"
for name in NEXT_PUBLIC_API_URL NEXT_PUBLIC_USER_POOL_ID NEXT_PUBLIC_USER_POOL_CLIENT_ID; do
  value="${!name}"
  if [ -z "$value" ] || [ "$value" = "None" ]; then
    echo "deploy.sh: stack $stack has no output for $name; stop." >&2
    exit 1
  fi
done
export NEXT_PUBLIC_API_URL NEXT_PUBLIC_USER_POOL_ID NEXT_PUBLIC_USER_POOL_CLIENT_ID

cd "$(dirname "$0")"

prune_old_build_output() {
  [ -d cdk.out ] || return 0
  # Each old entry is first moved (one atomic rename) into a trash folder, then the trash is deleted. A delete that
  # stops half way (Finder writes .DS_Store files while it runs) then leaves its rest in the trash, never a
  # half-empty asset.<hash> that the next run would take for a complete one.
  local trash="cdk.out/.prune-trash" removed=0 entry
  mkdir -p "$trash"
  while IFS= read -r entry; do
    if mv "$entry" "$trash/"; then removed=$((removed + 1)); fi
  done < <(find cdk.out -maxdepth 1 -name 'asset.*' -mmin +1440)
  rm -rf "$trash" || echo "deploy.sh: a rest of old build output stays in $trash; the next run removes it."
  echo "deploy.sh: removed $removed build output entries older than 24 hours from cdk.out."
}
echo "deploy.sh: stage $stage, stack $stack, region $region; the three public variables are set from the stack outputs."
echo "deploy.sh: commerce write freeze list: ${freeze:-<empty: no tenant frozen>}"

npx cdk diff "${cdk_args[@]}"
if [ "$action" = "diff" ]; then prune_old_build_output; exit 0; fi

printf "Deploy this diff to %s? Type the stage name to continue: " "$stage"
read -r answer
if [ "$answer" != "$stage" ]; then echo "deploy.sh: not deployed."; exit 1; fi
npx cdk deploy "${cdk_args[@]}"
prune_old_build_output
