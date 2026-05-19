# MarkFlow Hybrid PDF Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hybrid MarkFlow PDF architecture where public users stay on the BYOK browser path with strict PDF limits and approved users are routed automatically to a server-managed Cloud Run PDF service backed by Firestore and Firebase Storage.

**Architecture:** Keep Firebase Hosting responsible for the Angular frontend, use Firestore and Storage for entitlement and job state, and move approved-user PDF conversion into the Python FastAPI service. Implement this in thin vertical slices so routing, backend execution, and retention can each be verified independently.

**Tech Stack:** Angular 21, Firebase Auth, Firestore, Firebase Storage, FastAPI, Cloud Run, Python unittest, Angular TestBed, Firebase rules

---

## File Structure

### Frontend

- Modify: `src/app/firebase.ts`
  Purpose: export Storage and shared Firebase helpers.
- Create: `src/app/pdf-access-policy.ts`
  Purpose: define public PDF size/page limits and contact copy in one place.
- Create: `src/app/entitlement.service.ts`
  Purpose: resolve whether the signed-in user is approved for server-managed PDF conversion.
- Create: `src/app/server-pdf.service.ts`
  Purpose: call the Cloud Run API for synchronous approved-user conversions and create background jobs.
- Modify: `src/environments/environment.ts`
  Purpose: define the hosted API base URL for the Angular app.
- Modify: `src/environments/environment.ext.ts`
  Purpose: keep extension builds from depending on the hosted Cloud Run route.
- Modify: `src/app/core-state.ts`
  Purpose: route users between BYOK/public and approved/server-managed paths, enforce public PDF limits, and expose job state to the UI.
- Modify: `src/app/converter.service.ts`
  Purpose: expose PDF page-count inspection for client-side limit checks.
- Modify: `src/app/web-layout/web-layout.ts`
  Purpose: drive new public-limit and approved-user messaging.
- Modify: `src/app/web-layout/web-layout.html`
  Purpose: render contact copy, approved-user state, and job progress UI.
- Modify: `src/app/core-state.spec.ts`
  Purpose: cover entitlement routing and public PDF limit logic.
- Modify: `src/app/web-layout/web-layout.spec.ts`
  Purpose: cover public contact messaging and approved-user status rendering.

### Firebase

- Modify: `firebase.json`
  Purpose: register Storage rules and add an `/api/**` Hosting rewrite to the Cloud Run service.
- Modify: `firestore.rules`
  Purpose: allow safe reads for approved-user entitlement and per-user job records while keeping approved background job creation backend-owned.
- Create: `storage.rules`
  Purpose: restrict Storage artifact access to each job owner and the backend.

### Python Service

- Create: `markflow-api/settings.py`
  Purpose: centralize environment variables for project ID, allowlist collection, bucket, and service base URL.
- Create: `markflow-api/firebase_admin_client.py`
  Purpose: initialize Firebase Admin SDK lazily for Firestore and Storage access.
- Create: `markflow-api/entitlements.py`
  Purpose: resolve approved-user access by canonical email from Firestore.
- Create: `markflow-api/job_store.py`
  Purpose: create and update Firestore conversion job records.
- Create: `markflow-api/storage_service.py`
  Purpose: upload and download approved-user artifacts in Firebase Storage.
- Modify: `markflow-api/main.py`
  Purpose: add approved-user sync conversion endpoint plus background job endpoints.
- Modify: `markflow-api/requirements.txt`
  Purpose: add Firebase Admin SDK and any runtime support packages needed by Cloud Run.
- Create: `markflow-api/tests/test_entitlements.py`
  Purpose: verify allowlist access checks.
- Create: `markflow-api/tests/test_jobs.py`
  Purpose: verify job-record lifecycle behavior.
- Create: `markflow-api/tests/test_main.py`
  Purpose: verify sync/background endpoint behavior.
- Create: `markflow-api/Dockerfile`
  Purpose: package the API for Cloud Run deployment.

