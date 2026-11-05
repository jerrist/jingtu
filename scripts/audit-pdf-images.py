"""List embedded PDF images so question-critical figures can be reviewed."""

from pathlib import Path
import argparse
import json

import pdfplumber


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=Path)
    args = parser.parse_args()
    report = []
    for input_path in args.inputs:
        pages = []
        with pdfplumber.open(input_path) as pdf:
            for page_number, page in enumerate(pdf.pages, start=1):
                images = [
                    {
                        "index": index,
                        "width": round(float(image.get("width", image["x1"] - image["x0"]))),
                        "height": round(float(image.get("height", image["y1"] - image["y0"]))),
                        "top": round(float(image.get("top", 0))),
                        "bottom": round(float(image.get("bottom", 0)))
                    }
                    for index, image in enumerate(page.images)
                ]
                if images:
                    pages.append({"page": page_number, "images": images})
        report.append({"file": input_path.name, "imagePages": pages})
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
