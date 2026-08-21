#!/bin/sh

set -eu

# Memos treats an instance without MEMOS_INSTANCE_URL as private. Derive the URL
# from Vercel's runtime variables so a fresh Vercel deployment opens on the public
# Explore feed for anonymous visitors. An explicitly configured URL always wins.
if [ -z "${MEMOS_INSTANCE_URL:-}" ]; then
  vercel_instance_host=""

  if [ "${VERCEL_ENV:-}" = "production" ] && [ -n "${VERCEL_PROJECT_PRODUCTION_URL:-}" ]; then
    vercel_instance_host="${VERCEL_PROJECT_PRODUCTION_URL}"
  elif [ -n "${VERCEL_URL:-}" ]; then
    vercel_instance_host="${VERCEL_URL}"
  elif [ -n "${VERCEL_PROJECT_PRODUCTION_URL:-}" ]; then
    vercel_instance_host="${VERCEL_PROJECT_PRODUCTION_URL}"
  fi

  if [ -n "${vercel_instance_host}" ]; then
    case "${vercel_instance_host}" in
      http://*|https://*) MEMOS_INSTANCE_URL="${vercel_instance_host}" ;;
      *) MEMOS_INSTANCE_URL="https://${vercel_instance_host}" ;;
    esac
    export MEMOS_INSTANCE_URL
  fi
fi

exec /usr/local/bin/memos \
  --addr "${MEMOS_ADDR:-0.0.0.0}" \
  --port "${PORT:-5230}"
