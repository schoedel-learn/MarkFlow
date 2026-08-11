import os
import tempfile
from fastapi import BackgroundTasks, FastAPI, File, UploadFile, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from firebase_admin import auth as firebase_auth

from entitlements import (
    check_ocr_budget,
    is_approved_user,
    record_ocr_usage,
)
from firebase_admin_client import get_auth_client, get_firebase_app, get_firestore_client
from job_store import build_storage_paths, create_conversion_job, get_conversion_job, update_conversion_job
from pdf_pipeline import (
    analyze_pdf_pages,
    count_pdf_pages,
    improve_pdf_markdown,
)
from settings import get_settings
from storage_service import (
    delete_blobs_by_prefix,
    download_bytes_from_storage,
    download_text_from_storage,
    upload_bytes_to_storage,
    upload_text_to_storage,
)
from user_keys import delete_user_gemini_key, get_user_gemini_key, get_user_gemini_key_status, set_user_gemini_key

app = FastAPI(title="MarkFlow API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
@app.get("/health")
async def health_check():
    return {"status": "ok"}


def verify_firebase_id_token(token: str) -> dict:
    # Ensure the default Firebase app is initialized before verifying tokens.
    # firebase_auth.verify_id_token requires an initialized app, and earlier
    # request paths relied on side effects (e.g. Firestore lookups) to set it
    # up, which is fragile when auth runs first.
    get_firebase_app()
    return firebase_auth.verify_id_token(token)


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authentication required")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    return token


def _get_verified_user_email(authorization: str | None) -> str:
    token = _extract_bearer_token(authorization)
    try:
        decoded_token = verify_firebase_id_token(token)
    except Exception as exc:  # pragma: no cover - exact SDK errors are patched in tests
        print(f"[auth] verify_id_token failed (email helper): {exc}")
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    email = decoded_token.get("email")
    if not email or not decoded_token.get("email_verified"):
        raise HTTPException(status_code=403, detail="Verified email required")
    return email


def _get_verified_user_identity(authorization: str | None) -> dict[str, str]:
    token = _extract_bearer_token(authorization)
    try:
        decoded_token = verify_firebase_id_token(token)
    except Exception as exc:  # pragma: no cover - exact SDK errors are patched in tests
        print(f"[auth] verify_id_token failed: {exc}")
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    email = decoded_token.get("email")
    uid = decoded_token.get("uid") or decoded_token.get("sub") or decoded_token.get("user_id")
    if not email or not decoded_token.get("email_verified"):
        raise HTTPException(status_code=403, detail="Verified email required")
    if not uid:
        print(f"[auth] decoded token missing uid; keys={list(decoded_token.keys())}")
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    return {"uid": uid, "email": email}


async def _read_upload_bytes(file: UploadFile) -> bytes:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty")
    return content


def _count_pdf_pages_from_bytes(content: bytes) -> int:
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name
        return count_pdf_pages(temp_path)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def _ensure_pdf_filename(filename: str | None) -> None:
    if not filename or not filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")


async def _save_upload_to_temp_pdf(file: UploadFile) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        content = await file.read()
        temp_file.write(content)
        return temp_file.name


def _resolve_flavor_name(flavor: str) -> str:
    return flavor if flavor != "auto" else "GitHub Flavored Markdown"


# Standardized error payloads for OCR gating so the frontend can recognize and
# surface a clean upgrade prompt instead of a generic "conversion failed".
OCR_REQUIRED_DETAIL = (
    "scanned_pdf_requires_approval: This PDF appears to be scanned or "
    "image-based. OCR access is currently limited to approved users — email "
    "barry@schoedeldesign.ai with the subject 'Markflow Increased Access' "
    "to request access."
)


def _ocr_quota_exceeded_detail(quota: int, used: int, needed: int) -> str:
    return (
        f"ocr_quota_exceeded: This PDF needs {needed} OCR page(s) but you "
        f"have only {max(quota - used, 0)} of {quota} remaining this month. "
        "Email barry@schoedeldesign.ai for a higher limit."
    )


def _count_pages_needing_ocr(temp_path: str) -> int:
    return sum(1 for analysis in analyze_pdf_pages(temp_path) if analysis.needs_ocr)


def _convert_pdf_file(
    temp_path: str,
    *,
    api_key: str,
    model: str,
    chunk_size: int,
    flavor: str,
    ocr_enabled: bool = False,
) -> dict[str, str | int]:
    result = improve_pdf_markdown(
        pdf_path=temp_path,
        api_key=api_key,
        model=model,
        chunk_size=chunk_size,
        flavor_name=_resolve_flavor_name(flavor),
        ocr_enabled=ocr_enabled,
    )
    return {
        "markdown": result["markdown"],
        "ocrPagesUsed": result.get("ocr_pages_used", 0),
    }


def _ensure_owner_job(job_id: str, user_id: str) -> dict:
    job = get_conversion_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail='Job not found')
    if job.get('userId') != user_id:
        raise HTTPException(status_code=404, detail='Job not found')
    return job


