from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_FLAVOR_NAME = "GitHub Flavored Markdown"

# A page with fewer extractable text characters than this threshold is
# considered scanned / image-only and is routed through the OCR fallback
# when the caller is entitled to OCR.
MIN_TEXT_CHARS_PER_PAGE = 50

# DPI used when rasterizing a PDF page for multimodal OCR. 200 dpi gives
# Gemini a sharp enough image to read most documents without producing
# pixmaps so large they hit the request body limit.
OCR_RENDER_DPI = 200


@dataclass(frozen=True)
class PageAnalysis:
    page_index: int  # 0-based
    text_chars: int
    needs_ocr: bool


def count_pdf_pages(pdf_path: str | Path) -> int:
    import pymupdf

    doc = pymupdf.open(str(pdf_path))
    try:
        return len(doc)
    finally:
        doc.close()


def analyze_pdf_pages(pdf_path: str | Path) -> list[PageAnalysis]:
    """Per-page analysis: counts extractable text characters and flags pages
    that look scanned/image-only (and would therefore benefit from OCR)."""
    import pymupdf

    doc = pymupdf.open(str(pdf_path))
    try:
        results: list[PageAnalysis] = []
        for page_index in range(len(doc)):
            page = doc.load_page(page_index)
            text = page.get_text("text") or ""
            stripped_len = len(text.strip())
            results.append(
                PageAnalysis(
                    page_index=page_index,
                    text_chars=stripped_len,
                    needs_ocr=stripped_len < MIN_TEXT_CHARS_PER_PAGE,
                )
            )
        return results
    finally:
        doc.close()


def pdf_needs_ocr(pdf_path: str | Path) -> bool:
    return any(p.needs_ocr for p in analyze_pdf_pages(pdf_path))


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


def _render_page_to_png_bytes(pdf_path: str | Path, page_index: int) -> bytes:
    import pymupdf

    doc = pymupdf.open(str(pdf_path))
    try:
        page = doc.load_page(page_index)
        pixmap = page.get_pixmap(dpi=OCR_RENDER_DPI)
        return pixmap.tobytes("png")
    finally:
        doc.close()


def build_ocr_prompt(page_number_one_based: int, flavor_name: str) -> str:
    return f"""
    You are an expert OCR engine and document formatter. The attached image is page {page_number_one_based} of a PDF that contains little or no extractable text (it is scanned or image-based).

    Read every visible word from the image and output high-quality {flavor_name}.

    STRICT RULES:
    1. TRANSCRIBE EVERYTHING readable in natural reading order.
    2. PRESERVE STRUCTURE: headings, lists, tables (as GFM), block quotes, code, emphasis.
    3. DO NOT invent content. If text is illegible, write [illegible].
    4. OMIT page numbers, running headers/footers, and decorative artifacts.
    5. Output ONLY the raw Markdown for this page — no commentary, no fences.
    """


def ocr_page_to_markdown(
    pdf_path: str | Path,
    page_index: int,
    api_key: str,
    model: str,
    flavor_name: str = DEFAULT_FLAVOR_NAME,
) -> str:
    """Render a single PDF page to an image and ask Gemini multimodal to
    return clean Markdown for it. Used as the OCR fallback for scanned or
    image-only PDFs."""
    from google import genai
    from google.genai import types

    image_bytes = _render_page_to_png_bytes(pdf_path, page_index)
    prompt = build_ocr_prompt(
        page_number_one_based=page_index + 1, flavor_name=flavor_name
    )
    client = genai.Client(api_key=api_key)
    image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/png")
    response = client.models.generate_content(
        model=model,
        contents=[image_part, prompt],
    )
    return response.text or ""


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
    ocr_enabled: bool = False,
) -> dict:
    """Convert a PDF to Markdown. Returns a dict with the final Markdown plus
    usage stats so callers can record OCR consumption against a quota.

    Returns:
        {"markdown": str, "ocr_pages_used": int, "text_pages_processed": int}
    """
    from google import genai

    total_pages = count_pdf_pages(pdf_path)
    page_limit = total_pages if max_pages is None else min(max_pages, total_pages)
    analyses = analyze_pdf_pages(pdf_path)[:page_limit]

    ocr_page_indices = {a.page_index for a in analyses if a.needs_ocr}
    text_page_indices = [a.page_index for a in analyses if not a.needs_ocr]

    client = genai.Client(api_key=api_key)
    rendered: dict[int, str] = {}
    ocr_pages_used = 0

    # OCR fallback for image/scanned pages (only when caller is entitled).
    if ocr_enabled and ocr_page_indices:
        for page_index in sorted(ocr_page_indices):
            print(f"OCR page {page_index + 1} of {page_limit}...")
            page_md = ocr_page_to_markdown(
                pdf_path=pdf_path,
                page_index=page_index,
                api_key=api_key,
                model=model,
                flavor_name=flavor_name,
            )
            rendered[page_index] = page_md
            ocr_pages_used += 1

    # Text path: chunk the remaining (text-bearing) pages and run the existing
    # cleanup prompt against each chunk.
    text_chunks: list[list[int]] = []
    if text_page_indices:
        for i in range(0, len(text_page_indices), chunk_size):
            text_chunks.append(text_page_indices[i : i + chunk_size])

    for page_range in text_chunks:
        print(f"Processing text pages {page_range} of {page_limit}...")
        raw_chunk_md = extract_raw_markdown(pdf_path, pages=page_range)
        prompt = build_formatting_prompt(
            raw_chunk_md=raw_chunk_md,
            start_page=page_range[0] + 1,
            end_page=page_range[-1] + 1,
            flavor_name=flavor_name,
        )
        response = client.models.generate_content(model=model, contents=prompt)
        chunk_md = response.text if response.text else raw_chunk_md
        # Distribute the cleaned chunk back under its first page so we can
        # rebuild a stable page-ordered document.
        rendered[page_range[0]] = chunk_md

    ordered_markdown = [
        rendered[key] for key in sorted(rendered.keys()) if key in rendered
    ]
    return {
        "markdown": "\n\n---\n\n".join(ordered_markdown),
        "ocr_pages_used": ocr_pages_used,
        "text_pages_processed": len(text_page_indices),
    }
