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