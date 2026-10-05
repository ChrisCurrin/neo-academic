'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test, afterEach } = require('node:test');
const { parseHTML } = require('linkedom');

const root = path.join(__dirname, '..');
const indexHTML = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const moduleFiles = [
  'academic/bibtex-parser.js',
  'academic/csl-renderer.js',
  'academic/academic-model.js',
  'academic/academic-theme.js',
  'academic/academic-plugin.js',
  'academic/references.js',
  'academic/academic-objects.js',
  'academic/academic-review.js',
  'academic/academic-export.js',
  'academic/academic-ui.js',
  'academic/academic-clipboard.js'
];
const harnesses = [];

afterEach(() => {
  for (const h of harnesses) {
    assert.deepEqual(h.saves.errors, h.saves.expectedErrors, 'unexpected Academic writing console errors');
    assert.deepEqual(h.saves.loggedErrors, h.saves.expectedLoggedErrors, 'unexpected academic error reports');
    assert.deepEqual(h.saves.toasts, h.saves.expectedToasts, 'unexpected academic error or status toasts');
  }
  harnesses.length = 0;
});

function installDOMCompatibility(document, window) {
  const selection = {
    ranges: [],
    get rangeCount() { return this.ranges.length; },
    getRangeAt(index) { return this.ranges[index]; },
    removeAllRanges() { this.ranges = []; },
    addRange(range) { this.ranges = [range]; }
  };
  window.getSelection = () => selection;

  document.createRange = () => ({
    startContainer: null,
    startOffset: 0,
    endContainer: null,
    endOffset: 0,
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
    collapse(toStart) {
      if (toStart) {
        this.endContainer = this.startContainer;
        this.endOffset = this.startOffset;
      } else {
        this.startContainer = this.endContainer;
        this.startOffset = this.endOffset;
      }
    },
    cloneRange() {
      const copy = document.createRange();
      copy.setStart(this.startContainer, this.startOffset);
      copy.setEnd(this.endContainer, this.endOffset);
      return copy;
    },
    toString() {
      if (this.startContainer === this.endContainer && this.startContainer.nodeType === 3) {
        return this.startContainer.data.slice(this.startOffset, this.endOffset);
      }
      return '';
    }
  });

  document.execCommand = (command, _showUI, html) => {
    if (command !== 'insertHTML' || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    const text = range.startContainer;
    if (!text || text.nodeType !== 3 || text !== range.endContainer) return false;
    const parent = text.parentNode;
    const offset = range.startOffset;
    const before = text.data.slice(0, offset);
    const after = text.data.slice(range.endOffset);
    text.data = before;
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const inserted = Array.from(holder.childNodes);
    const tail = document.createTextNode(after);
    let cursor = text.nextSibling;
    for (const node of inserted) parent.insertBefore(node, cursor);
    parent.insertBefore(tail, cursor);
    const caret = document.createRange();
    caret.setStart(tail, 0);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    return true;
  };

  for (const element of document.querySelectorAll('input, textarea, select')) {
    element.setCustomValidity = () => {};
    element.reportValidity = () => true;
  }
  function installSelect(select) {
    let value = select.options.find((option) => option.hasAttribute('selected'))?.value ?? select.options[0]?.value ?? '';
    if (!Object.prototype.hasOwnProperty.call(select, 'value')) Object.defineProperty(select, 'value', {
      configurable: true,
      get() {
        return this.multiple
          ? Array.from(this.options).find((option) => option.selected)?.value || ''
          : value;
      },
      set(next) {
        const requested = String(next);
        value = Array.from(this.options).some((option) => option.value === requested) ? requested : '';
        if (this.multiple) {
          for (const option of this.options) option.selected = option.value === value;
        } else {
          for (const option of this.options) option.selected = option.value === value;
        }
      }
    });
    if (!Object.prototype.hasOwnProperty.call(select, 'selectedOptions')) Object.defineProperty(select, 'selectedOptions', {
      configurable: true,
      get() { return Array.from(this.options).filter((option) => option.selected); }
    });
  }
  for (const select of document.querySelectorAll('select')) installSelect(select);
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName, options) => {
    const element = createElement(tagName, options);
    if (String(tagName).toLowerCase() === 'select') installSelect(element);
    if (/^(input|textarea|select)$/i.test(String(tagName))) {
      element.setCustomValidity = () => {};
      element.reportValidity = () => true;
    }
    return element;
  };
  return selection;
}

