(function () {
  const panel = document.getElementById('academic-panel');
  if (!panel) return;
  const byId = (id) => document.getElementById(id);
  const tr = (key, vars) => window.NeoI18n.t(key, vars);
  const refs = window.NeoReferences;
  const objects = window.NeoAcademicObjects;
  const model = window.NeoAcademicModel;

  // Plugin seam: create academic plugin with dependency injection
  const plugin = window.NeoAcademicPlugin.create({
    document,
    getBook: () => typeof book !== 'undefined' ? book : null,
    translate: tr,
    report: (err) => {
      const message = String(err && err.message || err);
      console.error('Academic writing:', err);
      if (window.neo.logError) window.neo.logError('academic: ' + (err && err.stack || message));
      toast(tr('Academic writing: {error}', { error: message }), 8000);
    },
    model,
    i18n: window.NeoI18n,
    neo: window.neo
  });
  let bookmark = null;
  let refreshing = false;
  let programmaticEdit = false;
  let refreshTimer = null;
  let pasteQueue = Promise.resolve();
  const beforeEdits = new WeakMap();

  function currentBook() {
    return typeof book !== 'undefined' ? book : null;
  }

  function metadata() {
    const b = currentBook();
    return b ? model.read(b) : null;
  }

  function commitMetadata(changes) {
    return plugin.updateMetadata(changes);
    // Legacy direct mutation removed; plugin handles bookStore adapter
  }

  function report(err) {
    const message = String(err && err.message || err);
    console.error('Academic writing:', err);
    if (window.neo.logError) window.neo.logError('academic: ' + (err && err.stack || message));
    toast(tr('Academic writing: {error}', { error: message }), 8000);
  }

  function uniqueId(prefix) {
    return prefix + '-' + crypto.randomUUID();
  }

  const academicUI = window.NeoAcademicUI.create({ document, getBook: currentBook, translate: tr, report, uniqueId });
  const { dialog, button: makeButton, eventAction: action } = academicUI;

  function rememberSelection() {
    const b = currentBook();
    const selection = window.getSelection();
    if (!b || !selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const body = element && element.closest('.chapter-body');
    if (!body || !body.contains(range.endContainer) || element.closest('[contenteditable="false"]')) return;
    bookmark = { bookId: b.id, chapterId: body.closest('.chapter').dataset.id, body, range: range.cloneRange() };
  }

  function insertionPoint() {
    rememberSelection();
    const b = currentBook();
    if (!b || !bookmark || bookmark.bookId !== b.id || !bookmark.body.isConnected ||
        !bookmark.body.contains(bookmark.range.startContainer) || !bookmark.body.contains(bookmark.range.endContainer)) {
      throw new Error(tr('Click inside the manuscript first.'));
    }
    return { ...bookmark, html: captureBody(bookmark.body) };
  }

  function insertHTML(html, point = insertionPoint(), changes = null, { prepareClipboard = false } = {}) {
    const b = currentBook();
    if (!b || point.bookId !== b.id || !point.body.isConnected) throw new Error(tr('The insertion point is no longer available.'));
    if (point.html != null && point.html !== captureBody(point.body)) throw new Error(tr('The manuscript changed while this action was open. Try again.'));
    const before = captureBody(point.body);
    const beforeMetadata = metadata();
    snapshotStructure('academic insertion', { academic: true });
    point.body.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(point.range);
    const insertion = prepareClipboard ? window.NeoAcademicClipboard.prepareInsertionHTML(html, { document }) : html;
    programmaticEdit = true;
    try {
      if (!document.execCommand('insertHTML', false, insertion)) throw new Error(tr('The manuscript could not accept this insertion.'));
    } finally {
      try { window.NeoAcademicClipboard.restoreAtomicMarkers(point.body); }
      finally { programmaticEdit = false; }
    }
    if (changes) commitMetadata(changes);
    captureRevision(point.body, before, beforeMetadata);
    syncChapter(point.body, point.chapterId);
    rememberSelection();
    refreshDocument();
    document.dispatchEvent(new CustomEvent('neo:academic-structural-edit'));
  }

  function bodyForObject(id) {
    return Array.from(document.querySelectorAll('#chapters [data-academic-id]'))
      .find((node) => node.dataset.academicId === id);
  }

  function replaceObject(id, html, changes) {
    const node = bodyForObject(id);
    if (!node) throw new Error(tr('This object is no longer in the manuscript.'));
    const body = node.closest('.chapter-body');
    const before = captureBody(body);
    const beforeMetadata = metadata();
    snapshotStructure('academic object edit', { academic: true });
    const holder = document.createElement('div');
    holder.innerHTML = html;
    node.replaceWith(holder.firstElementChild);
    if (changes) commitMetadata(changes);
    captureRevision(body, before, beforeMetadata);
    syncChapter(body, body.closest('.chapter').dataset.id);
    refreshDocument();
    document.dispatchEvent(new CustomEvent('neo:academic-structural-edit'));
  }

  function fieldsFromPanel() {
    const authors = model.parseAuthors(byId('academic-authors').value);
    return {
      abstract: byId('academic-abstract').value,
      keywords: [...new Set(byId('academic-keywords').value.split(',').map((keyword) => keyword.trim()).filter(Boolean))],
      authors,
      paperType: byId('academic-paper-type').value,
      profile: byId('academic-profile').value,
      citationStyle: byId('academic-citation-style').value,
      writingTheme: byId('academic-writing-theme').value,
      exportTheme: byId('academic-export-theme').value
    };
  }

  function saveFields() {
    commitMetadata(fieldsFromPanel());
    byId('academic-authors').setCustomValidity('');
    renderThemePreview();
    refreshDocument();
  }

  function syncFields() {
    const meta = metadata();
    if (!meta) return;
    byId('academic-abstract').value = meta.abstract;
    byId('academic-keywords').value = meta.keywords.join(', ');
    byId('academic-authors').value = model.formatAuthors(meta.authors);
    byId('academic-authors').setCustomValidity('');
    byId('academic-paper-type').value = meta.paperType;
    byId('academic-profile').value = meta.profile;
    byId('academic-citation-style').value = meta.citationStyle;
    byId('academic-writing-theme').value = meta.writingTheme || meta.theme || 'latex-plain';
    byId('academic-export-theme').value = meta.exportTheme || meta.writingTheme || meta.theme || 'latex-plain';
    byId('academic-track-changes').checked = meta.trackChanges;
    applyMode(meta.academicMode);
    renderReferences();
    renderReview();
    refreshDocument();
  }

  function applyMode(enabled) {
    plugin.setMode(enabled);
    byId('academic-mode-toggle').setAttribute('aria-pressed', String(enabled));
    byId('academic-mode-toggle').textContent = tr(enabled ? 'Academic mode on' : 'Academic mode');
    byId('academic-toggle').hidden = !currentBook();
    if (enabled && currentBook()) {
      plugin.applyWritingTheme(document.getElementById('chapters') || document.body, currentBook());
      createFloatingQuickBar();
    } else {
      // Clear theme when academic mode off
      const root = document.getElementById('chapters') || document.body;
      root.dataset.theme = '';
      root.style.removeProperty('--theme-font-family');
      root.style.removeProperty('--theme-line-height');
      root.style.removeProperty('--theme-measure');
      const bar = document.getElementById('academic-quick-bar');
      if (bar) bar.remove();
    }
  }

  // Miniature page showing how the selected export theme lays out a paper,
  // so the choice is visible before exporting. 1 preview px = 1pt at 96dpi.
  function renderThemePreview() {
    const box = byId('academic-theme-preview');
    if (!box) return;
    const theme = plugin.getTheme('export');
    if (!theme) { box.replaceChildren(); return; }
    const t = theme.typography, p = theme.page;
    const size = Math.max(7, Math.min(t.fontSizePt, 14));
    const page = document.createElement('div');
    page.className = 'tp-page';
    const style = page.style;
    style.setProperty('--tp-font', t.fontFamily);
    style.setProperty('--tp-size', size + 'px');
    style.setProperty('--tp-leading', String(t.lineHeight));
    page.innerHTML =
      '<div class="tp-title">Manuscript title</div>' +
      '<div class="tp-meta">Author One &middot; Institution</div>' +
      '<div class="tp-body' + (p.columns > 1 ? ' two-col' : '') + '">' +
      '<h2>1. Introduction</h2>' +
      '<p>Sample text runs the full measure of the export layout so type size, leading, and column count read the way they will in the finished document.</p>' +
      '<p>Citations are rendered inline <span class="tp-citation">[1]</span> and equations display centered on their own line: <span class="tp-math">E = mc&sup2;</span></p>' +
      '<h3>1.1 Method</h3>' +
      '<p>A second paragraph confirms paragraph spacing and heading steps match the theme.</p>' +
      '<div class="tp-figure-box"></div>' +
      '<div class="tp-caption">Fig. 1. Illustrative caption</div>' +
      '<table class="tp-table"><tr><th>A</th><th>B</th></tr><tr><td>1.0</td><td>2.0</td></tr></table>' +
      '</div>' +
      '<hr class="tp-rule" />' +
      '<div class="tp-caption" style="text-align:left;font-size:' + Math.max(6, (theme.captions ? theme.captions.figure.fontSize || 8 : 8)) + 'px">References: Author (2024) Title. Journal 1(1): 1&ndash;9.</div>';
    box.replaceChildren(page);
  }

  function toggleMode() {
    const enabled = plugin.toggleMode();
    applyMode(enabled);
    if (enabled) {
      document.getElementById('side-pane').classList.add('open');
      setPanelVisible(true);
    }
    refreshDocument();
  }

  function setPanelVisible(visible) {
    panel.hidden = !visible;
    byId('academic-toggle').setAttribute('aria-expanded', String(visible));
    byId('academic-toggle').textContent = tr(visible ? 'Notes' : 'Academic');
    byId('sticky-list').hidden = visible;
    if (visible) renderThemePreview();
  }

  function referenceId(ref) { return ref.id || ref.key; }
  function normalizedReferences() { return metadata().references.map((ref) => refs.normalize(ref)); }

  async function editReference(existing = null) {
    const normalized = existing ? refs.normalize(existing) : null;
    const authorText = normalized ? (normalized.author || []).map((author) => author.literal
      ? '{' + author.literal + '}' : [author.family, author.given].filter(Boolean).join(', ')).join('; ') : '';
    const value = await dialog(existing ? 'Edit reference' : 'Add reference', [
      { key: 'key', label: 'Citation key', required: true, value: normalized && referenceId(normalized) },
      { key: 'title', label: 'Title', required: true, value: normalized && (normalized.title || normalized.text || normalized.label) },
      { key: 'author', label: 'Authors (semicolon separated: Family, Given or {Organization})', value: authorText },
      { key: 'year', label: 'Year', type: 'number', min: 1, max: 9999, value: normalized?.issued?.['date-parts']?.[0]?.[0] || '' },
      { key: 'container', label: 'Journal or publisher', value: normalized && (normalized['container-title'] || normalized.publisher) },
      { key: 'DOI', label: 'DOI', value: normalized && normalized.DOI },
      { key: 'URL', label: 'URL', type: 'url', value: normalized && normalized.URL },
      { key: 'category', label: 'Category', value: normalized && normalized.category },
      { key: 'type', label: 'Reference type', value: normalized && normalized.type || 'article-journal', options: [
        { value: 'article-journal', label: 'Journal article' }, { value: 'book', label: 'Book' },
        { value: 'chapter', label: 'Book chapter' }, { value: 'webpage', label: 'Web page' }, { value: 'paper-conference', label: 'Conference paper' }
      ] }
    ], {
      validate: (values) => {
        if (!/^[\p{L}\p{N}_.:+-]+$/u.test(values.key.trim())) throw new Error(tr('Citation keys must not contain spaces or markup.'));
        if (!values.title.trim()) throw new Error(tr('A reference title is required.'));
        if (normalizedReferences().some((ref) => referenceId(ref) === values.key.trim() && referenceId(ref) !== (normalized && referenceId(normalized)))) {
          throw new Error(tr('This citation key is already in use.'));
        }
        if (values.URL && !/^https?:\/\//i.test(values.URL)) throw new Error(tr('Reference URLs must use http or https.'));
      }
    });
    if (!value) return;
    const id = value.key.trim();
    const ref = refs.normalize({
      ...(normalized || {}), id, key: id, type: value.type, title: value.title.trim(),
      author: normalized && value.author === authorText ? normalized.author
        : window.NeoBibtex.parseNames(value.author.split(';').map((name) => name.trim()).filter(Boolean).join(' and ')),
      issued: value.year ? { 'date-parts': [[Number(value.year)]] } : normalized?.issued?.literal ? normalized.issued : { 'date-parts': [] },
      'container-title': value.type === 'book' ? '' : value.container.trim(),
      publisher: value.type === 'book' ? value.container.trim() : normalized?.publisher || '',
      DOI: value.DOI.trim(), URL: value.URL.trim(), category: value.category.trim()
    });
    const list = normalizedReferences();
    const index = normalized ? list.findIndex((entry) => referenceId(entry) === referenceId(normalized)) : -1;
    if (index >= 0) list[index] = ref;
    else list.push(ref);
    if (normalized && id !== referenceId(normalized)) renameCitations(referenceId(normalized), id);
    commitMetadata({ references: list });
    renderReferences();
    refreshDocument();
    await persistBibliography();
  }

  function renameCitations(previous, next) {
    const citations = Array.from(document.querySelectorAll('#chapters .academic-citation'), (node) => {
      const ids = JSON.parse(node.dataset.cites);
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error(tr('Invalid citation marker.'));
      return { node, ids };
    });
    citations.forEach(({ node, ids }) => {
      if (!ids.includes(previous)) return;
      node.dataset.cites = JSON.stringify(ids.map((id) => id === previous ? next : id));
      const body = node.closest('.chapter-body');
      syncChapter(body, body.closest('.chapter').dataset.id);
    });
  }

  function createQuickCaptionOverlay(onDone) {
    const overlay = document.createElement('div');
    overlay.className = 'academic-quick-caption';
    overlay.innerHTML = `
      <div class="caption-inner">
        <input id="quick-caption-input" placeholder="${tr('Figure caption…')}" />
        <input id="quick-alt-input" placeholder="${tr('Alt text…')}" />
        <div class="caption-actions">
          <button type="button" class="btn-gold" data-action="done">${tr('Insert')}</button>
          <button type="button" data-action="cancel">${tr('Cancel')}</button>
        </div>
      </div>`;
    const captionInput = overlay.querySelector('#quick-caption-input');
    const altInput = overlay.querySelector('#quick-alt-input');
    captionInput.focus();
    overlay.querySelector('[data-action="done"]').addEventListener('click', () => {
      overlay.remove();
      onDone(captionInput.value, altInput.value);
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    return overlay;
  }

  function createCitationPicker(list, onSelect) {
    const overlay = document.createElement('div');
    overlay.className = 'academic-citation-picker';
    overlay.innerHTML = `
      <div class="picker-inner">
        <input id="citation-picker-input" placeholder="${tr('Search references…')}" autocomplete="off" />
        <div id="citation-picker-results"></div>
        <div class="picker-actions">
          <button type="button" class="btn-gold" data-action="insert">${tr('Insert')}</button>
          <button type="button" data-action="cancel">${tr('Cancel')}</button>
        </div>
      </div>`;
    const input = overlay.querySelector('#citation-picker-input');
    const results = overlay.querySelector('#citation-picker-results');
    const selected = new Set();
    function render(filter = '') {
      results.innerHTML = '';
      const items = list.filter(ref => {
        const key = referenceId(ref);
        const title = ref.title || '';
        const author = (ref.author || []).map(a => a.literal || [a.family, a.given].filter(Boolean).join(' ')).join(' ');
        const hay = `${key} ${title} ${author}`.toLowerCase();
        return !filter || hay.includes(filter.toLowerCase());
      });
      items.forEach(ref => {
        const id = referenceId(ref);
        const row = document.createElement('div');
        row.className = 'picker-item' + (selected.has(id) ? ' selected' : '');
        row.innerHTML = `<span>${id}</span><small>${ref.title || ''}</small>`;
        row.addEventListener('click', () => {
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          render(input.value);
        });
        results.appendChild(row);
      });
    }
    render();
    input.addEventListener('input', () => render(input.value));
    overlay.querySelector('[data-action="insert"]').addEventListener('click', () => {
      overlay.remove();
      onSelect([...selected]);
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    return overlay;
  }

  function renderReferences() {
    const meta = metadata();
    if (!meta) return;
    const filter = byId('academic-ref-filter');
    const selected = filter.value;
    filter.replaceChildren();
    const all = document.createElement('option');
    all.value = '';
    all.textContent = tr('All categories');
    filter.appendChild(all);
    [...new Set(meta.references.map((ref) => ref.category).filter(Boolean))].sort().forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      filter.appendChild(option);
    });
    filter.value = selected;
    const list = byId('academic-ref-list');
    list.replaceChildren();
    normalizedReferences().filter((ref) => !filter.value || ref.category === filter.value).forEach((ref) => {
      const item = document.createElement('div');
      item.className = 'academic-ref-item';
      item.dataset.key = referenceId(ref);
      const text = document.createElement('span');
      text.textContent = referenceId(ref) + ': ' + (ref.title || ref.label || ref.text || '');
      item.append(text, makeButton('Edit', () => editReference(ref)), makeButton('Cite', () => insertCitation([referenceId(ref)])), makeButton('Remove', async () => {
        const check = await dialog('Remove reference?', [], { submit: 'Remove' });
        if (!check) return;
        commitMetadata({ references: normalizedReferences().filter((entry) => referenceId(entry) !== referenceId(ref)) });
        renderReferences();
        refreshDocument();
        await persistBibliography();
      }));
      list.appendChild(item);
    });
  }

  async function insertCitation(ids) {
    const point = insertionPoint();
    const list = normalizedReferences();
    if (!list.length) throw new Error(tr('Add a reference before inserting a citation.'));
    if (!Array.isArray(ids)) {
      // Inline quick picker for fluid insertion
      const picker = createCitationPicker(list, async (selectedIds) => {
        if (!selectedIds.length) return;
        const meta = metadata();
        const span = document.createElement('span');
        span.className = 'academic-citation';
        span.dataset.cites = JSON.stringify(selectedIds);
        span.contentEditable = 'false';
        span.textContent = refs.citation(list, selectedIds, { profile: meta.profile, style: meta.citationStyle });
        insertHTML(span.outerHTML + ' ', point);
      });
      document.body.appendChild(picker);
      return;
    }
    const meta = metadata();
    const span = document.createElement('span');
    span.className = 'academic-citation';
    span.dataset.cites = JSON.stringify(ids);
    span.contentEditable = 'false';
    span.textContent = refs.citation(list, ids, { profile: meta.profile, style: meta.citationStyle });
    insertHTML(span.outerHTML + ' ', point);
  }

  async function persistBibliography() {
    const b = currentBook();
    if (!b) return;
    const text = refs.export(normalizedReferences(), 'bib');
    if (!window.neo.writeAcademicBibliography) throw new Error(tr('Bibliography file storage is unavailable on this platform.'));
    await window.neo.writeAcademicBibliography(b.id, text);
  }

  async function importReferences(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const b = currentBook();
    const parsed = refs.import(await file.text(), /\.bib$/i.test(file.name) ? 'bib' : 'json');
    if (b !== currentBook()) throw new Error(tr('The open book changed. Try the import again.'));
    let combined;
    try { combined = model.mergeReferences(normalizedReferences(), parsed, { duplicates: 'error' }); }
    catch (err) {
      const values = await dialog('Duplicate citation keys', [{ key: 'duplicates', label: 'Existing references', options: [
        { value: 'skip', label: 'Keep existing references' }, { value: 'replace', label: 'Replace with imported references' }
      ] }]);
      if (!values) return;
      combined = model.mergeReferences(normalizedReferences(), parsed, { duplicates: values.duplicates });
    }
    commitMetadata({ references: combined });
    renderReferences();
    refreshDocument();
    await persistBibliography();
  }

  async function exportReferences(format) {
    const b = currentBook();
    const saved = await window.neo.exportSave({ format: format === 'bib' ? 'bib' : 'json', defaultName: safeName(b.title) + '-bibliography', content: refs.export(normalizedReferences(), format) });
    if (saved) toast(tr('Exported: {file}', { file: saved.split('/').pop() }));
  }

  async function insertFigure() {
    const point = insertionPoint();
    const b = currentBook();
    if (!window.neo.importAcademicFigure) throw new Error(tr('Figure import is unavailable on this platform.'));
    const asset = await window.neo.importAcademicFigure(b.id);
    if (!asset) return;
    if (b !== currentBook()) throw new Error(tr('The open book changed. Try the action again.'));
    // Quick caption overlay instead of full dialog
    const { dataUrl, ...storedAsset } = asset;
    const quickCaption = createQuickCaptionOverlay(async (caption, alt) => {
      const figure = { id: uniqueId('fig'), ...storedAsset, caption: caption || '', alt: alt || asset.originalName || '', source: '', license: '', attribution: '' };
      insertHTML(objects.figureHTML(figure, dataUrl) + '<p><br></p>', point, { figures: [...metadata().figures, figure] });
      refreshDocument();
    });
    document.body.appendChild(quickCaption);
  }

  function figureDialog(figure) {
    return dialog('Figure details', [
      { key: 'caption', label: 'Caption', value: figure.caption, required: true },
      { key: 'alt', label: 'Alternative text', value: figure.alt, required: true },
      { key: 'source', label: 'Source', value: figure.source },
      { key: 'license', label: 'License', value: figure.license },
      { key: 'attribution', label: 'Attribution', value: figure.attribution }
    ]);
  }

  async function editFigure(figure) {
    const owner = currentBook();
    const values = await figureDialog(figure);
    if (!values) return;
    const updated = { ...figure, ...values };
    const dataUrl = figure.dataUrl || await window.neo.readAcademicFigure(owner.id, figure.file);
    if (owner !== currentBook()) throw new Error(tr('The open book changed. Try the action again.'));
    replaceObject(figure.id, objects.figureHTML(updated, dataUrl), { figures: metadata().figures.map((entry) => entry.id === figure.id ? updated : entry) });
    refreshDocument();
  }

  function equationInput(raw, display) {
    let source = raw.trim();
    if (source.startsWith('$$') && source.endsWith('$$')) { source = source.slice(2, -2).trim(); display = true; }
    else if (source.startsWith('\\[') && source.endsWith('\\]')) { source = source.slice(2, -2).trim(); display = true; }
    else if (source.startsWith('$') && source.endsWith('$')) { source = source.slice(1, -1).trim(); display = false; }
    return { source, display };
  }

  async function equationDialog(equation = null, inline = false) {
    if (inline) {
      const overlay = document.createElement('div');
      overlay.className = 'academic-equation-overlay';
      overlay.innerHTML = `
        <div class="eq-inner">
          <textarea id="eq-source" placeholder="${tr('LaTeX or AsciiMath…')}">${equation?.source || ''}</textarea>
          <div class="eq-preview" aria-live="polite">${tr('Equation preview')}</div>
          <div class="eq-actions">
            <label><input type="checkbox" id="eq-display" ${equation?.display ? 'checked' : 'checked'} /> ${tr('Numbered display')}</label>
            <button type="button" class="btn-gold" data-action="insert">${equation ? tr('Save') : tr('Insert')}</button>
            <button type="button" data-action="cancel">${tr('Cancel')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const textarea = overlay.querySelector('#eq-source');
      const preview = overlay.querySelector('.eq-preview');
      const displayCb = overlay.querySelector('#eq-display');
      textarea.focus();
      let request = 0;
      const render = async () => {
        const token = ++request;
        const { source, display } = equationInput(textarea.value, displayCb.checked);
        if (!source) { preview.textContent = tr('Equation preview'); return; }
        try {
          const rendered = await window.neo.renderAcademicMath(source, 'tex', display);
          if (token !== request || !overlay.isConnected) return;
          preview.innerHTML = typeof rendered === 'string' ? rendered : rendered.svg;
        } catch (err) {
          if (token === request && overlay.isConnected) preview.textContent = String(err.message || err);
        }
      };
      textarea.addEventListener('input', () => { clearTimeout(overlay._t); overlay._t = setTimeout(render, 200); });
      displayCb.addEventListener('change', render);
      setTimeout(render, 0);
      return new Promise(resolve => {
        overlay.querySelector('[data-action="insert"]').addEventListener('click', async () => {
          overlay.remove();
          const { source, display } = equationInput(textarea.value, displayCb.checked);
          if (!source) { resolve(null); return; }
          const rendered = await window.neo.renderAcademicMath(source, 'tex', display);
          resolve({ id: equation?.id || uniqueId('eq'), source, format: 'tex', display, svg: typeof rendered === 'string' ? rendered : rendered.svg });
        });
        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => { overlay.remove(); resolve(null); });
        overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
      });
    }
    const values = await dialog(equation ? 'Edit equation' : 'Insert equation', [
      { key: 'source', label: 'Math source (LaTeX or AsciiMath)', type: 'textarea', required: true, value: equation && equation.source || '' },
      { key: 'format', label: 'Math format', value: equation && equation.format || 'tex',
        options: [{ value: 'tex', label: 'LaTeX' }, { value: 'asciimath', label: 'AsciiMath' }] },
      { key: 'display', label: 'Display equation (numbered)', type: 'checkbox', value: equation ? equation.display : true }
    ], {
      submit: equation ? 'Save' : 'Insert',
      enhance: (form, controls) => {
        const preview = document.createElement('div');
        preview.className = 'academic-math-preview';
        preview.setAttribute('aria-live', 'polite');
        form.appendChild(preview);
        let request = 0;
        let timer;
        const render = async () => {
          const token = ++request;
          const { source, display } = equationInput(controls.get('source').input.value, controls.get('display').input.checked);
          if (!source) { preview.textContent = tr('Equation preview'); return; }
          try {
            const rendered = await window.neo.renderAcademicMath(source, controls.get('format').input.value, display);
            if (token !== request || !form.isConnected) return;
            preview.innerHTML = typeof rendered === 'string' ? rendered : rendered.svg;
          } catch (err) {
            if (token === request && form.isConnected) preview.textContent = String(err.message || err);
          }
        };
        controls.forEach(({ input }) => input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(render, 200);
        }));
        setTimeout(render, 0);
      }
    });
    if (!values) return null;
    const { source, display } = equationInput(values.source, values.display);
    if (!source) throw new Error(tr('An equation source is required.'));
    const b = currentBook();
    if (!window.neo.renderAcademicMath) throw new Error(tr('Math rendering is unavailable on this platform.'));
    const rendered = await window.neo.renderAcademicMath(source, values.format, display);
    if (b !== currentBook()) throw new Error(tr('The open book changed. Try the action again.'));
    return { ...(equation || {}), id: equation ? equation.id : uniqueId('eq'), source, format: values.format, display, svg: typeof rendered === 'string' ? rendered : rendered.svg };
  }

  async function insertEquation() {
    const point = insertionPoint();
    const equation = await equationDialog(null, true);
    if (!equation) return;
    insertHTML(objects.equationHTML(equation, equation.svg) + (equation.display ? '<p><br></p>' : ' '), point, { equations: [...metadata().equations, equation] });
    refreshDocument();
  }

  async function editEquation(equation) {
    const updated = await equationDialog(equation);
    if (!updated) return;
    replaceObject(equation.id, objects.equationHTML(updated, updated.svg), { equations: metadata().equations.map((entry) => entry.id === updated.id ? updated : entry) });
    refreshDocument();
  }

  function tableDialog(table = null) {
    return dialog(table ? 'Edit table' : 'Insert table', [
      { key: 'caption', label: 'Caption', required: true, value: table && table.caption || '' },
      { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 100, value: table ? table.rows.length : 3 },
      { key: 'columns', label: 'Columns', type: 'number', min: 1, max: 30, value: table ? table.rows[0].length : 3 },
      { key: 'csv', label: 'Cell contents (CSV; quoted fields supported)', type: 'textarea', rows: 8, value: table ? objects.exportCSV(table.rows) : '' },
      { key: 'header', label: 'First row is a header', type: 'checkbox', value: table ? table.header : true },
      { key: 'borders', label: 'Cell borders', type: 'checkbox', value: table ? table.borders : true },
      { key: 'shading', label: 'Alternate row shading', type: 'checkbox', value: table ? table.shading : false },
      { key: 'align', label: 'Alignment', value: table && table.align || 'left', options: [
        { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }
      ] },
      ...(table ? [{ key: 'allowCrop', label: 'Allow removing populated rows or columns', type: 'checkbox', value: false }] : [])
    ], {
      submit: table ? 'Save' : 'Insert',
      validate: (values) => {
        const rows = Number(values.rows), columns = Number(values.columns);
        if (!Number.isInteger(rows) || rows < 1 || rows > 100 || !Number.isInteger(columns) || columns < 1 || columns > 30) throw new Error(tr('Use 1-100 rows and 1-30 columns.'));
        if (values.csv.trim()) objects.parseCSV(values.csv);
        const content = values.csv.trim() ? objects.parseCSV(values.csv) : [];
        if (!values.allowCrop && (content.length > rows || content.some((row) => row.length > columns))) {
          throw new Error(tr('The CSV data exceeds the selected grid. Increase the grid size or explicitly allow removing populated rows or columns.'));
        }
      },
      enhance: (form, controls) => {
        const grid = document.createElement('div');
        grid.className = 'academic-table-editor';
        form.appendChild(grid);
        function renderGrid() {
          try {
            const rowCount = Math.max(1, Math.min(100, Number(controls.get('rows').input.value) || 1));
            const columns = Math.max(1, Math.min(30, Number(controls.get('columns').input.value) || 1));
            const csv = controls.get('csv').input;
            const parsed = csv.value ? objects.parseCSV(csv.value) : [];
            const element = document.createElement('table');
            for (let row = 0; row < rowCount; row++) {
              const tr = document.createElement('tr');
              for (let col = 0; col < columns; col++) {
                const td = document.createElement('td');
                const input = document.createElement('input');
                input.type = 'text';
                input.value = parsed[row] && parsed[row][col] || '';
                input.setAttribute('aria-label', window.NeoI18n.t('Row {row}, column {column}', { row: row + 1, column: col + 1 }));
                input.addEventListener('input', () => {
                  const values = csv.value ? objects.parseCSV(csv.value) : [];
                  while (values.length < rowCount) values.push([]);
                  values.forEach((cells) => { while (cells.length < columns) cells.push(''); });
                  values[row][col] = input.value;
                  csv.value = objects.exportCSV(values);
                });
                td.appendChild(input);
                tr.appendChild(td);
              }
              element.appendChild(tr);
            }
            grid.replaceChildren(element);
          } catch (err) { grid.textContent = String(err.message || err); }
        }
        ['rows', 'columns', 'csv'].forEach((key) => controls.get(key).input.addEventListener('input', renderGrid));
        renderGrid();
      }
    });
  }

  function tableFromValues(values, existing = null) {
    const content = values.csv.trim() ? objects.parseCSV(values.csv) : [];
    const rowCount = Number(values.rows), columns = Number(values.columns);
    if (!values.allowCrop && (content.length > rowCount || content.some((row) => row.length > columns))) throw new Error(tr('The CSV data exceeds the selected grid. Increase the row or column count.'));
    return {
      id: existing ? existing.id : uniqueId('tbl'), caption: values.caption.trim(),
      rows: Array.from({ length: rowCount }, (_, row) => Array.from({ length: columns }, (_, col) => content[row] && content[row][col] || '')),
      header: values.header, borders: values.borders, shading: values.shading, align: values.align
    };
  }

  async function insertTable() {
    const point = insertionPoint();
    // Quick table grid chooser
    const chooser = document.createElement('div');
    chooser.className = 'academic-table-chooser';
    chooser.innerHTML = `
      <div class="chooser-inner">
        <p>${tr('Choose grid size')}</p>
        <div class="grid-presets">
          <button data-rows="2" data-cols="2">2×2</button>
          <button data-rows="3" data-cols="3">3×3</button>
          <button data-rows="4" data-cols="3">4×3</button>
        </div>
        <div class="custom">
          <label>${tr('Rows')}<input type="number" id="quick-rows" min="1" max="10" value="3" /></label>
          <label>${tr('Cols')}<input type="number" id="quick-cols" min="1" max="10" value="3" /></label>
        </div>
        <div class="actions">
          <button class="btn-gold" data-action="create">${tr('Create')}</button>
          <button data-action="cancel">${tr('Cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(chooser);
    chooser.querySelectorAll('.grid-presets button').forEach(btn => {
      btn.addEventListener('click', () => {
        chooser.querySelector('#quick-rows').value = btn.dataset.rows;
        chooser.querySelector('#quick-cols').value = btn.dataset.cols;
      });
    });
    const create = async () => {
      const rows = Number(chooser.querySelector('#quick-rows').value);
      const cols = Number(chooser.querySelector('#quick-cols').value);
      chooser.remove();
      const values = { caption: '', rows, columns: cols, csv: '', header: true, borders: true, shading: false, align: 'left' };
      const table = tableFromValues(values);
      insertHTML(objects.tableHTML(table) + '<p><br></p>', point, { tables: [...metadata().tables, table] });
      refreshDocument();
      // Insert ghost caption
      setTimeout(() => {
        const body = point.body;
        const captionEl = document.createElement('p');
        captionEl.className = 'academic-table-caption ghost';
        captionEl.contentEditable = 'true';
        captionEl.textContent = tr('Table caption…');
        body.insertAdjacentElement('afterend', captionEl);
      }, 0);
    };
    chooser.querySelector('[data-action="create"]').addEventListener('click', create);
    chooser.querySelector('[data-action="cancel"]').addEventListener('click', () => chooser.remove());
    chooser.addEventListener('click', e => { if (e.target === chooser) chooser.remove(); });
  }

  async function editTable(table) {
    const values = await tableDialog(table);
    if (!values) return;
    const updated = tableFromValues(values, table);
    replaceObject(table.id, objects.tableHTML(updated), { tables: metadata().tables.map((entry) => entry.id === table.id ? updated : entry) });
    refreshDocument();
  }

  async function insertCrossReference() {
    const point = insertionPoint();
    const nodes = Array.from(document.querySelectorAll('#chapters [data-academic-id]'))
      .filter((node) => !node.classList.contains('academic-equation') || node.dataset.display === 'true');
    if (!nodes.length) throw new Error(tr('Insert a figure, table or numbered display equation first.'));
    const values = await dialog('Insert cross-reference', [{ key: 'target', label: 'Target', options: nodes.map((node) => {
      const caption = node.querySelector('figcaption, .academic-equation-number');
      return { value: node.dataset.academicId, label: caption ? caption.textContent : node.dataset.academicId };
    }) }], { submit: 'Insert' });
    if (!values) return;
    const node = nodes.find((entry) => entry.dataset.academicId === values.target);
    const kind = node.classList.contains('academic-figure') ? 'figure' : node.classList.contains('academic-table') ? 'table' : 'equation';
    const span = document.createElement('span');
    span.className = 'academic-xref';
    span.contentEditable = 'false';
    span.dataset.target = values.target;
    span.dataset.kind = kind;
    span.textContent = values.target;
    insertHTML(span.outerHTML + ' ', point);
  }

  function renderObjects() {
    const meta = metadata();
    if (!meta) return;
    const list = byId('academic-object-list');
    list.replaceChildren();
    [['figures', editFigure], ['tables', editTable], ['equations', editEquation]].forEach(([key, edit]) => {
      meta[key].forEach((item) => {
        const node = bodyForObject(item.id);
        const row = document.createElement('div');
        row.className = 'academic-object-item';
        const text = document.createElement('span');
        const caption = node && node.querySelector('figcaption, .academic-equation-number');
        text.textContent = (caption ? caption.textContent : item.caption || item.source || item.id) + (node ? '' : ' (' + tr('Not in manuscript') + ')');
        if (key === 'figures' && node) {
          const image = node.querySelector('img');
          if (image) {
            const thumbnail = document.createElement('img');
            thumbnail.src = image.src;
            thumbnail.alt = item.alt || item.caption;
            row.appendChild(thumbnail);
          }
        }
        row.append(text, makeButton('Edit', () => edit(item)), makeButton('Go to', () => {
          if (!node) throw new Error(tr('This object is no longer in the manuscript.'));
          if (currentTab !== 'manuscript') switchTab('manuscript');
          node.scrollIntoView({ block: 'center' });
        }));
        row.appendChild(makeButton('Remove', async () => {
          const values = await dialog('Remove object?', [], { submit: 'Remove' });
          if (!values) return;
          const live = bodyForObject(item.id);
          if (live) {
            const body = live.closest('.chapter-body');
            const before = captureBody(body);
            const beforeMetadata = metadata();
            snapshotStructure('academic object removal', { academic: true });
            live.remove();
            commitMetadata({ [key]: metadata()[key].filter((entry) => entry.id !== item.id) });
            captureRevision(body, before, beforeMetadata);
            syncChapter(body, body.closest('.chapter').dataset.id);
            document.dispatchEvent(new CustomEvent('neo:academic-structural-edit'));
          } else commitMetadata({ [key]: metadata()[key].filter((entry) => entry.id !== item.id) });
          refreshDocument();
        }));
        if (key === 'tables') {
          row.append(makeButton('CSV', () => window.neo.exportSave({ format: 'csv', defaultName: safeName(item.caption || item.id), content: objects.exportCSV(item.rows) })),
            makeButton('HTML', () => window.neo.exportSave({ format: 'html', defaultName: safeName(item.caption || item.id), content: '<!DOCTYPE html><meta charset="utf-8">' + objects.tableHTML(item) })));
        }
        if (key === 'equations') row.append(makeButton('Copy source', () => navigator.clipboard.writeText(item.source)));
        list.appendChild(row);
      });
    });
  }

  function objectIds(html) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    return new Set(Array.from(holder.querySelectorAll('[data-academic-id]'), (node) => node.dataset.academicId));
  }

  function revisionObjects(meta, ids) {
    return Object.fromEntries(['figures', 'tables', 'equations'].map((key) => [key, meta[key].filter((entry) => ids.has(entry.id))]));
  }

  function captureRevision(body, before, beforeMetadata = null) {
    const meta = metadata();
    if (!meta || !meta.trackChanges || !body || refreshing) return;
    const after = captureBody(body);
    const chapterId = body.closest('.chapter').dataset.id;
    const revisions = window.NeoAcademicReview.record(meta.revisions, before, after, {
      id: uniqueId('rev'), chapterId, author: currentBook().author || tr('Anonymous')
    });
    const previous = meta.revisions[meta.revisions.length - 1];
    const revision = revisions[revisions.length - 1];
    if (revision && revision.status === 'pending' && revision.chapterId === chapterId && revision.after === after) {
      const beforeIds = objectIds(before);
      const afterIds = objectIds(after);
      revision.objectBefore = revision.objectBefore || revisionObjects(beforeMetadata || meta, beforeIds);
      revision.objectAfter = revisionObjects(meta, afterIds);
      revision.objectIds = [...new Set([...(revision.objectIds || []), ...beforeIds, ...afterIds])];
      if (previous && previous.id === revision.id && previous.objectBefore) revision.objectBefore = previous.objectBefore;
    }
    commitMetadata({ revisions });
    renderReview();
  }

  async function addComment() {
    const point = insertionPoint();
    const quote = point.range.toString();
    if (!quote.trim()) throw new Error(tr('Select manuscript text to attach a review comment.'));
    const values = await dialog('Review comment', [{ key: 'text', label: 'Comment', type: 'textarea', required: true }]);
    if (!values) return;
    const comment = window.NeoAcademicReview.comment({
      id: uniqueId('comment'), chapterId: point.chapterId, quote, text: values.text,
      author: currentBook().author || tr('Anonymous')
    });
    commitMetadata({ reviewComments: [...metadata().reviewComments, comment] });
    renderReview();
  }

  function locateComment(comment) {
    const body = Array.from(document.querySelectorAll('#chapters .chapter-body')).find((entry) => entry.closest('.chapter').dataset.id === comment.chapterId);
    if (!body) throw new Error(tr('The comment chapter no longer exists.'));
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '', node;
    while ((node = walker.nextNode())) { nodes.push({ node, start: text.length }); text += node.textContent; }
    const offset = text.indexOf(comment.quote);
    if (offset < 0) throw new Error(tr('The commented text has changed or was removed.'));
    if (text.indexOf(comment.quote, offset + 1) >= 0) throw new Error(tr('The comment anchor matches more than once. Use its quoted text to locate the intended passage.'));
    const first = nodes.find((item) => offset >= item.start && offset < item.start + item.node.textContent.length);
    const end = offset + comment.quote.length;
    const last = nodes.find((item) => end > item.start && end <= item.start + item.node.textContent.length);
    const range = document.createRange();
    range.setStart(first.node, offset - first.start);
    range.setEnd(last.node, end - last.start);
    if (currentTab !== 'manuscript') switchTab('manuscript');
    body.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    body.scrollIntoView({ block: 'center' });
  }

  function resolveRevision(revision, decision) {
    const body = Array.from(document.querySelectorAll('#chapters .chapter-body')).find((entry) => entry.closest('.chapter').dataset.id === revision.chapterId);
    if (!body) throw new Error(tr('The revised chapter no longer exists.'));
    const result = window.NeoAcademicReview.resolve(revision, decision, captureBody(body));
    if (decision === 'reject') {
      snapshotStructure('reject revision', { academic: true });
      body.innerHTML = result.html;
      if (revision.objectBefore && revision.objectIds) {
        const ids = new Set(revision.objectIds);
        const meta = metadata();
        const restored = Object.fromEntries(['figures', 'tables', 'equations'].map((key) => [
          key, [...meta[key].filter((entry) => !ids.has(entry.id)), ...revision.objectBefore[key]]
        ]));
        commitMetadata(restored);
      }
      syncChapter(body, revision.chapterId);
      document.dispatchEvent(new CustomEvent('neo:academic-structural-edit'));
    }
    commitMetadata({ revisions: metadata().revisions.map((entry) => entry.id === revision.id ? { ...entry, status: result.status } : entry) });
    renderReview();
    refreshDocument();
  }

  async function resolveAllRevisions(decision) {
    const pending = metadata().revisions.filter((revision) => revision.status === 'pending');
    if (!pending.length) return;
    // Reject newest first so each earlier snapshot is checked against its
    // own successor, not silently applied over subsequent manuscript edits.
    for (const revision of decision === 'reject' ? pending.slice().reverse() : pending) resolveRevision(revision, decision);
  }

  function renderReview() {
    const meta = metadata();
    if (!meta) return;
    const list = byId('academic-review-list');
    list.replaceChildren();
    meta.reviewComments.forEach((comment) => {
      const row = document.createElement('div');
      row.className = 'academic-review-item';
      const text = document.createElement('p');
      text.textContent = (comment.resolved ? '[' + tr('Resolved') + '] ' : '') + comment.author + ': ' + comment.text + '\n"' + comment.quote + '"';
      row.append(text, makeButton('Go to', () => locateComment(comment)), makeButton(comment.resolved ? 'Reopen' : 'Resolve', () => {
        commitMetadata({ reviewComments: metadata().reviewComments.map((entry) => entry.id === comment.id ? { ...entry, resolved: !entry.resolved } : entry) });
        renderReview();
      }));
      list.appendChild(row);
    });
    meta.revisions.filter((revision) => revision.status === 'pending').forEach((revision) => {
      const row = document.createElement('div');
      row.className = 'academic-review-item';
      const text = document.createElement('p');
      text.textContent = revision.author + ': ' + revision.summary;
      const comparison = document.createElement('details');
      const heading = document.createElement('summary');
      heading.textContent = tr('Show changes');
      const before = document.createElement('div'), after = document.createElement('div');
      const plain = (html) => { const holder = document.createElement('div'); holder.innerHTML = html; return holder.textContent; };
      before.textContent = tr('Before') + ': ' + plain(revision.before);
      after.textContent = tr('After') + ': ' + plain(revision.after);
      comparison.append(heading, before, after);
      row.append(text, comparison, makeButton('Accept', () => resolveRevision(revision, 'accept')), makeButton('Reject', () => resolveRevision(revision, 'reject')));
      list.appendChild(row);
    });
  }

  function refreshDocument() {
    if (refreshing || !currentBook()) return;
    refreshing = true;
    try {
      const meta = metadata();
      const normalized = normalizedReferences();
      const diagnostics = [];
      const cited = [];
      const citations = [];
      document.querySelectorAll('#chapters .academic-citation').forEach((node) => {
        try {
          const ids = JSON.parse(node.dataset.cites);
          if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error(tr('Invalid citation marker.'));
          cited.push(...ids);
          citations.push({ node, ids });
        } catch (err) { diagnostics.push({ message: String(err.message || err) }); }
      });
      // Inline diagnostics: highlight invalid objects
      document.querySelectorAll('#chapters [data-academic-id]').forEach(node => {
        const id = node.dataset.academicId;
        const valid = meta.figures.some(f => f.id === id) || meta.tables.some(t => t.id === id) || meta.equations.some(e => e.id === id);
        node.style.outline = valid ? '' : '2px dashed var(--red)';
        node.title = valid ? '' : tr('Object reference missing or invalid');
      });
      citations.forEach(({ node, ids }) => {
        try {
          const text = refs.citation(normalized, ids, { profile: meta.profile, style: meta.citationStyle, citedIds: cited });
          if (node.textContent !== text) node.textContent = text;
        } catch (err) { diagnostics.push({ message: String(err.message || err) }); }
      });
      diagnostics.push(...refs.validate(normalized, cited));
      const reconciled = objects.reconcile(byId('chapters'), meta);
      diagnostics.push(...(Array.isArray(reconciled) ? reconciled : reconciled && reconciled.diagnostics || []));
      const bibliography = byId('academic-bibliography');
      bibliography.replaceChildren();
      refs.bibliography(normalized, cited, { profile: meta.profile, style: meta.citationStyle, citedIds: cited }).forEach((entry) => {
        const line = document.createElement('p');
        line.textContent = entry.text;
        bibliography.appendChild(line);
      });
      byId('academic-diagnostics').textContent = diagnostics.length
        ? diagnostics.map((entry) => typeof entry === 'string' ? entry : entry.message || [entry.code, entry.id || entry.target].filter(Boolean).join(': ')).join('\n')
        : tr('All academic cross-references are valid.');
      const counts = { citations: document.querySelectorAll('#chapters .academic-citation').length,
        figures: document.querySelectorAll('#chapters .academic-figure').length,
        tables: document.querySelectorAll('#chapters .academic-table').length,
        equations: document.querySelectorAll('#chapters .academic-equation').length };
      byId('academic-statistics').textContent = tr('{words} words, {citations} citations, {figures} figures, {tables} tables, {equations} equations', {
        words: byId('chapters').textContent.trim().split(/\s+/).filter(Boolean).length, ...counts
      });
      const outline = byId('academic-outline');
      outline.replaceChildren();
      currentBook().chapterOrder.forEach((id, index) => {
        const chapter = Array.from(document.querySelectorAll('#chapters .chapter')).find((node) => node.dataset.id === id);
        const number = chapter && chapter.querySelector('.ch-num');
        if (number && typeof chapterName === 'function') number.textContent = meta.academicMode ? String(index + 1) : chapterName(id);
        const title = currentBook().chapterTitles && currentBook().chapterTitles[id] || tr('Section {n}', { n: index + 1 });
        const button = makeButton(String(index + 1) + '. ' + title, () => {
          if (currentTab !== 'manuscript') switchTab('manuscript');
          focusChapter(id);
        });
        outline.appendChild(button);
      });
      renderObjects();
      document.querySelectorAll('#chapters .chapter-body').forEach((body) => {
        if (!body.querySelector('.academic-citation, .academic-xref, [data-academic-id]')) return;
        const id = body.closest('.chapter').dataset.id;
        const html = captureBody(body);
        if (chapterHTML[id] !== html) { chapterHTML[id] = html; scheduleChapterSave(id); }
      });
    } catch (err) { report(err); }
    finally { refreshing = false; }
  }

  async function hydrateFigures() {
    const b = currentBook();
    if (!b) return;
    for (const figure of metadata().figures) {
      const node = bodyForObject(figure.id);
      if (!node) continue;
      const image = node.querySelector('img');
      if (image && /^data:image\//.test(image.getAttribute('src') || '')) continue;
      const dataUrl = figure.dataUrl || await window.neo.readAcademicFigure(b.id, figure.file);
      if (b !== currentBook()) return;
      if (image && node.isConnected) image.src = dataUrl;
    }
  }

  async function exportPayload(format, chapterId = null) {
    const b = currentBook();
    if (!b) throw new Error(tr('Open a book first'));
    const supported = ['html', 'pdf', 'md', 'tex', 'typ', 'docx', 'txt', 'epub'];
    if (!supported.includes(format)) throw new Error(tr('Use HTML, PDF, Markdown, Word, LaTeX, Typst, text or EPUB for academic export.'));
    refreshDocument();
    flushAllSaves();
    const meta = metadata();
    const selectedChapters = b.chapterOrder.filter((id) => !chapterId || id === chapterId);
    const liveChapters = new Map(Array.from(document.querySelectorAll('#chapters .chapter-body'), (body) => [
      body.closest('.chapter').dataset.id, captureBody(body)
    ]));
    const chapterSource = (id) => liveChapters.get(id) ?? chapterHTML[id] ?? '';
    const usedFigures = new Set();
    selectedChapters.forEach((id) => {
      const holder = document.createElement('div');
      holder.innerHTML = chapterSource(id);
      holder.querySelectorAll('.academic-figure').forEach((node) => usedFigures.add(node.dataset.academicId));
    });
    const figures = await Promise.all(meta.figures.filter((figure) => usedFigures.has(figure.id)).map(async (figure) => {
      return { ...figure, dataUrl: figure.dataUrl || await window.neo.readAcademicFigure(b.id, figure.file) };
    }));
    if (b !== currentBook()) throw new Error(tr('The open book changed. Try the export again.'));
    const doc = {
      title: b.title, subtitle: b.subtitle, author: b.author,
      metadata: { ...meta, figures },
      chapters: selectedChapters.map((id, index) => ({
        id, title: b.chapterTitles && b.chapterTitles[id] || tr('Section {n}', { n: index + 1 }), html: chapterSource(id)
      }))
    };
    return window.NeoAcademicExport.build(doc, { format, profile: meta.profile, document });
  }

  async function exportAcademic(format, chapterId = null) {
    const payload = await exportPayload(format, chapterId);
    const saved = await window.neo.exportSave(payload);
    if (saved) toast(tr('Exported: {file}', { file: saved.split('/').pop() }));
    return saved;
  }

  function captureClipboard(event) {
    const b = currentBook();
    const selection = window.getSelection();
    const target = event.target && event.target.closest && event.target.closest('.chapter-body');
    if (!b || !target || currentTab !== 'manuscript' || !event.clipboardData || !selection || !selection.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0).cloneRange();
    const atomic = (node) => {
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      return element && element.closest('.academic-citation, .academic-xref, [data-academic-id]');
    };
    const startObject = atomic(range.startContainer), endObject = atomic(range.endContainer);
    if (startObject) range.setStartBefore(startObject);
    if (endObject) range.setEndAfter(endObject);
    const selected = Array.from(document.querySelectorAll('#chapters .chapter-body'))
      .filter((body) => range.intersectsNode(body))
      .map((body) => {
        const local = document.createRange();
        local.selectNodeContents(body);
        if (body.contains(range.startContainer)) local.setStart(range.startContainer, range.startOffset);
        if (body.contains(range.endContainer)) local.setEnd(range.endContainer, range.endOffset);
        return { body, range: local, before: captureBody(body) };
      });
    const holder = document.createElement('div');
    selected.forEach((entry) => holder.appendChild(entry.range.cloneContents()));
    if (!holder.querySelector('.academic-citation, .academic-xref, [data-academic-id]')) return;
    try {
      const transfer = window.NeoAcademicClipboard.createTransfer(holder.innerHTML, metadata(), { bookId: b.id, cut: event.type === 'cut', document });
      event.clipboardData.setData(window.NeoAcademicClipboard.MIME, transfer);
      event.clipboardData.setData('text/plain', holder.textContent);
      event.preventDefault();
      if (event.type !== 'cut') return;
      snapshotStructure('academic cut', { academic: true });
      selected.slice().reverse().forEach(({ body, range: local }) => {
        local.deleteContents();
        if (!body.childNodes.length) body.innerHTML = '<p><br></p>';
      });
      selected.forEach(({ body, before }) => {
        captureRevision(body, before);
        syncChapter(body, body.closest('.chapter').dataset.id);
      });
      const caret = selected[0].range;
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
      selected[0].body.focus({ preventScroll: true });
      rememberSelection();
      refreshDocument();
      document.dispatchEvent(new CustomEvent('neo:academic-structural-edit'));
    } catch (err) {
      event.preventDefault();
      report(err);
    }
  }

  function handlePaste(event, body) {
    const clipboard = window.NeoAcademicClipboard;
    const transfer = clipboard && event.clipboardData && event.clipboardData.getData(clipboard.MIME);
    if (!transfer) return false;
    event.preventDefault();
    const owner = currentBook();
    pasteQueue = pasteQueue.then(async () => {
      if (owner !== currentBook()) throw new Error(tr('The open book changed. Try the action again.'));
      const point = insertionPoint();
      if (point.body !== body) throw new Error(tr('Click inside the manuscript first.'));
      const prepared = await clipboard.prepareTransfer(transfer, {
        bookId: owner.id, metadata: metadata(), document, uniqueId,
        existingIds: Array.from(document.querySelectorAll('#chapters [data-academic-id]'), (node) => node.dataset.academicId),
        readFigure: (bookId, file) => window.neo.readAcademicFigure(bookId, file),
        copyFigure: (figure, source, target) => window.neo.copyAcademicFigure(source, target, figure),
        renderMath: (source, format, display) => window.neo.renderAcademicMath(source, format, display)
      });
      if (owner !== currentBook()) throw new Error(tr('The open book changed. Try the action again.'));
      const incoming = prepared.metadataChanges;
      const meta = metadata();
      const changes = { references: model.mergeReferences(meta.references, incoming.references || [], { duplicates: 'error' }) };
      ['figures', 'tables', 'equations'].forEach((key) => {
        const upserts = new Map((incoming[key] || []).map((entry) => [entry.id, entry]));
        changes[key] = meta[key].map((entry) => {
          const updated = upserts.get(entry.id);
          upserts.delete(entry.id);
          return updated || entry;
        }).concat([...upserts.values()]);
      });
      insertHTML(prepared.html, point, changes, { prepareClipboard: true });
      const diagnostics = incoming.diagnostics || prepared.diagnostics || [];
      if (diagnostics.length) toast(diagnostics.map((entry) => typeof entry === 'string' ? entry : entry.message || entry.code).join('\n'), 8000);
      await persistBibliography();
    }).catch(report);
    return true;
  }

  function wire(id, event, handler) {
    const element = byId(id);
    if (element) element.addEventListener(event, action(handler));
  }
  wire('academic-toggle', 'click', () => { setPanelVisible(panel.hidden); refreshDocument(); });
  wire('academic-mode-toggle', 'click', () => { toggleMode(); if (metadata()?.academicMode) createFloatingQuickBar(); });

  // === Fluid writing enhancements ===
  // Contextual insert menu, command palette, inline editing, typing markers, floating quick bar

  function showContextMenu(event, chapterId) {
    if (!metadata().academicMode) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = document.getElementById('paper').getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'academic-context-menu';
    menu.style.left = `${event.clientX - rect.left}px`;
    menu.style.top = `${event.clientY - rect.top}px`;
    const items = [
      { label: tr('Insert citation'), action: () => insertCitation() },
      { label: tr('Insert figure'), action: () => insertFigure() },
      { label: tr('Insert equation'), action: () => insertEquation() },
      { label: tr('Insert table'), action: () => insertTable() },
      { label: tr('Insert cross-reference'), action: () => insertCrossReference() }
    ];
    items.forEach(({ label, action }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        document.removeEventListener('click', hide);
        menu.remove();
        action();
      });
      menu.appendChild(btn);
    });
    const hide = () => { menu.remove(); document.removeEventListener('click', hide); };
    setTimeout(() => document.addEventListener('click', hide), 0);
    document.body.appendChild(menu);
  }

  function openCommandPalette() {
    if (!metadata().academicMode) return;
    const overlay = document.createElement('div');
    overlay.className = 'academic-command-palette';
    overlay.innerHTML = `
      <div class="palette-inner">
        <input id="academic-palette-input" placeholder="${tr('Type a command…')}" autocomplete="off" />
        <div id="academic-palette-results"></div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#academic-palette-input');
    const results = overlay.querySelector('#academic-palette-results');
    const commands = [
      { id: 'cite', label: tr('Insert citation'), action: () => insertCitation() },
      { id: 'fig', label: tr('Insert figure'), action: () => insertFigure() },
      { id: 'eq', label: tr('Insert equation'), action: () => insertEquation() },
      { id: 'tbl', label: tr('Insert table'), action: () => insertTable() },
      { id: 'xref', label: tr('Insert cross-reference'), action: () => insertCrossReference() }
    ];
    function render(filter) {
      results.innerHTML = '';
      const list = commands.filter(c => c.id.includes(filter.toLowerCase()) || c.label.toLowerCase().includes(filter.toLowerCase()));
      list.forEach(cmd => {
        const el = document.createElement('button');
        el.type = 'button';
        el.textContent = `${cmd.id} — ${cmd.label}`;
        el.addEventListener('click', () => { overlay.remove(); cmd.action(); });
        results.appendChild(el);
      });
    }
    input.focus();
    render('');
    input.addEventListener('input', () => render(input.value));
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  function createFloatingQuickBar() {
    const bar = document.getElementById('academic-quick-bar');
    if (bar) return;
    const el = document.createElement('div');
    el.id = 'academic-quick-bar';
    el.className = 'academic-quick-bar';
    el.innerHTML = `
      <button data-action="cite" title="${tr('Insert citation')}">Cite</button>
      <button data-action="fig" title="${tr('Insert figure')}">Fig</button>
      <button data-action="eq" title="${tr('Insert equation')}">Eq</button>
      <button data-action="tbl" title="${tr('Insert table')}">Tbl</button>
      <button data-action="xref" title="${tr('Insert cross-reference')}">Xref</button>`;
    document.getElementById('paper-scroll').appendChild(el);
    el.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const map = { cite: insertCitation, fig: insertFigure, eq: insertEquation, tbl: insertTable, xref: insertCrossReference };
      map[btn.dataset.action]?.();
    });
  }

  function handleTypingMarkers(event) {
    const target = event.target.closest('.chapter-body');
    if (!target) return;
    const text = target.innerText || '';
    const markers = [
      { pattern: /\[@[^\]]+\]/g, replace: (m) => { /* citation marker */ } },
      { pattern: /\[\[fig\]\]/gi, replace: () => { insertFigure(); } },
      { pattern: /\[\[eq\]\]/gi, replace: () => { insertEquation(); } },
      { pattern: /\[\[tbl\]\]/gi, replace: () => { insertTable(); } }
    ];
    // Simple detection on space/enter
    if (event.inputType === 'insertText' && (event.data === ' ' || event.data === '\n')) {
      markers.forEach(({ pattern }) => {
        if (pattern.test(text)) {
          // Convert marker to object insertion
          // Implementation placeholder
        }
      });
    }
  }

  // Wire fluid features
  document.addEventListener('contextmenu', (e) => {
    const body = e.target.closest('.chapter-body');
    if (body && metadata()?.academicMode) {
      showContextMenu(e, body.closest('.chapter').dataset.id);
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey) {
      e.preventDefault();
      openCommandPalette();
    }
  });
  // Inline editing on double-click
  document.addEventListener('dblclick', action(async (event) => {
    const node = event.target.closest && event.target.closest('#chapters [data-academic-id]');
    if (!node) return;
    const meta = metadata();
    const id = node.dataset.academicId;
    if (node.classList.contains('academic-figure')) await editFigure(meta.figures.find((entry) => entry.id === id));
    else if (node.classList.contains('academic-table')) await editTable(meta.tables.find((entry) => entry.id === id));
    else if (node.classList.contains('academic-equation')) await editEquation(meta.equations.find((entry) => entry.id === id));
    else if (node.classList.contains('academic-citation')) {
      const ids = JSON.parse(node.dataset.cites);
      // Inline citation edit placeholder
      insertCitation(ids);
    }
  }));
  ['academic-abstract', 'academic-keywords'].forEach((id) => wire(id, 'input', saveFields));
  wire('academic-authors', 'change', () => {
    try { saveFields(); }
    catch (err) { byId('academic-authors').setCustomValidity(err.message); byId('academic-authors').reportValidity(); throw err; }
  });
  ['academic-paper-type', 'academic-profile', 'academic-citation-style', 'academic-writing-theme', 'academic-export-theme'].forEach((id) => wire(id, 'change', saveFields));
  wire('academic-add-ref', 'click', () => editReference());
  wire('academic-insert-citation', 'click', () => insertCitation());
  wire('academic-import-refs', 'change', importReferences);
  wire('academic-export-bib', 'click', () => exportReferences('bib'));
  wire('academic-export-csl', 'click', () => exportReferences('json'));
  wire('academic-ref-filter', 'change', renderReferences);
  wire('academic-insert-figure', 'click', insertFigure);
  wire('academic-insert-equation', 'click', insertEquation);
  wire('academic-insert-table', 'click', insertTable);
  wire('academic-insert-xref', 'click', insertCrossReference);
  wire('academic-track-changes', 'change', (event) => { commitMetadata({ trackChanges: event.target.checked }); });
  wire('academic-add-comment', 'click', addComment);
  wire('academic-accept-all', 'click', () => resolveAllRevisions('accept'));
  wire('academic-reject-all', 'click', () => resolveAllRevisions('reject'));
  wire('academic-export', 'click', () => exportAcademic(byId('academic-export-format').value));
  document.addEventListener('selectionchange', rememberSelection);
  document.addEventListener('copy', captureClipboard);
  document.addEventListener('cut', captureClipboard);
  document.addEventListener('beforeinput', (event) => {
    const body = event.target.closest && event.target.closest('.chapter-body');
    if (body && currentBook() && !programmaticEdit && metadata().trackChanges) beforeEdits.set(body, captureBody(body));
  }, true);
  document.addEventListener('input', (event) => {
    const body = event.target.closest && event.target.closest('.chapter-body');
    if (!body || !currentBook() || refreshing || programmaticEdit) return;
    const before = beforeEdits.get(body);
    beforeEdits.delete(body);
    if (before != null) captureRevision(body, before);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshDocument, 150);
    // Typing markers conversion
    if (event.inputType === 'insertText' && (event.data === ' ' || event.data === '\n' || event.data === '\r')) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const text = range.startContainer.textContent;
      const offset = range.startOffset;
      const beforeText = text.slice(0, offset - 1);
      if (beforeText.endsWith('[[fig]]')) { event.preventDefault(); insertFigure(); }
      else if (beforeText.endsWith('[[eq]]')) { event.preventDefault(); insertEquation(); }
      else if (beforeText.endsWith('[[tbl]]')) { event.preventDefault(); insertTable(); }
      else if (/\[@[^\]]+\]$/.test(beforeText)) {
        const match = beforeText.match(/\[(@[^\]]+)\]$/);
        if (match) {
          event.preventDefault();
          const keys = match[1].slice(1).split(',').map(s => s.trim()).filter(Boolean);
          const list = normalizedReferences();
          const ids = list.filter(r => keys.includes(referenceId(r))).map(r => referenceId(r));
          if (ids.length) insertCitation(ids);
        }
      }
    }
  });
  document.addEventListener('dblclick', action(async (event) => {
    const node = event.target.closest && event.target.closest('#chapters [data-academic-id]');
    if (!node) return;
    const meta = metadata();
    const id = node.dataset.academicId;
    if (node.classList.contains('academic-figure')) await editFigure(meta.figures.find((entry) => entry.id === id));
    else if (node.classList.contains('academic-table')) await editTable(meta.tables.find((entry) => entry.id === id));
    else if (node.classList.contains('academic-equation')) await editEquation(meta.equations.find((entry) => entry.id === id));
    else if (node.classList.contains('academic-citation')) {
      const ids = JSON.parse(node.dataset.cites);
      const picker = createCitationPicker(normalizedReferences(), async (selectedIds) => {
        if (!selectedIds.length) return;
        node.dataset.cites = JSON.stringify(selectedIds);
        node.textContent = refs.citation(normalizedReferences(), selectedIds, { profile: meta.profile, style: meta.citationStyle });
        const body = node.closest('.chapter-body');
        syncChapter(body, body.closest('.chapter').dataset.id);
        refreshDocument();
      });
      document.body.appendChild(picker);
    }
  }));
  document.addEventListener('keydown', (event) => {
    if (!currentBook() || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey) || !event.shiftKey ||
        document.querySelector('.modal-backdrop:not([hidden])')) return;
    const commands = { c: insertCitation, f: insertFigure, i: insertFigure, e: insertEquation, t: insertTable, m: toggleMode };
    const key = /^Key[A-Z]$/.test(event.code || '') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
    if (key !== 'm' && !metadata().academicMode) return;
    const command = commands[key];
    if (!command) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    action(command)();
  }, true);
  document.addEventListener('neo:book-opened', action(async () => {
    bookmark = null;
    setPanelVisible(false);
    syncFields();
    await hydrateFigures();
  }));
  document.addEventListener('neo:chapters-rendered', () => {
    bookmark = null;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshDocument, 0);
  });
  document.addEventListener('neo:metadata-refreshed', action(() => { syncFields(); hydrateFigures().catch(report); }));
  document.addEventListener('neo:book-closed', () => {
    bookmark = null;
    clearTimeout(refreshTimer);
    setPanelVisible(false);
    applyMode(false);
    byId('academic-toggle').hidden = true;
  });
  const commands = { citation: insertCitation, figure: insertFigure, equation: insertEquation, table: insertTable, mode: toggleMode, comment: addComment };
  window.NeoAcademic = { export: exportAcademic, payload: exportPayload, captureRevision, refresh: refreshDocument, handlePaste,
    hasContent: () => !!document.querySelector('#chapters .academic-citation, #chapters [data-academic-id]'),
    command: (name) => {
    if (!commands[name]) throw new Error('Unknown academic command: ' + name);
    return action(commands[name])();
  } };
})();
