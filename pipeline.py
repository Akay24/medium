#!/usr/bin/env python3
"""
Antigravity Standalone Article Pipeline Manager
================================================
Manages standalone publish-ready article outputs in articles/output/.
Each topic produces two 100% self-contained outputs:
  - articles/output/<topic>article.md   (Standalone Markdown with embedded Base64 WebP images)
  - articles/output/<topic>article.html (Standalone HTML with embedded Base64 WebP images & styles)

No external assets/ folder or relative paths required.
All article artifacts are strictly local and ignored by Git.

Usage:
    python3 pipeline.py list
    python3 pipeline.py check <topic-slug>
    python3 pipeline.py open <topic-slug>
    python3 pipeline.py delete <topic-slug>
"""

import argparse
import base64
import os
import re
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ARTICLES_DIR = BASE_DIR / "articles"
OUTPUT_DIR = ARTICLES_DIR / "output"


def slugify(text: str) -> str:
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    return re.sub(r"[-\s]+", "-", slug)


def get_topic_files(slug: str):
    slug_clean = slug.removesuffix("article").removesuffix("-article")
    md_file = OUTPUT_DIR / f"{slug_clean}article.md"
    html_file = OUTPUT_DIR / f"{slug_clean}article.html"
    return md_file, html_file


def list_topics():
    if not OUTPUT_DIR.exists():
        print("No output directory found at articles/output/.")
        return

    md_files = sorted(OUTPUT_DIR.glob("*article.md"))
    if not md_files:
        print("No standalone articles found in articles/output/.")
        return

    print("\n" + "=" * 80)
    print(f"{'STANDALONE TOPIC':<36} | {'MD (KB)':<10} | {'HTML (KB)':<10} | {'STATUS'}")
    print("=" * 80)

    seen = set()
    for md_file in md_files:
        topic_name = md_file.stem
        norm_name = topic_name.replace("-article", "").replace("article", "")
        if norm_name in seen:
            continue
        seen.add(norm_name)

        html_candidates = [
            OUTPUT_DIR / f"{topic_name}.html",
            OUTPUT_DIR / f"{norm_name}article.html",
            OUTPUT_DIR / f"{norm_name}-article.html",
        ]
        html_file = next((f for f in html_candidates if f.exists()), None)

        md_kb = round(md_file.stat().st_size / 1024, 1)
        html_kb = round(html_file.stat().st_size / 1024, 1) if html_file else 0

        status = "READY" if (md_file.exists() and html_file and html_file.exists()) else "INCOMPLETE"
        status_color = "\033[92m" if status == "READY" else "\033[93m"
        reset_color = "\033[0m"

        print(f"{norm_name:<36} | {md_kb:<10} | {html_kb:<10} | {status_color}{status}{reset_color}")
    print("=" * 80 + "\n")


def check_topic(slug: str):
    md_file, html_file = get_topic_files(slug)

    print(f"\nVerifying Standalone Topic Outputs: '{slug}'")
    print("-" * 65)

    checklist = [
        (f"Standalone Markdown ({md_file.name})", md_file.exists()),
        (f"Standalone HTML ({html_file.name})", html_file.exists()),
    ]

    all_passed = True
    for name, passed in checklist:
        mark = "\033[92m✔ PASS\033[0m" if passed else "\033[91m✖ MISSING\033[0m"
        if not passed:
            all_passed = False
        print(f"  [{mark}] {name}")

    if md_file.exists():
        with open(md_file, "r") as f:
            md_text = f.read()
        images = re.findall(r"!\[.*?\]\((.*?)\)", md_text)
        has_relative = any(not (src.startswith("data:image/") or src.startswith("http")) for src in images)
        if has_relative:
            print("  [\033[91m✖ FAIL\033[0m] Relative image paths detected in MD (not standalone!)")
            all_passed = False
        else:
            print(f"  [\033[92m✔ PASS\033[0m] Embedded WebP Images: {len(images)} (100% Standalone Base64)")

    if html_file.exists():
        with open(html_file, "r") as f:
            html_text = f.read()
        html_images = re.findall(r'<img [^>]*src=["\']([^"\']+)["\']', html_text)
        has_relative_html = any(not (src.startswith("data:image/") or src.startswith("http")) for src in html_images)
        if has_relative_html:
            print("  [\033[91m✖ FAIL\033[0m] Relative image paths detected in HTML (not standalone!)")
            all_passed = False
        else:
            print(f"  [\033[92m✔ PASS\033[0m] HTML Inlined WebP Images: {len(html_images)} (100% Standalone)")

    if all_passed:
        print("\n\033[92m★ TOPIC IS COMPLETELY STANDALONE & PUBLISH-READY!\033[0m\n")
    else:
        print("\n\033[93m⚠ Topic outputs have missing or non-standalone elements.\033[0m\n")


def open_topic(slug: str):
    _, html_file = get_topic_files(slug)
    if not html_file.exists():
        print(f"Error: HTML file '{html_file}' does not exist.")
        sys.exit(1)

    print(f"Opening standalone HTML in default browser: {html_file}")
    subprocess.run(["open", str(html_file)], check=False)


