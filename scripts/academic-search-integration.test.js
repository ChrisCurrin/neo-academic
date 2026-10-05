'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { parseHTML } = require('linkedom');
const search = require('../academic/academic-search.js');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const sectionStart = appSource.indexOf('/*  FIND & REPLACE');
const sectionEnd = appSource.indexOf('/*  IMPORT', sectionStart);
const searchSection = appSource.slice(sectionStart, sectionEnd);

function installRangeSupport(document) {
  document.createRange = () => {
    const range = {
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
      getBoundingClientRect() { return { top: 0 }; },
      deleteContents() {
        const root = this.startContainer.parentElement.closest('.chapter-body') || document;
        const walker = document.createTreeWalker(root, 4);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        const first = nodes.indexOf(this.startContainer);
        const last = nodes.indexOf(this.endContainer);
        if (first === last) {
          this.startContainer.data = this.startContainer.data.slice(0, this.startOffset) +
            this.startContainer.data.slice(this.endOffset);
        } else {
          const start = this.startContainer;
          const end = this.endContainer;
          start.data = start.data.slice(0, this.startOffset) + end.data.slice(this.endOffset);
          for (let i = first + 1; i <= last; i += 1) nodes[i].remove();
        }
        this.endContainer = this.startContainer;
        this.endOffset = this.startOffset;
      },
      insertNode(inserted) {
        const current = this.startContainer;
        const parent = current.parentNode;
        const after = current.nextSibling;
        const tail = document.createTextNode(current.data.slice(this.startOffset));
        current.data = current.data.slice(0, this.startOffset);
        parent.insertBefore(inserted, after);
        parent.insertBefore(tail, after);
      }
    };
    return range;
  };
}

function createSearchHarness(chapterMarkup) {
  const { document, window } = parseHTML(`
    <div id="searchbar"><input id="search-input"><input id="replace-input">
      <input id="search-regex" type="checkbox"><input id="search-case-sensitive" type="checkbox">
      <span id="search-count"></span><button id="search-next"></button><button id="search-prev"></button>
      <button id="replace-one"></button><button id="replace-all"></button><button id="search-close"></button>
    </div>
    <div id="paper-scroll"></div>
    <div id="editor-view"></div>
    <main id="chapters"><article class="chapter" data-id="c1">
      <div class="chapter-body">${chapterMarkup}</div>
    </article></main>
  `);
  installRangeSupport(document);
  const toasts = [];
  const snapshots = [];
  const syncs = [];
  const revisions = [];
  window.NeoAcademicSearch = search;
  window.Highlight = class Highlight { add() {} };
  window.CSS = { highlights: new Map() };
  window.innerHeight = 800;
  window.NeoAcademic = {
    captureRevision(body, before) { revisions.push({ body, before, after: body.innerHTML }); }
  };
  const context = vm.createContext({
    window,
    document,
    $: (selector) => document.querySelector(selector),
    NodeFilter: { SHOW_TEXT: 4 },
    CSS: window.CSS,
    Highlight: window.Highlight,
    currentTab: 'manuscript',
    book: { chapterOrder: ['c1'] },
    saveTimers: {},
    undoStack: [],
    KZ: '⌘Z',
    setTimeout,
    clearTimeout,
    t(message, values) {
      return values ? message.replace(/\{(\w+)\}/g, (_, key) => values[key]) : message;
    },
    toast(message) { toasts.push(message); },
    snapshotStructure(label) { snapshots.push(label); },
    syncChapter(body, id) { syncs.push({ body, id, html: body.innerHTML }); }
  });
  vm.runInContext(searchSection, context);
  return {
    context,
    document,
    toasts,
    snapshots,
    syncs,
    revisions,
    query: document.querySelector('#search-input'),
    replacement: document.querySelector('#replace-input'),
    regex: document.querySelector('#search-regex'),
    caseSensitive: document.querySelector('#search-case-sensitive'),
    body: document.querySelector('.chapter-body'),
    searchMatchCount() { return vm.runInContext('searchState.matches.length', context); },
    firstMatchText() { return vm.runInContext('searchState.matches[0].text', context); },
    firstMatchLength() { return vm.runInContext('searchState.matches[0].length', context); }
  };
}

test('search crosses inline formatting within a paragraph but not paragraph or object boundaries', () => {
  const harness = createSearchHarness(
    '<p><span>Fo</span><b>o</b> bar</p><p>baz</p>' +
    '<p><span>academic</span><span class="academic-xref">-xref</span> end</p>'
  );
  harness.query.value = 'foo';
  harness.context.runSearch();
  assert.equal(harness.document.querySelector('#search-count').textContent, '1 found');
  assert.equal(harness.firstMatchText(), 'Foo');

  harness.query.value = 'barbaz';
  harness.context.runSearch();
  assert.equal(harness.searchMatchCount(), 0);

  harness.query.value = 'academic-xref';
  harness.context.runSearch();
  assert.equal(harness.searchMatchCount(), 0);
});

