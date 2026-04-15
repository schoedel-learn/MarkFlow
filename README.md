<div align="center">
  <img width="1200" height="475" alt="MarkFlow Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MarkFlow

MarkFlow is an Angular-based document conversion app focused on Markdown workflows.

## What it does

- Convert **Markdown** into:
  - **PDF**
  - **Word (.docx)**
  - **Plain text (.txt)**
- Convert **documents** into **Markdown**:
  - **.docx**
  - **.pdf**
  - **.html**
  - **.txt**
- Supports multiple Markdown flavors (Auto, GFM, CommonMark, Pandoc, and more)
- Includes Google Sign-In and Firebase-backed usage/error tracking

## Tech stack

- Angular 21
- TypeScript
- Angular Material + Tailwind CSS
- Firebase (Auth + Firestore)
- Conversion libraries: `marked`, `turndown`, `mammoth`, `pdfjs-dist`, `jspdf`, `docx`
- Gemini API (`@google/genai`) for HTML → Markdown enhancement

## Prerequisites

- Node.js 20+
- npm

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure your Gemini API key as a build-time `GEMINI_API_KEY` value using a local, non-committed method.
   Example:
   - create a local `.env.local` with `GEMINI_API_KEY=your_key_here`
   - inject that value into your local build/run configuration
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Open:
   - `http://localhost:3000`

## Available scripts

- `npm run dev` — run `ng serve` on `0.0.0.0:3000` with live reload disabled
- `npm run start` — run plain `ng serve` (Angular default host/port, typically `localhost:4200`)
- `npm run build` — build production bundles
- `npm run watch` — build in watch mode
- `npm run test` — run unit tests
- `npm run lint` — run ESLint checks

## Notes

- Firebase runtime configuration is loaded from `firebase-applet-config.json`.
- Use your own Firebase project settings and keep sensitive configuration outside version control for production deployments.
- For local setup, create/update `firebase-applet-config.json` using values from your Firebase project settings (Project ID, App ID, API key, Auth domain, Storage bucket, Messaging sender ID, and Firestore database ID).
