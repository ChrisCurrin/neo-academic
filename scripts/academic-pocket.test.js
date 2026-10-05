'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { renderServer } = require('../academic/academic-math.js');

const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'pocket/www/pocket-bridge.js'), 'utf8');

class SvgDOMParser {
  parseFromString(source) {
    const parsed = parseHTML(`<div id="svg-root">${source}</div>`);
    const root = parsed.document.querySelector('svg');
    return {
      documentElement: root,
      querySelector: (selector) => selector === 'parsererror' ? null : root && root.querySelector(selector)
    };
  }
}

class SvgXMLSerializer {
  serializeToString(node) {
    return node.outerHTML;
  }
}

function svgNode(source) {
  return parseHTML(`<div>${source}</div>`).document.querySelector('svg');
}

function createPocketBridge({ mathJax, files = new Map() } = {}) {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  const filesystem = {
    async mkdir() {},
    async readdir() { return { files: [] }; },
    async readFile({ path: filePath }) {
      if (!files.has(filePath)) throw new Error('File not found');
      return { data: files.get(filePath) };
    },
    async writeFile({ path: filePath, data }) {
      files.set(filePath, data);
    },
    async deleteFile({ path: filePath }) { files.delete(filePath); }
  };
  window.Capacitor = {
    getPlatform: () => 'android',
    Plugins: { Filesystem: filesystem },
    registerPlugin: () => ({ set: async () => {} })
  };
  if (mathJax) window.MathJax = mathJax;

  const context = vm.createContext({
    window,
    document,
    navigator: { language: 'en' },
    XMLHttpRequest: class { open() {} send() {} },
    MutationObserver: class {},
    DOMParser: SvgDOMParser,
    XMLSerializer: SvgXMLSerializer,
    console,
    setTimeout,
    clearTimeout,
    localStorage: { getItem() { return null; }, setItem() {} },
    Date,
    Math,
    URL,
    Blob,
    Uint8Array,
    TextDecoder,
    TextEncoder,
    atob,
    btoa
  });
  vm.runInContext(bridgeSource, context);
  return { window, files };
}

function mathJaxAdapter(svg) {
  return {
    startup: { promise: Promise.resolve() },
    tex2svgPromise: async () => svgNode(svg),
    asciimath2svgPromise: async () => svgNode(svg)
  };
}

