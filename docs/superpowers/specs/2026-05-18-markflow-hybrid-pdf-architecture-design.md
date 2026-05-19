# MarkFlow Hybrid PDF Architecture Design

## Goal

Make MarkFlow reliable for the workflows it was designed to support by separating frontend delivery, app state, and PDF conversion compute into the right runtimes.

The design must preserve low-friction public access while giving approved users a more reliable server-managed PDF path.

## Product Model

- Public users authenticate with Google and use Bring Your Own Key for Gemini-backed conversions.
- Public users can convert PDFs through the frontend-only path with hard limits of 10 MB and 25 pages.
- Public users must see a clear message that complex PDFs may still fail within those limits.
- Public users who need larger or more reliable PDF handling are directed to contact barry@schoedeldesign.ai.
- Approved users are identified by an email allowlist stored in Firestore.
- Approved users are routed automatically to the server-managed PDF conversion path.
- Approved-user generated files and source PDFs are retained for 30 days.
- If repeated demand exists for larger public conversions, the contact flow can evolve into a nominal paid access tier.

## Architecture

MarkFlow runs as three connected layers.

### 1. Firebase Hosting

Firebase Hosting serves the Angular frontend only.

Responsibilities:

- Serve the web application.
- Handle Google sign-in through Firebase Auth.
- Render product messaging, conversion UI, job status, and download actions.

Non-responsibilities:

- Do not execute Python.
- Do not hold the server-managed Gemini key.
- Do not handle large-document PDF processing.

### 2. Firebase Firestore and Storage

Firestore is the system of record for user entitlement, usage metadata, job state, and operational visibility.

Firebase Storage holds approved-user source and output artifacts when server-managed processing is used.

Firestore responsibilities:

- Store user profile data.
- Store approved-user email allowlist records.
- Store conversion job records and live status.
- Store usage counters and error metadata.
- Drive frontend subscriptions for progress and completion.

Storage responsibilities:

- Store source PDFs for approved-user server-side processing.
- Store generated Markdown artifacts for retrieval and retry support.
- Retain approved-user artifacts for 30 days.

### 3. Python PDF Service on Cloud Run

Cloud Run hosts the Python FastAPI service and shared PDF pipeline.

Responsibilities:

- Accept approved-user conversion requests.
- Fetch source PDFs from upload or Storage.
- Run PDF extraction and Gemini cleanup using the shared Python pipeline.
- Return results directly for small synchronous jobs.
- Run longer conversions as background jobs and update Firestore status.
- Write output artifacts to Storage for approved-user retrieval.

## Access and Routing Rules

### Public Users

- Must provide their own Gemini API key.
- Use the existing frontend/browser conversion path.
- Are blocked from PDF conversion if the file exceeds 10 MB or 25 pages.
- See a contact message for larger-PDF access: barry@schoedeldesign.ai.
- Use best-effort conversion only, with explicit messaging that large or complex PDFs may still fail below the hard limit.

### Approved Users

- Sign in through Google Auth.
- Are matched against an email allowlist stored in Firestore.
- Automatically use the server-managed PDF path.
- Do not need to provide their own Gemini key for that path.
- Can use synchronous conversion for small jobs and background processing for longer jobs.

## Data Model

### Firestore Collections

`users/{uid}`

- Existing profile and usage data.
- Add resolved entitlement state for UI convenience if needed.

`approved_users/{emailKey}`

- `email`: canonical user email.
- `enabled`: boolean.
- `notes`: optional admin note.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.

`conversion_jobs/{jobId}`

- `userId`: Firebase Auth UID.
- `userEmail`: canonical email.
- `source`: `public_byok` or `approved_server`.
- `inputKind`: `pdf`.
- `status`: `queued`, `processing`, `completed`, `failed`.
- `mode`: `sync` or `background`.
- `originalFilename`: string.
- `sizeBytes`: number.
- `pageCount`: number.
- `storageInputPath`: optional Storage path.
- `storageOutputPath`: optional Storage path.
- `resultPreview`: optional short preview.
- `errorMessage`: optional string.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.
- `expiresAt`: timestamp for retention cleanup.

### Storage Layout

