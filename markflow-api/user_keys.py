"""Per-user backend Gemini API key storage.

Keys are stored in the ``user_gemini_keys`` Firestore collection, keyed by
Firebase Auth uid. Client-side Firestore rules deny all access to that
collection; only the backend admin SDK (this module) reads or writes it.
"""

from __future__ import annotations

from datetime import datetime, timezone

from firebase_admin_client import get_firestore_client


COLLECTION = "user_gemini_keys"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_user_gemini_key(uid: str, firestore_client=None) -> str | None:
    """Return the stored Gemini API key for ``uid`` or ``None`` if absent."""
    if not uid:
        return None
    client = firestore_client or get_firestore_client()
    snapshot = client.collection(COLLECTION).document(uid).get()
    if not snapshot.exists:
        return None
    data = snapshot.to_dict() or {}
    key = data.get("geminiKey")
    if isinstance(key, str) and key:
        return key
    return None


def get_user_gemini_key_status(uid: str, firestore_client=None) -> dict:
    """Return non-sensitive metadata about a stored key (never the key itself)."""
    if not uid:
        return {"hasKey": False, "updatedAt": None}
    client = firestore_client or get_firestore_client()
    snapshot = client.collection(COLLECTION).document(uid).get()
    if not snapshot.exists:
        return {"hasKey": False, "updatedAt": None}
    data = snapshot.to_dict() or {}
    key = data.get("geminiKey")
    has_key = isinstance(key, str) and bool(key)
    return {"hasKey": has_key, "updatedAt": data.get("updatedAt")}


def set_user_gemini_key(
    uid: str,
    email: str,
    key: str,
    firestore_client=None,
) -> dict:
    """Store ``key`` for ``uid``. Returns the new status payload."""
    if not uid:
        raise ValueError("uid is required")
    if not isinstance(key, str):
        raise ValueError("key must be a string")
    normalized = key.strip()
    if not normalized:
        raise ValueError("key must not be empty")
    if len(normalized) > 256:
        raise ValueError("key is too long")

    client = firestore_client or get_firestore_client()
    payload = {
        "geminiKey": normalized,
        "userEmail": email or "",
        "updatedAt": _now_iso(),
    }
    client.collection(COLLECTION).document(uid).set(payload, merge=True)
    return {"hasKey": True, "updatedAt": payload["updatedAt"]}


def delete_user_gemini_key(uid: str, firestore_client=None) -> None:
    if not uid:
        return
    client = firestore_client or get_firestore_client()
    client.collection(COLLECTION).document(uid).delete()
