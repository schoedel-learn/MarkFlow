import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import pdf_pipeline  # noqa: E402


class PageRangeTests(unittest.TestCase):
    def test_iter_page_ranges_uses_chunk_size_until_document_end(self) -> None:
        page_ranges = list(pdf_pipeline.iter_page_ranges(total_pages=5, chunk_size=2))

        self.assertEqual(page_ranges, [[0, 1], [2, 3], [4]])

    def test_iter_page_ranges_honors_max_pages_cap(self) -> None:
        page_ranges = list(
            pdf_pipeline.iter_page_ranges(total_pages=6, chunk_size=2, max_pages=3)
        )

        self.assertEqual(page_ranges, [[0, 1], [2]])


class PromptTests(unittest.TestCase):
    def test_build_prompt_includes_page_span_and_flavor(self) -> None:
        prompt = pdf_pipeline.build_formatting_prompt(
            raw_chunk_md="raw markdown",
            start_page=3,
            end_page=4,
            flavor_name="GitHub Flavored Markdown",
        )

        self.assertIn("pages 3-4", prompt)
        self.assertIn("GitHub Flavored Markdown", prompt)
        self.assertIn("raw markdown", prompt)

    def test_ocr_prompt_mentions_page_number_and_flavor(self) -> None:
        prompt = pdf_pipeline.build_ocr_prompt(
            page_number_one_based=2, flavor_name="GitHub Flavored Markdown"
        )

        self.assertIn("page 2", prompt)
        self.assertIn("GitHub Flavored Markdown", prompt)


def _fake_pymupdf_doc(page_texts: list[str]):
    """Build a minimal pymupdf-like document whose `load_page(i).get_text("text")`
    returns `page_texts[i]`. `len(doc)` returns the page count."""
    doc = MagicMock()
    doc.__len__.return_value = len(page_texts)

    def load_page(index):
        page = MagicMock()
        page.get_text.return_value = page_texts[index]
        pixmap = MagicMock()
        pixmap.tobytes.return_value = b"PNGDATA"
        page.get_pixmap.return_value = pixmap
        return page

    doc.load_page.side_effect = load_page
    doc.close = MagicMock()
    return doc


class AnalyzePagesTests(unittest.TestCase):
    def test_pages_with_little_text_are_flagged_for_ocr(self) -> None:
        fake_doc = _fake_pymupdf_doc(["short", "x" * 200])
        fake_pymupdf = MagicMock(open=MagicMock(return_value=fake_doc))

        with patch.dict(sys.modules, {"pymupdf": fake_pymupdf}):
            results = pdf_pipeline.analyze_pdf_pages("fake.pdf")

        self.assertEqual(len(results), 2)
        self.assertTrue(results[0].needs_ocr)
        self.assertFalse(results[1].needs_ocr)

    def test_pdf_needs_ocr_returns_true_when_any_page_is_image(self) -> None:
        fake_doc = _fake_pymupdf_doc(["x" * 500, ""])
        fake_pymupdf = MagicMock(open=MagicMock(return_value=fake_doc))

        with patch.dict(sys.modules, {"pymupdf": fake_pymupdf}):
            self.assertTrue(pdf_pipeline.pdf_needs_ocr("fake.pdf"))


class ImprovePdfMarkdownTests(unittest.TestCase):
    def _patch_pipeline(self, page_texts: list[str]):
        fake_doc = _fake_pymupdf_doc(page_texts)
        fake_pymupdf = MagicMock(open=MagicMock(return_value=fake_doc))
        fake_pymupdf4llm = MagicMock(to_markdown=MagicMock(return_value="raw chunk md"))
        fake_genai_types = MagicMock()
        fake_genai_types.Part.from_bytes = MagicMock(return_value="image_part")
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = MagicMock(text="cleaned md")
        fake_genai = MagicMock()
        fake_genai.Client.return_value = fake_client
        fake_google_module = MagicMock(genai=fake_genai)

        module_patches = {
            "pymupdf": fake_pymupdf,
            "pymupdf4llm": fake_pymupdf4llm,
            "google": fake_google_module,
            "google.genai": fake_genai,
            "google.genai.types": fake_genai_types,
        }
        return module_patches, fake_client

    def test_ocr_disabled_skips_image_pages(self) -> None:
        module_patches, fake_client = self._patch_pipeline(["", "x" * 500])

        with patch.dict(sys.modules, module_patches):
            result = pdf_pipeline.improve_pdf_markdown(
                pdf_path="fake.pdf",
                api_key="key",
                model="gemini-test",
                chunk_size=2,
                ocr_enabled=False,
            )

        self.assertEqual(result["ocr_pages_used"], 0)
        # Only the text page should produce a chunk; only one text-cleanup call.
        self.assertEqual(fake_client.models.generate_content.call_count, 1)
        self.assertIn("cleaned md", result["markdown"])

    def test_ocr_enabled_processes_image_pages(self) -> None:
        module_patches, fake_client = self._patch_pipeline(["", "x" * 500])

        with patch.dict(sys.modules, module_patches):
            result = pdf_pipeline.improve_pdf_markdown(
                pdf_path="fake.pdf",
                api_key="key",
                model="gemini-test",
                chunk_size=2,
                ocr_enabled=True,
            )

        self.assertEqual(result["ocr_pages_used"], 1)
        self.assertEqual(result["text_pages_processed"], 1)
        # One OCR call plus one text-cleanup call.
        self.assertEqual(fake_client.models.generate_content.call_count, 2)


if __name__ == "__main__":
    unittest.main()