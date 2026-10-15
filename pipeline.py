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

    args = parser.parse_args()

    if args.command == "list":
        list_topics()
    elif args.command == "check":
        check_topic(args.topic)
    elif args.command == "open":
        open_topic(args.topic)
    elif args.command == "delete":
        delete_topic(args.topic)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
