# Academic Writing in NEO

## Overview

This roadmap records the academic features implemented across the seven phases, while identifying deferred integrations and current limitations separately. The features are optional and use the existing local book files; they do not replace NEO's novel-writing workflow.

The implementation has local author-date/numeric citation rendering and pragmatic APA, MLA, Chicago, and IEEE export profiles. These are useful formatting presets, **not a complete or standards-certified CSL processor**. Zotero and Mendeley API integrations remain deferred; Word citation fields do not connect to either service.

## Phase 1: Academic Metadata & Structure

### Metadata features

- [x] Abstract, comma-separated keywords, paper type, authors, affiliations, and validated ORCID IDs.
- [x] Select APA, MLA, Chicago, IEEE, or plain-text output profiles.
- [x] One metadata abstraction reads legacy `book.academic` and `book.metadata`; `metadata` is authoritative when academic data is edited.

Profiles provide local pragmatic formatting, not full CSL processing or certification against style manuals.

---

## Phase 2: References & Bibliography

### Reference features

- [x] Add and manage structured references manually or import/export BibTeX and CSL JSON.
- [x] Insert one or multiple citations; render local author-date or numeric citations and a generated bibliography.
- [x] Validate citations and report missing or unresolved references.
- [x] Keep unresolved citation markers movable and surface explicit diagnostics; isolate references across books to prevent cross-book ID collisions.
- [ ] Zotero and Mendeley API integrations are deferred; imports/exports are file-based, with no live library link.

---

## Phase 3: Figures & Media

### Figure features

- [x] Import PNG, JPEG, SVG, and PDF. Raster/SVG imports are optimized and validated; imported PDFs preserve the original and use a PNG preview of the first page.
- [x] Store figure assets in the book's `figures/` folder with stable IDs and source, license, attribution, caption, and alt-text metadata.
- [x] Insert, browse in the figure gallery, number, caption, and cross-reference figures.
- [x] Apply input, dimension, and optimized-output size limits. If an asset is rejected by a limit or format check, use a supported source or a smaller image.

PDF preview is a first-page raster, not a multi-page PDF viewer. PDF preview generation is desktop-only; Pocket can display desktop-generated previews.

---

## Phase 4: Math Equations

### Equation features

- [x] Insert and edit inline or display equations in TeX or AsciiMath, with local `mathjax-full` SVG rendering and a live preview.
- [x] Keep source with the equation, support copying its source, and number and cross-reference display equations.

Object numbers follow manuscript placement; unused metadata-only objects do not consume numbers. Inline equations are unnumbered and cannot be targeted by equation cross-references.

---

## Phase 5: Tables

### Table features

- [x] Create and edit tables in a grid; add/remove rows and columns, set header, borders, shading, alignment, and caption.
- [x] Number and cross-reference tables.
- [x] Import/export CSV and include tables in HTML and document exports.

---

## Phase 6: Export & Compilation

### Compilation features

