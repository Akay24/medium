# Antigravity Medium Publication Pipeline

A clean, minimalist pipeline for producing high-depth, visually rich, verified Medium engineering articles.

---

## ⚡ The Single-Prompt Workflow

All you need to provide is the **TOPIC NAME**. Antigravity autonomously handles the entire lifecycle:

```text
User: "Topic: PostgreSQL Indexing Under the Hood (B-Trees vs LSM-Trees)"
```

Antigravity will automatically:
1. **Research** official primary documentation and technical specifications.
2. **Draft** the complete, in-depth technical publication in `PUBLISH.md`.
3. **Generate** a 16:9 minimalist editorial cover image (`cover.webp`).
4. **Render** non-breaking, high-DPI diagrams directly into WebP (`assets/diagram-*.webp`).
5. **Code & Verify** practical backend implementations with live benchmark logs (`code/`).
6. **Evaluate** the QA checklist (`qa.md`).
7. **Clean up** all intermediate and temporary files so only the tidy publication folder remains.

---

## 📁 Single-Folder Topic Architecture

Every topic is isolated inside its own folder under `articles/<topic-slug>/`:

```text
articles/<topic-slug>/
├── PUBLISH.md         # Single structured publication file (Metadata + CDN WebP + Article)
├── cover.webp         # 16:9 generated editorial hero image
├── assets/            # Non-breaking, colorful WebP diagrams
│   ├── diagram-1-*.webp
│   └── diagram-2-*.webp
├── code/              # Executed and benchmarked production code
│   └── demo.py
└── qa.md              # Verified quality assurance report (PASS)
```

---

## 🛠️ Topic Management CLI (`pipeline.py`)

Manage your topics with simple, zero-friction commands:

```bash
# 1. List all topics and their publication status
python3 pipeline.py list

# 2. Check and verify assets for a topic
python3 pipeline.py check how-redis-caching-works

# 3. 1-Click: Sync CDN, create public Gist, and launch Medium Importer
python3 pipeline.py gist how-redis-caching-works

# 4. Cleanly delete any old topic folder
python3 pipeline.py delete how-redis-caching-works
```

---

## 🚀 Publishing to Medium

```bash
# Run the 1-click gist publisher:
python3 pipeline.py gist how-redis-caching-works
```

```text
This automatically:
1. Pushes the WebP assets to your GitHub repository.
2. Generates a public GitHub Gist referencing the raw CDN URLs.
3. Copies the Gist URL to your clipboard.
4. Opens https://medium.com/p/import in your browser.
Simply press Cmd+V and click "Import story".
```
