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


if __name__ == "__main__":
    unittest.main()