function makeHarness() {
  const { document, window } = parseHTML(indexHTML);
  const selection = installDOMCompatibility(document, window);
  const saves = {
    meta: [], chapters: [], snapshots: [], snapshotOptions: [], exports: [], bibliographies: [],
    toasts: [], academicStates: [], errors: [], loggedErrors: [], structuralEvents: [],
    expectedErrors: [], expectedLoggedErrors: [], expectedToasts: []
  };
  const chapterHTML = {};
  const CustomEventShim = function CustomEvent(type, options = {}) {
    const event = new window.Event(type, options);
    event.detail = options.detail;
    return event;
  };
  window.CustomEvent = CustomEventShim;
  const harnessConsole = Object.create(console);
  harnessConsole.error = (...args) => saves.errors.push(args);
  document.addEventListener('neo:academic-structural-edit', (event) => saves.structuralEvents.push(event.type));
  const context = vm.createContext({
    window,
    document,
    globalThis: window,
    crypto,
    Node: window.Node,
    NodeFilter: { SHOW_TEXT: 4 },
    CustomEvent: CustomEventShim,
    book: null,
    currentTab: 'manuscript',
    chapterHTML,
    saveMeta(bookValue) { saves.meta.push({ type: 'saveMeta', book: bookValue && bookValue.id }); },
    scheduleMetaSave() { saves.meta.push({ type: 'schedule', book: context.book && context.book.id }); },
    scheduleChapterSave(id) { saves.chapters.push(id); },
    flushAllSaves() {},
    captureBody(body) { return body.innerHTML; },
    captureRevision(body, before) { saves.revisions.push({ before, after: body.innerHTML }); },
    snapshotStructure(label, options) {
      saves.snapshots.push(label);
      saves.snapshotOptions.push({ label, options });
    },
    syncChapter(body, id) {
      saves.chapters.push(id);
      chapterHTML[id] = body.innerHTML;
    },
    switchTab(tab) { context.currentTab = tab; },
    focusChapter(id) { saves.focusedChapter = id; },
    toast(message) { saves.toasts.push(message); },
    setTimeout,
    clearTimeout,
    console: harnessConsole,
    navigator: window.navigator
  });
  saves.revisions = [];
  window.neo = {
    logError(message) { saves.loggedErrors.push(message); },
    writeAcademicBibliography(bookId, content) {
      saves.bibliographies.push({ bookId, content });
      return Promise.resolve();
    },
    readAcademicFigure: async () => 'data:image/png;base64,AA==',
    renderAcademicMath: async (source) => `<svg><text>${source}</text></svg>`,
    academicState: (enabled) => saves.academicStates.push(enabled),
    exportSave: async (payload) => {
      saves.exports.push(payload);
      return '/exports/paper.html';
    }
  };
  window.NeoI18n = { t: (message, values) => values
    ? message.replace(/\{(\w+)\}/g, (_, key) => values[key])
    : message };

  for (const filename of moduleFiles) {
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
    // Modules export to window via globalThis mapping, so read from window directly
    const exported = filename === 'academic/bibtex-parser.js' ? 'NeoBibtex'
      : filename === 'academic/csl-renderer.js' ? 'NeoCSL'
        : filename === 'academic/academic-model.js' ? 'NeoAcademicModel'
          : filename === 'academic/academic-theme.js' ? 'NeoAcademicTheme'
            : filename === 'academic/academic-plugin.js' ? 'NeoAcademicPlugin'
              : filename === 'academic/references.js' ? 'NeoReferences'
                : filename === 'academic/academic-objects.js' ? 'NeoAcademicObjects'
                  : filename === 'academic/academic-review.js' ? 'NeoAcademicReview'
                    : filename === 'academic/academic-export.js' ? 'NeoAcademicExport'
                      : filename === 'academic/academic-ui.js' ? 'NeoAcademicUI'
                        : 'NeoAcademicClipboard';
    // Already exported to window via globalThis, no need to copy from context
  }
  const importInput = document.getElementById('academic-import-refs');
  const addImportListener = importInput.addEventListener.bind(importInput);
  importInput.addEventListener = (type, listener, options) => addImportListener(type,
    type === 'change' ? () => listener({ target: importInput }) : listener, options);
  vm.runInContext(fs.readFileSync(path.join(root, 'academic/academic.js'), 'utf8'), context, { filename: 'academic.js' });

  function addChapter(bookValue, id, html = '<p>Manuscript text.</p>') {
    const chapter = document.createElement('article');
    chapter.className = 'chapter';
    chapter.dataset.id = id;
    const body = document.createElement('div');
    body.className = 'chapter-body';
    body.contentEditable = 'true';
    body.innerHTML = html;
    chapter.appendChild(body);
    document.getElementById('chapters').replaceChildren(chapter);
    bookValue.chapterOrder = [id];
    bookValue.chapterTitles = { [id]: 'Introduction' };
    chapterHTML[id] = body.innerHTML;
    return body;
  }

  async function openBook(bookValue, html) {
    context.book = bookValue;
    const body = addChapter(bookValue, bookValue.chapterOrder && bookValue.chapterOrder[0] || 'chapter-1', html);
    document.dispatchEvent(new window.Event('neo:book-opened'));
    await settle();
    return body;
  }

  function selectText(textNode, start, end = start) {
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new window.Event('selectionchange'));
    return range;
  }

  function modalControls() {
    const form = document.querySelector('.academic-dialog form');
    assert.ok(form, 'the requested action should open its custom modal');
    const fields = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (child.localName === 'label' && !child.hasAttribute('for')) {
          const control = Array.from(child.children).find((entry) => ['input', 'textarea', 'select'].includes(entry.localName));
          if (control) fields.push(control);
        }
        visit(child);
      }
    };
    visit(form);
    return { form, fields };
  }

  async function submitModal(values) {
    const { form, fields } = modalControls();
    assert.equal(fields.length, values.length, `${form.querySelector('h2')?.textContent}: ${fields.map((field) => `${field.parentElement?.textContent.trim()}:${field.localName}:${field.type || ''}`).join(', ')}`);
    values.forEach((value, index) => {
      if (fields[index].type === 'checkbox') fields[index].checked = value;
      else fields[index].value = value;
    });
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();
  }

  const harness = { context, document, window, saves, chapterHTML, selection, addChapter, openBook, selectText, modalControls, submitModal };
  harnesses.push(harness);
  return harness;
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function click(element) {
  assert.ok(element, 'expected button/control to exist');
  element.dispatchEvent(new element.ownerDocument.defaultView.Event('click', { bubbles: true }));
}

