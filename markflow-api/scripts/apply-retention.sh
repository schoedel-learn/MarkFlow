#!/usr/bin/env zsh
# Apply the 30-day delete lifecycle to MarkFlow's Cloud Storage bucket and
# enable Firestore TTL on the collections that carry an `expiresAt` field.
#
# Run from the repository root:
#   ./markflow-api/scripts/apply-retention.sh
#
# Requires: gcloud auth, project set to gen-lang-client-0879285190.

set -euo pipefail

PROJECT_ID="${MARKFLOW_PROJECT_ID:-gen-lang-client-0879285190}"
DATABASE_ID="${MARKFLOW_FIRESTORE_DB:-ai-studio-e879c0d4-59d6-4a9c-bafd-eefea3708520}"
BUCKET="${MARKFLOW_STORAGE_BUCKET:-}"
LIFECYCLE_FILE="$(cd "$(dirname "$0")"/.. && pwd)/gcs-lifecycle.json"

if [[ -z "$BUCKET" ]]; then
  # Auto-detect: prefer the newer .firebasestorage.app default, fall back to .appspot.com.
  for candidate in "${PROJECT_ID}.firebasestorage.app" "${PROJECT_ID}.appspot.com"; do
    if gcloud storage buckets describe "gs://${candidate}" --project="$PROJECT_ID" >/dev/null 2>&1; then
      BUCKET="$candidate"
      break
    fi
  done
fi

if [[ -z "$BUCKET" ]]; then
  echo "ERROR: could not detect storage bucket. Set MARKFLOW_STORAGE_BUCKET." >&2
  exit 1
fi

echo "==> Applying GCS lifecycle to gs://${BUCKET}"
gcloud storage buckets update "gs://${BUCKET}" \
  --lifecycle-file="$LIFECYCLE_FILE" \
  --project="$PROJECT_ID"

echo "==> Enabling Firestore TTL on conversion_jobs.expiresAt"
gcloud firestore fields ttls update expiresAt \
  --collection-group=conversion_jobs \
  --enable-ttl \
  --database="$DATABASE_ID" \
  --project="$PROJECT_ID" || true

echo "==> Enabling Firestore TTL on conversion_errors.expiresAt"
gcloud firestore fields ttls update expiresAt \
  --collection-group=conversion_errors \
  --enable-ttl \
  --database="$DATABASE_ID" \
  --project="$PROJECT_ID" || true

echo "==> Enabling Firestore TTL on ocr_usage.expiresAt"
gcloud firestore fields ttls update expiresAt \
  --collection-group=ocr_usage \
  --enable-ttl \
  --database="$DATABASE_ID" \
  --project="$PROJECT_ID" || true

echo "Done. Note: Firestore TTL activation can take up to 24 hours to begin deleting documents."
