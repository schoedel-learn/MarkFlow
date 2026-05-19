import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import user_keys


class FakeDoc:
    def __init__(self, data=None):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class FakeDocRef:
    def __init__(self, store, key):
        self._store = store
        self._key = key

    def get(self):
        return FakeDoc(self._store.get(self._key))

    def set(self, data, merge=False):
        if merge and self._key in self._store:
            self._store[self._key] = {**self._store[self._key], **data}
        else:
            self._store[self._key] = dict(data)

    def delete(self):
        self._store.pop(self._key, None)


class FakeCollection:
    def __init__(self, store, name):
        self._store = store
        self._name = name

    def document(self, doc_id):
        return FakeDocRef(self._store, f"{self._name}/{doc_id}")


class FakeFirestoreClient:
    def __init__(self):
        self._store = {}

    def collection(self, name):
        return FakeCollection(self._store, name)


class UserKeysTests(unittest.TestCase):
    def test_status_empty_when_missing(self):
        store = FakeFirestoreClient()
        self.assertEqual(
            user_keys.get_user_gemini_key_status("uid-1", firestore_client=store),
            {"hasKey": False, "updatedAt": None},
        )
        self.assertIsNone(user_keys.get_user_gemini_key("uid-1", firestore_client=store))

    def test_set_and_get_roundtrip(self):
        store = FakeFirestoreClient()
        result = user_keys.set_user_gemini_key(
            "uid-1", "user@example.com", "  AIzaSecret  ", firestore_client=store
        )
        self.assertTrue(result["hasKey"])
        self.assertIsNotNone(result["updatedAt"])
        self.assertEqual(
            user_keys.get_user_gemini_key("uid-1", firestore_client=store),
            "AIzaSecret",
        )
        status = user_keys.get_user_gemini_key_status("uid-1", firestore_client=store)
        self.assertTrue(status["hasKey"])
        self.assertEqual(status["updatedAt"], result["updatedAt"])

    def test_set_rejects_empty(self):
        store = FakeFirestoreClient()
        with self.assertRaises(ValueError):
            user_keys.set_user_gemini_key("uid-1", "e@x", "   ", firestore_client=store)

    def test_set_rejects_too_long(self):
        store = FakeFirestoreClient()
        with self.assertRaises(ValueError):
            user_keys.set_user_gemini_key(
                "uid-1", "e@x", "x" * 1024, firestore_client=store
            )

    def test_delete_removes_doc(self):
        store = FakeFirestoreClient()
        user_keys.set_user_gemini_key("uid-1", "e@x", "AIzaSecret", firestore_client=store)
        user_keys.delete_user_gemini_key("uid-1", firestore_client=store)
        self.assertEqual(
            user_keys.get_user_gemini_key_status("uid-1", firestore_client=store),
            {"hasKey": False, "updatedAt": None},
        )

    def test_missing_uid_no_op(self):
        store = FakeFirestoreClient()
        self.assertIsNone(user_keys.get_user_gemini_key("", firestore_client=store))
        self.assertEqual(
            user_keys.get_user_gemini_key_status("", firestore_client=store),
            {"hasKey": False, "updatedAt": None},
        )
        # delete is a no-op for missing uid
        user_keys.delete_user_gemini_key("", firestore_client=store)


if __name__ == "__main__":
    unittest.main()
