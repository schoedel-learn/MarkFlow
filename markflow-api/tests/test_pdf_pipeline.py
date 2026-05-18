import sys
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()