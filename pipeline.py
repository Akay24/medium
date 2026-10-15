#!/usr/bin/env python3
"""
Antigravity Topic Pipeline Manager
==================================
Tidy, single-folder topic publications.
All you provide is the TOPIC NAME. Antigravity does all research, writing,
cover art generation, WebP diagram rendering, and code verification.

Usage:
    python3 pipeline.py list
    python3 pipeline.py check <topic-slug>
    python3 pipeline.py gist <topic-slug>
    python3 pipeline.py delete <topic-slug>
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ARTICLES_DIR = BASE_DIR / "articles"


def slugify(text: str) -> str:
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    return re.sub(r"[-\s]+", "-", slug)


def list_topics():
    if not ARTICLES_DIR.exists():
        print("No articles directory found.")
        return

    topics = [d for d in ARTICLES_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]
    if not topics:
        print("No topics found in articles/.")
        return

    print("\n" + "=" * 75)
    print(f"{'TOPIC SLUG':<32} | {'ARTICLE.MD':<11} | {'WEBP':<6} | {'STATUS'}")
    print("=" * 75)

    for t in sorted(topics):
        has_article = (t / "article.md").exists() or (t / "PUBLISH.md").exists()
        webps = list((t / "assets").glob("*.webp")) if (t / "assets").exists() else []
        has_cover = (t / "cover.webp").exists()

        status = "READY" if (has_article and has_cover and len(webps) > 0) else "INCOMPLETE"
        status_color = "\033[92m" if status == "READY" else "\033[93m"
        reset_color = "\033[0m"

        print(
            f"{t.name:<32} | {'Yes' if has_article else 'No':<11} | {len(webps):<6} | {status_color}{status}{reset_color}"
        )
    print("=" * 75 + "\n")


def check_topic(slug: str):
    target = ARTICLES_DIR / slug
    if not target.exists():
        print(f"Error: Topic folder '{slug}' not found under {ARTICLES_DIR}.")
        sys.exit(1)

    print(f"\nVerifying Topic Package: '{slug}'")
    print("-" * 55)

    has_article = (target / "article.md").exists() or (target / "PUBLISH.md").exists()
    checklist = [
        ("Article File (article.md)", has_article),
        ("Cover Image (cover.webp)", (target / "cover.webp").exists()),
        ("WebP Diagrams (assets/*.webp)", len(list((target / "assets").glob("*.webp"))) >= 1),
        ("Executable Code (code/)", (target / "code").exists() and len(list((target / "code").glob("*"))) >= 1),
        ("Quality Assurance Report (qa.md)", (target / "qa.md").exists()),
    ]

    all_passed = True
    for name, passed in checklist:
        mark = "\033[92m✔ PASS\033[0m" if passed else "\033[91m✖ MISSING\033[0m"
        if not passed:
            all_passed = False
        print(f"  [{mark}] {name}")

    webp_count = len(list((target / "assets").glob("*.webp"))) if (target / "assets").exists() else 0
    print(f"\n  WebP Asset Count: {webp_count}")

    if all_passed:
        print("\n\033[92m★ TOPIC IS TIDY & READY FOR MEDIUM PUBLICATION!\033[0m\n")
    else:
        print("\n\033[93m⚠ Topic has missing assets. Prompt Antigravity to complete.\033[0m\n")


def publish_gist(slug: str):
    target = ARTICLES_DIR / slug
    publish_file = target / "article.md" if (target / "article.md").exists() else target / "PUBLISH.md"
    if not publish_file.exists():
        print(f"Error: Article file '{publish_file}' not found.")
        sys.exit(1)

    # 2. Create public Gist using gh CLI
    print(f"\nCreating public GitHub Gist for '{slug}'...")
    proc = subprocess.run(
        ["gh", "gist", "create", str(publish_file), "--public", "-d", f"Medium Article Draft: {slug}"],
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    match = re.search(r"https://gist\.github\.com/[^\s]+", out)
    if not match:
        print(f"Error creating Gist:\n{out}")
        sys.exit(1)

    gist_url = match.group(0)
    print(f"\n\033[92m✔ Public GitHub Gist Created!\033[0m")
    print(f"  \033[1mGist URL:\033[0m {gist_url}")

    # Copy to system clipboard on macOS
    try:
        subprocess.run(["pbcopy"], input=gist_url.encode("utf-8"), check=False)
        print("  \033[96m(Copied Gist URL to clipboard!)\033[0m")
    except Exception:
        pass

    # 3. Open Medium Importer
    print("\nNext step: Paste the Gist URL into Medium's Story Importer:")
    print("  \033[4mhttps://medium.com/p/import\033[0m\n")
    subprocess.run(["open", "https://medium.com/p/import"], check=False)


def delete_topic(slug: str):
    target = ARTICLES_DIR / slug
    if not target.exists():
        print(f"Error: Topic folder '{slug}' does not exist.")
        sys.exit(1)

    shutil.rmtree(target)
    print(f"\033[92m✔ Successfully deleted topic folder:\033[0m articles/{slug}")


def main():
    parser = argparse.ArgumentParser(description="Antigravity Topic Pipeline Manager")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("list", help="List all article topics and their readiness")

    p_check = subparsers.add_parser("check", help="Verify a topic's publish-ready assets")
    p_check.add_argument("topic", help="Topic folder slug (e.g., how-redis-caching-works)")

    p_gist = subparsers.add_parser("gist", help="Publish Gist and launch Medium story import")
    p_gist.add_argument("topic", help="Topic folder slug")

    p_del = subparsers.add_parser("delete", help="Delete a topic folder")
    p_del.add_argument("topic", help="Topic folder slug to delete")

    args = parser.parse_args()

    if args.command == "list":
        list_topics()
    elif args.command == "check":
        check_topic(args.topic)
    elif args.command == "gist":
        publish_gist(args.topic)
    elif args.command == "delete":
        delete_topic(args.topic)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
