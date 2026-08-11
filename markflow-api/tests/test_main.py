import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import main  # noqa: E402


class ApprovedSyncRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def test_convert_pdf_still_requires_user_api_key(self) -> None:
        response = self.client.post(
            "/convert/pdf",
            files={"file": ("sample.pdf", b"%PDF-1.4 sample", "application/pdf")},
            data={"flavor": "auto"},
        )

        self.assertEqual(response.status_code, 422)

    def test_approved_sync_rejects_missing_auth(self) -> None:
        response = self.client.post(
            "/convert/pdf/approved-sync",
            files={"file": ("sample.pdf", b"%PDF-1.4 sample", "application/pdf")},
            data={"user_email": "user@example.com", "flavor": "CommonMark"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"detail": "Authentication required"})

    def test_approved_sync_rejects_invalid_auth(self) -> None:
        with patch.object(main, "verify_firebase_id_token", side_effect=ValueError("bad token")):
            response = self.client.post(
                "/convert/pdf/approved-sync",
                files={"file": ("sample.pdf", b"%PDF-1.4 sample", "application/pdf")},
                data={"user_email": "user@example.com", "flavor": "CommonMark"},
                headers={"Authorization": "Bearer invalid-token"},
            )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {"detail": "Invalid authentication token"})

    def test_approved_sync_rejects_verified_non_approved_email(self) -> None:
        with (
            patch.object(
                main,
                "verify_firebase_id_token",
                return_value={"uid": "uid-1", "email": "member@example.com", "email_verified": True},
            ),
            patch.object(main, "is_approved_user", return_value=False) as approved_mock,
        ):
            response = self.client.post(
                "/convert/pdf/approved-sync",
                files={"file": ("sample.pdf", b"%PDF-1.4 sample", "application/pdf")},
                data={"user_email": "attacker@example.com", "flavor": "CommonMark"},
                headers={"Authorization": "Bearer valid-token"},
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "Approved access required"})
        approved_mock.assert_called_once_with("member@example.com")

    def test_approved_sync_uses_verified_allowlisted_email_and_server_managed_gemini_settings(self) -> None:
        with (
            patch.object(
                main,
                "verify_firebase_id_token",
                return_value={"uid": "uid-1", "email": "approved@example.com", "email_verified": True},
            ),
            patch.object(main, "is_approved_user", return_value=True) as approved_mock,
            patch.object(
                main,
                "improve_pdf_markdown",
                return_value={"markdown": "# converted", "ocr_pages_used": 0, "text_pages_processed": 1},
            ) as improve_mock,
            patch.object(main, "analyze_pdf_pages", return_value=[]),
            patch.object(main, "record_ocr_usage") as record_usage_mock,
            patch.object(main, "get_user_gemini_key", return_value=None),
            patch.object(
                main,
                "get_settings",
                return_value=SimpleNamespace(
                    gemini_api_key="server-key",
                    gemini_model="server-model",
                    pdf_chunk_size=7,
                ),
            ),
        ):
            response = self.client.post(
                "/api/convert/pdf/approved-sync",
                files={"file": ("sample.pdf", b"%PDF-1.4 sample", "application/pdf")},
                data={"user_email": "attacker@example.com", "flavor": "CommonMark"},
                headers={"Authorization": "Bearer valid-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"markdown": "# converted", "ocrPagesUsed": 0})
        approved_mock.assert_called_once_with("approved@example.com")
        improve_mock.assert_called_once()
        self.assertEqual(improve_mock.call_args.kwargs["api_key"], "server-key")
        self.assertEqual(improve_mock.call_args.kwargs["model"], "server-model")
        self.assertEqual(improve_mock.call_args.kwargs["chunk_size"], 7)
        self.assertEqual(improve_mock.call_args.kwargs["flavor_name"], "CommonMark")
        self.assertTrue(improve_mock.call_args.kwargs["ocr_enabled"])
        record_usage_mock.assert_not_called()


class OcrGatingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def _scanned_analysis(self):
        from pdf_pipeline import PageAnalysis

        return [PageAnalysis(page_index=0, text_chars=0, needs_ocr=True)]

    def _text_analysis(self):
        from pdf_pipeline import PageAnalysis

        return [PageAnalysis(page_index=0, text_chars=900, needs_ocr=False)]

    def test_public_convert_rejects_scanned_pdf_with_409(self) -> None:
        with patch.object(main, "analyze_pdf_pages", return_value=self._scanned_analysis()):
            response = self.client.post(
                "/convert/pdf",
                files={"file": ("scan.pdf", b"%PDF-1.4 scan", "application/pdf")},
                data={"api_key": "user-key", "flavor": "auto"},
            )

        self.assertEqual(response.status_code, 409)
        self.assertIn("scanned_pdf_requires_approval", response.json()["detail"])

    def test_approved_sync_blocks_over_budget_ocr_request_with_429(self) -> None:
        with (
            patch.object(
                main,
                "verify_firebase_id_token",
                return_value={"uid": "uid-1", "email": "approved@example.com", "email_verified": True},
            ),
            patch.object(main, "is_approved_user", return_value=True),
            patch.object(main, "get_user_gemini_key", return_value=None),
            patch.object(
                main,
                "get_settings",
                return_value=SimpleNamespace(
                    gemini_api_key="server-key",
                    gemini_model="server-model",
                    pdf_chunk_size=7,
                ),
            ),
            patch.object(main, "analyze_pdf_pages", return_value=self._scanned_analysis()),
            patch.object(main, "check_ocr_budget", return_value=(False, 500, 500)),
            patch.object(main, "improve_pdf_markdown") as improve_mock,
        ):
            response = self.client.post(
                "/api/convert/pdf/approved-sync",
                files={"file": ("scan.pdf", b"%PDF-1.4 scan", "application/pdf")},
                data={"user_email": "approved@example.com", "flavor": "auto"},
                headers={"Authorization": "Bearer valid-token"},
            )

        self.assertEqual(response.status_code, 429)
        self.assertIn("ocr_quota_exceeded", response.json()["detail"])
        improve_mock.assert_not_called()

    def test_approved_sync_records_ocr_usage_on_success(self) -> None:
        with (
            patch.object(
                main,
                "verify_firebase_id_token",
                return_value={"uid": "uid-1", "email": "approved@example.com", "email_verified": True},
            ),
            patch.object(main, "is_approved_user", return_value=True),
            patch.object(main, "get_user_gemini_key", return_value=None),
            patch.object(
                main,
                "get_settings",
                return_value=SimpleNamespace(
                    gemini_api_key="server-key",
                    gemini_model="server-model",
                    pdf_chunk_size=7,
                ),
            ),
            patch.object(main, "analyze_pdf_pages", return_value=self._scanned_analysis()),
            patch.object(main, "check_ocr_budget", return_value=(True, 500, 0)),
            patch.object(
                main,
                "improve_pdf_markdown",
                return_value={"markdown": "# ocr md", "ocr_pages_used": 1, "text_pages_processed": 0},
            ),
            patch.object(main, "record_ocr_usage") as record_usage_mock,
        ):
            response = self.client.post(
                "/api/convert/pdf/approved-sync",
                files={"file": ("scan.pdf", b"%PDF-1.4 scan", "application/pdf")},
                data={"user_email": "approved@example.com", "flavor": "auto"},
                headers={"Authorization": "Bearer valid-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"markdown": "# ocr md", "ocrPagesUsed": 1})
        record_usage_mock.assert_called_once_with("approved@example.com", 1)


class SelfServiceDataRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def _verified(self, **overrides):
        token = {
            "uid": "uid-42",
            "email": "user@example.com",
            "email_verified": True,
        }
        token.update(overrides)
        return token

    def test_flush_conversions_requires_auth(self) -> None:
        response = self.client.delete("/api/me/conversions")
        self.assertEqual(response.status_code, 401)

    def test_flush_conversions_deletes_jobs_and_purges_prefixes(self) -> None:
        with (
            patch.object(main, "verify_firebase_id_token", return_value=self._verified()),
            patch.object(main, "_delete_user_conversion_jobs", return_value=3) as jobs_mock,
            patch.object(main, "_purge_user_storage") as purge_mock,
        ):
            response = self.client.delete(
                "/api/me/conversions",
                headers={"Authorization": "Bearer valid-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deletedJobs": 3})
        jobs_mock.assert_called_once_with("uid-42")
        purge_mock.assert_called_once_with("uid-42")

    def test_delete_account_requires_auth(self) -> None:
        response = self.client.delete("/api/me")
        self.assertEqual(response.status_code, 401)

    def test_delete_account_cascades_everything(self) -> None:
        fake_client = SimpleNamespace(
            collection=lambda name: SimpleNamespace(
                document=lambda uid: SimpleNamespace(delete=lambda: None)
            )
        )
        with (
            patch.object(main, "verify_firebase_id_token", return_value=self._verified()),
            patch.object(main, "_delete_user_conversion_jobs", return_value=2) as jobs_mock,
            patch.object(main, "_purge_user_storage") as purge_mock,
            patch.object(main, "get_firestore_client", return_value=fake_client),
            patch.object(main, "_delete_user_collection_docs", side_effect=[5, 1]) as docs_mock,
            patch.object(main, "delete_user_gemini_key") as gemini_mock,
            patch.object(main, "get_auth_client") as auth_mock,
        ):
            auth_mock.return_value.delete_user = lambda uid: None
            response = self.client.delete(
                "/api/me",
                headers={"Authorization": "Bearer valid-token"},
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["deletedJobs"], 2)
        self.assertEqual(body["deletedErrors"], 5)
        self.assertEqual(body["deletedOcrUsage"], 1)
        self.assertTrue(body["authDeleted"])

        jobs_mock.assert_called_once_with("uid-42")
        purge_mock.assert_called_once_with("uid-42")
        gemini_mock.assert_called_once_with("uid-42", firestore_client=fake_client)

        # Confirm both per-user collection sweeps used the right keys.
        call_kwargs = [c.kwargs for c in docs_mock.call_args_list]
        self.assertEqual(call_kwargs[0]["collection"], "conversion_errors")
        self.assertEqual(call_kwargs[0]["field"], "userId")
        self.assertEqual(call_kwargs[0]["value"], "uid-42")
        self.assertEqual(call_kwargs[1]["collection"], "ocr_usage")
        self.assertEqual(call_kwargs[1]["field"], "email")
        self.assertEqual(call_kwargs[1]["value"], "user@example.com")


if __name__ == "__main__":
    unittest.main()