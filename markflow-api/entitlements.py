from datetime import datetime, timedelta, timezone

from firebase_admin_client import get_firestore_client
from settings import get_settings


# Default monthly OCR page allowance for any approved user that doesn't have
# an explicit `ocr_pages_per_month` override on their allowlist document.
DEFAULT_OCR_PAGES_PER_MONTH = 500

OCR_USAGE_COLLECTION = "ocr_usage"


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


def get_user_ocr_quota(email: str | None, firestore_client=None) -> int:
    """Per-month OCR page budget for `email`. Falls back to the project
    default if the user's allowlist document doesn't override it."""
    canonical_email = normalize_email(email)
    if not canonical_email:
        return 0

    settings = get_settings()
    client = firestore_client or get_firestore_client()
    snapshot = (
        client.collection(settings.allowlist_collection)
        .document(canonical_email)
        .get()
    )
    if not snapshot.exists:
        return 0
    data = snapshot.to_dict() or {}
    if not data.get("enabled"):
        return 0
    raw = data.get("ocr_pages_per_month")
    try:
        quota = int(raw) if raw is not None else DEFAULT_OCR_PAGES_PER_MONTH
    except (TypeError, ValueError):
        quota = DEFAULT_OCR_PAGES_PER_MONTH
    return max(quota, 0)


def _current_period_key(now: datetime | None = None) -> str:
    moment = now or datetime.now(timezone.utc)
    return moment.strftime("%Y%m")


def _usage_doc_id(email: str, period_key: str) -> str:
    return f"{email}_{period_key}"


def get_user_ocr_usage(
    email: str | None, firestore_client=None, now: datetime | None = None
) -> int:
    canonical_email = normalize_email(email)
    if not canonical_email:
        return 0
    client = firestore_client or get_firestore_client()
    doc_id = _usage_doc_id(canonical_email, _current_period_key(now))
    snapshot = client.collection(OCR_USAGE_COLLECTION).document(doc_id).get()
    if not snapshot.exists:
        return 0
    data = snapshot.to_dict() or {}
    try:
        return max(int(data.get("pages", 0)), 0)
    except (TypeError, ValueError):
        return 0


def check_ocr_budget(
    email: str | None,
    additional_pages: int,
    firestore_client=None,
    now: datetime | None = None,
) -> tuple[bool, int, int]:
    """Returns (allowed, quota, current_usage). `allowed` is True only when
    quota - current_usage >= additional_pages."""
    quota = get_user_ocr_quota(email, firestore_client=firestore_client)
    usage = get_user_ocr_usage(email, firestore_client=firestore_client, now=now)
    return (usage + additional_pages) <= quota, quota, usage


def record_ocr_usage(
    email: str | None,
    pages: int,
    firestore_client=None,
    now: datetime | None = None,
) -> int:
    """Increment the current-period OCR page counter and return the new
    total. No-op for empty email or non-positive `pages`. Uses a simple
    read-then-set; the race window is small at expected concurrency."""
    canonical_email = normalize_email(email)
    if not canonical_email or pages <= 0:
        return get_user_ocr_usage(
            email, firestore_client=firestore_client, now=now
        )

    client = firestore_client or get_firestore_client()
    period_key = _current_period_key(now)
    moment_dt = now or datetime.now(timezone.utc)
    moment = moment_dt.isoformat()
    # Keep OCR usage counters for ~60 days past the period they cover, then
    # let Firestore TTL purge them. Long enough to debug a stuck month,
    # short enough that we are not holding per-user usage forever.
    expires_at = moment_dt + timedelta(days=60)
    doc_ref = client.collection(OCR_USAGE_COLLECTION).document(
        _usage_doc_id(canonical_email, period_key)
    )
    snapshot = doc_ref.get()
    existing = 0
    if snapshot.exists:
        data = snapshot.to_dict() or {}
        try:
            existing = max(int(data.get("pages", 0)), 0)
        except (TypeError, ValueError):
            existing = 0
    new_total = existing + pages
    doc_ref.set(
        {
            "email": canonical_email,
            "periodKey": period_key,
            "pages": new_total,
            "updatedAt": moment,
            "expiresAt": expires_at,
        },
        merge=True,
    )
    return new_total
