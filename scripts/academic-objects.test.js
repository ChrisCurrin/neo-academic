'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const objects = require('../academic/academic-objects.js');
const math = require('../academic/academic-math.js');

const figure = { id: 'fig-one', caption: 'A <caption>', alt: '" onload="alert(1)', file: 'figure-one.png' };
const table = { id: 'tbl-one', caption: 'Measurements', rows: [['Name', 'Value'], ['A', '2']], header: true, borders: true, shading: true, align: 'right' };
const equation = { id: 'eq-one', source: '\\frac{x^2}{2}', format: 'tex', display: true };

test('UMD helpers load without Node or document', () => {
  const context = vm.createContext({});
  for (const file of ['academic/academic-objects.js', 'academic/academic-math.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  assert.equal(typeof context.NeoAcademicObjects.reconcile, 'function');
  assert.equal(typeof context.NeoAcademicMath.render, 'function');
});
test('models are validated, cloned, and contain no HTML derived state', () => {
  const copy = objects.normalizeTable(table);
  copy.rows[0][0] = 'Changed';
  assert.equal(table.rows[0][0], 'Name');
  assert.throws(() => objects.normalizeTable({ ...table, rows: [['1'], ['2', '3']] }));
  assert.throws(() => objects.normalizeTable({ ...table, align: 'left;background:url(x)' }));
  assert.throws(() => objects.normalizeFigure({ ...figure, id: '"><script>' }));
  assert.throws(() => objects.normalizeFigure({ ...figure, file: '../image.png' }));
  assert.throws(() => objects.normalizeEquation({ ...equation, format: 'html' }));
  assert.throws(() => objects.normalizeEquation({ ...equation, display: 'true' }));
});
test('figure normalization retains validated PDF provenance and preview metadata for clipboard transfers', () => {
  const original = { ...figure, originalFile: 'figure-abc.pdf', originalMime: 'application/pdf', originalName: 'Original paper.pdf',
    bytes: 123, originalBytes: 456, width: 400, height: 200, previewPage: 1, pageCount: 2, dataUrl: 'data:image/png;base64,YQ==' };
  const normalized = objects.normalizeFigure(original);
  for (const key of ['originalFile', 'originalMime', 'originalName', 'bytes', 'originalBytes', 'width', 'height', 'previewPage', 'pageCount']) {
    assert.equal(normalized[key], original[key]);
  }
  assert.equal(normalized.dataUrl, undefined);
  assert.throws(() => objects.normalizeFigure({ ...original, originalMime: 'text/html' }));
  assert.throws(() => objects.normalizeFigure({ ...original, bytes: -1 }));
  assert.throws(() => objects.normalizeFigure({ ...original, width: 50000 }));
  assert.throws(() => objects.normalizeFigure({ ...original, previewPage: 3 }));
});
test('object HTML escapes captions, alternate text, cells and source', () => {
  const html = objects.figureHTML(figure, 'data:image/png;base64,YQ==', 1);
  assert.match(html, /Figure 1\. A &lt;caption&gt;/);
  assert.match(html, /alt="&quot; onload=&quot;alert\(1\)"/);
  assert.throws(() => objects.figureHTML(figure, 'javascript:alert(1)'));
  assert.match(objects.tableHTML({ ...table, rows: [['<script>', '"']] }, 2), /&lt;script&gt;/);
  const mathHTML = objects.equationHTML({ ...equation, source: '<img onerror="x">' }, '', 3);
  assert.match(mathHTML, /data-source="&lt;img onerror=&quot;x&quot;&gt;"/);
  assert.match(mathHTML, /\(3\)/);
  assert.match(objects.xrefHTML('fig-one', 'figure', 1), /Figure 1/);
  assert.throws(() => objects.xrefHTML('fig-one', 'bogus'));
  assert.throws(() => objects.xrefHTML('fig-one', 'constructor'));
});
test('stable HTML option objects and validation aliases work', () => {
  assert.match(objects.figureHTML(figure, { dataUrl: 'data:image/png;base64,YQ==', number: 4 }), /Figure 4\./);
  assert.match(objects.tableHTML(table, { number: 5 }), /Table 5\./);
  assert.match(objects.equationHTML(equation, { number: 6, svg: '<svg></svg>' }), /\(6\)/);
  assert.deepEqual(objects.validateTable(table), objects.normalizeTable(table));
  assert.match(objects.equationHTML({ ...equation, display: false }, {}), /^<span /);
  assert.match(objects.equationHTML(equation, {}), /^<div /);
});
test('real DOM reconciliation returns diagnostics array and updates authoritative object HTML', () => {
  const { document } = parseHTML('<html><body><main></main></body></html>');
  const root = document.querySelector('main');
  root.innerHTML = objects.figureHTML(figure, { number: 9 }) + objects.tableHTML(table, { number: 9 }) +
    objects.equationHTML({ ...equation, display: false }, {}) +
    objects.xrefHTML(equation.id, 'equation', 9) + objects.xrefHTML('fig-missing', 'figure', 9);
  const diagnostics = objects.reconcile(root, { figures: [figure], tables: [table], equations: [equation] });
  assert.ok(Array.isArray(diagnostics));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'dangling-xref');
  const block = root.querySelector('.academic-equation');
  assert.equal(block.tagName, 'DIV');
  assert.equal(block.getAttribute('data-academic-id'), equation.id);
  assert.equal(block.getAttribute('data-source'), equation.source);
  assert.equal(block.getAttribute('data-math-format'), 'tex');
  assert.equal(block.getAttribute('data-display'), 'true');
  assert.equal(root.querySelector('.academic-equation-number').textContent, '(1)');
  assert.equal(root.querySelector('.academic-xref').textContent, 'Equation 1');
  assert.match(root.querySelector('figcaption').textContent, /Figure 1/);
  objects.reconcile(root, { figures: [figure], tables: [table], equations: [{ ...equation, display: false }] });
  assert.equal(root.querySelector('.academic-equation').tagName, 'SPAN');
  assert.equal(root.querySelector('.academic-equation-number'), null);
});
test('CSV round trips quoted commas, quotes, CRLF, multiline fields and empty trailing cells', () => {
  const rows = [['Name', 'Quote', ''], ['A,B', 'He said "yes"\r\nagain', ''], ['', '', 'last']];
  assert.deepEqual(objects.parseCSV(objects.exportCSV(rows)), rows);
  assert.deepEqual(objects.parseCSV('\uFEFFa,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(objects.parseCSV('a,\n,'), [['a', ''], ['', '']]);
  assert.deepEqual(objects.parseCSV('""'), [['']]);
  assert.deepEqual(objects.parseCSV(''), []);
  for (const malformed of ['"unclosed', '"a"x,b', 'a"b,c']) assert.throws(() => objects.parseCSV(malformed));
});
test('CSV import pads ragged rows and table edits do not mutate input', () => {
  const imported = objects.importCSV('a,b\nc', { id: 'tbl-csv', header: false });
  assert.deepEqual(imported.rows, [['a', 'b'], ['c', '']]);
  assert.deepEqual(objects.resizeTable(table, 3, 3).rows[2], ['', '', '']);
  assert.deepEqual(objects.resizeTable(table, 1, 1).rows, [['Name']]);
  assert.equal(objects.editTableCell(table, 1, 1, '3').rows[1][1], '3');
  assert.equal(table.rows[1][1], '2');
  assert.equal(objects.editTableAxis(table, 'row', 0, false).rows.length, 3);
  assert.equal(objects.editTableAxis(table, 'column', 1, true).rows[0].length, 1);
  assert.throws(() => objects.editTableAxis(objects.resizeTable(table, 1, 1), 'row', 0, true));
  assert.throws(() => objects.resizeTable(table, 0, 2));
  assert.throws(() => objects.editTableCell(table, -1, 0, 'x'));
});

// Minimal DOM surface keeps these domain tests independent of Electron/jsdom.
class Element {
  constructor(kind, attrs = {}) {
    this.kind = kind; this.attrs = attrs; this.innerHTML = ''; this.textContent = '';
    this.tagName = kind === 'equation' && attrs['data-display'] === 'false' ? 'SPAN' : 'DIV';
    this.classList = { contains: (name) => name === `academic-${kind}` };
    this.ownerDocument = { createElement: () => ({
      set innerHTML(html) {
        const tag = /^<(span|div)\b([^>]*)>([\s\S]*)<\/\1>$/.exec(html);
        const attrs = Object.fromEntries([...tag[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
        this.firstElementChild = { tagName: tag[1].toUpperCase(), innerHTML: tag[3], getAttribute: (key) => attrs[key] };
      }
    }) };
  }
  getAttribute(key) { return this.attrs[key] == null ? null : this.attrs[key]; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  querySelector(selector) { return selector === 'img' ? { getAttribute: () => 'data:image/png;base64,YQ==' } : null; }
}
function chapter(nodes) {
  return { querySelectorAll: (selector) => nodes.filter((node) => selector.includes(`.academic-${node.kind}`)) };
}
test('reconciliation numbers chapter order from authoritative models and reports dangling/duplicate objects', () => {
  const first = new Element('figure', { 'data-academic-id': 'fig-two' });
  const second = new Element('figure', { 'data-academic-id': 'fig-one' });
  const cross = new Element('xref', { 'data-target': 'fig-one', 'data-kind': 'figure' });
  const lost = new Element('xref', { 'data-target': 'fig-deleted', 'data-kind': 'figure' });
  const missing = new Element('figure', { 'data-academic-id': 'fig-no-model' });
  const duplicate = new Element('figure', { 'data-academic-id': 'fig-one' });
  const result = objects.reconcile([chapter([first, cross]), chapter([second, lost, missing, duplicate])], {
    figures: [figure, { ...figure, id: 'fig-two', caption: 'New caption' }, { ...figure, id: 'fig-unused' }]
  });
  assert.deepEqual(result.numbers.figure, { 'fig-two': 1, 'fig-one': 2 });
  assert.equal(cross.textContent, 'Figure 2');
  assert.equal(lost.textContent, 'Figure ?');
  assert.match(first.innerHTML, /Figure 1\. New caption/);
  assert.equal(missing.getAttribute('data-academic-dangling'), 'true');
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code).sort(), ['dangling-xref', 'duplicate-object', 'missing-model', 'unplaced-model'].sort());
  const renumbered = objects.reconcile([chapter([second, cross]), chapter([first])], { figures: [figure, { ...figure, id: 'fig-two' }] });
  assert.equal(renumbered.numbers.figure['fig-one'], 1);
  assert.equal(cross.textContent, 'Figure 1');
});
test('reconciliation regenerates tables and rejects mismatched and invalid models', () => {
  const node = new Element('table', { 'data-academic-id': 'tbl-one' });
  const cross = new Element('xref', { 'data-target': 'constructor', 'data-kind': 'table' });
  const result = objects.reconcile(chapter([node, cross]), { tables: [table, { ...table, id: 'tbl-one' }, { id: 'bad', rows: [] }] });
  assert.match(node.innerHTML, /<th[^>]*>Name<\/th>/);
  assert.match(node.innerHTML, /Table 1\. Measurements/);
  assert.equal(cross.textContent, 'Table ?');
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-model'));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-model'));
});
test('equation models own source and display numbering; inline math does not consume a number', () => {
  const inline = new Element('equation', { 'data-academic-id': 'eq-inline', 'data-display': 'false' });
  const block = new Element('equation', { 'data-academic-id': 'eq-one', 'data-display': 'true', 'data-source': 'stale source' });
  const cross = new Element('xref', { 'data-target': 'eq-one', 'data-kind': 'equation' });
  const missingInlineNumber = new Element('xref', { 'data-target': 'eq-inline', 'data-kind': 'equation' });
  const result = objects.reconcile(chapter([inline, block, cross, missingInlineNumber]), {
    equations: [equation, { ...equation, id: 'eq-inline', source: 'x', display: false }]
  });
  assert.deepEqual(result.numbers.equation, { 'eq-one': 1 });
  assert.match(block.innerHTML, /\\frac\{x\^2\}\{2\}/);
  assert.match(block.innerHTML, /\(1\)/);
  assert.equal(block.getAttribute('data-source'), equation.source);
  assert.equal(cross.textContent, 'Equation 1');
  assert.equal(missingInlineNumber.getAttribute('data-academic-dangling'), 'true');
});
test('math adapter is async, validates inputs, and uses local rendering without scripts', async () => {
  const calls = [];
  const result = await math.render('x', 'tex', false, async (...args) => { calls.push(args); return '<svg></svg>'; });
  assert.equal(result, '<svg></svg>');
  assert.deepEqual(calls, [['x', 'tex', false]]);
  await assert.rejects(math.render('x', 'invalid', true));
  assert.throws(() => math.renderServer('\\href{https://example.com}{x}', 'tex', true));
  for (const format of ['tex', 'asciimath']) {
    const svg = math.renderServer(format === 'tex' ? equation.source : 'sqrt(x^2+1)', format, true);
    assert.match(svg, /^<svg/);
    assert.match(objects.equationHTML({ ...equation, format }, svg, 1), /<svg/);
    assert.doesNotMatch(svg, /<script|<use|href=/);
  }
  for (const source of ['\\begin{align}a&=b\\\\c&=d\\end{align}', '\\tag{3}x=y', '\\text{hello world}']) {
    assert.match(objects.safeMathSVG(math.renderServer(source, 'tex', true)), /^<svg/);
  }
  assert.throws(() => objects.safeMathSVG('<svg><script>alert(1)</script></svg>'));
  assert.throws(() => objects.safeMathSVG('<svg><a href="https://example.com"></a></svg>'));
  assert.throws(() => objects.safeMathSVG('<svg><animate attributeName="x"></animate></svg>'));
});
