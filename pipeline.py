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
import hashlib
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

        if len(images) == 3:
            print("  [\033[92m✔ PASS\033[0m] Strict 3-Image Standard (1 Cover + 2 Core Diagrams)")
        else:
            print(f"  [\033[93m⚠ INFO\033[0m] Visual Count: {len(images)} images (Standard is 3: 1 cover + 2 diagrams)")

        if "```mermaid" in md_text:
            print("  [\033[93m⚠ WARN\033[0m] Raw Mermaid code blocks detected (recommend dropping Mermaid for clean visual diagrams)")
        else:
            print("  [\033[92m✔ PASS\033[0m] Zero Raw Mermaid Blocks (Clean visual presentation)")

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


def table_to_medium_list(table_str: str) -> str:
    """Converts a Markdown table into a structured list preserving headers and row data for Medium."""
    lines = [l.strip() for l in table_str.strip().split("\n") if l.strip()]
    if len(lines) < 3:
        return table_str

    header_line = lines[0]
    data_lines = lines[2:]

    headers = [c.strip() for c in header_line.strip("|").split("|")]
    if not headers or not data_lines:
        return table_str

    list_items = []
    for r in data_lines:
        cells = [c.strip() for c in r.strip("|").split("|")]
        if not cells:
            continue
        primary = cells[0] if cells else ""
        sub_items = []
        for h, val in zip(headers[1:], cells[1:]):
            if val:
                sub_items.append(f"  - **{h}**: {val}")
        if sub_items:
            item_text = f"- {primary}\n" + "\n".join(sub_items)
        else:
            item_text = f"- {primary}"
        list_items.append(item_text)

    return "\n".join(list_items)


def clean_medium_markdown(md_text: str, assets_rel_dir: str, extracted_assets: list) -> tuple[str, int]:
    """
    Transforms markdown into a clean Medium-ready copy:
    - Replaces base64 image data with local asset references.
    - Strips unsupported HTML wrappers (<details>, <summary>) and raw Mermaid blocks.
    - Retains corresponding rendered diagram images.
    - Converts Markdown tables into readable nested lists.
    - Clearly marks local assets as pending upload.
    """
    text = md_text

    # 1. Replace base64 images with local asset references
    for asset in extracted_assets:
        orig_match = asset["full_match"]
        filename = asset["filename"]
        alt = asset["alt"]
        local_rel_path = f"{assets_rel_dir}/{filename}"

        replacement = (
            f"\n\n![{alt}]({local_rel_path})\n"
            f"> 📍 **Local Asset (Pending Medium Upload)**: `{filename}` — *Upload this local image at this location.*  \n"
            f"> *Caption: {alt}*\n\n"
        )
        text = text.replace(orig_match, replacement)

    # 2. Strip <details> and <summary> wrappers and raw Mermaid blocks
    text = re.sub(r"<details>[\s\S]*?</details>", "", text)
    text = re.sub(r"```mermaid[\s\S]*?```", "", text)
    text = re.sub(r"</?(?:details|summary|div|span|center)[^>]*>", "", text)

    # 3. Convert Markdown tables to readable lists
    table_pattern = re.compile(
        r"(\|[^\n]+\|\s*\n\|[-: |]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)",
        re.MULTILINE
    )
    tables_found = table_pattern.findall(text)
    for tbl in tables_found:
        converted = table_to_medium_list(tbl)
        text = text.replace(tbl, converted + "\n")

    # Clean up excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n", len(tables_found)


