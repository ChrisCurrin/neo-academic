# Academic Writing Extensions for NEO

## Overview

This document outlines the feature roadmap to extend NEO from a novel-writing tool to support academic paper writing. The core features needed are:

- **References & Bibliography** (citations, BibTeX/CSL support)
- **Figures & Media** (image insertion, captioning, referencing)
- **Math Equations** (LaTeX, inline and display)
- **Tables** (creation, styling, referencing)
- **Academic Metadata** (abstract, keywords, author affiliations)

## Phase 1: Academic Metadata & Structure

### Features
- [ ] Abstract field in book metadata
- [ ] Keywords/tags for papers
- [ ] Author affiliations and ORCID support
- [ ] Paper type selection (research, review, short communication, etc.)
- [ ] Academic export profiles (APA, MLA, Chicago, IEEE)

### Files to create/modify
- `app.js` - Add academic metadata UI panels
- `styles.css` - Academic layout templates
- Storage: Extend `library.json` and book metadata

---

## Phase 2: References & Bibliography

### Features
- [ ] Citation insertion (keyboard shortcut `Cmd+Shift+C` / `Ctrl+Shift+C`)
- [ ] Reference database UI (manage citations)
- [ ] Support for:
  - Manual entry (author, title, year, DOI, URL)
  - BibTeX import/export
  - CSL JSON format
  - Zotero/Mendeley integration (future)
- [ ] In-text citation styles: `[1]`, `(Author, Year)`, `Author (Year)`
- [ ] Auto-generated bibliography
- [ ] Cross-reference validation (detect missing citations)

### Files to create
- `references.js` - Citation management
- `bibtex-parser.js` - BibTeX parsing
- `csl-renderer.js` - Citation Style Language support
- `styles/references.css` - Reference UI styling

### Files to modify
- `app.js` - Add reference panel and citation insertion
- `index.html` - Add reference UI elements

---

## Phase 3: Figures & Media

### Features
- [ ] Image insertion with `Cmd+Shift+I` / `Ctrl+Shift+I`
- [ ] Figure captioning
- [ ] Figure numbering (auto-increment)
- [ ] Figure referencing (`See Figure 3.2`)
- [ ] Image compression/optimization
- [ ] Supported formats: PNG, JPEG, SVG, PDF (for print)
- [ ] Figure gallery view
- [ ] Image metadata (source, license, attribution)

### Files to create
- `figures.js` - Figure management
- `figure-gallery.js` - Gallery UI
- `styles/figures.css` - Figure styling

### Files to modify
- `app.js` - Figure insertion UI
- `main.js` - File handling for images

---

## Phase 4: Math Equations

### Features
- [ ] Inline math: `$x^2 + y^2 = z^2$`
- [ ] Display math: `$$...$$` or `\[...\]`
- [ ] LaTeX/AsciiMath input
- [ ] Real-time rendering (MathJax)
- [ ] Equation numbering
- [ ] Equation referencing (`Eq. (3.14)`)
- [ ] Math clipboard support

### Dependencies
- `mathjax` for rendering

### Files to create
- `math.js` - Math equation handling
- `styles/math.css` - Math rendering styles

### Files to modify
- `app.js` - Math insertion and editing
- `index.html` - MathJax script inclusion
- `package.json` - Add MathJax dependency

---

## Phase 5: Tables

### Features
- [ ] Table insertion with customizable grid
- [ ] Table editing (add/remove rows/columns)
- [ ] Table styling (borders, shading, alignment)
- [ ] Table captioning
- [ ] Table numbering
- [ ] Table referencing (`See Table 1.3`)
- [ ] Export to common formats (CSV, HTML)

### Files to create
- `tables.js` - Table management
- `table-editor.js` - Table UI
- `styles/tables.css` - Table styling

### Files to modify
- `app.js` - Table insertion and management

---

## Phase 6: Export & Compilation

### Features
- [ ] Academic PDF export with:
  - Proper typography (line spacing, margins)
  - Bibliography formatting
  - Figure and table placement
  - Table of contents
- [ ] LaTeX/Typst export (for advanced users)
- [ ] Word `.docx` with:
  - Formatted references (Zotero/Word field codes)
  - Figure captions
  - Equation support
- [ ] Markdown with academic extensions:
  - Pandoc-compatible citations
  - Math formulas
  - Cross-references

### Files to modify
- `app.js` - Export options
- Extend export functions in `main.js`

---

## Phase 7: Academic UI & Workflows

### Features
- [ ] "Academic Mode" toggle (simplified UI focus)
- [ ] Sidebar panels:
  - References (organized by category)
  - Figures & Tables (with thumbnails)
  - Outline with section numbering
  - Statistics (word count, citation count, etc.)
- [ ] Find & Replace with regex support
- [ ] Comment/note feature for peer review
- [ ] Revision tracking (basic; mark changes)
- [ ] Academic keyboard shortcuts reference

### Files to modify
- `app.js` - Sidebar and mode switching
- `styles.css` - Academic layout templates
- `index.html` - Panel structure

---

## Implementation Strategy

### UI/UX Principles
- Keep the distraction-free philosophy
- Sidebar panels that fade when not in use
- Placeholders similar to existing `***` for references/figures/equations
- Consistent keyboard shortcuts (Cmd/Ctrl + Shift + letter)

### Data Storage
- Extend book metadata JSON to include:
  - `metadata.abstract`
  - `metadata.keywords`
  - `metadata.authors[]` (affiliations, ORCID)
  - `metadata.references[]`
  - `metadata.figures[]`
  - `metadata.tables[]`
- Store images in book folder: `./figures/`
- Store BibTeX in book folder: `./bibliography.bib`

### Backward Compatibility
- All academic features are optional
- Existing NEO books load without changes
- New panels are collapsed by default
- Academic mode is opt-in

---

## Quick Start for Contributors

### To add a new academic feature:
1. Create `feature.js` following existing patterns (e.g., `references.js`)
2. Add CSS to `styles.css` or create `styles/feature.css`
3. Integrate insertion/management UI into `app.js`
4. Update `index.html` with any new UI elements
5. Test with sample academic document

### Keyboard Shortcut Convention
- `Cmd+Shift+C` / `Ctrl+Shift+C` - Citation
- `Cmd+Shift+F` / `Ctrl+Shift+F` - Figure
- `Cmd+Shift+E` / `Ctrl+Shift+E` - Equation
- `Cmd+Shift+T` / `Ctrl+Shift+T` - Table
- `Cmd+Shift+M` / `Ctrl+Shift+M` - Toggle Academic Mode

---

## External Libraries & Dependencies

Candidates for addition to `package.json`:
- **Citation**: `csl-json`, `pandoc-citeproc` (optional)
- **Math**: `mathjax` (v3)
- **Tables**: `html-table-parser`, `csv-parse`
- **LaTeX**: `latex.js` (optional, for math rendering)
- **Word exports**: `docx` package for enhanced .docx generation

---

## Testing Checklist

- [ ] Academic metadata persists across sessions
- [ ] References export in multiple formats
- [ ] Math equations render correctly in all export formats
- [ ] Figures scale properly in PDF export
- [ ] Tables format correctly in all export formats
- [ ] Cross-references remain valid when content moves
- [ ] Backward compatibility: old NEO books still work
- [ ] All keyboard shortcuts work on macOS, Windows, Linux

---

## Future Enhancements

- Zotero/Mendeley API integration
- Collaborative editing (multi-author papers)
- Version control integration (Git-aware tracking)
- Real-time plagiarism check
- Citation analytics (most-cited, trending)
- Academic journal template library
- Automatic metadata extraction from PDFs
