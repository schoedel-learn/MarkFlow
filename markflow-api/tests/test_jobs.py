import sys
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import job_store  # noqa: E402
import main  # noqa: E402


class JobStoreTests(unittest.TestCase):
    def test_build_storage_paths_uses_canonical_pdf_and_markdown_names(self) -> None:
        input_path, output_path = job_store.build_storage_paths('u1', 'job123')

        self.assertEqual(input_path, 'pdf-inputs/u1/job123/source.pdf')
        self.assertEqual(output_path, 'markdown-outputs/u1/job123/output.md')

    def test_create_job_record_sets_background_status_and_expiry(self) -> None:
        record = job_store.create_job_record(
            job_id='job123',
            user_id='u1',
            user_email='user@example.com',
            filename='source.pdf',
            size_bytes=100,
            page_count=12,
            storage_input_path='pdf-inputs/u1/job123/source.pdf',
        )

        self.assertEqual(record['jobId'], 'job123')
        self.assertEqual(record['status'], 'queued')
        self.assertEqual(record['mode'], 'background')
        self.assertEqual(record['source'], 'approved_server')
        self.assertEqual(record['inputKind'], 'pdf')
        self.assertIn('expiresAt', record)

        created_at = datetime.fromisoformat(record['createdAt'])
        expires_at = datetime.fromisoformat(record['expiresAt'])
        self.assertGreater(expires_at, created_at)


class BackgroundJobRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def test_create_pdf_job_requires_authentication(self) -> None:
        response = self.client.post(
            '/api/jobs/pdf',
            files={'file': ('sample.pdf', b'%PDF-1.4 sample', 'application/pdf')},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json(), {'detail': 'Authentication required'})

    def test_create_pdf_job_requires_approved_access(self) -> None:
        with (
            patch.object(main, 'verify_firebase_id_token', return_value={'uid': 'u1', 'email': 'user@example.com', 'email_verified': True}),
            patch.object(main, 'is_approved_user', return_value=False),
        ):
            response = self.client.post(
                '/api/jobs/pdf',
                files={'file': ('sample.pdf', b'%PDF-1.4 sample', 'application/pdf')},
                headers={'Authorization': 'Bearer valid-token'},
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {'detail': 'Approved access required'})

    def test_create_pdf_job_uploads_input_and_creates_job_record(self) -> None:
        with (
            patch.object(main, 'verify_firebase_id_token', return_value={'uid': 'u1', 'email': 'approved@example.com', 'email_verified': True}),
            patch.object(main, 'is_approved_user', return_value=True),
            patch.object(main, 'count_pdf_pages', return_value=9),
            patch.object(main, 'analyze_pdf_pages', return_value=[]),
            patch.object(main, 'upload_bytes_to_storage') as upload_mock,
            patch.object(main, 'process_pdf_job') as process_mock,
            patch.object(main, 'create_conversion_job', return_value={'jobId': 'job123', 'status': 'queued', 'storageInputPath': 'pdf-inputs/u1/job123/source.pdf'}) as create_mock,
        ):
            response = self.client.post(
                '/api/jobs/pdf',
                files={'file': ('sample.pdf', b'%PDF-1.4 sample', 'application/pdf')},
                headers={'Authorization': 'Bearer valid-token'},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'jobId': 'job123', 'status': 'queued', 'storageInputPath': 'pdf-inputs/u1/job123/source.pdf'})
        upload_mock.assert_called_once()
        create_mock.assert_called_once()
        process_mock.assert_called_once_with('job123', 'auto')

    def test_get_pdf_job_returns_owner_job(self) -> None:
        with (
            patch.object(main, 'verify_firebase_id_token', return_value={'uid': 'u1', 'email': 'approved@example.com', 'email_verified': True}),
            patch.object(main, 'get_conversion_job', return_value={'jobId': 'job123', 'userId': 'u1', 'status': 'queued'}) as get_mock,
        ):
            response = self.client.get('/api/jobs/pdf/job123', headers={'Authorization': 'Bearer valid-token'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'jobId': 'job123', 'userId': 'u1', 'status': 'queued'})
        get_mock.assert_called_once_with('job123')

    def test_get_pdf_job_markdown_returns_completed_output_for_owner(self) -> None:
        with (
            patch.object(main, 'verify_firebase_id_token', return_value={'uid': 'u1', 'email': 'approved@example.com', 'email_verified': True}),
            patch.object(main, 'get_conversion_job', return_value={
                'jobId': 'job123',
                'userId': 'u1',
                'status': 'completed',
                'storageOutputPath': 'markdown-outputs/u1/job123/output.md',
            }),
            patch.object(main, 'download_text_from_storage', return_value='# converted') as download_mock,
        ):
            response = self.client.get('/api/jobs/pdf/job123/markdown', headers={'Authorization': 'Bearer valid-token'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'markdown': '# converted'})
        download_mock.assert_called_once_with('markdown-outputs/u1/job123/output.md')

    def test_process_pdf_job_marks_job_completed_and_uploads_output(self) -> None:
        with (
            patch.object(main, 'get_conversion_job', return_value={
                'jobId': 'job123',
                'userId': 'u1',
                'storageInputPath': 'pdf-inputs/u1/job123/source.pdf',
                'originalFilename': 'sample.pdf',
            }),
            patch.object(main, 'download_bytes_from_storage', return_value=b'%PDF-1.4 sample'),
            patch.object(
                main,
                'improve_pdf_markdown',
                return_value={'markdown': '# converted', 'ocr_pages_used': 0, 'text_pages_processed': 1},
            ),
            patch.object(main, 'upload_text_to_storage') as upload_mock,
            patch.object(main, 'update_conversion_job') as update_mock,
            patch.object(main, 'record_ocr_usage') as record_usage_mock,
            patch.object(
                main,
                'get_settings',
                return_value=SimpleNamespace(
                    gemini_api_key='server-key',
                    gemini_model='server-model',
                    pdf_chunk_size=7,
                ),
            ),
        ):
            main.process_pdf_job('job123', 'CommonMark')

        self.assertEqual(update_mock.call_args_list[0].args, ('job123', {'status': 'processing'}))
        self.assertEqual(update_mock.call_args_list[1].args, ('job123', {
            'status': 'completed',
            'storageOutputPath': 'markdown-outputs/u1/job123/output.md',
            'flavor': 'CommonMark',
            'ocrPagesUsed': 0,
        }))
        upload_mock.assert_called_once_with('markdown-outputs/u1/job123/output.md', '# converted')
        record_usage_mock.assert_not_called()


if __name__ == '__main__':
    unittest.main()