def generate_export_instructions(slug_clean: str, assets: list, tables_count: int, export_md_path: Path, assets_dir: Path, out_path: Path):
    """Generates EXPORT_INSTRUCTIONS.md detailing how to copy content and place local images."""
    lines = [
        f"# Medium Publishing Instructions: {slug_clean}",
        "",
        "> **Important**: This article contains **local image assets** that reside on your machine.",
        "> They have **not** been uploaded to Medium yet. Medium does not parse local file paths,",
        "> so each image must be uploaded directly via Medium's editor at the indicated locations.",
        "",
        "---",
        "",
        "## 📋 Quick Publishing Steps",
        "",
        "1. **Open Medium**: Navigate to [medium.com/new-story](https://medium.com/new-story).",
        f"2. **Copy Article Text**: Copy the full text from `{export_md_path.name}`.",
        f"   - On macOS terminal: `pbcopy < articles/output/{export_md_path.name}`",
        "3. **Paste into Medium**: Paste (Cmd+V) directly into Medium's story editor.",
        "4. **Upload Images**: Drag and drop the corresponding local image file from the assets directory",
        f"   (`{assets_dir.name}/`) into each marked placeholder in the article.",
        "5. **Format Code Blocks**: Medium will format fenced code blocks automatically. If needed, select code and press `Cmd+Alt+6` (or `Ctrl+Alt+6`) to activate syntax highlighting.",
        "6. **Review Lists & Tables**: The Markdown tables have been converted into clean, readable lists for native Medium display.",
        "7. **Delete Placeholders**: After dragging in each image, delete the `> 📍 Local Asset` callout block above/below it.",
        "",
        "---",
        "",
        "## 🖼️ Local Visual Assets Checklist",
        "",
        f"All images are stored locally in: `articles/output/{assets_dir.name}/`",
        "",
        "| # | File Name | Format | Size | Insertion Location / Caption | Status |",
        "|---|-----------|--------|------|------------------------------|--------|",
    ]

    for i, a in enumerate(assets, 1):
        lines.append(
            f"| {i} | `{a['filename']}` | {a['format'].upper()} | {a['size_kb']} KB | **{a['alt'][:45]}** | Local Asset (Pending Upload) |"
        )

    lines.extend([
        "",
        "---",
        "",
        "## 🔍 Formatting Conversions Applied",
        "",
        f"- **Tables Converted**: {tables_count} Markdown tables converted to readable nested lists.",
        "- **Mermaid Cleaned**: Raw Mermaid code and `<details>` tags removed; high-DPI rendered images preserved.",
        "- **Base64 Replaced**: 0 base64 strings in export copy. Clean local paths used throughout.",
        f"- **Original Article Intact**: `articles/output/{slug_clean}article.md` was not modified.",
        "",
        "Happy Publishing! 🚀",
        ""
    ])

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def validate_export(source_md: Path, orig_hash: str, export_md: Path, asset_dir: Path, assets: list, tables_count: int) -> bool:
    """Validates the export copy against all required publication criteria."""
    print(f"\nValidating Medium Export for '{source_md.stem}'")
    print("-" * 65)

    all_passed = True

    # 1. Source of truth unchanged
    new_hash = hashlib.sha256(source_md.read_bytes()).hexdigest()
    if new_hash == orig_hash:
        print("  [\033[92m✔ PASS\033[0m] Source Markdown Intact (Unmodified & Preserved)")
    else:
        print("  [\033[91m✖ FAIL\033[0m] Source Markdown was modified during export!")
        all_passed = False

    # 2. Check export file exists
    if not export_md.exists():
        print(f"  [\033[91m✖ FAIL\033[0m] Export file '{export_md.name}' does not exist.")
        return False

    export_text = export_md.read_text(encoding="utf-8")

    # 3. Check for unresolved base64 data
    b64_matches = re.findall(r"data:image/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+", export_text)
    if not b64_matches:
        print("  [\033[92m✔ PASS\033[0m] Zero Unresolved Base64 Strings in Export Copy")
    else:
        print(f"  [\033[91m✖ FAIL\033[0m] Found {len(b64_matches)} unresolved base64 strings in export!")
        all_passed = False

    # 4. Check for unsupported HTML tags
    unsupported_html = re.findall(r"</?(?:details|summary|div|span|center|script|iframe)[^>]*>", export_text, re.IGNORECASE)
    if not unsupported_html:
        print("  [\033[92m✔ PASS\033[0m] Zero Unsupported HTML Tags (<details>, <summary>, etc.)")
    else:
        print(f"  [\033[91m✖ FAIL\033[0m] Found unsupported HTML tags: {set(unsupported_html)}")
        all_passed = False

    # 5. Check for raw Mermaid code blocks
    mermaid_blocks = re.findall(r"```mermaid[\s\S]*?```", export_text)
    if not mermaid_blocks:
        print("  [\033[92m✔ PASS\033[0m] Zero Raw Mermaid Blocks (No unrendered code exposed)")
    else:
        print(f"  [\033[91m✖ FAIL\033[0m] Found {len(mermaid_blocks)} raw Mermaid code blocks in export!")
        all_passed = False

    # 6. Check that extracted images exist on disk and have non-zero size
    missing_assets = []
    for a in assets:
        img_path = asset_dir / a["filename"]
        if not img_path.exists() or img_path.stat().st_size == 0:
            missing_assets.append(a["filename"])

    if not missing_assets:
        print(f"  [\033[92m✔ PASS\033[0m] All Extracted Image Assets Exist on Disk ({len(assets)}/{len(assets)})")
    else:
        print(f"  [\033[91m✖ FAIL\033[0m] Missing image asset files: {missing_assets}")
        all_passed = False

    # 7. Check that tables were converted (no unparsed Markdown tables)
    table_pattern = re.compile(r"(\|[^\n]+\|\s*\n\|[-: |]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)", re.MULTILINE)
    remaining_tables = table_pattern.findall(export_text)
    if not remaining_tables:
        print(f"  [\033[92m✔ PASS\033[0m] Markdown Tables Converted to Medium-Friendly Lists ({tables_count} converted)")
    else:
        print(f"  [\033[91m✖ FAIL\033[0m] Found {len(remaining_tables)} unconverted Markdown tables!")
        all_passed = False

    # 8. Check that export distinguishes local assets (no false 'already uploaded' claims)
    if "Uploaded to Medium" in export_text or "image has been uploaded" in export_text:
        print("  [\033[91m✖ FAIL\033[0m] False upload claims detected in export text!")
        all_passed = False
    else:
        print("  [\033[92m✔ PASS\033[0m] Local Assets Explicitly Marked (Pending Upload)")

    print("-" * 65)
    if all_passed:
        print("\033[92m★ EXPORT VALIDATION PASSED: 100% READY FOR MEDIUM COPY-PASTE!\033[0m\n")
    else:
        print("\033[91m✖ EXPORT VALIDATION FAILED: Issues detected above.\033[0m\n")

    return all_passed