function change(element) {
  element.dispatchEvent(new element.ownerDocument.defaultView.Event('change', { bubbles: true }));
}

function shortcut(document, window, key) {
  const event = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    key: { value: key },
    metaKey: { value: true },
    ctrlKey: { value: false },
    shiftKey: { value: true },
    altKey: { value: false },
    isComposing: { value: false }
  });
  document.dispatchEvent(event);
  return event.defaultPrevented;
}

test('book lifecycle keeps academic metadata isolated and does not persist defaults on legacy open', async () => {
  const h = makeHarness();
  const legacy = {
    id: 'legacy',
    academic: { abstract: 'Old abstract', keywords: ['legacy'], profile: 'mla' },
    chapterOrder: ['legacy-chapter']
  };
  await h.openBook(legacy, '<p>Legacy text.</p>');

  assert.equal(legacy.metadata, undefined);
  assert.deepEqual(h.saves.meta, []);
  assert.equal(h.document.getElementById('academic-abstract').value, 'Old abstract');
  assert.equal(h.document.getElementById('academic-profile').value, 'mla');

  const another = { id: 'another', chapterOrder: ['another-chapter'], metadata: { abstract: 'Other book' } };
  await h.openBook(another, '<p>Other manuscript.</p>');
  assert.equal(h.document.getElementById('academic-abstract').value, 'Other book');
  h.document.getElementById('academic-abstract').value = 'Edited in second book';
  h.document.getElementById('academic-abstract').dispatchEvent(new h.window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(another.metadata.abstract, 'Edited in second book');
  assert.equal(legacy.metadata, undefined);
  assert.equal(legacy.academic.abstract, 'Old abstract');

  h.document.dispatchEvent(new h.window.Event('neo:book-closed'));
  await settle();
  assert.equal(h.document.getElementById('academic-toggle').hidden, true);
  assert.equal(h.document.body.classList.contains('academic-mode'), false);
});

test('author panel preserves an empty affiliation before ORCID and validates real domain objects', async () => {
  const h = makeHarness();
  const book = { id: 'authors', chapterOrder: ['c1'] };
  await h.openBook(book);
  const authors = h.document.getElementById('academic-authors');
  authors.value = 'Ada Example |  | 0000-0002-1825-0097';
  change(authors);
  await settle();

  assert.deepEqual(JSON.parse(JSON.stringify(book.metadata.authors)), [
    { name: 'Ada Example', affiliation: '', orcid: '0000-0002-1825-0097' }
  ]);
  assert.equal(authors.value, 'Ada Example |  | 0000-0002-1825-0097');
  assert.equal(typeof h.window.NeoAcademicModel.read, 'function');
  assert.equal(typeof h.window.NeoReferences.import, 'function');
  assert.equal(typeof h.window.NeoAcademicObjects.reconcile, 'function');
  assert.equal(typeof h.window.NeoAcademicReview.record, 'function');
  assert.equal(typeof h.window.NeoAcademicExport.build, 'function');
});

test('reference add, edit, duplicate BibTeX import, remove, and bibliography persistence use modals', async () => {
  const h = makeHarness();
  const book = { id: 'refs', chapterOrder: ['c1'] };
  await h.openBook(book);

  click(h.document.getElementById('academic-add-ref'));
  await settle();
  await h.submitModal(['doe2020', 'First title', 'Jane Doe', '2020', 'Journal', '', 'https://example.org/one', 'Studies', 'article-journal']);
  assert.equal(book.metadata.references.length, 1);
  assert.equal(book.metadata.references[0].title, 'First title');
  assert.equal(h.saves.bibliographies.at(-1).bookId, 'refs');

  click(h.document.getElementById('academic-ref-list').firstElementChild.querySelector('button'));
  await settle();
  await h.submitModal(['doe2020', 'Revised title', 'Jane Doe', '2021', 'New Journal', '', '', 'Studies', 'article-journal']);
  assert.equal(book.metadata.references[0].title, 'Revised title');
  assert.equal(book.metadata.references[0].issued['date-parts'][0][0], 2021);

  const bib = '@article{doe2020, title={Imported title}, author={Jane Doe}, year={2022}}';
  const input = h.document.getElementById('academic-import-refs');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'refs.bib', text: async () => bib }] });
  const importEvent = new h.window.Event('change', { bubbles: true });
  Object.defineProperty(importEvent, 'target', { configurable: true, value: input });
  input.dispatchEvent(importEvent);
  await settle();
  assert.match(h.document.querySelector('.academic-dialog').textContent, /Duplicate citation keys/);
  const duplicateChoice = h.modalControls().fields[0];
  duplicateChoice.value = 'replace';
  h.modalControls().form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(book.metadata.references[0].title, 'Imported title');
  assert.ok(h.saves.bibliographies.length >= 3);
  await h.openBook(book, '<p>Reference survives reopening.</p>');
  assert.equal(book.metadata.references[0].title, 'Imported title');
  assert.match(h.document.getElementById('academic-ref-list').textContent, /Imported title/);

  const remove = Array.from(h.document.querySelectorAll('.academic-ref-item button')).find((button) => button.textContent === 'Remove');
  click(remove);
  await settle();
  assert.match(h.document.querySelector('.academic-dialog').textContent, /Remove reference/);
  h.modalControls().form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(book.metadata.references.length, 0);
  assert.equal(h.document.querySelectorAll('.academic-ref-item').length, 0);
});

