import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import entitlements  # noqa: E402


class FakeDocumentSnapshot:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class FakeDocumentReference:
    def __init__(self, docs, path):
        self._docs = docs
        self._path = path

    def get(self):
        return FakeDocumentSnapshot(self._docs.get(self._path))

    def set(self, data, merge=False):
        if merge and self._path in self._docs and isinstance(self._docs[self._path], dict):
            self._docs[self._path] = {**self._docs[self._path], **data}
        else:
            self._docs[self._path] = dict(data)


class FakeCollectionReference:
    def __init__(self, docs, collection_name):
        self._docs = docs
        self._collection_name = collection_name

    def document(self, document_id):
        return FakeDocumentReference(self._docs, f"{self._collection_name}/{document_id}")


class FakeFirestoreClient:
    def __init__(self, docs):
        self._docs = docs

    def collection(self, collection_name):
        return FakeCollectionReference(self._docs, collection_name)


class ApprovedUserTests(unittest.TestCase):
    def test_is_approved_user_accepts_enabled_allowlist_record(self) -> None:
        store = FakeFirestoreClient({"approved_users/user@example.com": {"enabled": True}})

        self.assertTrue(entitlements.is_approved_user("User@Example.com", firestore_client=store))

    def test_is_approved_user_rejects_missing_or_disabled_records(self) -> None:
        store = FakeFirestoreClient({"approved_users/user@example.com": {"enabled": False}})

        self.assertFalse(entitlements.is_approved_user("user@example.com", firestore_client=store))
        self.assertFalse(entitlements.is_approved_user("missing@example.com", firestore_client=store))
        self.assertFalse(entitlements.is_approved_user(None, firestore_client=store))


class OcrQuotaTests(unittest.TestCase):
    NOW = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)

    def test_default_quota_for_enabled_user(self) -> None:
        store = FakeFirestoreClient(
            {"approved_users/user@example.com": {"enabled": True}}
        )

        quota = entitlements.get_user_ocr_quota("user@example.com", firestore_client=store)

        self.assertEqual(quota, entitlements.DEFAULT_OCR_PAGES_PER_MONTH)

    def test_explicit_quota_overrides_default(self) -> None:
        store = FakeFirestoreClient(
            {"approved_users/user@example.com": {"enabled": True, "ocr_pages_per_month": 25}}
        )

        self.assertEqual(
            entitlements.get_user_ocr_quota("user@example.com", firestore_client=store),
            25,
        )

    def test_quota_is_zero_for_disabled_or_missing_users(self) -> None:
        store = FakeFirestoreClient(
            {"approved_users/user@example.com": {"enabled": False, "ocr_pages_per_month": 999}}
        )

        self.assertEqual(
            entitlements.get_user_ocr_quota("user@example.com", firestore_client=store),
            0,
        )
        self.assertEqual(
            entitlements.get_user_ocr_quota("missing@example.com", firestore_client=store),
            0,
        )

    def test_record_ocr_usage_accumulates_within_period(self) -> None:
        store = FakeFirestoreClient(
            {"approved_users/user@example.com": {"enabled": True}}
        )

        first = entitlements.record_ocr_usage(
            "User@Example.com", 3, firestore_client=store, now=self.NOW
        )
        second = entitlements.record_ocr_usage(
            "user@example.com", 4, firestore_client=store, now=self.NOW
        )

        self.assertEqual(first, 3)
        self.assertEqual(second, 7)
        self.assertEqual(
            store._docs.get("ocr_usage/user@example.com_202605", {}).get("pages"),
            7,
        )

    def test_check_ocr_budget_allows_within_remaining_quota(self) -> None:
        store = FakeFirestoreClient(
            {"approved_users/user@example.com": {"enabled": True, "ocr_pages_per_month": 10}}
        )
        entitlements.record_ocr_usage(
            "user@example.com", 6, firestore_client=store, now=self.NOW
        )

        allowed, quota, used = entitlements.check_ocr_budget(
            "user@example.com", 4, firestore_client=store, now=self.NOW
        )

        self.assertTrue(allowed)
        self.assertEqual((quota, used), (10, 6))

    def test_check_ocr_budget_blocks_when_request_exceeds_remaining(self) -> None:
        store = FakeFirestoreClient(
            {"approved_users/user@example.com": {"enabled": True, "ocr_pages_per_month": 10}}
        )
        entitlements.record_ocr_usage(
            "user@example.com", 8, firestore_client=store, now=self.NOW
        )

        allowed, _, _ = entitlements.check_ocr_budget(
            "user@example.com", 3, firestore_client=store, now=self.NOW
        )

        self.assertFalse(allowed)


if __name__ == "__main__":
    unittest.main()