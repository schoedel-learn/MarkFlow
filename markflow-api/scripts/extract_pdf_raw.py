import argparse
from pathlib import Path
import sys


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from pdf_pipeline import extract_raw_markdown


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract raw Markdown from a PDF.")
    parser.add_argument("pdf_path", help="Path to the source PDF file.")
    parser.add_argument(
        "-o",
        "--output",
        help="Path for the extracted Markdown. Defaults to <pdf>_raw.md.",
    )
    return parser.parse_args()


def build_output_path(pdf_path: Path, output: str | None) -> Path:
    if output:
        return Path(output)
    return pdf_path.with_name(f"{pdf_path.stem}_raw.md")


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf_path).expanduser().resolve()

    if not pdf_path.exists():
        print(f"File not found: {pdf_path}")
        return 1

    output_path = build_output_path(pdf_path, args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Extracting {pdf_path}...")
    md_text = extract_raw_markdown(pdf_path)
    output_path.write_text(md_text, encoding="utf-8")
    print(f"Done. Saved to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())