- [x] Build EPUB, HTML, PDF, DOCX, Markdown, plain text, LaTeX, or Typst synchronously with `NeoAcademicExport.build(manuscript, { format, profile, document?, references? })`.
- [x] HTML and PDF builds return safe static academic HTML; PDF uses NEO's existing PDF renderer. EPUB is an EPUB 3 ZIP with the required uncompressed first `mimetype` entry, package/navigation files, XHTML chapters, embedded PNG/JPEG/GIF/SVG assets, bibliography, and cross-chapter links.
- [x] DOCX uses OOXML for tables and figures, cached native Word `CITATION`, `REF`, `SEQ`, and `TOC` fields, plus matching bibliography sources in `customXml/item1.xml` and its registered relationships. Field auto-update is disabled; this does not generate Zotero `ADDIN` controls.
- [x] Markdown emits Pandoc citations (`[@ref-N]`), embedded CSL references, base64 or percent-encoded image data URLs, math, anchors, and cross-reference links. Its profile-formatted bibliography is included directly and `suppress-bibliography: true` prevents a duplicate when using citeproc. Pandoc supports these data URLs ([source](https://github.com/jgm/pandoc/blob/main/src/Text/Pandoc/Class/PandocMonad.hs)).
- [x] LaTeX and Typst requests return `format: 'zip'` bundles, default-named `<title>-tex` / `<title>-typ`, with `manuscript.tex` / `manuscript.typ`, bibliography, assets, README, and `equation-sources.json` containing original equation source, format, and display mode. Plain text emits object descriptions, tab-separated tables, citations/bibliography, and tagged TeX or AsciiMath source; it does not embed figure images.

### Export boundaries

- HTML, PDF, DOCX, Typst, and EPUB require hydrated local figure and equation image/SVG assets. Markdown and LaTeX can emit TeX equations without a preview; AsciiMath is never converted to TeX and needs an image preview, otherwise export reports an error.
- DOCX math is an image preview, not editable Word math. SVG previews require an SVG-capable Word viewer; older viewers use a PNG placeholder.
- LaTeX emits TeX equation source only for TeX input; AsciiMath uses a preview (`\includesvg` or PNG `\includegraphics`). Compiling the bundle requires XeLaTeX and Biber, the matching installed `biblatex` profile style, Times New Roman, `svg` and Inkscape, and explicit `--shell-escape` for SVG. Do not compile untrusted input with shell escape enabled.
- Typst uses SVG/raster previews for both TeX and AsciiMath; it does not translate either source language. The selected Times font must be installed.
- Markdown's embedded profile bibliography is not a full CSL processor. For citeproc rendering, use Pandoc `--citeproc` and a matching `--csl` file for the selected profile.

---

## Phase 7: Academic UI & Workflows

### Workflow features

- [x] Academic mode is opt-in; academic panels start collapsed. The academic metadata model is read without writing or migrating a book on open. Editing academic data writes it to authoritative `metadata`.
- [x] Provide an academic outline, section statistics, and a references/figures/tables/equations gallery.
- [x] Search supports regular expressions, case sensitivity, capture groups, and replacement; citation, cross-reference, and equation markers remain atomic and are excluded from text matching.
- [x] Save basic chapter revision snapshots and review comments anchored to quoted manuscript text. Snapshots can be accepted or rejected; rejecting checks for intervening chapter edits.
- [x] Shortcuts are mode-aware and the existing novel-mode native shortcuts remain available: `Cmd/Ctrl+Shift+M` toggles academic mode; in academic mode `Cmd/Ctrl+Shift+C` inserts citations, `Cmd/Ctrl+Shift+I` or `Cmd/Ctrl+Shift+F` inserts a figure, `Cmd/Ctrl+Shift+E` an equation, and `Cmd/Ctrl+Shift+T` a table. In novel mode `Cmd/Ctrl+Shift+F` retains Find.

Revision snapshots and comments are local review aids, not collaboration, synchronized co-authoring, or full tracked-changes workflows.

---

## Implementation Strategy

### UI/UX Principles

- Keep the distraction-free philosophy
- Academic mode is opt-in and academic panels are collapsed until opened.
- Keep the existing novel-mode shortcuts; use mode-aware academic commands.

### Data Storage

- Academic fields and structured objects are stored in book metadata; figure files live in `figures/`, and the desktop-compatible bibliography sidecar is `bibliography.bib`.
- Reads normalize old and new metadata without writing to the book. On academic edit, `metadata` becomes the single authoritative representation; the legacy `book.academic` property is removed.

### Backward Compatibility

- Academic features are optional; existing books remain unchanged until an academic edit.
- New academic panels are collapsed by default, and academic mode is opt-in.

---

## Quick Start for Contributors

### Adding an academic feature

1. Extend the academic model and relevant feature module.
2. Integrate the UI with the existing editor and metadata persistence.
3. Add focused tests under `scripts/` and run `npm run test:academic`.

### Keyboard Shortcut Convention

- `Cmd/Ctrl+Shift+M` - Toggle Academic Mode
- In Academic Mode: `Cmd/Ctrl+Shift+C` - Citation; `Cmd/Ctrl+Shift+I` or `F` - Figure; `Cmd/Ctrl+Shift+E` - Equation; `Cmd/Ctrl+Shift+T` - Table
- In novel mode: `Cmd/Ctrl+Shift+F` retains Find

---

## External Libraries & Dependencies

The implementation uses:

- `mathjax-full` for local TeX/AsciiMath equation rendering.
- Local reference import, parsing, and rendering modules for BibTeX and CSL JSON; there is no external citation-service connection.

---

## Testing Checklist

Run these no-argument commands for portable default test artifacts; optional CLI arguments can override the defaults:

```sh
npm run test:academic
npm run test:academic:smoke
npm run test:academic:app
```

- [x] Academic tests pass (163/163); the baseline dash and spellcheck suites pass (7 tests each).
- [x] Chromium-backed smoke testing covers cross-chapter copy/cut, container-preserving multi-chapter cuts, rapid paste with unique IDs, and HTML/PDF/DOCX exports.
- [x] The real Electron app smoke test covers academic mode/native menu, citation/table/math insertion, immediate `Cmd+Z` after academic cut, and save/reopen with editor markup and metadata preserved.
- [x] The latest generated PDF has five pages and four image operations; DOCX package structure (24 ZIP entries) was checked. An exported UI screenshot was reviewed in a browser.

These checks do not certify citation-style compliance or physical print fidelity. No external Pandoc, TeX, or Typst compilation, or visual rendering in Word, is claimed.

---

## Future Enhancements

- Zotero and Mendeley API integrations.
