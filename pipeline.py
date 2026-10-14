#!/usr/bin/env python3
"""
Medium Publication Pipeline Manager
====================================
Manage single-folder topic publications, verify non-breaking WebP assets,
preview in browser, create GitHub Gists for Medium import, and easily create,
check, or delete article topics.

Usage:
    python3 pipeline.py list
    python3 pipeline.py check <topic-slug>
    python3 pipeline.py preview <topic-slug>
    python3 pipeline.py gist <topic-slug>
    python3 pipeline.py new "<Topic Name>"
    python3 pipeline.py delete <topic-slug>
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ARTICLES_DIR = BASE_DIR / "articles"
TEMPLATES_DIR = BASE_DIR / "templates"


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

    print("\n" + "=" * 80)
    print(f"{'TOPIC SLUG':<30} | {'PUBLISH.MD':<11} | {'WEBP':<6} | {'COVER':<6} | {'STATUS'}")
    print("=" * 80)

    for t in sorted(topics):
        has_publish = (t / "PUBLISH.md").exists()
        webps = list((t / "assets").glob("*.webp")) if (t / "assets").exists() else []
        has_cover = (t / "cover.webp").exists() or (t / "cover.jpg").exists()

        status = "READY" if (has_publish and has_cover and len(webps) > 0) else "INCOMPLETE"
        status_color = "\033[92m" if status == "READY" else "\033[93m"
        reset_color = "\033[0m"

        print(
            f"{t.name:<30} | {'Yes' if has_publish else 'No':<11} | {len(webps):<6} | {'Yes' if has_cover else 'No':<6} | {status_color}{status}{reset_color}"
        )
    print("=" * 80 + "\n")


def check_topic(slug: str):
    target = ARTICLES_DIR / slug
    if not target.exists():
        print(f"Error: Topic folder '{slug}' not found under {ARTICLES_DIR}.")
        sys.exit(1)

    print(f"\nVerifying Topic Publication Package: '{slug}'")
    print("-" * 60)

    checklist = [
        ("Single Publish File (PUBLISH.md)", (target / "PUBLISH.md").exists()),
        ("Gist Import File (GIST.md)", (target / "GIST.md").exists()),
        ("Browser Preview (preview.html)", (target / "preview.html").exists()),
        ("Cover Art (cover.webp)", (target / "cover.webp").exists()),
        ("Standalone WebP Diagrams (assets/*.webp)", len(list((target / "assets").glob("*.webp"))) >= 1),
        ("Runnable Code (code/)", (target / "code").exists() and len(list((target / "code").glob("*"))) >= 1),
        ("Quality Checklist (qa-checklist-completed.md)", (target / "qa-checklist-completed.md").exists()),
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
        print("\n\033[92m★ TOPIC IS FULLY PUBLISH-READY FOR MEDIUM!\033[0m\n")
    else:
        print("\n\033[93m⚠ Topic has missing assets. Prompt Antigravity to complete.\033[0m\n")


import base64


def generate_standalone(slug: str) -> Path:
    target = ARTICLES_DIR / slug
    preview_file = target / "preview.html"
    standalone_file = target / "standalone.html"
    if not preview_file.exists():
        print(f"Error: Preview file '{preview_file}' not found.")
        sys.exit(1)

    html = preview_file.read_text()
    all_webps = list(target.glob("*.webp")) + (list((target / "assets").glob("*.webp")) if (target / "assets").exists() else [])

    for img_path in all_webps:
        rel_path = img_path.relative_to(target)
        b64_str = base64.b64encode(img_path.read_bytes()).decode("utf-8")
        data_uri = f"data:image/webp;base64,{b64_str}"
        html = html.replace(f'src="{rel_path}"', f'src="{data_uri}"')
        html = html.replace(f'src="./{rel_path}"', f'src="{data_uri}"')
        html = html.replace(f'src="{img_path.name}"', f'src="{data_uri}"')

    standalone_file.write_text(html)
    return standalone_file


def preview_topic(slug: str):
    standalone_file = generate_standalone(slug)
    print(f"\033[92m✔ Generated self-contained standalone.html (all WebP images baked in via Base64)\033[0m")
    print(f"Opening browser preview for '{slug}'...")
    subprocess.run(["open", str(standalone_file)])


def publish_gist(slug: str):
    target = ARTICLES_DIR / slug
    gist_file = target / "GIST.md"
    if not gist_file.exists():
        print(f"Error: Gist file '{gist_file}' not found.")
        sys.exit(1)

    # 1. Sync repository to ensure raw CDN URLs are accessible
    print("Syncing repository assets with GitHub origin...")
    subprocess.run(["git", "add", "."], cwd=BASE_DIR, check=False)
    subprocess.run(
        ["git", "commit", "-m", f"chore: sync {slug} assets for gist import"],
        cwd=BASE_DIR,
        check=False,
    )
    subprocess.run(["git", "push", "origin", "main"], cwd=BASE_DIR, check=False)

    # 2. Create public Gist using gh CLI
    print(f"\nCreating public GitHub Gist for '{slug}'...")
    proc = subprocess.run(
        ["gh", "gist", "create", str(gist_file), "--public", "-d", f"Medium Article Draft: {slug}"],
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    match = re.search(r"https://gist\.github\.com/[^\s]+", out)
    if not match:
        print(f"Error creating Gist:\n{out}")
        sys.exit(1)

    gist_url = match.group(0)
    print(f"\n\033[92m✔ Public GitHub Gist Created Successfully!\033[0m")
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


def new_topic(topic_name: str):
    slug = slugify(topic_name)
    target_dir = ARTICLES_DIR / slug
    assets_dir = target_dir / "assets"
    code_dir = target_dir / "code"

    assets_dir.mkdir(parents=True, exist_ok=True)
    code_dir.mkdir(parents=True, exist_ok=True)

    template_file = TEMPLATES_DIR / f"article-request-{slug}.md"
    content = f"""# Article Request: {topic_name}

