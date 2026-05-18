<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e879c0d4-59d6-4a9c-bafd-eefea3708520

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy From GitLab

This repo is set up to deploy to Firebase Hosting from GitLab CI whenever you push to the default branch.

### One-time GitLab setup

Add these CI/CD variables in your GitLab project settings:

1. `FIREBASE_SERVICE_ACCOUNT`
   Add this as a GitLab CI/CD variable containing the Firebase service account JSON with permission to deploy Hosting for project `gen-lang-client-0879285190`.
   A file-type variable is recommended and is supported by the pipeline.
2. `FIREBASE_PROJECT_ID`
   Optional override. If unset, the pipeline defaults to `gen-lang-client-0879285190`.

Recommended variable settings:

- Prefer a file-type variable for `FIREBASE_SERVICE_ACCOUNT`
- Mark `FIREBASE_SERVICE_ACCOUNT` as protected if you only deploy from protected branches

### Pipeline behavior

- Every branch push runs a production build
- Pushes to the default branch also deploy to Firebase Hosting

### Local deploy

If you need to deploy manually from a machine that already has Firebase credentials configured:

`npm run build:prod && npm run deploy:hosting`
