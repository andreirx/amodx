#!/bin/bash
# Store deployment-level reCAPTCHA v3 keys in AWS SSM Parameter Store.
#
# These provide mandatory bot protection for ALL tenants by default.
# Tenants can override with their own keys via Admin > Settings, but cannot disable.
#
# Prerequisites:
#   1. Register at https://www.google.com/recaptcha/admin
#   2. Choose reCAPTCHA v3
#   3. Add ALL tenant domains (+ localhost for dev)
#   4. Copy the Site Key (public) and Secret Key (private)
#
# Usage:
#   ./scripts/setup-recaptcha.sh
#
# The script will prompt for both keys interactively.

set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-eu-central-1}"

echo "=== AMODX reCAPTCHA v3 Setup ==="
echo ""
echo "This stores deployment-level reCAPTCHA keys in AWS SSM Parameter Store."
echo "Region: $REGION"
echo ""

# Prompt for keys (hide secret key input)
read -rp "Site Key (public):  " SITE_KEY
read -rsp "Secret Key (private): " SECRET_KEY
echo ""

if [[ -z "$SITE_KEY" || -z "$SECRET_KEY" ]]; then
    echo "ERROR: Both keys are required."
    exit 1
fi

echo ""
echo "Storing keys in SSM..."

# Site key — plain String (public, embedded in HTML)
aws ssm put-parameter \
    --region "$REGION" \
    --name "/amodx/recaptcha/site-key" \
    --type "String" \
    --value "$SITE_KEY" \
    --overwrite \
    --description "reCAPTCHA v3 site key (public — embedded in HTML for all tenants)"

# Secret key — String (not SecureString: CloudFormation blocks SecureString in Lambda env vars)
aws ssm put-parameter \
    --region "$REGION" \
    --name "/amodx/recaptcha/secret-key" \
    --type "String" \
    --value "$SECRET_KEY" \
    --overwrite \
    --description "reCAPTCHA v3 secret key (private — used by Lambda for server-side verification)"

echo ""
echo "Done. Keys stored:"
echo "  /amodx/recaptcha/site-key    (String)"
echo "  /amodx/recaptcha/secret-key  (String)"
echo ""
echo "Next: deploy with 'cdk deploy' to inject these into Lambda env vars."
