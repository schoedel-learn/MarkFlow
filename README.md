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
2. Set your Gemini API key in `angular.json` (replace `YOUR_GEMINI_API_KEY`).
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Open:
   - `http://localhost:3000`

## Available scripts

- `npm run dev` — run local dev server on port 3000
- `npm run start` — run Angular dev server
- `npm run build` — build production bundles
- `npm run watch` — build in watch mode
- `npm run test` — run unit tests
- `npm run lint` — run ESLint checks

## Notes

- Firebase runtime configuration is loaded from `firebase-applet-config.json`.
- This repository currently includes Firebase project settings; use your own project config for production environments.