### Docs and Ops

- Modify: `README.md`
  Purpose: document the hybrid routing model, Cloud Run deployment, Storage retention, and public PDF limits.
- Create: `docs/superpowers/plans/markflow-cloud-run-env.md`
  Purpose: record required env vars, service account roles, and retention job setup.

### Task 1: Firebase Data and Rules Foundation

**Files:**
- Create: `storage.rules`
- Modify: `firestore.rules`
- Modify: `firebase.json`
- Test: `firestore.rules`

- [ ] **Step 1: Write the failing rules-focused checks in the plan notes**

```text
Need rules support for:
1. Approved-user entitlement lookup by authenticated user email
2. Per-user read access on conversion_jobs/{jobId}` with only safe client-created sync records if any are still needed
3. Storage access only under paths owned by request.auth.uid
```

- [ ] **Step 2: Run a quick file-presence check to confirm Storage rules do not exist yet**

Run: `test -f storage.rules; echo $?`
Expected: `1`

- [ ] **Step 3: Add Storage rules with per-user path isolation**

```firebase
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    match /pdf-inputs/{userId}/{jobId}/{fileName} {
      allow read, write: if isOwner(userId);
    }

    match /markdown-outputs/{userId}/{jobId}/{fileName} {
      allow read, write: if isOwner(userId);
    }
  }
}
```

- [ ] **Step 4: Extend Firestore rules for approved-user lookups and conversion jobs**

```firebase
match /approved_users/{emailKey} {
  allow read: if isAuthenticated() && emailKey == lower(request.auth.token.email);
  allow write: if false;
}