test('replacement skips atomic academic figures and tables, including their captions and cells', () => {
  const atomicObjects =
    '<figure class="academic-figure" data-academic-id="fig-1" contenteditable="false">' +
      '<figcaption>target figure caption</figcaption></figure>' +
    '<div class="academic-table" data-academic-id="table-1" contenteditable="false">' +
      '<table><tbody><tr><td>target cell</td></tr></tbody></table>' +
      '<div>target table caption</div></div>';
  const harness = createSearchHarness(`<p>prose target</p>${atomicObjects}`);
  harness.query.value = 'target';
  harness.replacement.value = 'changed';
  harness.context.replaceAllMatches();

  assert.equal(harness.body.querySelector('p').textContent, 'prose changed');
  assert.equal(harness.body.querySelector('.academic-figure figcaption').textContent, 'target figure caption');
  assert.equal(harness.body.querySelector('.academic-table td').textContent, 'target cell');
  assert.equal(harness.body.querySelector('.academic-table > div').textContent, 'target table caption');
  assert.deepEqual(harness.snapshots, ['replace all']);
  assert.match(harness.toasts[0], /^1 replaced across/);

  const objectOnly = createSearchHarness(atomicObjects);
  objectOnly.query.value = 'target';
  objectOnly.replacement.value = 'changed';
  objectOnly.context.replaceAllMatches();
  assert.deepEqual(objectOnly.snapshots, []);
  assert.equal(objectOnly.body.querySelector('.academic-figure figcaption').textContent, 'target figure caption');
  assert.equal(objectOnly.body.querySelector('.academic-table td').textContent, 'target cell');
  assert.equal(objectOnly.toasts[0], '0 replaced');
});

test('literal replace one preserves literal matching and records a revision', () => {
  const harness = createSearchHarness('<p><span>A+</span><b>B</b> a+b</p>');
  harness.query.value = 'a+b';
  harness.replacement.value = '$1';
  harness.context.runSearch();
  assert.equal(harness.firstMatchText(), 'A+B');
  assert.equal(harness.firstMatchLength(), 3);
  harness.context.replaceCurrent();

  assert.equal(harness.body.textContent, '$1 a+b');
  assert.deepEqual(harness.snapshots, ['replace']);
  assert.equal(harness.syncs.length, 1);
  assert.equal(harness.revisions.length, 1);
  assert.match(harness.revisions[0].before, /A\+<\/span><b>B/);
});

test('regex replace all expands named captures across formatted text', () => {
  const harness = createSearchHarness(
    '<p><span>Ada</span> Lovelace; <i>Ada</i> Byron</p>'
  );
  harness.query.value = '(?<first>\\w+) (?<last>\\w+)';
  harness.replacement.value = '$<last>, $1';
  harness.regex.checked = true;
  harness.caseSensitive.checked = true;
  harness.context.runSearch();
  assert.equal(harness.searchMatchCount(), 2);
  harness.context.replaceAllMatches();

  assert.equal(harness.body.textContent, 'Lovelace, Ada; Byron, Ada');
  assert.deepEqual(harness.snapshots, ['replace all']);
  assert.equal(harness.syncs.length, 1);
  assert.equal(harness.revisions.length, 1);
});

test('invalid regex reports its error without creating an undo snapshot', () => {
  const harness = createSearchHarness('<p>still here</p>');
  harness.query.value = '(';
  harness.regex.checked = true;
  harness.context.runSearch();
  assert.equal(harness.searchMatchCount(), 0);
  assert.match(harness.toasts[0], /^Invalid search regular expression:/);

  harness.context.replaceAllMatches();
  assert.deepEqual(harness.snapshots, []);
  assert.equal(harness.body.textContent, 'still here');
});

test('a valid search with no matches creates no undo snapshot', () => {
  const harness = createSearchHarness('<p>still here</p>');
  harness.query.value = 'missing';
  harness.context.replaceAllMatches();
  assert.deepEqual(harness.snapshots, []);
  assert.equal(harness.body.textContent, 'still here');
});

test('changing search options refreshes the cached match and its highlights', () => {
  const harness = createSearchHarness('<p>a+b aaaab FOO foo</p>');
  harness.query.value = 'a+b';
  harness.context.runSearch();
  assert.equal(harness.firstMatchText(), 'a+b');

  harness.regex.checked = true;
  harness.context.freshSearchIfStale();
  assert.equal(harness.firstMatchText(), 'aaaab');

  harness.query.value = 'foo';
  harness.caseSensitive.checked = false;
  harness.context.runSearch();
  assert.equal(harness.searchMatchCount(), 2);
  harness.caseSensitive.checked = true;
  harness.context.freshSearchIfStale();
  assert.equal(harness.searchMatchCount(), 1);
  assert.equal(harness.firstMatchText(), 'foo');
});