test('undated references persist and numeric APA uses first-appearance numbering everywhere', async () => {
  const h = makeHarness();
  const book = {
    id: 'undated-numeric',
    chapterOrder: ['c1'],
    metadata: { profile: 'apa', citationStyle: 'numeric' }
  };
  const body = await h.openBook(book, '<p>Start. target. End.</p>');
  for (const [key, title, author] of [
    ['ref-a', 'Alpha source', 'Alpha Author'],
    ['ref-b', 'Beta source', 'Beta Author']
  ]) {
    click(h.document.getElementById('academic-add-ref'));
    await settle();
    await h.submitModal([key, title, author, '', 'Smoke Journal', '', '', '', 'article-journal']);
  }

  assert.deepEqual(
    JSON.parse(JSON.stringify(book.metadata.references.map((ref) => ref.issued))),
    [{ 'date-parts': [] }, { 'date-parts': [] }]
  );
  assert.equal(h.saves.bibliographies.length, 2);

  const alpha = Array.from(h.document.querySelectorAll('.academic-ref-item')).find((item) => item.dataset.key === 'ref-a');
  click(Array.from(alpha.querySelectorAll('button')).find((button) => button.textContent === 'Edit'));
  await settle();
  const alphaEdit = h.modalControls();
  assert.equal(alphaEdit.fields[2].value, 'Author, Alpha');
  assert.equal(alphaEdit.fields[3].value, '');
  await h.submitModal(['ref-a', 'Alpha source', 'Author, Alpha', '', 'Smoke Journal', '', '', '', 'article-journal']);
  assert.deepEqual(JSON.parse(JSON.stringify(book.metadata.references[0].author)), [
    { family: 'Author', given: 'Alpha' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(book.metadata.references[0].issued)), { 'date-parts': [] });

  const firstText = body.querySelector('p').firstChild;
  h.selectText(firstText, firstText.data.indexOf('target'));
  click(h.document.getElementById('academic-insert-citation'));
  await settle();
  let picker = h.modalControls().fields[0];
  picker.options[1].selected = true;
  h.modalControls().form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();

  const followingText = Array.from(body.querySelector('p').childNodes)
    .find((node) => node.nodeType === 3 && node.data.includes('target'));
  h.selectText(followingText, 0);
  click(h.document.getElementById('academic-insert-citation'));
  await settle();
  picker = h.modalControls().fields[0];
  picker.options[0].selected = true;
  h.modalControls().form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();

  const editorCitations = Array.from(body.querySelectorAll('.academic-citation'), (node) => node.textContent);
  assert.deepEqual(editorCitations, ['[1]', '[2]']);
  const preview = Array.from(h.document.querySelectorAll('#academic-bibliography p'), (node) => node.textContent);
  assert.match(preview[0], /^\[1\].*Beta source/);
  assert.match(preview[1], /^\[2\].*Alpha source/);

  const payload = await h.window.NeoAcademic.payload('html');
  const exported = parseHTML(payload.content).document;
  assert.deepEqual(Array.from(exported.querySelectorAll('.citation'), (node) => node.textContent), editorCitations);
  const exportedReferences = Array.from(exported.querySelectorAll('.bibliography p'), (node) => node.textContent);
  assert.match(exportedReferences[0], /^\[1\].*Beta source/);
  assert.match(exportedReferences[1], /^\[2\].*Alpha source/);
});

test('corporate reference authors remain literal through edit and book reopen', async () => {
  const h = makeHarness();
  const book = { id: 'corporate-reference', chapterOrder: ['c1'] };
  await h.openBook(book);
  click(h.document.getElementById('academic-add-ref'));
  await settle();
  await h.submitModal([
    'acme2024',
    'Corporate authorship',
    '{Acme Research Group}',
    '',
    '',
    '',
    '',
    '',
    'book'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(book.metadata.references[0].author)), [
    { literal: 'Acme Research Group' }
  ]);

  await h.openBook(book, '<p>Corporate reference manuscript.</p>');
  const item = h.document.querySelector('.academic-ref-item');
  click(Array.from(item.querySelectorAll('button')).find((button) => button.textContent === 'Edit'));
  await settle();
  const edit = h.modalControls();
  assert.equal(edit.fields[2].value, '{Acme Research Group}');
  assert.equal(edit.fields[3].value, '');
  await h.submitModal([
    'acme2024',
    'Corporate authorship',
    edit.fields[2].value,
    edit.fields[3].value,
    '',
    '',
    '',
    '',
    'book'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(book.metadata.references[0].author)), [
    { literal: 'Acme Research Group' }
  ]);

  await h.openBook(book, '<p>Reopened corporate reference.</p>');
  click(Array.from(h.document.querySelector('.academic-ref-item').querySelectorAll('button'))
    .find((button) => button.textContent === 'Edit'));
  await settle();
  assert.equal(h.modalControls().fields[2].value, '{Acme Research Group}');
  assert.equal(h.modalControls().fields[3].value, '');
});

test('citation insertion remembers manuscript selection and profile changes rerender persisted citation', async () => {
  const h = makeHarness();
  const book = {
    id: 'citation',
    chapterOrder: ['c1'],
    metadata: {
      profile: 'apa',
      citationStyle: 'numeric',
      references: [
        { id: 'one', key: 'one', type: 'book', title: 'First Source', author: [{ literal: 'Ada Author' }], issued: { 'date-parts': [[2020]] } },
        { id: 'two', key: 'two', type: 'book', title: 'Second Source', author: [{ literal: 'Grace Writer' }], issued: { 'date-parts': [[2021]] } }
      ]
    }
  };
  const body = await h.openBook(book, '<p>before after</p>');
  const text = body.querySelector('p').firstChild;
  h.selectText(text, 7);
  click(h.document.getElementById('academic-insert-citation'));
  await settle();
  assert.match(h.document.querySelector('.academic-dialog').textContent, /Insert citation/);
  const multi = h.modalControls().fields[0];
  multi.options[0].selected = true;
  h.modalControls().form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();

  const citation = body.querySelector('.academic-citation');
  assert.ok(citation);
  assert.deepEqual(JSON.parse(citation.dataset.cites), ['one']);
  assert.match(citation.textContent, /\[1\]/);
  assert.ok(h.saves.snapshots.includes('academic insertion'));
  assert.equal(h.saves.chapters.at(-1), 'c1');
  assert.deepEqual(h.saves.structuralEvents, ['neo:academic-structural-edit']);

  const trailing = Array.from(body.querySelector('p').childNodes).find((node) => node.nodeType === 3 && node.data.includes('after'));
  h.selectText(trailing, 0);
  click(h.document.getElementById('academic-insert-citation'));
  await settle();
  const second = h.modalControls().fields[0];
  second.options[1].selected = true;
  h.modalControls().form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  const secondCitation = Array.from(body.querySelectorAll('.academic-citation')).find((node) => node.dataset.cites === '["two"]');
  assert.ok(secondCitation);
  assert.match(secondCitation.textContent, /\[2\]/);
  assert.deepEqual(h.saves.structuralEvents, ['neo:academic-structural-edit', 'neo:academic-structural-edit']);

  const style = h.document.getElementById('academic-profile');
  style.value = 'ieee';
  change(style);
  await settle();
  assert.match(citation.textContent, /\[1\]/);
  assert.match(secondCitation.textContent, /\[2\]/);
  assert.equal(book.metadata.profile, 'ieee');

  const citationStyle = h.document.getElementById('academic-citation-style');
  citationStyle.value = 'author-date';
  change(citationStyle);
  await settle();
  assert.doesNotMatch(citation.textContent, /\[1\]/);
  assert.doesNotMatch(secondCitation.textContent, /\[2\]/);
  assert.match(citation.textContent, /2020/);
  assert.match(secondCitation.textContent, /2021/);
  assert.equal(book.metadata.citationStyle, 'author-date');

  const reopened = await h.openBook(book, body.innerHTML);
  assert.deepEqual(Array.from(reopened.querySelectorAll('.academic-citation'), (node) => node.textContent),
    [citation.textContent, secondCitation.textContent]);
  assert.equal(book.metadata.references.length, 2);
});

test('PDF figure import retains the original PDF asset alongside its rendered preview', async () => {
  const h = makeHarness();
  const asset = {
    file: 'figure-1234.png',
    originalFile: 'figure-1234.pdf',
    originalName: 'study.pdf',
    mime: 'image/png',
    originalMime: 'application/pdf',
    dataUrl: 'data:image/png;base64,AA==',
    width: 640,
    height: 480,
    previewPage: 1,
    pageCount: 2
  };
  h.window.neo.importAcademicFigure = async (bookId) => {
    assert.equal(bookId, 'pdf-figure');
    return asset;
  };
  const book = { id: 'pdf-figure', chapterOrder: ['c1'] };
  const body = await h.openBook(book, '<p>Figure goes here.</p>');
  const text = body.querySelector('p').firstChild;
  h.selectText(text, text.data.length);
  click(h.document.getElementById('academic-insert-figure'));
  await settle();
  await h.submitModal(['First-page preview', 'A chart from the source PDF', '', '', '']);

  const figure = book.metadata.figures[0];
  assert.equal(figure.originalFile, 'figure-1234.pdf');
  assert.equal(figure.originalMime, 'application/pdf');
  assert.equal(figure.file, 'figure-1234.png');
  assert.equal(body.querySelector('.academic-figure img').getAttribute('src'), asset.dataUrl);
  assert.equal(h.window.NeoAcademicObjects.validateFigure(figure).originalFile, figure.originalFile);

  await h.openBook(book, body.innerHTML);
  assert.equal(book.metadata.figures[0].originalFile, 'figure-1234.pdf');
  assert.equal(h.window.NeoAcademicObjects.validateFigure(book.metadata.figures[0]).originalFile, 'figure-1234.pdf');
});

test('object reconciliation keeps numeric labels stable and updates cross-references after edits', async () => {
  const h = makeHarness();
  const objects = h.window.NeoAcademicObjects;
  const figure = { id: 'figureA', caption: 'Study design', alt: 'Chart', source: '', license: '', attribution: '', file: '' };
  const table = { id: 'tableA', caption: 'Measurements', rows: [['Measure', 'Value'], ['Score', '5']], header: true, borders: true, shading: false, align: 'left' };
  const equation = { id: 'equationA', source: 'x = 1', format: 'tex', display: true };
  const chapter = `<p>Intro <span class="academic-xref" data-target="tableA" data-kind="table" contenteditable="false">Table ?</span></p>${objects.figureHTML(figure, { dataUrl: '', number: 88 })}${objects.tableHTML(table, { number: 77 })}${objects.equationHTML(equation, { svg: '', number: 66 })}`;
  const book = {
    id: 'objects',
    chapterOrder: ['c1'],
    metadata: { figures: [figure], tables: [table], equations: [equation] }
  };
  const body = await h.openBook(book, chapter);
  assert.equal(body.querySelector('.academic-figure figcaption').textContent, 'Figure 1. Study design');
  assert.equal(body.querySelector('.academic-table figcaption').textContent, 'Table 1. Measurements');
  assert.equal(body.querySelector('.academic-equation-number').textContent, '(1)');
  const crossref = body.querySelector('.academic-xref');
  assert.equal(crossref.textContent, 'Table 1');
  const labels = [body.querySelector('.academic-figure figcaption').textContent,
    body.querySelector('.academic-table figcaption').textContent,
    body.querySelector('.academic-equation-number').textContent];
  h.window.NeoAcademic.refresh();
  assert.deepEqual([
    body.querySelector('.academic-figure figcaption').textContent,
    body.querySelector('.academic-table figcaption').textContent,
    body.querySelector('.academic-equation-number').textContent
  ], labels);

  const edit = Array.from(h.document.querySelectorAll('.academic-object-item')).find((item) => item.textContent.includes('Measurements')).querySelector('button');
  click(edit);
  await settle();
  assert.equal(h.document.querySelector('.academic-dialog h2').textContent, 'Edit table');
  await h.submitModal(['Updated measurements', '2', '2', 'Measure,Value\nScore,8', true, true, false, 'left', false]);
  assert.equal(book.metadata.tables[0].caption, 'Updated measurements');
  assert.match(body.querySelector('.academic-table figcaption').textContent, /Table 1\. Updated measurements/);
  assert.equal(body.querySelector('.academic-xref').textContent, 'Table 1');
  assert.ok(h.saves.snapshots.includes('academic object edit'));
  assert.deepEqual(h.saves.structuralEvents, ['neo:academic-structural-edit']);
});

test('rejecting a tracked table edit restores table HTML and metadata without touching other chapters', async () => {
  const h = makeHarness();
  const objects = h.window.NeoAcademicObjects;
  const originalTable = {
    id: 'tableTracked',
    caption: 'Original measurements',
    rows: [['Measure', 'Value'], ['Count', '5']],
    header: true,
    borders: true,
    shading: false,
    align: 'left'
  };
  const otherTable = {
    id: 'tableUntouched',
    caption: 'Independent results',
    rows: [['Group', 'Result'], ['Control', 'Stable']],
    header: true,
    borders: true,
    shading: false,
    align: 'center'
  };
  const book = {
    id: 'tracked-table-rejection',
    chapterOrder: ['chapter-one', 'chapter-two'],
    metadata: { trackChanges: true, tables: [originalTable, otherTable] }
  };
  const firstBody = await h.openBook(book, `<p>First chapter.</p>${objects.tableHTML(originalTable, { number: 1 })}`);
  const secondChapter = h.document.createElement('article');
  secondChapter.className = 'chapter';
  secondChapter.dataset.id = 'chapter-two';
  const secondBody = h.document.createElement('div');
  secondBody.className = 'chapter-body';
  secondBody.contentEditable = 'true';
  secondBody.innerHTML = `<p>Second chapter.</p>${objects.tableHTML(otherTable, { number: 2 })}`;
  secondChapter.appendChild(secondBody);
  h.document.getElementById('chapters').appendChild(secondChapter);
  book.chapterOrder = ['chapter-one', 'chapter-two'];
  book.chapterTitles['chapter-two'] = 'Second chapter';
  h.chapterHTML['chapter-two'] = secondBody.innerHTML;
  h.window.NeoAcademic.refresh();

  const snapshotsBeforeMetadataEdit = h.saves.snapshots.length;
  const abstract = h.document.getElementById('academic-abstract');
  abstract.value = 'Metadata-only change';
  abstract.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(h.saves.snapshots.length, snapshotsBeforeMetadataEdit);

  const secondChapterBefore = secondBody.innerHTML;
  const row = Array.from(h.document.querySelectorAll('.academic-object-item'))
    .find((item) => item.textContent.includes('Original measurements'));
  click(Array.from(row.querySelectorAll('button')).find((button) => button.textContent === 'Edit'));
  await settle();
  await h.submitModal(['Revised measurements', '2', '2', 'Measure,Value\nCount,99', true, true, false, 'left', false]);

  const edited = book.metadata.tables.find((table) => table.id === originalTable.id);
  const revision = book.metadata.revisions.find((entry) => entry.status === 'pending');
  assert.equal(edited.caption, 'Revised measurements');
  assert.equal(edited.rows[1][1], '99');
  assert.ok(revision);
  assert.deepEqual(JSON.parse(JSON.stringify(revision.objectBefore.tables[0].rows)), originalTable.rows);
  assert.deepEqual(JSON.parse(JSON.stringify(revision.objectAfter.tables[0].rows)), JSON.parse(JSON.stringify(edited.rows)));
  assert.ok(revision.objectIds.includes(originalTable.id));
  assert.ok(h.saves.snapshotOptions.some(({ label, options }) => label === 'academic object edit' && options.academic === true));

  const reviewRow = Array.from(h.document.querySelectorAll('.academic-review-item'))
    .find((item) => item.textContent.includes('Revised measurements'));
  click(Array.from(reviewRow.querySelectorAll('button')).find((button) => button.textContent === 'Reject'));
  await settle();

  const restored = book.metadata.tables.find((table) => table.id === originalTable.id);
  const preservedOther = book.metadata.tables.find((table) => table.id === otherTable.id);
  const restoredNode = firstBody.querySelector('[data-academic-id="tableTracked"]');
  const preservedNode = secondBody.querySelector('[data-academic-id="tableUntouched"]');
  assert.deepEqual(JSON.parse(JSON.stringify(restored.rows)), originalTable.rows);
  assert.equal(restored.caption, originalTable.caption);
  assert.deepEqual(JSON.parse(JSON.stringify(preservedOther)), otherTable);
  assert.deepEqual(Array.from(restoredNode.querySelectorAll('td, th'), (cell) => cell.textContent), ['Measure', 'Value', 'Count', '5']);
  assert.deepEqual(Array.from(preservedNode.querySelectorAll('td, th'), (cell) => cell.textContent), ['Group', 'Result', 'Control', 'Stable']);
  assert.equal(secondBody.innerHTML, secondChapterBefore);
  assert.ok(h.saves.snapshotOptions.some(({ label, options }) => label === 'reject revision' && options.academic === true));
  assert.deepEqual(h.saves.structuralEvents, ['neo:academic-structural-edit', 'neo:academic-structural-edit']);
});

test('novel-mode shortcuts leave academic commands untouched except mode toggle', async () => {
  const h = makeHarness();
  const book = {
    id: 'shortcut-mode',
    chapterOrder: ['c1'],
    metadata: {
      references: [{ id: 'shortRef', key: 'shortRef', type: 'book', title: 'Shortcut Source', author: [{ literal: 'A Writer' }] }]
    }
  };
  const body = await h.openBook(book, '<p>Shortcut target.</p>');
  const text = body.querySelector('p').firstChild;
  h.selectText(text, 0);
  assert.equal(book.metadata.academicMode, undefined);
  assert.equal(shortcut(h.document, h.window, 'c'), false);
  await settle();
  assert.equal(h.document.querySelector('.academic-dialog'), null);

  assert.equal(shortcut(h.document, h.window, 'm'), true);
  await settle();
  assert.equal(book.metadata.academicMode, true);
  assert.equal(h.saves.academicStates.at(-1), true);

  h.selectText(text, 0);
  assert.equal(shortcut(h.document, h.window, 'c'), true);
  await settle();
  assert.match(h.document.querySelector('.academic-dialog').textContent, /Insert citation/);
  const option = h.modalControls().fields[0].options[0];
  option.selected = true;
  h.modalControls().form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.ok(body.querySelector('.academic-citation'));
});

test('ordinary external paste is not consumed or allowed to mutate academic models', async () => {
  const h = makeHarness();
  const book = {
    id: 'ordinary-paste',
    chapterOrder: ['c1'],
    metadata: { tables: [{ id: 'keepTable', caption: 'Keep', rows: [['Value']], header: true, borders: true, shading: false, align: 'left' }] }
  };
  const body = await h.openBook(book, '<p>Unchanged manuscript.</p>');
  const before = JSON.stringify(book.metadata);
  const html = body.innerHTML;
  const event = {
    clipboardData: { getData: (type) => type === 'text/html' ? '<p>External paste</p>' : '' },
    preventDefault() { this.defaultPrevented = true; }
  };

  assert.equal(h.window.NeoAcademic.handlePaste(event, body), false);
  assert.equal(event.defaultPrevented, undefined);
  assert.equal(JSON.stringify(book.metadata), before);
  assert.equal(body.innerHTML, html);
});

test('track changes captures beforeinput/input revisions and academic export routes through real builder', async () => {
  const h = makeHarness();
  const book = { id: 'export', title: 'A Paper', author: 'A Writer', chapterOrder: ['c1'], metadata: { trackChanges: true } };
  const body = await h.openBook(book, '<p>Original sentence.</p>');
  const paragraph = body.querySelector('p');
  paragraph.dispatchEvent(new h.window.Event('beforeinput', { bubbles: true }));
  paragraph.textContent = 'Edited sentence.';
  paragraph.dispatchEvent(new h.window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(book.metadata.revisions.length, 1);
  assert.equal(book.metadata.revisions[0].status, 'pending');
  assert.match(book.metadata.revisions[0].before, /Original sentence/);
  assert.match(book.metadata.revisions[0].after, /Edited sentence/);
  assert.equal(h.chapterHTML.c1, '<p>Original sentence.</p>', 'ordinary input should leave the cached chapter snapshot stale');

  const chapterSavesBeforeExport = h.saves.chapters.length;
  h.saves.expectedToasts.push('Exported: paper.html');
  const saved = await h.window.NeoAcademic.export('html');
  assert.equal(saved, '/exports/paper.html');
  assert.equal(h.saves.exports.length, 1);
  assert.match(h.saves.exports[0].content, /A Paper/);
  assert.match(h.saves.exports[0].content, /Edited sentence/);
  assert.equal(h.chapterHTML.c1, '<p>Original sentence.</p>', 'export must not persist a rendered chapter snapshot as a normal save');
  assert.equal(h.saves.chapters.length, chapterSavesBeforeExport, 'export should read live DOM without scheduling chapter saves');
});