def export_medium(slug: str, target_format: str = "png", out_dir: str = None):
    """
    Medium export pipeline:
    1. Reads original article as immutable source of truth (verifies SHA256 before & after).
    2. Extracts embedded base64 images into separate files under <topic>-assets/.
    3. Replaces base64 image data with local asset references.
    4. Strips unsupported HTML wrappers (<details>, <summary>) and raw Mermaid blocks.
    5. Converts Markdown tables into readable nested lists.
    6. Generates EXPORT_INSTRUCTIONS.md.
    7. Runs validation checklist.
    """
    target_format = target_format.lower()
    if target_format in ["jpg", "jpeg"]:
        target_format = "jpeg"
    elif target_format not in ["webp", "png"]:
        print(f"Error: Unsupported format '{target_format}'. Supported formats: png, webp, jpeg.")
        sys.exit(1)

    md_file, _ = get_topic_files(slug)
    if not md_file.exists():
        print(f"Error: Markdown file '{md_file}' does not exist.")
        sys.exit(1)

    # 1. Compute SHA256 of source of truth to guarantee it is NEVER modified
    source_bytes = md_file.read_bytes()
    orig_hash = hashlib.sha256(source_bytes).hexdigest()
    md_text = source_bytes.decode("utf-8")

    slug_clean = slug.removesuffix("article").removesuffix("-article")
    assets_dir = Path(out_dir) if out_dir else (OUTPUT_DIR / f"{slug_clean}-assets")
    assets_dir.mkdir(parents=True, exist_ok=True)

    pattern = r'!\[(.*?)\]\(data:image/([a-zA-Z]+);base64,([A-Za-z0-9+/=]+)\)'
    matches = list(re.finditer(pattern, md_text))

    if not matches:
        print(f"No Base64 images found in {md_file.name}.")
        return

    ext = "jpg" if target_format == "jpeg" else target_format
    print(f"\nExtracting {len(matches)} embedded images from '{md_file.name}' to {assets_dir.name}/ (format: .{ext.upper()}):")
    print("-" * 65)

    extracted_assets = []
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

        out_path = assets_dir / filename

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
        print(f"  [{i}/{len(matches)}] Extracted: {out_path.name:<32} ({kb} KB)")

        extracted_assets.append({
            "full_match": m.group(0),
            "filename": filename,
            "alt": alt,
            "format": ext,
            "size_kb": kb
        })

    # Clean Medium Markdown
    clean_text, tables_count = clean_medium_markdown(md_text, assets_dir.name, extracted_assets)
    clean_md_path = OUTPUT_DIR / f"{slug_clean}-medium.md"
    clean_md_path.write_text(clean_text, encoding="utf-8")

    # Generate EXPORT_INSTRUCTIONS.md
    instructions_path = OUTPUT_DIR / "EXPORT_INSTRUCTIONS.md"
    generate_export_instructions(slug_clean, extracted_assets, tables_count, clean_md_path, assets_dir, instructions_path)

    print("-" * 65)
    print(f"✔ Local Assets saved to:           {assets_dir.relative_to(BASE_DIR)}/")
    print(f"✔ Medium-Ready Markdown saved to: {clean_md_path.relative_to(BASE_DIR)}")
    print(f"✔ Publishing Instructions:        {instructions_path.relative_to(BASE_DIR)}")

    # Run validation step
    validate_export(md_file, orig_hash, clean_md_path, assets_dir, extracted_assets, tables_count)


