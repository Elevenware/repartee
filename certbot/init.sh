#!/bin/sh
# Obtain a SAN certificate covering ${AUTHENTIQUE_HOST} and ${REPARTEE_HOST}
# via Cloudflare DNS-01 if one isn't already on disk, then loop forever
# attempting renewal. nginx polls the cert files on its own schedule, so
# no IPC between containers is needed.
set -e

if [ -z "${CERTBOT_EMAIL}" ]; then
  echo "ERROR: CERTBOT_EMAIL is required (set it in .env)" >&2
  exit 1
fi

if [ ! -f /run/secrets/cloudflare.ini ]; then
  echo "ERROR: /run/secrets/cloudflare.ini is missing — copy" >&2
  echo "       certbot/cloudflare.ini.example to certbot/cloudflare.ini" >&2
  echo "       and fill in your Cloudflare API token." >&2
  exit 1
fi

# certbot refuses to use credentials with world/group-readable perms, but
# the bind-mount inherits its mode from the host. Copy to a tmp path and
# tighten perms there.
CREDS=/tmp/cloudflare.ini
cp /run/secrets/cloudflare.ini "$CREDS"
chmod 600 "$CREDS"

STAGING_FLAG=""
if [ "${CERTBOT_STAGING:-0}" = "1" ]; then
  STAGING_FLAG="--staging"
fi

PRIMARY="${AUTHENTIQUE_HOST:-authentique.oidc4j.com}"
SECONDARY="${REPARTEE_HOST:-repartee.oidc4j.com}"

if [ ! -f "/etc/letsencrypt/live/${PRIMARY}/fullchain.pem" ]; then
  echo "[certbot] obtaining cert for ${PRIMARY}, ${SECONDARY}"
  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$CREDS" \
    --dns-cloudflare-propagation-seconds 30 \
    --cert-name "${PRIMARY}" \
    -d "${PRIMARY}" \
    -d "${SECONDARY}" \
    --email "${CERTBOT_EMAIL}" \
    --agree-tos \
    --non-interactive \
    $STAGING_FLAG
else
  echo "[certbot] existing cert found for ${PRIMARY}; skipping initial issuance"
fi

INTERVAL="${CERTBOT_RENEW_INTERVAL:-43200}"  # default 12h
echo "[certbot] entering renewal loop (interval=${INTERVAL}s)"
while :; do
  sleep "$INTERVAL"
  certbot renew \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$CREDS" \
    --dns-cloudflare-propagation-seconds 30 \
    --non-interactive \
    $STAGING_FLAG || echo "[certbot] renewal attempt failed; will retry next cycle"
done
