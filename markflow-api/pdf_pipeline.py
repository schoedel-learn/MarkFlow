from pathlib import Path
from typing import Iterable


DEFAULT_FLAVOR_NAME = "GitHub Flavored Markdown"


def count_pdf_pages(pdf_path: str | Path) -> int:
    import pymupdf

    doc = pymupdf.open(str(pdf_path))
    try:
        return len(doc)
    finally:
        doc.close()


def iter_page_ranges(
    total_pages: int, chunk_size: int, max_pages: int | None = None
) -> Iterable[list[int]]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than 0.")

    page_limit = total_pages if max_pages is None else min(max_pages, total_pages)
    for page_index in range(0, page_limit, chunk_size):
        yield list(range(page_index, min(page_index + chunk_size, page_limit)))


def extract_raw_markdown(pdf_path: str | Path, pages: list[int] | None = None) -> str:
    import pymupdf4llm

    return pymupdf4llm.to_markdown(str(pdf_path), pages=pages)


def build_formatting_prompt(
    raw_chunk_md: str,
    start_page: int,
    end_page: int,
    flavor_name: str = DEFAULT_FLAVOR_NAME,
) -> str:
    return f"""
    You are an expert document formatter. The following text is raw Markdown extracted from pages {start_page}-{end_page} of a PDF.
    Your task is to cleanly format this into high-quality {flavor_name}.

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


def improve_pdf_markdown(
    pdf_path: str | Path,
    api_key: str,
    model: str,
    chunk_size: int,
    max_pages: int | None = None,
    flavor_name: str = DEFAULT_FLAVOR_NAME,
) -> str:
    from google import genai

    total_pages = count_pdf_pages(pdf_path)
    client = genai.Client(api_key=api_key)
    full_markdown: list[str] = []

    for page_range in iter_page_ranges(total_pages, chunk_size, max_pages=max_pages):
        print(f"Processing pages {page_range} of {total_pages}...")
        raw_chunk_md = extract_raw_markdown(pdf_path, pages=page_range)
        prompt = build_formatting_prompt(
            raw_chunk_md=raw_chunk_md,
            start_page=page_range[0] + 1,
            end_page=page_range[-1] + 1,
            flavor_name=flavor_name,
        )
        response = client.models.generate_content(model=model, contents=prompt)

        if response.text:
            full_markdown.append(response.text)
        else:
            full_markdown.append(raw_chunk_md)

    return "\n\n---\n\n".join(full_markdown)