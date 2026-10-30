"""Extract page-delimited text from a PDF for local question-bank processing."""

from pathlib import Path
import argparse
import pdfplumber


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("output_txt", type=Path)
    args = parser.parse_args()

    args.output_txt.parent.mkdir(parents=True, exist_ok=True)
    sections: list[str] = []
    with pdfplumber.open(args.input_pdf) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            sections.append(f"--- PAGE {page_number} ---\n{text.strip()}")

    args.output_txt.write_text("\n\n".join(sections) + "\n", encoding="utf-8")
    print(f"Extracted {len(sections)} pages to {args.output_txt}")


if __name__ == "__main__":
    main()
