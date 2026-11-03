"""Render selected PDF pages to PNG files with pypdfium2."""

from pathlib import Path
import argparse
import pypdfium2 as pdfium


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("pages", nargs="+", type=int, help="One-based page numbers")
    parser.add_argument("--scale", type=float, default=2.5)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(args.input_pdf)
    for page_number in args.pages:
        if page_number < 1 or page_number > len(document):
            raise ValueError(f"Page {page_number} is outside 1..{len(document)}")
        page = document[page_number - 1]
        image = page.render(scale=args.scale).to_pil()
        output = args.output_dir / f"page-{page_number:03d}.png"
        image.save(output, format="PNG", optimize=True)
        print(output)


if __name__ == "__main__":
    main()
