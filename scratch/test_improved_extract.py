import argparse
import os
from pathlib import Path

from google import genai
import pymupdf
import pymupdf4llm


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract Markdown from a PDF and improve formatting with Gemini."
    )
    parser.add_argument("pdf_path", help="Path to the source PDF file.")
    parser.add_argument(
        "-o",
        "--output",
        help="Path for the improved Markdown. Defaults to <pdf>_improved.md.",
    )
    parser.add_argument(
        "--api-key",
        help="Gemini API key. Defaults to the GEMINI_API_KEY environment variable.",
    )
    parser.add_argument(
        "--model",
        default="gemini-1.5-flash",
        help="Gemini model to use for formatting.",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=2,
        help="Number of PDF pages to process in each request.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        help="Optional cap on how many pages to process from the start of the document.",
    )
    return parser.parse_args()


def build_output_path(pdf_path: Path, output: str | None) -> Path:
    if output:
        return Path(output)
    return pdf_path.with_name(f"{pdf_path.stem}_improved.md")


def build_prompt(raw_chunk_md: str, start_page: int, end_page: int) -> str:
    return f"""
    You are an expert document formatter. The following text is raw Markdown extracted from pages {start_page}-{end_page} of a PDF.
    Your task is to cleanly format this into high-quality GitHub Flavored Markdown.

    STRICT RULES:
    1. FIX LINE BREAKS: Join fragmented sentences and paragraphs that were split by page breaks or layout artifacts.
    2. CLEAN TABLES: Ensure all tables are correctly formatted in GFM syntax.
    3. REMOVE ARTIFACTS: Delete redundant page numbers, running headers/footers, or "hidden" duplicate text.
    4. PRESERVE CONTENT: Do not summarize. Keep all dates, names, and liturgical data exactly as provided.
    5. HIERARCHY: Use appropriate heading levels (#, ##, ###).
    6. Output ONLY the raw Markdown.

    RAW DATA:
    {raw_chunk_md}
    """


def resolve_api_key(cli_api_key: str | None) -> str:
    api_key = cli_api_key or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("Provide --api-key or set GEMINI_API_KEY.")
    return api_key


def convert_pdf_improved(
    pdf_path: Path,
    output_path: Path,
    api_key: str,
    model: str,
    chunk_size: int,
    max_pages: int | None,
) -> None:
    if chunk_size <= 0:
        raise ValueError("--chunk-size must be greater than 0.")

    doc = pymupdf.open(str(pdf_path))
    try:
        total_pages = len(doc)
    finally:
        doc.close()

    page_limit = total_pages if max_pages is None else min(max_pages, total_pages)
    client = genai.Client(api_key=api_key)
    full_markdown: list[str] = []

    for i in range(0, page_limit, chunk_size):
        page_range = list(range(i, min(i + chunk_size, page_limit)))
        print(f"Processing pages {page_range} of {page_limit}...")

        raw_chunk_md = pymupdf4llm.to_markdown(str(pdf_path), pages=page_range)
        prompt = build_prompt(raw_chunk_md, i + 1, min(i + chunk_size, page_limit))
        response = client.models.generate_content(model=model, contents=prompt)

        if response.text:
            full_markdown.append(response.text)
        else:
            full_markdown.append(raw_chunk_md)

    output_path.write_text("\n\n---\n\n".join(full_markdown), encoding="utf-8")
    print(f"Done. Saved to {output_path}")


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf_path).expanduser().resolve()
    if not pdf_path.exists():
        print(f"File not found: {pdf_path}")
        return 1

    output_path = build_output_path(pdf_path, args.output)
    api_key = resolve_api_key(args.api_key)
    convert_pdf_improved(
        pdf_path=pdf_path,
        output_path=output_path,
        api_key=api_key,
        model=args.model,
        chunk_size=args.chunk_size,
        max_pages=args.max_pages,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
