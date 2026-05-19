from firebase_admin_client import get_firestore_client
from settings import get_settings


def normalize_email(email: str | None) -> str:
    if not email:
        return ""
    return email.strip().lower()


def is_approved_user(email: str | None, firestore_client=None) -> bool:
    canonical_email = normalize_email(email)
    if not canonical_email:
        return False

    settings = get_settings()
    client = firestore_client or get_firestore_client()
    snapshot = (
        client.collection(settings.allowlist_collection)
        .document(canonical_email)
        .get()
    )
    return snapshot.exists and bool((snapshot.to_dict() or {}).get("enabled"))