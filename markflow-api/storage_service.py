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