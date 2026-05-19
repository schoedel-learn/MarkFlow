import os
import tempfile
from fastapi import FastAPI, File, UploadFile, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import auth as firebase_auth

from entitlements import is_approved_user
from job_store import create_conversion_job, get_conversion_job
from pdf_pipeline import count_pdf_pages, improve_pdf_markdown
from settings import get_settings
from storage_service import upload_bytes_to_storage

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
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    email = decoded_token.get("email")
    uid = decoded_token.get("uid")
    if not email or not decoded_token.get("email_verified"):
        raise HTTPException(status_code=403, detail="Verified email required")
    if not uid:
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


def _convert_pdf_file(
    temp_path: str,
    *,
    api_key: str,
    model: str,
    chunk_size: int,
    flavor: str,
) -> dict[str, str]:
    final_md = improve_pdf_markdown(
        pdf_path=temp_path,
        api_key=api_key,
        model=model,
        chunk_size=chunk_size,
        flavor_name=_resolve_flavor_name(flavor),
    )
    return {"markdown": final_md}


def _ensure_owner_job(job_id: str, user_id: str) -> dict:
    job = get_conversion_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail='Job not found')
    if job.get('userId') != user_id:
        raise HTTPException(status_code=404, detail='Job not found')
    return job

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
        return _convert_pdf_file(
            temp_path,
            api_key=api_key,
            model="gemini-3.1-pro-preview",
            chunk_size=3,
            flavor=flavor,
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
    verified_email = _get_verified_user_email(authorization)
    if not is_approved_user(verified_email):
        raise HTTPException(status_code=403, detail="Approved access required")

    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Server PDF conversion is not configured")

    temp_path = ""
    try:
        temp_path = await _save_upload_to_temp_pdf(file)
        return _convert_pdf_file(
            temp_path,
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            chunk_size=settings.pdf_chunk_size,
            flavor=flavor,
        )
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
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    _ensure_pdf_filename(file.filename)
    identity = _get_verified_user_identity(authorization)
    if not is_approved_user(identity['email']):
        raise HTTPException(status_code=403, detail='Approved access required')

    content = await _read_upload_bytes(file)
    page_count = _count_pdf_pages_from_bytes(content)
    job = create_conversion_job(
        user_id=identity['uid'],
        user_email=identity['email'],
        filename=file.filename or 'source.pdf',
        size_bytes=len(content),
        page_count=page_count,
    )
    upload_bytes_to_storage(
        job['storageInputPath'],
        content,
        content_type=file.content_type or 'application/pdf',
    )
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
