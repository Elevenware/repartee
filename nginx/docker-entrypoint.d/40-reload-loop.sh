#!/bin/sh
# Periodically `nginx -s reload` so that renewed certs in /etc/letsencrypt
# get picked up without restarting the container. Reload is graceful and
# zero-downtime, so reloading on a schedule (rather than on a renewal
# signal from the certbot container) keeps the design dependency-free.

INTERVAL="${NGINX_RELOAD_INTERVAL:-21600}"  # default 6h

(
  while :; do
    sleep "$INTERVAL"
    nginx -s reload 2>&1 || true
  done
) &