- `pdf-inputs/{uid}/{jobId}/source.pdf`
- `markdown-outputs/{uid}/{jobId}/output.md`

Retention policy:

- Delete approved-user job artifacts after 30 days.
- Delete associated Firestore artifact references when cleanup runs.

## Request Flows

### Public PDF Flow

1. User signs in.
2. User provides Gemini key.
3. Frontend inspects the selected PDF.
4. If the file exceeds 10 MB or 25 pages, block conversion and show the contact message.
5. If within limits, run the existing browser-side PDF conversion path.
6. If conversion fails, show a clear best-effort failure message and preserve the contact option for larger-document help.

### Approved Small-PDF Flow

1. User signs in.
2. Frontend checks Firestore allowlist status.
3. Frontend routes the user to the server-managed PDF path automatically.
4. Frontend uploads the file to the Python service.
5. Python service performs synchronous conversion when the file is small enough.
6. Frontend receives Markdown and downloads or displays it.

### Approved Large-PDF Flow

1. User signs in.
2. Frontend confirms approved entitlement.
3. Frontend sends the file or upload request to the Python service.
4. Python service verifies the request, stores the source PDF when needed, and creates the Firestore job record.
5. Python service processes the job asynchronously.
6. Python service updates Firestore status as the job progresses.
7. Python service writes output Markdown to Storage.
8. Frontend subscribes to the job record and enables download when complete.

## Service Boundaries

The browser remains responsible for lightweight public conversions and user interaction.

The Python backend becomes the only place that should own:

- server-managed Gemini credentials,
- server-side PDF extraction,
- approved-user large-file processing,
- approved-user background job creation,
- Storage-backed artifact generation,
- background job execution.

This keeps MarkFlow aligned with runtime reality: Hosting serves the app, Firestore tracks state, and Cloud Run does compute.

## Error Handling

### Public Flow

- Reject files over the hard limit before conversion begins.
- Show user-facing messages for parse failure, Gemini failure, or browser limits.
- Keep the contact path visible when public processing is unsuitable.

### Approved Flow

- Mark job failures in Firestore with a user-visible error state.
- Preserve partial operational details in logs and error records.
- Allow background jobs to fail without losing job history.
- Preserve artifact references only for successful jobs or useful partial diagnostics.

## Security

- Public users never receive the server-managed Gemini key.
- Allowlist decisions are read from Firestore, but privileged backend execution is enforced server-side.
- Cloud Run uses server-side credentials for Gemini and Storage access.
- Firestore and Storage rules must enforce user isolation for job metadata and artifacts.
- The frontend must never rely on UI-only checks for access control.

## Operational Constraints

- Public PDF conversion is intentionally limited because browser-only PDF parsing is unreliable on larger documents.
- Approved-user server-managed processing exists to provide reliability, not just convenience.
- Synchronous server requests should be reserved for smaller jobs to avoid timeouts.
- Larger jobs should move to a queued background flow.

## Testing Strategy

### Frontend

- Test allowlist-driven routing behavior.
- Test public limit enforcement for size and page count.
- Test contact-message rendering for oversized public PDFs.
- Test job-status subscription handling for approved users.

### Backend

- Test allowlisted-user access checks.
- Test synchronous and background PDF job flows.
- Test Storage write and retrieval paths.
- Test failure-state updates in Firestore.
- Test retention cleanup behavior for 30-day artifacts.

### Integration

- Verify Hosting frontend can authenticate and route correctly.
- Verify approved users can submit PDFs and receive results.
- Verify public users are blocked correctly on oversized PDFs.
- Verify Storage and Firestore records stay consistent across job lifecycle states.

## Rollout Plan

1. Add Firestore allowlist data model and rules updates.
2. Deploy the Python service to Cloud Run.
3. Add frontend entitlement resolution and routing.
4. Add public PDF limit enforcement and contact messaging.
5. Add job records, Storage persistence, and background processing.
6. Add 30-day cleanup automation.

## Recommendation

This hybrid architecture is the correct target for MarkFlow because it preserves public accessibility while moving the app's most failure-prone workflow, PDF conversion, into a runtime that can support it reliably.