Topic: {topic_name}
Series: System Design
Audience: Intermediate developers
Format: Technical deep dive
Technical depth: Detailed
Visuals: Custom cover image brief + colorful WebP diagrams
Purpose: Learn and prepare for software engineering interviews
Additional instructions: Generate single PUBLISH.md and GIST.md output with WebP diagrams.

Execute the full article production workflow from the master instructions.
"""
    template_file.write_text(content.strip() + "\n")

    print(f"\n\033[92m✔ New topic scaffolded:\033[0m {target_dir}")
    print(f"  Template created: templates/article-request-{slug}.md")
    print("\nNext step: Ask Antigravity:")
    print(f'  "Please generate all publish-ready outputs for topic: {slug}"\n')


def main():
    parser = argparse.ArgumentParser(description="Medium Publication Pipeline Manager")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("list", help="List all article topics and their readiness")

    p_check = subparsers.add_parser("check", help="Verify a topic's publish-ready assets")
    p_check.add_argument("topic", help="Topic folder slug (e.g., how-redis-caching-works)")

    p_preview = subparsers.add_parser("preview", help="Open visual preview in default browser")
    p_preview.add_argument("topic", help="Topic folder slug")

    p_gist = subparsers.add_parser("gist", help="Create public GitHub Gist for 1-click Medium story import")
    p_gist.add_argument("topic", help="Topic folder slug")

    p_new = subparsers.add_parser("new", help="Scaffold a new article topic")
    p_new.add_argument("name", help="Human-readable topic name (e.g., 'Kafka Partitioning Internals')")

    p_del = subparsers.add_parser("delete", help="Delete a topic folder")
    p_del.add_argument("topic", help="Topic folder slug to delete")

    args = parser.parse_args()

    if args.command == "list":
        list_topics()
    elif args.command == "check":
        check_topic(args.topic)
    elif args.command == "preview":
        preview_topic(args.topic)
    elif args.command == "gist":
        publish_gist(args.topic)
    elif args.command == "new":
        new_topic(args.name)
    elif args.command == "delete":
        delete_topic(args.topic)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