def _save_pdf_bytes_to_temp_file(content: bytes) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as temp_file:
        temp_file.write(content)
        return temp_file.name


def process_pdf_job(job_id: str, flavor: str) -> None:
    job = get_conversion_job(job_id)
    if not job:
        return

    settings = get_settings()
    user_key = get_user_gemini_key(job.get('userId') or '')
    effective_key = user_key or settings.gemini_api_key
    if not effective_key:
        update_conversion_job(job_id, {
            'status': 'failed',
            'errorMessage': 'Server PDF conversion is not configured',
            'flavor': flavor,
        })
        return

    temp_path = ''
    try:
        update_conversion_job(job_id, {'status': 'processing'})
        input_path = job['storageInputPath']
        output_path = build_storage_paths(job['userId'], job_id)[1]
        content = download_bytes_from_storage(input_path)
        temp_path = _save_pdf_bytes_to_temp_file(content)
        result = improve_pdf_markdown(
            pdf_path=temp_path,
            api_key=effective_key,
            model=settings.gemini_model,
            chunk_size=settings.pdf_chunk_size,
            flavor_name=_resolve_flavor_name(flavor),
            ocr_enabled=True,
        )
        ocr_pages_used = int(result.get('ocr_pages_used', 0))
        if ocr_pages_used > 0:
            try:
                record_ocr_usage(job.get('userEmail') or '', ocr_pages_used)
            except Exception as usage_exc:  # pragma: no cover - log only
                print(f"[ocr] failed to record usage for job {job_id}: {usage_exc}")
        upload_text_to_storage(output_path, result['markdown'])
        update_conversion_job(job_id, {
            'status': 'completed',
            'storageOutputPath': output_path,
            'flavor': flavor,
            'ocrPagesUsed': ocr_pages_used,
        })
    except Exception as exc:
        update_conversion_job(job_id, {
            'status': 'failed',
            'errorMessage': str(exc),
            'flavor': flavor,
        })
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/api/convert/pdf")
@app.post("/convert/pdf")
async def convert_pdf(
    file: UploadFile = File(...),
    api_key: str = Form(...),
    flavor: str = Form("auto")
):
    _ensure_pdf_filename(file.filename)

    temp_path = ""
    try:
        temp_path = await _save_upload_to_temp_pdf(file)
        if _count_pages_needing_ocr(temp_path) > 0:
            raise HTTPException(status_code=409, detail=OCR_REQUIRED_DETAIL)
        return _convert_pdf_file(
            temp_path,
            api_key=api_key,
            model="gemini-3.1-pro-preview",
            chunk_size=3,
            flavor=flavor,
            ocr_enabled=False,
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error converting PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/api/convert/pdf/approved-sync")
@app.post("/convert/pdf/approved-sync")
async def convert_pdf_approved_sync(
    file: UploadFile = File(...),
    user_email: str = Form(...),
    flavor: str = Form("auto"),
    authorization: str | None = Header(default=None),
):
    _ensure_pdf_filename(file.filename)
    verified_identity = _get_verified_user_identity(authorization)
    verified_email = verified_identity['email']
    if not is_approved_user(verified_email):
        raise HTTPException(status_code=403, detail="Approved access required")

    settings = get_settings()
    user_key = get_user_gemini_key(verified_identity['uid'])
    effective_key = user_key or settings.gemini_api_key
    if not effective_key:
        raise HTTPException(status_code=503, detail="Server PDF conversion is not configured")

    temp_path = ""
    try:
        temp_path = await _save_upload_to_temp_pdf(file)
        ocr_pages_needed = _count_pages_needing_ocr(temp_path)
        if ocr_pages_needed > 0:
            allowed, quota, used = check_ocr_budget(verified_email, ocr_pages_needed)
            if not allowed:
                raise HTTPException(
                    status_code=429,
                    detail=_ocr_quota_exceeded_detail(quota, used, ocr_pages_needed),
                )
        result = _convert_pdf_file(
            temp_path,
            api_key=effective_key,
            model=settings.gemini_model,
            chunk_size=settings.pdf_chunk_size,
            flavor=flavor,
            ocr_enabled=True,
        )
        ocr_pages_used = int(result.get('ocrPagesUsed', 0) or 0)
        if ocr_pages_used > 0:
            try:
                record_ocr_usage(verified_email, ocr_pages_used)
            except Exception as usage_exc:  # pragma: no cover - log only
                print(f"[ocr] failed to record usage for {verified_email}: {usage_exc}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error converting approved PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post('/api/jobs/pdf')
@app.post('/jobs/pdf')
async def create_pdf_job(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    flavor: str = Form('auto'),
    authorization: str | None = Header(default=None),
):
    _ensure_pdf_filename(file.filename)
    identity = _get_verified_user_identity(authorization)
    if not is_approved_user(identity['email']):
        raise HTTPException(status_code=403, detail='Approved access required')

    content = await _read_upload_bytes(file)
    page_count = _count_pdf_pages_from_bytes(content)

    # Pre-scan for OCR pages so we can reject over-budget jobs before
    # consuming a Cloud Run worker slot.
    temp_path = _save_pdf_bytes_to_temp_file(content)
    try:
        ocr_pages_needed = _count_pages_needing_ocr(temp_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
    if ocr_pages_needed > 0:
        allowed, quota, used = check_ocr_budget(identity['email'], ocr_pages_needed)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail=_ocr_quota_exceeded_detail(quota, used, ocr_pages_needed),
            )

    job = create_conversion_job(
        user_id=identity['uid'],
        user_email=identity['email'],
        filename=file.filename or 'source.pdf',
        flavor=flavor,
        size_bytes=len(content),
        page_count=page_count,
    )
    upload_bytes_to_storage(
        job['storageInputPath'],
        content,
        content_type=file.content_type or 'application/pdf',
    )
    background_tasks.add_task(process_pdf_job, job['jobId'], flavor)
    return {
        'jobId': job['jobId'],
        'status': job['status'],
        'storageInputPath': job['storageInputPath'],
    }


@app.get('/api/jobs/pdf/{job_id}')
@app.get('/jobs/pdf/{job_id}')
async def get_pdf_job(job_id: str, authorization: str | None = Header(default=None)):
    identity = _get_verified_user_identity(authorization)
    return _ensure_owner_job(job_id, identity['uid'])


@app.get('/api/jobs/pdf/{job_id}/markdown')
@app.get('/jobs/pdf/{job_id}/markdown')
async def get_pdf_job_markdown(job_id: str, authorization: str | None = Header(default=None)):
    identity = _get_verified_user_identity(authorization)
    job = _ensure_owner_job(job_id, identity['uid'])
    if job.get('status') != 'completed' or not job.get('storageOutputPath'):
        raise HTTPException(status_code=409, detail='Job output is not ready')
    return {'markdown': download_text_from_storage(job['storageOutputPath'])}


class GeminiKeyPayload(BaseModel):
    geminiKey: str = Field(..., min_length=1, max_length=256)


def _require_approved_identity(authorization: str | None) -> dict[str, str]:
    identity = _get_verified_user_identity(authorization)
    if not is_approved_user(identity['email']):
        raise HTTPException(status_code=403, detail='Approved access required')
    return identity


@app.get('/api/me/gemini-key')
@app.get('/me/gemini-key')
async def get_my_gemini_key(authorization: str | None = Header(default=None)):
    identity = _require_approved_identity(authorization)
    return get_user_gemini_key_status(identity['uid'])


@app.put('/api/me/gemini-key')
@app.put('/me/gemini-key')
async def put_my_gemini_key(
    payload: GeminiKeyPayload,
    authorization: str | None = Header(default=None),
):
    identity = _require_approved_identity(authorization)
    try:
        return set_user_gemini_key(identity['uid'], identity['email'], payload.geminiKey)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete('/api/me/gemini-key')
@app.delete('/me/gemini-key')
async def delete_my_gemini_key(authorization: str | None = Header(default=None)):
    identity = _require_approved_identity(authorization)
    delete_user_gemini_key(identity['uid'])
    return {'hasKey': False, 'updatedAt': None}


def _delete_user_conversion_jobs(uid: str, firestore_client=None) -> int:
    """Delete every conversion_jobs doc owned by ``uid`` along with the
    GCS input/output blobs each one references. Returns the number of
    Firestore docs deleted."""
    client = firestore_client or get_firestore_client()
    query = client.collection('conversion_jobs').where('userId', '==', uid)
    deleted = 0
    for snapshot in query.stream():
        data = snapshot.to_dict() or {}
        for path_key in ('storageInputPath', 'storageOutputPath'):
            storage_path = data.get(path_key)
            if not storage_path:
                continue
            try:
                delete_blobs_by_prefix(storage_path)
            except Exception as exc:  # pragma: no cover - best-effort cleanup
                print(f"[delete-data] failed to delete blob {storage_path}: {exc}")
        snapshot.reference.delete()
        deleted += 1
    return deleted


def _purge_user_storage(uid: str) -> None:
    """Belt-and-suspenders sweep of the per-user storage prefixes in case a
    Firestore job doc was missing or already gone."""
    for prefix in (f'pdf-inputs/{uid}/', f'markdown-outputs/{uid}/'):
        try:
            delete_blobs_by_prefix(prefix)
        except Exception as exc:  # pragma: no cover - best-effort cleanup
            print(f"[delete-data] failed to purge prefix {prefix}: {exc}")


def _delete_user_collection_docs(
    *,
    collection: str,
    field: str,
    value: str,
    firestore_client=None,
) -> int:
    if not value:
        return 0
    client = firestore_client or get_firestore_client()
    query = client.collection(collection).where(field, '==', value)
    deleted = 0
    for snapshot in query.stream():
        snapshot.reference.delete()
        deleted += 1
    return deleted


@app.delete('/api/me/conversions')
@app.delete('/me/conversions')
async def flush_my_conversions(authorization: str | None = Header(default=None)):
    """Self-service flush: removes all conversion jobs (Firestore + GCS) for
    the authenticated user. The account itself is preserved."""
    identity = _get_verified_user_identity(authorization)
    uid = identity['uid']
    deleted_jobs = _delete_user_conversion_jobs(uid)
    _purge_user_storage(uid)
    return {'deletedJobs': deleted_jobs}


@app.delete('/api/me')
@app.delete('/me')
async def delete_my_account(authorization: str | None = Header(default=None)):
    """Self-service account deletion: cascades across Firestore (jobs,
    errors, ocr usage, gemini keys, user profile), GCS (per-user storage
    prefixes), and Firebase Auth (the auth identity itself)."""
    identity = _get_verified_user_identity(authorization)
    uid = identity['uid']
    email = identity.get('email') or ''
    canonical_email = email.strip().lower() if isinstance(email, str) else ''

    deleted_jobs = _delete_user_conversion_jobs(uid)
    _purge_user_storage(uid)

    client = get_firestore_client()
    deleted_errors = _delete_user_collection_docs(
        collection='conversion_errors',
        field='userId',
        value=uid,
        firestore_client=client,
    )
    deleted_ocr = _delete_user_collection_docs(
        collection='ocr_usage',
        field='email',
        value=canonical_email,
        firestore_client=client,
    )

    try:
        delete_user_gemini_key(uid, firestore_client=client)
    except Exception as exc:  # pragma: no cover - best-effort cleanup
        print(f"[delete-data] failed to delete gemini key for {uid}: {exc}")

    try:
        client.collection('users').document(uid).delete()
    except Exception as exc:  # pragma: no cover - best-effort cleanup
        print(f"[delete-data] failed to delete user profile for {uid}: {exc}")

    auth_deleted = False
    try:
        get_auth_client().delete_user(uid)
        auth_deleted = True
    except Exception as exc:
        # firebase_admin raises if the auth record was already gone; that's
        # still a success from the user's POV.
        print(f"[delete-data] auth.delete_user failed for {uid}: {exc}")

    return {
        'deletedJobs': deleted_jobs,
        'deletedErrors': deleted_errors,
        'deletedOcrUsage': deleted_ocr,
        'authDeleted': auth_deleted,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