test('Pocket accepts a real MathJax SVG with its standard SVG namespace', async () => {
  const svg = renderServer('x^2 + \\frac{1}{y}', 'tex', true);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  const { window } = createPocketBridge({ mathJax: mathJaxAdapter(svg) });

  const rendered = await window.neo.renderAcademicMath('x^2 + \\frac{1}{y}', 'tex', true);

  assert.match(rendered, /^<svg\b/);
  assert.match(rendered, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(rendered, /<path\b/);
});

test('Pocket permits fragment references but rejects active and external MathJax SVG content', async () => {
  const svg = renderServer('x^2', 'tex', true);
  const fragmentSvg = svg.replace('</svg>', '<use href="#local-glyph"></use></svg>');
  const { window: safeWindow } = createPocketBridge({ mathJax: mathJaxAdapter(fragmentSvg) });
  assert.match(await safeWindow.neo.renderAcademicMath('x^2', 'tex', true), /href="#local-glyph"/);

  for (const unsafe of [
    svg.replace('<svg ', '<svg onload="alert(1)" '),
    svg.replace('<svg ', '<svg href="https://example.invalid/math.svg" '),
    svg.replace('</svg>', '<script>alert(1)</script></svg>')
  ]) {
    const { window } = createPocketBridge({ mathJax: mathJaxAdapter(unsafe) });
    await assert.rejects(window.neo.renderAcademicMath('x^2', 'tex', true), /unsafe|active|external|local fragments/i);
  }
});

test('Pocket SVG figure reads allow the standard namespace and reject unsafe references', async () => {
  const filename = 'figure-0123456789abcdef0123456789abcdef.svg';
  const filePath = `NEO Library/book-1/figures/${filename}`;
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
  const files = new Map([[filePath, Buffer.from(source).toString('base64')]]);
  const { window } = createPocketBridge({ files });

  const dataUrl = await window.neo.readAcademicFigure('book-1', filename);
  assert.match(dataUrl, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(dataUrl.split(',')[1], 'base64').toString('utf8'), /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

  files.set(filePath, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://example.invalid/a.svg#paint)"/></svg>').toString('base64'));
  await assert.rejects(window.neo.readAcademicFigure('book-1', filename), /external references/);
});

test('Pocket loads and rebuilds the shared academic UI module', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'pocket/www/index.html'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/pocket.yml'), 'utf8');
  const pocketWww = fs.readFileSync(path.join(__dirname, '..', 'scripts/pocket-www.js'), 'utf8');
  assert.ok(workflow.includes(`'academic/**'`));
  assert.ok(workflow.includes('node scripts/pocket-www.js'));
  assert.match(pocketWww, /\/\^academic\.\*\\\.js\$\//);
  for (const module of ['academic/academic-ui.js', 'academic/academic-clipboard.js']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', module)));
    assert.ok(index.indexOf(`src="../${module}"`) < index.indexOf('src="../academic/academic.js"'));
  }
  assert.match(index, /<option value="txt">Text<\/option>/);
  assert.match(index, /<option value="epub">EPUB<\/option>/);
});

test('Pocket copies cross-book figures with fresh names and preserves original PDFs', async () => {
  const sourceBookId = 'book-source';
  const targetBookId = 'book-target';
  const sourceFile = 'figure-0123456789abcdef0123456789abcdef.png';
  const sourceOriginalFile = 'figure-11111111111111111111111111111111.pdf';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv9sAAAAASUVORK5CYII=';
  const pdf = Buffer.from('%PDF-1.7\n% portable test PDF\n').toString('base64');
  const files = new Map([
    [`NEO Library/${sourceBookId}/book.json`, JSON.stringify({ id: sourceBookId })],
    [`NEO Library/${targetBookId}/book.json`, JSON.stringify({ id: targetBookId })],
    [`NEO Library/${sourceBookId}/figures/${sourceFile}`, png],
    [`NEO Library/${sourceBookId}/figures/${sourceOriginalFile}`, pdf]
  ]);
  const { window } = createPocketBridge({ files });
  const source = {
    id: 'fig-source',
    file: sourceFile,
    mime: 'image/png',
    originalFile: sourceOriginalFile,
    originalMime: 'application/pdf',
    originalName: 'paper.pdf',
    caption: 'A portable figure'
  };

  const copied = await window.neo.copyAcademicFigure(sourceBookId, targetBookId, source);

  assert.match(copied.file, /^figure-[a-f0-9-]+\.png$/);
  assert.match(copied.originalFile, /^figure-[a-f0-9-]+\.pdf$/);
  assert.notEqual(copied.file, source.file);
  assert.notEqual(copied.originalFile, source.originalFile);
  assert.equal(copied.mime, 'image/png');
  assert.equal(copied.originalMime, 'application/pdf');
  assert.equal(copied.originalName, source.originalName);
  assert.equal(copied.caption, source.caption);
  assert.equal(copied.dataUrl, `data:image/png;base64,${png}`);
  assert.equal(files.get(`NEO Library/${targetBookId}/figures/${copied.file}`), png);
  assert.equal(files.get(`NEO Library/${targetBookId}/figures/${copied.originalFile}`), pdf);
  assert.equal(copied.originalBytes, Buffer.from('%PDF-1.7\n% portable test PDF\n').length);
});

test('Pocket same-book figure copies only read existing assets and validates both book paths', async () => {
  const filename = 'figure-0123456789abcdef0123456789abcdef.png';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv9sAAAAASUVORK5CYII=';
  const files = new Map([
    ['NEO Library/book-1/book.json', JSON.stringify({ id: 'book-1' })],
    [`NEO Library/book-1/figures/${filename}`, png]
  ]);
  const { window } = createPocketBridge({ files });
  const figure = { id: 'fig-1', file: filename, mime: 'image/png' };

  const result = await window.neo.copyAcademicFigure('book-1', 'book-1', figure);

  assert.equal(result.file, filename);
  assert.equal(result.dataUrl, `data:image/png;base64,${png}`);
  assert.equal(files.size, 2);
  await assert.rejects(window.neo.copyAcademicFigure('book-1', '../escape', figure), /Invalid book ID/);
  await assert.rejects(window.neo.copyAcademicFigure('book-1', 'book-missing', figure), /book not found/i);
  await assert.rejects(window.neo.copyAcademicFigure('book-1', 'book-2', { ...figure, file: '../../escape.png' }), /Invalid figure filename/);
});
