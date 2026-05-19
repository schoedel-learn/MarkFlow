import sys
import unittest
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


if __name__ == "__main__":
    unittest.main()