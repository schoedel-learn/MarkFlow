from firebase_admin_client import get_storage_bucket


def upload_bytes_to_storage(
    storage_path: str,
    content: bytes,
    *,
    content_type: str = 'application/octet-stream',
    bucket=None,
) -> str:
    storage_bucket = bucket or get_storage_bucket()
    blob = storage_bucket.blob(storage_path)
    blob.upload_from_string(content, content_type=content_type)
    return storage_path


def upload_text_to_storage(
    storage_path: str,
    content: str,
    *,
    content_type: str = 'text/markdown; charset=utf-8',
    bucket=None,
) -> str:
    return upload_bytes_to_storage(
        storage_path,
        content.encode('utf-8'),
        content_type=content_type,
        bucket=bucket,
    )


def download_bytes_from_storage(storage_path: str, *, bucket=None) -> bytes:
    storage_bucket = bucket or get_storage_bucket()
    blob = storage_bucket.blob(storage_path)
    return blob.download_as_bytes()


def download_text_from_storage(storage_path: str, *, bucket=None) -> str:
    return download_bytes_from_storage(storage_path, bucket=bucket).decode('utf-8')


def delete_blobs_by_prefix(prefix: str, *, bucket=None) -> int:
    """Delete every blob under ``prefix`` and return how many were removed.

    Used by the self-service “flush” and “delete account” endpoints to wipe
    user-scoped storage paths (e.g. ``pdf-inputs/<uid>/`` and
    ``markdown-outputs/<uid>/``). Refuses to operate on an empty prefix so
    a bug can never trigger a bucket-wide deletion.
    """
    if not prefix:
        raise ValueError("prefix is required")
    storage_bucket = bucket or get_storage_bucket()
    deleted = 0
    for blob in storage_bucket.list_blobs(prefix=prefix):
        blob.delete()
        deleted += 1
    return deleted