'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const clipboard = require('../academic/academic-clipboard.js');
const objects = require('../academic/academic-objects.js');

const image = 'data:image/png;base64,YQ==';
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"></path></svg>';
const figure = { id: 'fig-one', file: 'one.png', originalFile: 'one.pdf', caption: 'Chart <one>',
  alt: '" onerror="evil', source: 'Research archive', license: 'CC BY', attribution: 'A. Writer' };
const table = { id: 'tbl-one', rows: [['Name', 'Value'], ['<script>evil()</script>', '2']], caption: 'Results', align: 'right' };
const equation = { id: 'eq-one', source: 'x^2', format: 'tex', display: false, svg: '<svg onload="evil()"></svg>' };
const ref = { id: 'ref-one', key: 'Writer2026', title: 'One', type: 'article-journal', author: [{ family: 'Writer', given: 'A' }] };
const metadata = { figures: [figure], tables: [table], equations: [equation], references: [ref] };
function doc() { return parseHTML('<html><body><main></main></body></html>').document; }
function options(extra = {}) {
  let serial = 0;
  return { bookId: 'book-one', metadata: {}, existingIds: [], uniqueId: (prefix) => `${prefix}-copy${++serial}`,
    renderMath: async () => svg, document: doc(), ...extra };
}
function copy(html, model = metadata, extra = {}) {
  return clipboard.createTransfer(html, model, { bookId: 'book-one', document: doc(), ...extra });
}
function parseResult(result) {
  const document = doc();
  document.querySelector('main').innerHTML = result.html;
  return document.querySelector('main');
}
function cite(ids, label = '(Writer, 2026)') {
  return `<span class="academic-citation" data-cites='${JSON.stringify(ids)}'>${label}</span>`;
}
function rewrite(payload, changes) { return JSON.stringify({ ...JSON.parse(payload), ...changes }); }

