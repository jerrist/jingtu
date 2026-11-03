"""Extract one embedded raster image from a PDF without resampling it."""

from pathlib import Path
import argparse
import io

import pdfplumber
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_pdf", type=Path)
    parser.add_argument("page", type=int, help="One-based PDF page number")
    parser.add_argument("image_index", type=int, help="Zero-based image index on the page")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    with pdfplumber.open(args.input_pdf) as pdf:
        if args.page < 1 or args.page > len(pdf.pages):
            raise ValueError(f"Page {args.page} is outside 1..{len(pdf.pages)}")
        images = pdf.pages[args.page - 1].images
        if args.image_index < 0 or args.image_index >= len(images):
            raise ValueError(f"Image index {args.image_index} is outside 0..{len(images) - 1}")
        raw = images[args.image_index]["stream"].get_rawdata()

    with Image.open(io.BytesIO(raw)) as image:
        image.verify()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(raw)
    with Image.open(args.output) as image:
        print(f"{args.output} ({image.width}x{image.height}, {image.format})")


if __name__ == "__main__":
    main()
