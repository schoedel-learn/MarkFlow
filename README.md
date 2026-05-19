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

## Hybrid PDF Architecture

MarkFlow now uses a hybrid PDF model:

- Public users: Bring Your Own Gemini key, browser PDF conversion only, capped at 10 MB and 25 pages.
- Approved users: automatic server-managed PDF conversion through the Python API.
- Larger public PDF requests: contact `barry@schoedeldesign.ai`.
- Approved-user background jobs retain source and output artifacts for 30 days.

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

## Cloud Run API Deployment

Firebase Hosting serves the Angular frontend only. The Python API under `markflow-api/` should be deployed separately to Cloud Run.

Build the container from the repo root:

`docker build -f markflow-api/Dockerfile -t markflow-api .`

The Cloud Run service should:

- be named `markflow-api`
- run in `us-central1`
- expose port `8080`
- receive Firebase and Gemini environment variables documented in `docs/superpowers/plans/markflow-cloud-run-env.md`

Firebase Hosting is already configured to rewrite `/api/**` requests to the Cloud Run service.

## PDF utility scripts

The repository also includes two Python utility scripts under `markflow-api/scripts/` for offline PDF-to-Markdown workflows.

Install the Python dependencies first:

`pip install -r markflow-api/requirements.txt`

Extract raw Markdown from a PDF:

`python markflow-api/scripts/extract_pdf_raw.py path/to/file.pdf`

Generate cleaned Markdown with Gemini formatting:

`GEMINI_API_KEY=your-key python markflow-api/scripts/improve_pdf_markdown.py path/to/file.pdf`

Optional flags for the improved formatter:

- `-o, --output` to choose the output path
- `--chunk-size` to control pages per Gemini request
- `--max-pages` to cap processing for partial runs
- `--model` to select a different Gemini model
