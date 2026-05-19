from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from firebase_admin_client import get_firestore_client


def build_storage_paths(user_id: str, job_id: str) -> tuple[str, str]:
    return (
        f'pdf-inputs/{user_id}/{job_id}/source.pdf',
        f'markdown-outputs/{user_id}/{job_id}/output.md',
    )


def create_job_record(
    *,
    job_id: str,
    user_id: str,
    user_email: str,
    filename: str,
    size_bytes: int,
    page_count: int,
    storage_input_path: str,
) -> dict[str, str | int]:
    now = datetime.now(timezone.utc)
    return {
        'jobId': job_id,
        'userId': user_id,
        'userEmail': user_email,
        'source': 'approved_server',
        'inputKind': 'pdf',
        'status': 'queued',
        'mode': 'background',
        'originalFilename': filename,
        'sizeBytes': size_bytes,
        'pageCount': page_count,
        'storageInputPath': storage_input_path,
        'createdAt': now.isoformat(),
        'updatedAt': now.isoformat(),
        'expiresAt': (now + timedelta(days=30)).isoformat(),
    }


def create_conversion_job(
    *,
    user_id: str,
    user_email: str,
    filename: str,
    size_bytes: int,
    page_count: int,
    firestore_client=None,
) -> dict[str, str | int]:
    client = firestore_client or get_firestore_client()
    job_id = uuid4().hex
    storage_input_path, _ = build_storage_paths(user_id, job_id)
    record = create_job_record(
        job_id=job_id,
        user_id=user_id,
        user_email=user_email,
        filename=filename,
        size_bytes=size_bytes,
        page_count=page_count,
        storage_input_path=storage_input_path,
    )
    client.collection('conversion_jobs').document(job_id).set(record)
    return record


def get_conversion_job(job_id: str, firestore_client=None) -> dict | None:
    client = firestore_client or get_firestore_client()
    snapshot = client.collection('conversion_jobs').document(job_id).get()
    if not snapshot.exists:
        return None
    return snapshot.to_dict()