# Alias export_images to export_medium for backwards compatibility
export_images = export_medium


def export_reddit(slug: str):
    """
    Exports a topic as a high-engagement, self-contained Reddit technical post:
    - Provides target subreddits (r/systemdesign, r/backend, r/programming) and flairs.
    - 3 title variants (Direct technical, Problem-focused, Architecture-focused).
    - TL;DR summary at the top.
    - Strips base64 blobs and unsupported HTML tags (<details>, <summary>).
    - Preserves tables (Reddit natively supports pipe tables!).
    - Preserves fenced code blocks and technical tradeoffs.
    - Adds 3 open-ended community discussion questions at the end to drive engagement.
    - Saves output to articles/output/<topic>-reddit.md.
    """
    md_file, _ = get_topic_files(slug)
    if not md_file.exists():
        print(f"Error: Markdown file '{md_file}' does not exist.")
        sys.exit(1)

    slug_clean = slug.removesuffix("article").removesuffix("-article")
    md_text = md_file.read_text(encoding="utf-8")

    # 1. Strip base64 image tags and replace with clean Reddit image note
    text = re.sub(r'!\[(.*?)\]\(data:image/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+\)', r'*(Diagram: \1)*', md_text)
    # 2. Strip <details> and <summary> and raw Mermaid
    text = re.sub(r"<details>[\s\S]*?</details>", "", text)
    text = re.sub(r"```mermaid[\s\S]*?```", "", text)
    text = re.sub(r"</?(?:details|summary|div|span|center)[^>]*>", "", text)

    # 3. Clean up leading title and subtitle
    lines = text.split("\n")
    cleaned_body_lines = []
    skip_header = True
    for line in lines:
        if line.startswith("## 1."):
            skip_header = False
        if not skip_header:
            cleaned_body_lines.append(line)

    body_text = "\n".join(cleaned_body_lines).strip()
    body_text = re.sub(r"\n{3,}", "\n\n", body_text)

    raw_title = slug_clean.replace("-", " ").title()
    subject = raw_title[4:] if raw_title.lower().startswith("how ") else raw_title
    clean_topic = subject.removesuffix(" Works")

    reddit_content = f"""# Reddit Post Metadata & Configuration

**Recommended Subreddits & Flairs:**
- **r/systemdesign** — Flair: `Architecture` / `Deep Dive`
- **r/backend** — Flair: `Discussion` / `Best Practices`
- **r/programming** — Flair: `Design`
- **r/ExperiencedDevs** — Flair: `Architecture`

**Title Options (Pick One):**
1. *[Deep Dive]* How {clean_topic} Actually Works Under High Concurrency: Stampede Mutexes, Eviction, and Invalidation Race Conditions
2. *[Architecture]* Why your database melts when a hot cache expires (and how to fix the stampede with distributed mutexes)
3. *[First Principles]* Under the hood of {clean_topic}: Single-threaded event loops, O(1) in-memory lookups, and dual-write consistency

---

### TL;DR
- **The Physical Reality**: Main memory (RAM) responds in ~50–100ns vs ~5–50ms for relational DB queries—two orders of magnitude faster.
- **The #1 Production Killer**: When a hot key expires, hundreds of concurrent threads execute DB queries at once (**Cache Stampede**). Protect it with an atomic distributed lock (`SET key token NX EX 5`).
- **Data Consistency**: Under concurrent writes, always **Invalidate (`DEL`)** the cache rather than updating it (`SET`) to prevent race condition data corruption.

---

{body_text}

---

## 💬 Discussion Questions for the Community

1. **Cache Invalidation in Production**: When managing dual-writes, do you rely on application-level invalidation (`DEL` after DB commit), or do you stream CDC events (e.g. Debezium / Kafka) into Redis?
2. **Stampede Mitigation**: Have you ever dealt with a thundering herd outage in production? Did you use distributed mutexes (`SET NX EX`), probabilistic early expiration (XFetch), or background refresh workers?
3. **Memory Sizing**: What `maxmemory-policy` has caused the least surprise for your team under unexpected memory pressure (`allkeys-lru` vs `volatile-lfu`)?

---

> *Original write-up with full high-DPI architecture diagrams, sequence flows, and reproducible benchmark scripts: [Your Publication Link / GitHub]*
"""

    out_path = OUTPUT_DIR / f"{slug_clean}-reddit.md"
    out_path.write_text(reddit_content.strip() + "\n", encoding="utf-8")

    print(f"\n✔ Reddit Technical Post generated: {out_path.relative_to(BASE_DIR)}")
    print(f"  Target Subreddits: r/systemdesign, r/backend, r/programming")
    print(f"  Tip: Copy to clipboard with: pbcopy < articles/output/{out_path.name}\n")


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

    p_exp = subparsers.add_parser("export", help="Export article for Medium (extract assets, convert tables, strip HTML/Mermaid, validate)")
    p_exp.add_argument("topic", help="Topic slug (e.g. how-redis-caching-works)")
    p_exp.add_argument("--format", default="png", choices=["png", "webp", "jpeg", "jpg"], help="Target image format (default: png)")
    p_exp.add_argument("--dir", default=None, help="Custom export directory path")

    p_exp_img = subparsers.add_parser("export-images", help="Alias for 'export'")
    p_exp_img.add_argument("topic", help="Topic slug")
    p_exp_img.add_argument("--format", default="png", choices=["png", "webp", "jpeg", "jpg"], help="Target image format (default: png)")
    p_exp_img.add_argument("--dir", default=None, help="Custom export directory path")

    p_red = subparsers.add_parser("reddit", help="Export topic as a self-contained, high-engagement Reddit technical post")
    p_red.add_argument("topic", help="Topic slug (e.g. how-redis-caching-works)")

    args = parser.parse_args()

    if args.command == "list":
        list_topics()
    elif args.command == "check":
        check_topic(args.topic)
    elif args.command == "open":
        open_topic(args.topic)
    elif args.command == "delete":
        delete_topic(args.topic)
    elif args.command in ["export", "export-images"]:
        export_medium(args.topic, target_format=args.format, out_dir=args.dir)
    elif args.command == "reddit":
        export_reddit(args.topic)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()



