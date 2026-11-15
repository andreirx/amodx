#!/usr/bin/env bash
# Deploy (or diff) one stage with the renderer's three public build variables set.
#
#   ./deploy.sh prod            show the diff, ask, then deploy
#   ./deploy.sh prod diff       show the diff only
#   ./deploy.sh staging         same, for the staging stage
#
# Why this script exists: the renderer build bakes NEXT_PUBLIC_API_URL, NEXT_PUBLIC_USER_POOL_ID and
# NEXT_PUBLIC_USER_POOL_CLIENT_ID into the bundle. A deploy without them ships a renderer that cannot reach the API.
# The values are the Outputs of the stage's own deployed stack, so the script reads them from there. They are not
# printed. A first deploy of a new stage has no stack yet: deploy once by hand, then use this script.
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
echo "deploy.sh: stage $stage, stack $stack, region $region; the three public variables are set from the stack outputs."

npx cdk diff "${cdk_args[@]}"
if [ "$action" = "diff" ]; then exit 0; fi

printf "Deploy this diff to %s? Type the stage name to continue: " "$stage"
read -r answer
if [ "$answer" != "$stage" ]; then echo "deploy.sh: not deployed."; exit 1; fi
npx cdk deploy "${cdk_args[@]}"