if (!process.versions.electron) {
test('native Chromium insertion retains paragraph citations, xrefs, and placeholder marks', {
  skip: process.platform === 'linux' && !process.env.DISPLAY
}, () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(require('electron'), [__filename], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  assert.match(result.stdout, /native clipboard markers preserved/);
});
test('UMD loads in browser without document or Node globals', () => {
  const context = vm.createContext({});
  for (const file of ['academic/academic-objects.js', 'academic/references.js', 'academic/academic-clipboard.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  assert.equal(context.NeoAcademicClipboard.MIME, 'application/x-neo-academic+json');
  assert.equal(typeof context.NeoAcademicClipboard.prepareTransfer, 'function');
});
test('portable model contains selected objects/references, not rendered equation SVG', async () => {
  const html = '<p>Before <strong>bold <em>emphasis</em></strong> ' + cite(['Writer2026']) + '</p>' +
    objects.figureHTML(figure, image) + objects.tableHTML(table) + objects.equationHTML(equation, svg);
  const payload = copy(html);
  const portable = JSON.parse(payload);
  assert.equal(portable.version, 1);
  assert.equal(portable.figures[0].dataUrl, image);
  assert.equal(portable.figures[0].originalFile, 'one.pdf');
  assert.equal(portable.equations[0].svg, undefined);
  assert.deepEqual(portable.references[0].author, ref.author);
  let args;
  const result = await clipboard.prepareTransfer(payload, options({
    renderMath: (...values) => { args = values; return svg; }
  }));
  const root = parseResult(result);
  assert.deepEqual(args, ['x^2', 'tex', false]);
  assert.equal(root.querySelector('strong em').textContent, 'emphasis');
  assert.equal(root.querySelector('.academic-equation').tagName, 'SPAN');
  assert.equal(root.querySelector('.academic-equation path').getAttribute('d'), 'M0 0');
  assert.equal(root.querySelector('td').textContent, '<script>evil()</script>');
  assert.equal(root.querySelector('img').getAttribute('alt'), figure.alt);
  assert.deepEqual(result.metadataChanges.references[0].author, ref.author);
  assert.notEqual(result.metadataChanges.figures[0].id, figure.id);
  assert.equal(metadata.figures[0].id, figure.id);
});
test('raw custom MIME HTML/attributes/SVG are never inserted or executed', async () => {
  const payload = rewrite(copy('<p>Text</p>'), {
    html: '<p onclick="evil()" style="background:url(https://tracker)">Safe <strong onmouseover="evil()">bold</strong>' +
      '<a href="javascript:evil()">link</a></p><script>evil()</script>' +
      '<svg><script>evil()</script></svg><img src="https://tracker" onerror="evil()">' +
      '<iframe srcdoc="<script>evil()</script>"></iframe><style>body{}</style>'
  });
  const result = await clipboard.prepareTransfer(payload, options());
  assert.equal(result.html, '<p>Safe <strong>bold</strong>link</p>');
  assert.deepEqual(result.metadataChanges.diagnostics, []);
});
test('partial paragraph and inline formatting survives without invented wrappers', async () => {
  const result = await clipboard.prepareTransfer(copy('part <b>bold</b><br>next <i>italic</i> &amp; end'), options());
  assert.equal(result.html, 'part <b>bold</b><br>next <i>italic</i> &amp; end');
});
test('same-book placeholders preserve safe marker IDs; cross-book retains readable symbol and warns', async () => {
  const payload = copy('<p>Before <span class="ph-mark" data-sid="s-abc123" onclick="evil()">⚑</span> after</p>');
  const same = await clipboard.prepareTransfer(payload, options());
  const mark = parseResult(same).querySelector('.ph-mark');
  assert.equal(mark.getAttribute('data-sid'), 's-abc123');
  assert.equal(mark.hasAttribute('onclick'), false);
  assert.equal(mark.textContent, '⚑');
  const cross = await clipboard.prepareTransfer(payload, options({ bookId: 'book-two' }));
  assert.equal(cross.html, '<p>Before ⚑ after</p>');
  assert.equal(cross.metadataChanges.diagnostics[0].code, 'placeholder-not-transferred');
  assert.throws(() => copy('<span class="ph-mark" data-sid=\'"><script>\'>⚑</span>'), /Invalid placeholder/);
});
test('native insertion adapter temporarily unlocks inline markers and restores atomic locks', async () => {
  const source = '<p>' + cite(['ref-one']) + objects.xrefHTML(table.id, 'table') +
    '<span class="ph-mark" data-sid="s-one">⚑</span></p>' + objects.tableHTML(table);
  const prepared = await clipboard.prepareTransfer(copy(source), options());
  const insertion = clipboard.prepareInsertionHTML(prepared.html, { document: doc() });
  const root = parseResult({ html: insertion });
  for (const selector of ['.academic-citation', '.academic-xref', '.ph-mark']) {
    assert.equal(root.querySelector(selector).hasAttribute('contenteditable'), false);
  }
  assert.equal(root.querySelector('.academic-table').getAttribute('contenteditable'), 'false');
  clipboard.restoreAtomicMarkers(root);
  assert.equal(root.querySelectorAll('[contenteditable="false"]').length, 4);
  assert.deepEqual(JSON.parse(root.querySelector('.academic-citation').getAttribute('data-cites')), ['ref-one']);
  assert.match(prepared.html, /contenteditable="false"/);
  const single = objects.xrefHTML(table.id, 'table');
  assert.equal(clipboard.prepareInsertionHTML(single, { document: doc() }), single);
});
test('copy creates IDs even when originals are absent and remaps internal cross-references', async () => {
  const payload = copy(objects.tableHTML(table) + objects.xrefHTML(table.id, 'table') + objects.xrefHTML('fig-other', 'figure'));
  const result = await clipboard.prepareTransfer(payload, options({
    metadata: { figures: [{ id: 'fig-other' }] }, existingIds: ['fig-other']
  }));
  const root = parseResult(result);
  assert.equal(root.querySelector('.academic-table').getAttribute('data-academic-id'), 'tbl-copy1');
  assert.deepEqual(Array.from(root.querySelectorAll('.academic-xref')).map((node) => node.getAttribute('data-target')),
    ['tbl-copy1', 'fig-other']);
  assert.deepEqual(result.metadataChanges.diagnostics, []);
});
test('same-book cut move retains ID only while it is absent from manuscript', async () => {
  const payload = copy(objects.tableHTML(table), metadata, { cut: true });
  const moved = await clipboard.prepareTransfer(payload, options({ metadata, uniqueId: undefined }));
  assert.equal(moved.metadataChanges.tables[0].id, table.id);
  const duplicate = await clipboard.prepareTransfer(payload, options({ metadata, existingIds: [table.id] }));
  assert.equal(duplicate.metadataChanges.tables[0].id, 'tbl-copy1');
});
test('same-book missing targets and cross-book external targets are explicitly dangling', async () => {
  const payload = copy(objects.xrefHTML('fig-outside', 'figure'));
  const same = await clipboard.prepareTransfer(payload, options());
  assert.equal(same.metadataChanges.diagnostics[0].code, 'dangling-xref');
  const cross = await clipboard.prepareTransfer(payload, options({
    bookId: 'book-two', metadata: { figures: [{ id: 'fig-outside' }] }, existingIds: ['fig-outside']
  }));
  assert.equal(cross.metadataChanges.diagnostics[0].id, 'fig-outside');
  assert.equal(parseResult(cross).querySelector('[data-target]'), null);
  assert.match(cross.html, /Figure \?/);
});
test('equations require regeneration and never trust clipboard SVG or rendered raw HTML', async () => {
  const payload = rewrite(copy(objects.equationHTML(equation)), {
    equations: [{ ...equation, svg: '<svg onload="evil()"></svg>' }],
    html: '<div class="academic-equation" data-academic-id="eq-one"><img src="https://evil"><script>evil()</script></div>'
  });
  const result = await clipboard.prepareTransfer(payload, options());
  assert.equal(result.html.includes('evil'), false);
  await assert.rejects(clipboard.prepareTransfer(payload, options({ renderMath: undefined })), /require renderMath/);
  await assert.rejects(clipboard.prepareTransfer(payload, options({ renderMath: () => '<svg onload="evil()"></svg>' })), /Unsafe/);
  await assert.rejects(clipboard.prepareTransfer(payload, options({ renderMath: () => '' })), /return SVG/);
});
test('reference conflict generates new key/ID and remaps all citation aliases without overwriting', async () => {
  const existing = { ...ref, title: 'Existing different work' };
  const payload = copy(cite(['ref-one', 'Writer2026']));
  const result = await clipboard.prepareTransfer(payload, options({
    metadata: { references: [existing, { id: 'Writer2026-copy1', title: 'Occupied suffix' }] }
  }));
  assert.equal(result.metadataChanges.references[0].id, 'Writer2026-copy2');
  assert.equal(result.metadataChanges.references[0].key, 'Writer2026-copy2');
  assert.equal(result.metadataChanges.references[0].title, 'One');
  assert.deepEqual(JSON.parse(parseResult(result).querySelector('.academic-citation').getAttribute('data-cites')),
    ['Writer2026-copy2', 'Writer2026-copy2']);
  assert.equal(existing.title, 'Existing different work');
});
test('identical normalized references deduplicate including differently ordered CSL properties', async () => {
  const result = await clipboard.prepareTransfer(copy(cite(['Writer2026'])), options({
    metadata: { references: [{ title: ref.title, key: ref.key, author: ref.author, type: ref.type, id: 'local-id' }] }
  }));
  assert.deepEqual(result.metadataChanges.references, []);
  assert.deepEqual(JSON.parse(parseResult(result).querySelector('.academic-citation').getAttribute('data-cites')), ['local-id']);
});
test('unresolved citations survive same-book cut/move with visible text and explicit diagnostics', async () => {
  const payload = copy('<p>Moved ' + cite(['removed-reference'], '[missing: removed-reference]') + '</p>',
    { references: [] }, { cut: true });
  assert.deepEqual(JSON.parse(payload).references, []);
  const result = await clipboard.prepareTransfer(payload, options({ uniqueId: undefined }));
  const marker = parseResult(result).querySelector('.academic-citation');
  assert.deepEqual(JSON.parse(marker.getAttribute('data-cites')), ['removed-reference']);
  assert.equal(marker.textContent, '[missing: removed-reference]');
  assert.deepEqual(result.metadataChanges.references, []);
  assert.deepEqual(result.metadataChanges.diagnostics, [{
    code: 'missing-citation', id: 'removed-reference', targetId: 'removed-reference', sourceBookId: 'book-one'
  }]);
});
test('cross-book unresolved citations cannot bind to unrelated destination reference aliases', async () => {
  const payload = copy(cite(['removed-reference', 'ref-one'], '[missing: removed-reference]; Writer'));
  const result = await clipboard.prepareTransfer(payload, options({
    bookId: 'book-two',
    metadata: { references: [
      { id: 'unrelated-id', key: 'removed-reference', title: 'Other work' },
      { id: 'occupied-suffix', key: 'removed-reference-unresolved-copy1', title: 'Occupied' }
    ] }
  }));
  const marker = parseResult(result).querySelector('.academic-citation');
  assert.deepEqual(JSON.parse(marker.getAttribute('data-cites')), ['removed-reference-unresolved-copy2', 'ref-one']);
  assert.equal(marker.textContent, '[missing: removed-reference]; Writer');
  assert.equal(result.metadataChanges.references.length, 1);
  assert.equal(result.metadataChanges.references[0].id, 'ref-one');
  assert.equal(result.metadataChanges.diagnostics[0].targetId, 'removed-reference-unresolved-copy2');
});
test('cross-book figures require destination storage and preserve originals and attribution', async () => {
  const payload = copy(objects.figureHTML(figure, image));
  await assert.rejects(clipboard.prepareTransfer(payload, options({ bookId: 'book-two' })), /require copyFigure/);
  let call;
  const result = await clipboard.prepareTransfer(payload, options({
    bookId: 'book-two',
    copyFigure: async (model, sourceBookId, targetBookId) => {
      call = { model, sourceBookId, targetBookId };
      return { file: 'dest.png', originalFile: 'dest.pdf' };
    }
  }));
  assert.equal(call.sourceBookId, 'book-one');
  assert.equal(call.targetBookId, 'book-two');
  assert.equal(call.model.dataUrl, image);
  assert.equal(result.metadataChanges.figures[0].file, 'dest.png');
  assert.equal(result.metadataChanges.figures[0].originalFile, 'dest.pdf');
  assert.equal(result.metadataChanges.figures[0].attribution, figure.attribution);
  assert.equal(result.metadataChanges.figures[0].license, figure.license);
  assert.equal(result.metadataChanges.figures[0].dataUrl, undefined);
  assert.equal(parseResult(result).querySelector('img').getAttribute('src'), image);
  await assert.rejects(clipboard.prepareTransfer(payload, options({
    bookId: 'book-two', copyFigure: async () => ({ file: 'dest.png', originalFile: '' })
  })), /original filenames/);
  await assert.rejects(clipboard.prepareTransfer(payload, options({
    bookId: 'book-two', copyFigure: async () => ({ file: 'dest.png' })
  })), /original filenames/);
});
test('figure URLs come from safe portable raster or bridge, never raw custom MIME markup', async () => {
  const payload = rewrite(copy(objects.figureHTML(figure, image)), {
    figures: [figure],
    html: '<figure class="academic-figure" data-academic-id="fig-one"><img src="https://evil"></figure>'
  });
  await assert.rejects(clipboard.prepareTransfer(payload, options()), /requires image data or readFigure/);
  let read;
  const result = await clipboard.prepareTransfer(payload, options({
    readFigure: async (...args) => { read = args; return image; }
  }));
  assert.deepEqual(read, ['book-one', 'one.png']);
  assert.equal(parseResult(result).querySelector('img').getAttribute('src'), image);
  const bridgeObject = await clipboard.prepareTransfer(payload, options({
    readFigure: () => ({ file: figure.file, mime: 'image/png', dataUrl: image })
  }));
  assert.equal(parseResult(bridgeObject).querySelector('img').getAttribute('src'), image);
  await assert.rejects(clipboard.prepareTransfer(payload, options({ readFigure: () => 'https://evil' })), /Unsafe/);
});
test('portable SVG rejected; bridge SVG strictly validated before use', async () => {
  const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const payload = copy(objects.figureHTML(figure, dataUrl));
  assert.equal(JSON.parse(payload).figures[0].dataUrl, undefined);
  const result = await clipboard.prepareTransfer(payload, options({ readFigure: () => dataUrl }));
  assert.equal(parseResult(result).querySelector('img').getAttribute('src'), dataUrl);
  await assert.rejects(clipboard.prepareTransfer(rewrite(payload, { figures: [{ ...figure, dataUrl }] }), options()), /Unsafe/);
  const unsafe = 'data:image/svg+xml;base64,' + Buffer.from('<svg><image href="https://evil"></image></svg>').toString('base64');
  await assert.rejects(clipboard.prepareTransfer(payload, options({ readFigure: () => unsafe })), /Unsafe figure SVG/);
  const geometry = 'data:image/svg+xml;base64,' +
    Buffer.from('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/><desc>Chart</desc></svg>').toString('base64');
  const safeGeometry = await clipboard.prepareTransfer(payload, options({ readFigure: () => geometry }));
  assert.equal(parseResult(safeGeometry).querySelector('img').getAttribute('src'), geometry);
  for (const source of ['<svg onload="evil()"></svg>', '<svg><circle fill="url(https://evil)"/></svg>',
    '<svg><foreignObject><iframe></iframe></foreignObject></svg>', '<svg></svg><svg></svg>']) {
    await assert.rejects(clipboard.prepareTransfer(payload, options({
      readFigure: () => 'data:image/svg+xml;base64,' + Buffer.from(source).toString('base64')
    })), /Unsafe figure SVG/);
  }
});
test('all model/HTML validation completes before storage or renderer calls', async () => {
  let called = false;
  const payload = rewrite(copy(objects.tableHTML(table)), {
    html: '<span class="academic-table" data-academic-id="tbl-one"></span>' +
      '<span class="academic-citation" data-cites="not-json"></span>'
  });
  await assert.rejects(clipboard.prepareTransfer(payload, options({
    copyFigure: () => { called = true; }, renderMath: () => { called = true; }
  })), /Invalid citation/);
  assert.equal(called, false);
  const mismatch = copy(objects.figureHTML(figure, image) + objects.xrefHTML(figure.id, 'table'));
  await assert.rejects(clipboard.prepareTransfer(mismatch, options({
    bookId: 'book-two', copyFigure: () => { called = true; }
  })), /kind disagrees/);
  assert.equal(called, false);
});
test('invalid and occupied unique IDs fail instead of silently duplicating manuscript IDs', async () => {
  const payload = copy(objects.tableHTML(table));
  await assert.rejects(clipboard.prepareTransfer(payload, options({ uniqueId: undefined })), /requires uniqueId/);
  await assert.rejects(clipboard.prepareTransfer(payload, options({ uniqueId: () => table.id })), /occupied/);
  await assert.rejects(clipboard.prepareTransfer(payload, options({ uniqueId: () => '"><img>' })), /Invalid object ID/);
  await assert.rejects(clipboard.prepareTransfer(payload, options({
    uniqueId: () => 'tbl-orphan', metadata: { tables: [{ ...table, id: 'tbl-orphan' }] }
  })), /occupied/);
});
test('malformed payloads, mismatched models, citations, and cross-reference kinds fail explicitly', async () => {
  const payload = copy(objects.tableHTML(table));
  for (const bad of ['{', 'null', rewrite(payload, { version: 2 }), rewrite(payload, { cut: 'true' }),
    rewrite(payload, { tables: {} }), rewrite(payload, { sourceBookId: '' }),
    rewrite(payload, { tables: [{ ...table, rows: [['1'], ['2', '3']] }] }),
    rewrite(payload, { html: '<span class="academic-table" data-academic-id="tbl-missing"></span>' }),
    rewrite(payload, { html: '' }), rewrite(payload, { references: [ref] }),
    rewrite(payload, { html: cite([]) }),
    rewrite(payload, { html: objects.xrefHTML(table.id, 'figure') + JSON.parse(payload).html }),
    rewrite(payload, { html: '<span class="academic-xref" data-target="tbl-one" data-kind="constructor"></span>' })]) {
    await assert.rejects(clipboard.prepareTransfer(bad, options()));
  }
  assert.throws(() => copy(objects.tableHTML(table) + objects.tableHTML(table)), /Duplicate object/);
  assert.throws(() => copy('<table><tr><td>raw</td></tr></table>'), /Unmodeled/);
  assert.throws(() => copy(objects.tableHTML(table), { tables: [] }), /Missing table/);
});
test('bounded JSON rejects oversized/deep/prototype model fields and non-JSON metadata', async () => {
  const payload = copy('text');
  await assert.rejects(clipboard.prepareTransfer('x'.repeat(16 * 1024 * 1024 + 1), options()), /Invalid clipboard payload/);
  await assert.rejects(clipboard.prepareTransfer(rewrite(payload, { references: new Array(1001).fill(ref) }), options()), /too many|Invalid/);
  await assert.rejects(clipboard.prepareTransfer(payload.replace('"version":1', '"__proto__":{},"version":1'), options()), /Unsafe/);
  let nested = 'x';
  for (let i = 0; i < 34; i++) nested = [nested];
  await assert.rejects(clipboard.prepareTransfer(rewrite(payload, { extra: nested }), options()), /deeply/);
  const cyclic = { ...ref }; cyclic.extra = cyclic;
  assert.throws(() => copy('text', { references: [cyclic] }), /must be JSON/);
});
} else {
  // Electron is the real insertion seam: its editing engine removes text-only
  // noneditable inline nodes while merging pasted paragraphs.
  const { app, BrowserWindow } = require('electron');
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false });
    try {
      await win.loadURL('data:text/html,<div id="body" contenteditable="true"><p>Destination</p></div>');
      const source = '<p>Prose ' + cite(['ref-one']) + cite(['Writer2026']) +
        objects.xrefHTML(table.id, 'table') + '<span class="ph-mark" data-sid="s-one">⚑</span></p>' +
        objects.tableHTML(table);
      const prepared = await clipboard.prepareTransfer(copy(source), options());
      const insertion = clipboard.prepareInsertionHTML(prepared.html, { document: doc() });
      const result = await win.webContents.executeJavaScript(`(() => {
        const body = document.querySelector('#body'); body.focus();
        const range = document.createRange(); range.selectNodeContents(body); range.collapse(false);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        const accepted = document.execCommand('insertHTML', false, ${JSON.stringify(insertion)});
        (${clipboard.restoreAtomicMarkers.toString()})(body);
        return { accepted, citations: body.querySelectorAll('.academic-citation').length,
          xrefs: body.querySelectorAll('.academic-xref').length, marks: body.querySelectorAll('.ph-mark').length,
          locked: body.querySelectorAll('span[contenteditable="false"]').length,
          html: body.innerHTML };
      })()`);
      assert.equal(result.accepted, true);
      assert.equal(result.citations, 2, JSON.stringify(result));
      assert.equal(result.xrefs, 1, JSON.stringify(result));
      assert.equal(result.marks, 1, JSON.stringify(result));
      assert.equal(result.locked, 4, JSON.stringify(result));
      const standalone = clipboard.prepareInsertionHTML(objects.xrefHTML('tbl-copy1', 'table'), { document: doc() });
      const rootMarker = await win.webContents.executeJavaScript(`(() => {
        const body = document.querySelector('#body'); body.focus();
        const range = document.createRange();
        const text = body.querySelector('p').firstChild;
        range.setStart(text, text.textContent.length); range.collapse(true);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        const accepted = document.execCommand('insertHTML', false, ${JSON.stringify(standalone)});
        (${clipboard.restoreAtomicMarkers.toString()})(body);
        return { accepted, xrefs: body.querySelectorAll('.academic-xref').length, html: body.innerHTML };
      })()`);
      assert.equal(rootMarker.accepted, true, JSON.stringify(rootMarker));
      assert.equal(rootMarker.xrefs, 2, JSON.stringify(rootMarker));
      for (const [selector, atom] of [
        ['.academic-xref', objects.xrefHTML('tbl-copy1', 'table')],
        ['.academic-citation', '<span class="academic-citation" data-cites=\'["ref-one"]\' contenteditable="false">[1]</span>']
      ]) {
        const atomInsertion = clipboard.prepareInsertionHTML(atom, { document: doc() });
        const single = await win.webContents.executeJavaScript(`(() => {
          const body = document.querySelector('#body'); body.innerHTML = '<p>Destination</p>'; body.focus();
          const range = document.createRange(); range.selectNodeContents(body); range.collapse(false);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          const accepted = document.execCommand('insertHTML', false, ${JSON.stringify(atomInsertion)});
          (${clipboard.restoreAtomicMarkers.toString()})(body);
          return { accepted, count: body.querySelectorAll(${JSON.stringify(selector)}).length,
            locked: body.querySelector(${JSON.stringify(selector)})?.getAttribute('contenteditable'), html: body.innerHTML };
        })()`);
        assert.equal(single.accepted, true, JSON.stringify(single));
        assert.equal(single.count, 1, JSON.stringify(single));
        assert.equal(single.locked, 'false', JSON.stringify(single));
      }
      console.log('native clipboard markers preserved');
      win.close();
      app.exit(0);
    } catch (error) {
      console.error(error);
      win.close();
      app.exit(1);
    }
  }).catch((error) => { console.error(error); app.exit(1); });
}
