# MarkFlow Cloud Run Environment

## Required Environment Variables

- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `ALLOWLIST_COLLECTION=approved_users`
- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-3.1-pro-preview`
- `PDF_CHUNK_SIZE=3`

## Required Service Permissions

- Firestore read/write access for `approved_users` and `conversion_jobs`
- Firebase Storage access for `pdf-inputs/*` and `markdown-outputs/*`
- Permission to verify Firebase Auth ID tokens

## Cloud Run Deployment Notes

- Service name: `markflow-api`
- Expected region: `us-central1`
- Firebase Hosting rewrites `/api/**` to this service
- The service must expose port `8080`

## Retention Cleanup

- Run a daily cleanup job against `conversion_jobs`
- Delete Storage objects when `expiresAt` is in the past
- Remove or update Firestore artifact references after cleanup
- Retention target for approved-user artifacts is 30 days