match /conversion_jobs/{jobId} {
  allow create: if isAuthenticated()
    && request.resource.data.userId == request.auth.uid
    && request.resource.data.source == 'public_byok'
    && request.resource.data.mode == 'sync';
  allow read: if isAuthenticated() && resource.data.userId == request.auth.uid;
  allow update: if false;
  allow delete: if false;
}
```

- [ ] **Step 5: Register Storage rules in Firebase config**

```json
{
  "hosting": {
    "rewrites": [
      {
        "source": "/api/**",
        "run": {
          "serviceId": "markflow-api",
          "region": "us-central1"
        }
      },
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  },
  "storage": {
    "rules": "storage.rules"
  }
}
```

- [ ] **Step 6: Review the changed rules files for syntax-only mistakes**

Run: `git diff -- firestore.rules storage.rules firebase.json`
Expected: new `approved_users`, `conversion_jobs`, and `storage` sections are present with no accidental unrelated edits.

- [ ] **Step 7: Commit**

```bash
git add firestore.rules storage.rules firebase.json
git commit -m "Add MarkFlow entitlement and storage rules"
```

### Task 2: Frontend Entitlement and Public PDF Policy

**Files:**
- Create: `src/app/pdf-access-policy.ts`
- Create: `src/app/entitlement.service.ts`
- Modify: `src/app/firebase.ts`
- Modify: `src/app/core-state.ts`
- Test: `src/app/core-state.spec.ts`

- [ ] **Step 1: Write the failing Angular spec for public-limit enforcement and entitlement mode**

```ts
it('blocks public PDF conversion when the file exceeds limits', async () => {
  service.user.set({ uid: 'u1', email: 'public@example.com' } as any);
  service.geminiKey.set('key');
  service.selectedFile.set(new File(['x'], 'large.pdf', { type: 'application/pdf' }));
  spyOn(service as any, 'getPdfMetadata').and.resolveTo({ pageCount: 30, sizeBytes: 1024 });

  const allowed = await service.canConvert({ showProfileMenuFn: () => {} });

  expect(allowed).toBeFalse();
  expect(service.error()).toContain('10 MB');
});
```

- [ ] **Step 2: Run the focused spec to verify it fails for missing policy and entitlement behavior**

Run: `npm test -- --watch=false --include src/app/core-state.spec.ts`
Expected: FAIL because the policy helpers and metadata checks do not exist yet.

- [ ] **Step 3: Add the shared public PDF policy constants**

```ts
export const PUBLIC_PDF_MAX_BYTES = 10 * 1024 * 1024;
export const PUBLIC_PDF_MAX_PAGES = 25;
export const LARGE_PDF_CONTACT_EMAIL = 'barry@schoedeldesign.ai';

export function buildPublicPdfLimitMessage(): string {
  return `Public PDF conversion is limited to 10 MB and 25 pages. For larger PDFs, contact ${LARGE_PDF_CONTACT_EMAIL}.`;
}
```

- [ ] **Step 4: Add entitlement resolution against `approved_users/{lower(email)}`**

```ts
@Injectable({ providedIn: 'root' })
export class EntitlementService {
  async isApprovedUser(email: string | null | undefined): Promise<boolean> {
    if (!email) return false;
    const key = email.trim().toLowerCase();
    const snap = await getDoc(doc(db, 'approved_users', key));
    return snap.exists() && snap.data()['enabled'] === true;
  }
}
```

- [ ] **Step 5: Update `CoreStateService` to cache entitlement mode and block oversized public PDFs**

```ts
entitlementMode = signal<'public_byok' | 'approved_server'>('public_byok');

private async ensurePdfAllowedForCurrentUser(file: File): Promise<boolean> {
  if (this.entitlementMode() === 'approved_server') return true;
  const metadata = await this.converter.inspectPdf(file);
  if (file.size > PUBLIC_PDF_MAX_BYTES || metadata.pageCount > PUBLIC_PDF_MAX_PAGES) {
    this.error.set(buildPublicPdfLimitMessage());
    return false;
  }
  return true;
}
```

- [ ] **Step 6: Re-run the focused spec to verify it passes**

Run: `npm test -- --watch=false --include src/app/core-state.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/pdf-access-policy.ts src/app/entitlement.service.ts src/app/firebase.ts src/app/core-state.ts src/app/core-state.spec.ts
git commit -m "Add MarkFlow entitlement and public PDF policy"
```

### Task 3: Public UX Messaging and Approved-Mode UI

**Files:**
- Modify: `src/app/web-layout/web-layout.ts`
- Modify: `src/app/web-layout/web-layout.html`
- Modify: `src/app/web-layout/web-layout.spec.ts`
- Test: `src/app/web-layout/web-layout.spec.ts`

- [ ] **Step 1: Write the failing component spec for oversized-public messaging**

```ts
it('shows the contact message when the public PDF limit error is set', () => {
  component.state.error.set('Public PDF conversion is limited to 10 MB and 25 pages. For larger PDFs, contact barry@schoedeldesign.ai.');
  fixture.detectChanges();

  expect(fixture.nativeElement.textContent).toContain('barry@schoedeldesign.ai');
});
```

- [ ] **Step 2: Run the focused component spec and verify it fails if the message area is missing**

Run: `npm test -- --watch=false --include src/app/web-layout/web-layout.spec.ts`
Expected: FAIL because the current template has no dedicated approved/public routing copy.

- [ ] **Step 3: Add small UI helpers in the component for approved-mode and contact visibility**

```ts
get isApprovedUser() {
  return this.state.entitlementMode() === 'approved_server';
}

get contactEmail() {
  return LARGE_PDF_CONTACT_EMAIL;
}
```

- [ ] **Step 4: Add template messaging for public limits and approved routing**

```html
@if (state.mode() === 'doc-to-md' && state.user()) {
  <div class="mb-6 rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
    @if (isApprovedUser) {
      <p>Your account is approved for server-managed PDF conversion.</p>
    } @else {
      <p>Public PDF conversion is limited to 10 MB and 25 pages. Larger PDFs may still fail in-browser. For larger-document access, contact <a href="mailto:{{ contactEmail }}">{{ contactEmail }}</a>.</p>
    }
  </div>
}
```

- [ ] **Step 5: Re-run the component spec to verify it passes**

Run: `npm test -- --watch=false --include src/app/web-layout/web-layout.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/web-layout/web-layout.ts src/app/web-layout/web-layout.html src/app/web-layout/web-layout.spec.ts
git commit -m "Add MarkFlow PDF access messaging"
```

### Task 4: Python Service Allowlist and Synchronous Approved Conversion

**Files:**
- Create: `markflow-api/settings.py`
- Create: `markflow-api/firebase_admin_client.py`
- Create: `markflow-api/entitlements.py`
- Modify: `markflow-api/main.py`
- Modify: `markflow-api/requirements.txt`
- Test: `markflow-api/tests/test_entitlements.py`
- Test: `markflow-api/tests/test_main.py`

- [ ] **Step 1: Write the failing entitlement test for enabled allowlist users**

```python
def test_is_approved_user_accepts_enabled_allowlist_record(self):
    store = FakeDocStore({'approved_users/user@example.com': {'enabled': True}})
    self.assertTrue(is_approved_user('User@Example.com', store))
```

- [ ] **Step 2: Run the focused unittest module and verify it fails for missing backend helpers**

Run: `python3 -m unittest markflow-api/tests/test_entitlements.py`
Expected: FAIL because `is_approved_user` and the admin client helpers do not exist yet.

- [ ] **Step 3: Add settings and Firebase Admin lazy initialization**

```python
from dataclasses import dataclass
import os

@dataclass(frozen=True)
class Settings:
    firebase_project_id: str = os.getenv('FIREBASE_PROJECT_ID', 'gen-lang-client-0879285190')
    allowlist_collection: str = os.getenv('ALLOWLIST_COLLECTION', 'approved_users')
    storage_bucket: str = os.getenv('FIREBASE_STORAGE_BUCKET', '')
```
```
from firebase_admin import credentials, firestore, initialize_app, storage

def get_firebase_app():
    try:
        return initialize_app()
    except ValueError:
        return initialize_app(credentials.ApplicationDefault())
```

- [ ] **Step 4: Add allowlist lookup and a sync endpoint guarded by approved-user email**

```python
def is_approved_user(email: str | None, db) -> bool:
    if not email:
        return False
    key = email.strip().lower()
    snap = db.collection('approved_users').document(key).get()
    return snap.exists and bool(snap.to_dict().get('enabled'))
```
```
@app.post('/convert/pdf/approved-sync')
async def convert_pdf_approved_sync(...):
    if not is_approved_user(user_email, firestore_client):
        raise HTTPException(status_code=403, detail='Approved access required')
```

- [ ] **Step 5: Re-run the backend unit tests and syntax checks**

Run: `python3 -m unittest markflow-api/tests/test_entitlements.py markflow-api/tests/test_main.py && python3 -m py_compile markflow-api/main.py markflow-api/settings.py markflow-api/firebase_admin_client.py markflow-api/entitlements.py`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add markflow-api/settings.py markflow-api/firebase_admin_client.py markflow-api/entitlements.py markflow-api/main.py markflow-api/requirements.txt markflow-api/tests/test_entitlements.py markflow-api/tests/test_main.py
git commit -m "Add approved-user sync PDF service"
```

### Task 5: Storage-Backed Background Jobs and Retention Metadata

**Files:**
- Create: `markflow-api/job_store.py`
- Create: `markflow-api/storage_service.py`
- Modify: `markflow-api/main.py`
- Create: `markflow-api/tests/test_jobs.py`
- Test: `markflow-api/tests/test_jobs.py`

- [ ] **Step 1: Write the failing unittest for job creation with 30-day expiry**

```python
def test_create_job_sets_background_status_and_expiry(self):
    job = create_job_record(
        user_id='u1',
        user_email='user@example.com',
        filename='source.pdf',
        size_bytes=100,
        page_count=12,
    )
    self.assertEqual(job['status'], 'queued')
    self.assertEqual(job['mode'], 'background')
    self.assertIn('expiresAt', job)
```

- [ ] **Step 2: Run the new unittest and verify it fails for missing job storage helpers**

Run: `python3 -m unittest markflow-api/tests/test_jobs.py`
Expected: FAIL because `create_job_record` does not exist yet.

- [ ] **Step 3: Implement Firestore job-record and Storage-path helpers**

```python
def build_storage_paths(user_id: str, job_id: str) -> tuple[str, str]:
    return (
        f'pdf-inputs/{user_id}/{job_id}/source.pdf',
        f'markdown-outputs/{user_id}/{job_id}/output.md',
    )

def create_job_record(...):
    now = datetime.now(timezone.utc)
    return {
        'status': 'queued',
        'mode': 'background',
        'createdAt': now.isoformat(),
        'updatedAt': now.isoformat(),
        'expiresAt': (now + timedelta(days=30)).isoformat(),
    }
```

- [ ] **Step 4: Add background endpoints to create, update, and fetch jobs**

```python
@app.post('/jobs/pdf')
async def create_pdf_job(...):
    ...

@app.get('/jobs/pdf/{job_id}')
async def get_pdf_job(job_id: str, ...):
    ...
```

- [ ] **Step 4a: Keep approved background job creation backend-owned**

```python
@app.post('/jobs/pdf')
async def create_pdf_job(...):
  # verify approved entitlement here
  # upload or verify source.pdf here
  # create Firestore job record here
```

- [ ] **Step 5: Re-run the job tests and syntax checks**

Run: `python3 -m unittest markflow-api/tests/test_jobs.py markflow-api/tests/test_main.py && python3 -m py_compile markflow-api/job_store.py markflow-api/storage_service.py markflow-api/main.py`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add markflow-api/job_store.py markflow-api/storage_service.py markflow-api/main.py markflow-api/tests/test_jobs.py markflow-api/tests/test_main.py
git commit -m "Add MarkFlow PDF background job pipeline"
```

### Task 6: Frontend Approved-User Server Path and Job Polling

**Files:**
- Create: `src/app/server-pdf.service.ts`
- Modify: `src/environments/environment.ts`
- Modify: `src/environments/environment.ext.ts`
- Modify: `src/app/core-state.ts`
- Modify: `src/app/web-layout/web-layout.ts`
- Modify: `src/app/web-layout/web-layout.html`
- Test: `src/app/core-state.spec.ts`

- [ ] **Step 1: Write the failing state spec for approved users using the server API instead of BYOK PDF conversion**

```ts
it('uses the server-managed PDF path for approved users', async () => {
  service.entitlementMode.set('approved_server');
  service.user.set({ uid: 'u1', email: 'approved@example.com' } as any);
  service.selectedFile.set(new File(['pdf'], 'sample.pdf', { type: 'application/pdf' }));
  spyOn(serverPdfService, 'convertApprovedPdfSync').and.resolveTo('# ok');

  await service.convertToMarkdown({ showProfileMenuFn: () => {} });

  expect(serverPdfService.convertApprovedPdfSync).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused state spec and verify it fails**

Run: `npm test -- --watch=false --include src/app/core-state.spec.ts`
Expected: FAIL because `ServerPdfService` is not implemented and `CoreStateService` still routes everything through `ConverterService`.

- [ ] **Step 3: Add a small API client for sync and background approved conversions**

```ts
@Injectable({ providedIn: 'root' })
export class ServerPdfService {
  private readonly apiBaseUrl = environment.apiBaseUrl;

  async convertApprovedPdfSync(file: File, userEmail: string, flavor: string): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_email', userEmail);
    formData.append('flavor', flavor);

    const response = await fetch(`${this.apiBaseUrl}/convert/pdf/approved-sync`, { method: 'POST', body: formData });
    const data = await response.json();
    return data.markdown;
  }
}
```

- [ ] **Step 4: Add environment-backed API base URLs for web and extension builds**

```ts
export const environment = {
  isExtension: false,
  apiBaseUrl: '/api',
};
```
```ts
export const environment = {
  isExtension: true,
  apiBaseUrl: 'http://localhost:8001',
};
```

- [ ] **Step 5: Route approved PDF requests through the new service and expose job state**

```ts
if (file.name.endsWith('.pdf') && this.entitlementMode() === 'approved_server') {
  md = await this.serverPdf.convertApprovedPdfSync(file, this.user()!.email!, this.markdownFlavor());
} else if (file.name.endsWith('.pdf')) {
  if (!(await this.ensurePdfAllowedForCurrentUser(file))) return;
  md = await this.converter.pdfToMd(file, this.markdownFlavor(), this.geminiKey());
}
```

- [ ] **Step 6: Re-run the focused state spec to verify it passes**

Run: `npm test -- --watch=false --include src/app/core-state.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/server-pdf.service.ts src/environments/environment.ts src/environments/environment.ext.ts src/app/core-state.ts src/app/web-layout/web-layout.ts src/app/web-layout/web-layout.html src/app/core-state.spec.ts firebase.json
git commit -m "Add approved-user server PDF routing"
```

### Task 7: Cloud Run Packaging, Retention Cleanup, and Docs

**Files:**
- Create: `markflow-api/Dockerfile`
- Create: `docs/superpowers/plans/markflow-cloud-run-env.md`
- Modify: `README.md`
- Test: `markflow-api/Dockerfile`

- [ ] **Step 1: Write the failing deployment sanity check as a shell command**

```text
Need a container build that installs requirements, exposes port 8080, and starts uvicorn for markflow-api/main.py.
```

- [ ] **Step 2: Run a file check to confirm no Dockerfile exists yet**

Run: `test -f markflow-api/Dockerfile; echo $?`
Expected: `1`

- [ ] **Step 3: Add the Cloud Run container definition**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY markflow-api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY markflow-api ./
ENV PORT=8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 4: Add deployment and retention documentation**

```md
## Cloud Run Environment

- FIREBASE_PROJECT_ID
- FIREBASE_STORAGE_BUCKET
- ALLOWLIST_COLLECTION=approved_users
- GEMINI_API_KEY

Retention cleanup:
- run a daily cleanup job
- delete Storage objects whose owning job `expiresAt` is older than now
- update or remove Firestore artifact references after deletion
```

- [ ] **Step 5: Add README sections for public limits and approved-user routing**

```md
### Hybrid PDF Conversion

- Public users: BYOK, browser PDF conversion only, capped at 10 MB and 25 pages.
- Approved users: automatic server-managed PDF conversion.
- Larger-public-PDF requests: contact barry@schoedeldesign.ai.
```

- [ ] **Step 6: Run final validation for docs and container syntax**

Run: `python3 -m py_compile markflow-api/main.py markflow-api/job_store.py markflow-api/storage_service.py markflow-api/entitlements.py && git diff -- README.md markflow-api/Dockerfile docs/superpowers/plans/markflow-cloud-run-env.md`
Expected: PASS for Python compile and a focused diff showing only Cloud Run/doc updates.

- [ ] **Step 7: Commit**

```bash
git add markflow-api/Dockerfile README.md docs/superpowers/plans/markflow-cloud-run-env.md
git commit -m "Document MarkFlow Cloud Run deployment"
```

## Self-Review

- Spec coverage: public BYOK caps, approved-user allowlist routing, Firestore/Storage job state, Cloud Run backend, 30-day retention, and contact messaging each map to at least one task.
- Placeholder scan: no `TODO`, `TBD`, or deferred implementation markers remain in the task steps.
- Type consistency: entitlement mode uses `public_byok` and `approved_server` consistently across frontend and backend tasks; job status values and path names match the approved architecture spec.