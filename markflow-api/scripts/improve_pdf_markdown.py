import argparse
import os
from pathlib import Path
import sys


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from pdf_pipeline import DEFAULT_FLAVOR_NAME, improve_pdf_markdown


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


def resolve_api_key(cli_api_key: str | None) -> str:
    api_key = cli_api_key or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("Provide --api-key or set GEMINI_API_KEY.")
    return api_key


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf_path).expanduser().resolve()
    if not pdf_path.exists():
        print(f"File not found: {pdf_path}")
        return 1

    output_path = build_output_path(pdf_path, args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    api_key = resolve_api_key(args.api_key)
    markdown = improve_pdf_markdown(
        pdf_path=pdf_path,
        api_key=api_key,
        model=args.model,
        chunk_size=args.chunk_size,
        max_pages=args.max_pages,
        flavor_name=DEFAULT_FLAVOR_NAME,
    )
    output_path.write_text(markdown, encoding="utf-8")
    print(f"Done. Saved to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())