def delete_topic(slug: str):
    md_file, html_file = get_topic_files(slug)
    deleted = 0
    for f in [md_file, html_file]:
        if f.exists():
            f.unlink()
            deleted += 1
            print(f"\033[92m✔ Deleted:\033[0m {f.relative_to(BASE_DIR)}")

    if deleted == 0:
        print(f"No files found for topic '{slug}' in {OUTPUT_DIR}.")


def export_images(slug: str, target_format: str = "webp", out_dir: str = None):
    target_format = target_format.lower()
    if target_format in ["jpg", "jpeg"]:
        target_format = "jpeg"
    elif target_format not in ["webp", "png"]:
        print(f"Error: Unsupported format '{target_format}'. Supported formats: webp, png, jpeg.")
        sys.exit(1)

    md_file, _ = get_topic_files(slug)
    if not md_file.exists():
        print(f"Error: Markdown file '{md_file}' does not exist.")
        sys.exit(1)

    slug_clean = slug.removesuffix("article").removesuffix("-article")
    export_dir = Path(out_dir) if out_dir else (OUTPUT_DIR / f"{slug_clean}-images")
    export_dir.mkdir(parents=True, exist_ok=True)

    with open(md_file, "r", encoding="utf-8") as f:
        md_text = f.read()

    pattern = r'!\[(.*?)\]\(data:image/([a-zA-Z]+);base64,([A-Za-z0-9+/=]+)\)'
    matches = list(re.finditer(pattern, md_text))

    if not matches:
        print(f"No Base64 images found in {md_file.name}.")
        return

    ext = "jpg" if target_format == "jpeg" else target_format
    print(f"\nExporting {len(matches)} images from '{md_file.name}' as .{ext.upper()} for Medium:")
    print("-" * 65)

    medium_md_text = md_text

    for i, m in enumerate(matches, 1):
        alt = m.group(1).strip()
        orig_fmt = m.group(2).lower()
        b64_str = m.group(3)
        raw_bytes = base64.b64decode(b64_str)

        alt_slug = re.sub(r"[^\w\s-]", "", alt.lower())
        alt_slug = re.sub(r"[-\s]+", "_", alt_slug)[:28].strip("_")
        if not alt_slug or alt_slug.startswith("image") or alt_slug.startswith("cover"):
            filename = f"{i:02d}_cover.{ext}" if i == 1 else f"{i:02d}_diagram.{ext}"
        else:
            filename = f"{i:02d}_{alt_slug}.{ext}"

        out_path = export_dir / filename

        if orig_fmt == target_format or (orig_fmt == "webp" and target_format == "webp"):
            with open(out_path, "wb") as img_out:
                img_out.write(raw_bytes)
        else:
            try:
                from PIL import Image
                import io
                img = Image.open(io.BytesIO(raw_bytes))
                if target_format == "jpeg" and img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.save(out_path, format=target_format.upper())
            except Exception as e:
                print(f"  Warning: Pillow conversion failed ({e}), saving raw bytes.")
                with open(out_path, "wb") as img_out:
                    img_out.write(raw_bytes)

        kb = round(out_path.stat().st_size / 1024, 1)
        print(f"  [{i}/{len(matches)}] Saved: {out_path.name:<32} ({kb} KB)")

        replacement = f"\n\n> 📸 **[MEDIUM IMAGE PLACEHOLDER: `{filename}`]**\n> *Caption: {alt}*\n\n"
        medium_md_text = medium_md_text.replace(m.group(0), replacement)

    clean_md_path = OUTPUT_DIR / f"{slug_clean}-medium.md"
    with open(clean_md_path, "w", encoding="utf-8") as f:
        f.write(medium_md_text)

    print("-" * 65)
    print(f"\n✔ {len(matches)} .{ext.upper()} images saved to: {export_dir.relative_to(BASE_DIR)}/")
    print(f"✔ Clean copy-paste text saved to: {clean_md_path.relative_to(BASE_DIR)}")
    print(f"  (Tip: Paste this clean text into Medium, then drag & drop the {ext.upper()} files into the placeholders!)\n")


def main():
    parser = argparse.ArgumentParser(description="Antigravity Standalone Topic Pipeline Manager")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("list", help="List all standalone topic outputs in articles/output/")

    p_check = subparsers.add_parser("check", help="Verify standalone readiness of a topic")
    p_check.add_argument("topic", help="Topic slug (e.g. how-redis-caching-works)")

    p_open = subparsers.add_parser("open", help="Open standalone HTML output in browser")
    p_open.add_argument("topic", help="Topic slug")

    p_del = subparsers.add_parser("delete", help="Delete a topic's output files")
    p_del.add_argument("topic", help="Topic slug to delete")

    p_exp = subparsers.add_parser("export-images", help="Extract Base64 images to real WEBP/PNG/JPEG files for Medium upload")
    p_exp.add_argument("topic", help="Topic slug")
    p_exp.add_argument("--format", default="webp", choices=["webp", "png", "jpeg", "jpg"], help="Target image format (default: webp)")
    p_exp.add_argument("--dir", default=None, help="Custom export directory path")

    args = parser.parse_args()

    if args.command == "list":
        list_topics()
    elif args.command == "check":
        check_topic(args.topic)
    elif args.command == "open":
        open_topic(args.topic)
    elif args.command == "delete":
        delete_topic(args.topic)
    elif args.command == "export-images":
        export_images(args.topic, target_format=args.format, out_dir=args.dir)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

