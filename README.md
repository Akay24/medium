# Antigravity Medium Publication Pipeline

A fast, high-signal, autonomous pipeline for producing punchy, deeply educational, visually rich technical articles for Medium.

---

## ⚡ The Single-Prompt Workflow

Provide only the **TOPIC NAME**, and the pipeline produces a publish-ready article:

```text
User: "Topic: PostgreSQL Indexing Under the Hood (B-Trees vs LSM-Trees)"
```

The pipeline autonomously:
1. **Researches** official primary documentation and technical specifications.
2. **Drafts** a concise, punchy, high-signal technical article (~1,200 to 1,800 words).
3. **Generates exactly 3 visual assets** (no raw Mermaid blocks):
   - **Cover Image (`01_cover`)**: 16:9 minimalist, rich editorial illustration.
   - **Diagram 1 (`02_diagram_1`)**: Request lifecycle / core architectural data flow.
   - **Diagram 2 (`03_diagram_2`)**: Key mechanical mechanism / edge case / failure mode.
4. **Verifies code** with concrete, practical implementation and benchmark notes.
5. **Generates 2 standalone outputs** in `articles/output/` with embedded Base64 WebP images:
   - `articles/output/<topic>article.md`
   - `articles/output/<topic>article.html`
6. **Cleans up** all intermediate files so only your clean output remains.

---

## 📁 Repository Structure

```text
.
├── articles/
│   └── output/
│       ├── <topic>article.md       # 100% standalone Markdown (inlined Base64 WebP)
│       └── <topic>article.html     # 100% standalone HTML (inlined WebP + responsive CSS)
├── instructions/
│   └── master-editorial-prompt.md  # Core editorial guidelines and rules
├── templates/
│   ├── article-request.md          # Input specification template
│   └── quality-checklist.md        # QA verification checklist
├── pipeline.py                     # CLI manager for validation, export & preview
└── README.md
```

> **Note**: `articles/` is completely gitignored. Your articles remain strictly local until you publish.

---

## 🛠️ Topic Management CLI (`pipeline.py`)

```bash
# 1. List all standalone articles and their status
python3 pipeline.py list

# 2. Verify standalone readiness, 3-image standard, and zero-Mermaid compliance
python3 pipeline.py check how-redis-caching-works

# 3. Preview standalone HTML in your browser
python3 pipeline.py open how-redis-caching-works

# 4. Export images as PNG (or WEBP) and get a clean Medium-ready markdown file
python3 pipeline.py export-images how-redis-caching-works --format png

# 5. Delete a topic's outputs
python3 pipeline.py delete how-redis-caching-works
```

---

## 🚀 Publishing to Medium

Because Medium's editor does not accept inline Base64 data URIs:

```bash
# 1. Export the 3 images as PNGs and get clean copy-paste text:
python3 pipeline.py export-images <topic-slug> --format png

# 2. Copy the clean Medium text to your clipboard:
pbcopy < articles/output/<topic-slug>-medium.md

# 3. In Medium's editor (https://medium.com/new-story):
#    - Paste the text (Cmd+V)
#    - Drag & drop the 3 PNG images from articles/output/<topic-slug>-images/ into the placeholders
```
