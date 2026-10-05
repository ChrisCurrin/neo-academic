'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assets = require('../academic/academic-assets.js');
const { renderPDF } = require('../pdf-render.js');

function fixture(run) {
  const directory = path.join('scripts', '.academic-assets-test-' + crypto.randomUUID());
  fs.mkdirSync(directory);
  fs.mkdirSync(path.join(directory, 'book-1'));
  try { run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
async function asyncFixture(run) {
  const directory = path.join('scripts', '.academic-assets-test-' + crypto.randomUUID());
  fs.mkdirSync(directory);
  fs.mkdirSync(path.join(directory, 'book-1'));
  try { await run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function staticPDF(width = 200, height = 100) {
  const commands = ['1 0 0 rg', '0 1 0 rg'].map((color) => `${color} 0 0 ${width} ${height} re f\n`);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (globalThis.__neoPdfExecuted=true;) >> >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${commands[0].length} >>\nstream\n${commands[0]}endstream`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 6 0 R >>`,
    `<< /Length ${commands[1].length} >>\nstream\n${commands[1]}endstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
    offsets.slice(1).map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="100" height="50" fill="#fff"/><text x="5" y="20">A &amp; B</text></svg>';
test('path and IPC payload validation reject traversal and unsafe names', () => {
  for (const bad of ['', '.', '..', '../book', 'a/b', 'a\\b', 'a\0b', 'a:b', 'book.']) {
    assert.throws(() => assets.assetPaths('scripts', bad));
  }
  for (const bad of ['../image.png', '/image.png', 'figure-a.svg/../../x', 'bibliography.bib', 'figure-a.html']) {
    assert.throws(() => assets.assetPaths('scripts', 'book-1', bad));
  }
  assert.equal(assets.assetPaths('scripts', 'book-1', 'figure-abc.png').file, path.resolve('scripts/book-1/figures/figure-abc.png'));
  assert.throws(() => assets.validateBibliography({ text: 'not text' }));
  assert.throws(() => assets.validateBibliography('bad\0payload'));
  assert.throws(() => assets.validateBibliography('a'.repeat(assets.MAX_INPUT_BYTES + 1)));
});
test('strict SVG sanitizer accepts static geometry and rejects all active/external content', () => {
  assert.equal(assets.sanitizeSVG(svg), svg);
  const malicious = [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><foreignObject><div>HTML</div></foreignObject></svg>',
    '<svg><image href="file:///etc/passwd"/></svg>',
    '<svg><use href="#x"/></svg>',
    '<svg><path fill="url(https://example.com)"/></svg>',
    '<svg><path fill="&#117;rl(x)"/></svg>',
    '<svg><path style="fill:red"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg>&x;</svg>',
    '<svg><animate attributeName="href"/></svg>',
    '<svg><g></svg>',
    '<svg xmlns="https://bad"></svg>',
    '<svg width="1" width="2"></svg>',
    '<svg/>junk',
    '<svg/><svg/>'
  ];
  for (const source of malicious) assert.throws(() => assets.sanitizeSVG(source), source);
});
test('SVG import persists safe portable assets and revalidates content on read', () => fixture((directory) => {
  const source = path.join(directory, 'figure.svg');
  fs.writeFileSync(source, svg);
  const result = assets.importFigure(directory, 'book-1', source);
  assert.match(result.file, /^figure-[a-f0-9-]+\.svg$/);
  assert.equal(result.mime, 'image/svg+xml');
  assert.equal(result.originalName, 'figure.svg');
  assert.equal(Buffer.from(result.dataUrl.split(',')[1], 'base64').toString(), svg);
  assert.equal(assets.readFigure(directory, 'book-1', result.file), result.dataUrl);
  fs.writeFileSync(path.join(directory, 'book-1', 'figures', result.file), '<svg onload="x"/>');
  assert.throws(() => assets.readFigure(directory, 'book-1', result.file));
}));
test('PDF import persists original and injectable first-page PNG preview', () => asyncFixture(async (directory) => {
  const source = path.join(directory, 'paper.pdf');
  const pdf = staticPDF();
  fs.writeFileSync(source, pdf);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a17sAAAAASUVORK5CYII=', 'base64');
  const result = await assets.importFigure(directory, 'book-1', source, null, async (buffer, options) => {
    assert.deepEqual(buffer, pdf);
    assert.equal(options.maxDimension, assets.MAX_DIMENSION);
    assert.equal(options.maxBytes, assets.MAX_IMAGE_BYTES);
    return { buffer: png, width: 1, height: 1, pageCount: 2, previewPage: 1 };
  });
  assert.match(result.file, /^figure-[a-f0-9-]+\.png$/);
  assert.match(result.originalFile, /^figure-[a-f0-9-]+\.pdf$/);
  assert.equal(result.mime, 'image/png');
  assert.equal(result.originalMime, 'application/pdf');
  assert.equal(result.previewPage, 1);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'book-1', 'figures', result.originalFile)), pdf);
  assert.equal(assets.readFigure(directory, 'book-1', result.file), result.dataUrl);
}));
test('PDF preview failures reject without persisting fake assets', () => asyncFixture(async (directory) => {
  const source = path.join(directory, 'paper.pdf');
  fs.writeFileSync(source, staticPDF());
  await assert.rejects(assets.importFigure(directory, 'book-1', source, null, async () => { throw new Error('Rasterization unavailable'); }), /Rasterization unavailable/);
  assert.equal(fs.existsSync(path.join(directory, 'book-1', 'figures')), false);
  await assert.rejects(assets.importFigure(directory, 'book-1', source, null, async () => ({ buffer: Buffer.from('bad'), width: 9000, height: 1, pageCount: 1 })), /Invalid PDF raster preview/);
  assert.equal(fs.existsSync(path.join(directory, 'book-1', 'figures')), false);
}));
test('real PDF.js/canvas renderer previews first page without running PDF JavaScript', async () => {
  delete globalThis.__neoPdfExecuted;
  const result = await renderPDF(staticPDF());
  assert.equal(result.pageCount, 2);
  assert.equal(result.previewPage, 1);
  assert.equal(result.width, 400);
  assert.equal(result.height, 200);
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const canvas = createCanvas(result.width, result.height);
  const context = canvas.getContext('2d');
  context.drawImage(await loadImage(result.buffer), 0, 0);
  assert.deepEqual([...context.getImageData(20, 20, 1, 1).data], [255, 0, 0, 255]);
  assert.equal(globalThis.__neoPdfExecuted, undefined);
});
test('real PDF imports round trip preserved PDF and bounded raster preview', () => asyncFixture(async (directory) => {
  const source = path.join(directory, 'large-page.pdf');
  const pdf = staticPDF(100000, 50000);
  fs.writeFileSync(source, pdf);
  const result = await assets.importFigure(directory, 'book-1', source);
  assert.equal(result.width, assets.MAX_DIMENSION);
  assert.ok(result.height <= assets.MAX_DIMENSION);
  assert.ok(result.bytes <= assets.MAX_IMAGE_BYTES);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'book-1', 'figures', result.originalFile)), pdf);
  assert.equal(assets.readFigure(directory, 'book-1', result.file), result.dataUrl);
}));
test('real PDF renderer rejects malformed, oversized, and invalid-limit payloads', async () => {
  await assert.rejects(renderPDF(Buffer.from('not a PDF')), /Invalid PDF figure/);
  await assert.rejects(renderPDF(Buffer.from('%PDF-1.4\ninvalid')), /Unable to render PDF/);
  await assert.rejects(renderPDF(Buffer.alloc(assets.MAX_INPUT_BYTES + 1)), /maximum 20 MB/);
  await assert.rejects(renderPDF(staticPDF(), { maxDimension: 9999 }), /Invalid PDF preview limits/);
});
test('bibliography is persisted only within its book and symlink destinations are rejected', () => fixture((directory) => {
  const bib = '@article{key,\n title={A Paper}\n}\n';
  assert.deepEqual(assets.writeBibliography(directory, 'book-1', bib), { file: 'bibliography.bib', bytes: Buffer.byteLength(bib) });
  assert.equal(fs.readFileSync(path.join(directory, 'book-1', 'bibliography.bib'), 'utf8'), bib);
  fs.unlinkSync(path.join(directory, 'book-1', 'bibliography.bib'));
  const target = path.resolve(directory, 'outside.txt');
  fs.writeFileSync(target, 'unchanged');
  fs.symlinkSync(target, path.join(directory, 'book-1', 'bibliography.bib'));
  assert.throws(() => assets.writeBibliography(directory, 'book-1', bib));
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  fs.unlinkSync(path.join(directory, 'book-1', 'bibliography.bib'));
  fs.symlinkSync(path.resolve(directory, 'missing'), path.join(directory, 'book-1', 'bibliography.bib'));
  assert.throws(() => assets.writeBibliography(directory, 'book-1', bib));
  fs.unlinkSync(path.join(directory, 'book-1', 'bibliography.bib'));
  fs.linkSync(target, path.join(directory, 'book-1', 'bibliography.bib'));
  assets.writeBibliography(directory, 'book-1', bib);
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
}));
test('symlink books, figure directories and figure files cannot escape the library', () => fixture((directory) => {
  fs.symlinkSync(path.resolve(directory, 'book-1'), path.join(directory, 'linked-book'));
  assert.throws(() => assets.writeBibliography(directory, 'linked-book', 'x'));
  fs.mkdirSync(path.join(directory, 'outside'));
  fs.symlinkSync(path.resolve(directory, 'outside'), path.join(directory, 'book-1', 'figures'));
  assert.throws(() => assets.readFigure(directory, 'book-1', 'figure-abc.svg'));
  fs.unlinkSync(path.join(directory, 'book-1', 'figures'));
  fs.mkdirSync(path.join(directory, 'book-1', 'figures'));
  fs.writeFileSync(path.join(directory, 'outside.svg'), svg);
  fs.symlinkSync(path.resolve(directory, 'outside.svg'), path.join(directory, 'book-1', 'figures', 'figure-abc.svg'));
  assert.throws(() => assets.readFigure(directory, 'book-1', 'figure-abc.svg'));
}));
test('bitmap optimization bounds dimensions and payload and rejects forged formats', () => {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
  let width = 10000, height = 8000;
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: (size) => { width = size.width; height = size.height; return image; },
    toPNG: () => png
  };
  const result = assets.optimizeBitmap(png, 'image/png', { createFromBuffer: () => image });
  assert.ok(result.width <= assets.MAX_DIMENSION);
  assert.ok(result.height <= assets.MAX_DIMENSION);
  assert.throws(() => assets.optimizeBitmap(Buffer.from('not an image'), 'image/png', { createFromBuffer: () => image }));
  assert.throws(() => assets.optimizeBitmap(png, 'image/png'));
});
test('large or malformed imports do not persist assets', () => fixture((directory) => {
  const source = path.join(directory, 'bad.svg');
  fs.writeFileSync(source, '<svg><script>bad</script></svg>');
  assert.throws(() => assets.importFigure(directory, 'book-1', source));
  assert.equal(fs.existsSync(path.join(directory, 'book-1', 'figures')), false);
  assert.throws(() => assets.importFigure(directory, 'book-1', path.join(directory, 'bad.exe')));
}));
test('cross-book figure copying regenerates asset names and returns normalized metadata without persisting data URLs', () => fixture((directory) => {
  fs.mkdirSync(path.join(directory, 'book-2'));
  const source = path.join(directory, 'source.svg');
  fs.writeFileSync(source, svg);
  const imported = assets.importFigure(directory, 'book-1', source);
  const figure = { ...imported, id: 'fig-copy', caption: 'Caption', alt: 'Alternate text', source: 'Archive',
    license: 'CC BY', attribution: 'Author', dataUrl: 'data:text/html,bad', unknownField: 'discard' };
  const result = assets.copyFigure(directory, 'book-1', 'book-2', figure);
  assert.notEqual(result.file, imported.file);
  assert.match(result.file, /^figure-[a-f0-9-]+\.svg$/);
  assert.equal(result.id, 'fig-copy');
  assert.equal(result.caption, 'Caption');
  assert.equal(result.alt, 'Alternate text');
  assert.equal(result.source, 'Archive');
  assert.equal(result.license, 'CC BY');
  assert.equal(result.attribution, 'Author');
  assert.equal(result.unknownField, undefined);
  assert.equal(result.dataUrl, imported.dataUrl);
  assert.equal(assets.readFigure(directory, 'book-2', result.file), imported.dataUrl);
  assert.equal(fs.readdirSync(path.join(directory, 'book-2', 'figures')).length, 1);
  const sameBook = assets.copyFigure(directory, 'book-1', 'book-1', figure);
  assert.equal(sameBook.file, imported.file);
  assert.equal(fs.readdirSync(path.join(directory, 'book-1', 'figures')).length, 1);
}));
test('PDF figure copies retain original bytes and existing PNG preview without rerasterization', () => asyncFixture(async (directory) => {
  fs.mkdirSync(path.join(directory, 'book-2'));
  const source = path.join(directory, 'source.pdf');
  const pdf = staticPDF();
  fs.writeFileSync(source, pdf);
  const imported = await assets.importFigure(directory, 'book-1', source);
  const figure = { ...imported, id: 'fig-pdf-copy', caption: 'PDF figure' };
  const result = assets.copyFigure(directory, 'book-1', 'book-2', figure);
  assert.notEqual(result.file, imported.file);
  assert.notEqual(result.originalFile, imported.originalFile);
  assert.equal(result.originalMime, 'application/pdf');
  assert.equal(result.mime, 'image/png');
  assert.equal(result.width, imported.width);
  assert.equal(result.height, imported.height);
  assert.equal(result.dataUrl, imported.dataUrl);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'book-2', 'figures', result.originalFile)), pdf);
  assert.equal(assets.readFigure(directory, 'book-2', result.file), imported.dataUrl);
  assert.equal(result.previewPage, 1);
  assert.equal(result.pageCount, 2);
  const same = assets.copyFigure(directory, 'book-1', 'book-1', figure);
  assert.equal(same.originalFile, imported.originalFile);
  assert.equal(same.file, imported.file);
  assert.equal(fs.readdirSync(path.join(directory, 'book-1', 'figures')).length, 2);
}));
test('copy validation rejects traversal, missing sources, symlink targets and unsafe SVG before writing', () => fixture((directory) => {
  fs.mkdirSync(path.join(directory, 'book-2'));
  const source = path.join(directory, 'source.svg');
  fs.writeFileSync(source, svg);
  const imported = assets.importFigure(directory, 'book-1', source);
  const figure = { ...imported, id: 'fig-copy' };
  assert.throws(() => assets.copyFigure(directory, '../book-1', 'book-2', figure), /Invalid/);
  assert.throws(() => assets.copyFigure(directory, 'book-1', '../book-2', figure), /Invalid/);
  assert.throws(() => assets.copyFigure(directory, 'book-1', 'book-2', { ...figure, file: '../source.svg' }), /Invalid/);
  assert.throws(() => assets.copyFigure(directory, 'book-1', 'book-2', { ...figure, originalFile: '../source.pdf' }), /Invalid/);
  assert.throws(() => assets.copyFigure(directory, 'book-1', 'missing-book', figure));
  assert.throws(() => assets.copyFigure(directory, 'book-1', 'book-2', { ...figure, file: 'figure-abc.svg' }));
  fs.symlinkSync(path.resolve(directory, 'book-2'), path.join(directory, 'linked-book'));
  assert.throws(() => assets.copyFigure(directory, 'book-1', 'linked-book', figure), /symbolic link/);
  fs.mkdirSync(path.join(directory, 'outside'));
  fs.symlinkSync(path.resolve(directory, 'outside'), path.join(directory, 'book-2', 'figures'));
  assert.throws(() => assets.copyFigure(directory, 'book-1', 'book-2', figure), /symbolic link/);
  fs.unlinkSync(path.join(directory, 'book-2', 'figures'));
  fs.writeFileSync(path.join(directory, 'book-1', 'figures', imported.file), '<svg onload="x"/>');
  assert.throws(() => assets.copyFigure(directory, 'book-1', 'book-2', figure), /unsafe SVG/);
  assert.equal(fs.existsSync(path.join(directory, 'book-2', 'figures')), false);
  assert.equal(fs.readdirSync(path.join(directory, 'outside')).length, 0);
}));
test('copy refuses malformed original PDF and oversized raster dimensions', () => fixture((directory) => {
  fs.mkdirSync(path.join(directory, 'book-2'));
  fs.mkdirSync(path.join(directory, 'book-1', 'figures'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a17sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(directory, 'book-1', 'figures', 'figure-abc.png'), png);
  fs.writeFileSync(path.join(directory, 'book-1', 'figures', 'figure-abc.pdf'), 'bad PDF');
  const figure = { id: 'fig-copy', file: 'figure-abc.png', originalFile: 'figure-abc.pdf' };
  assert.throws(() => assets.copyFigure(directory, 'book-1', 'book-2', figure), /Invalid PDF/);
  png.writeUInt32BE(50000, 16);
  fs.writeFileSync(path.join(directory, 'book-1', 'figures', 'figure-abc.png'), png);
  assert.throws(() => assets.copyFigure(directory, 'book-1', 'book-2', { ...figure, originalFile: '' }), /dimensions exceed/);
  assert.equal(fs.existsSync(path.join(directory, 'book-2', 'figures')), false);
}));
test('JPEG copying reads bounded dimensions from the stored image rather than untrusted metadata', () => fixture((directory) => {
  fs.mkdirSync(path.join(directory, 'book-2'));
  fs.mkdirSync(path.join(directory, 'book-1', 'figures'));
  const { createCanvas } = require('@napi-rs/canvas');
  const jpeg = createCanvas(3, 2).toBuffer('image/jpeg');
  fs.writeFileSync(path.join(directory, 'book-1', 'figures', 'figure-abc.jpg'), jpeg);
  const result = assets.copyFigure(directory, 'book-1', 'book-2', { id: 'fig-jpeg', file: 'figure-abc.jpg', width: 50000, height: 50000 });
  assert.equal(result.width, 3);
  assert.equal(result.height, 2);
  assert.equal(result.mime, 'image/jpeg');
  assert.deepEqual(fs.readFileSync(path.join(directory, 'book-2', 'figures', result.file)), jpeg);
}));
test('copy detects a source file replaced during reading and a destination book replaced during copying', () => fixture((directory) => {
  fs.mkdirSync(path.join(directory, 'book-2'));
  const source = path.join(directory, 'source.svg');
  fs.writeFileSync(source, svg);
  const imported = assets.importFigure(directory, 'book-1', source);
  const figure = { ...imported, id: 'fig-race' };
  const filename = path.join(directory, 'book-1', 'figures', imported.file);
  const read = fs.readFileSync;
  try {
    let changed = false;
    fs.readFileSync = function (value, ...args) {
      const content = read.call(this, value, ...args);
      if (typeof value === 'number' && !changed) {
        changed = true;
        fs.renameSync(filename, filename + '.previous');
        fs.writeFileSync(filename, svg);
      }
      return content;
    };
    assert.throws(() => assets.copyFigure(directory, 'book-1', 'book-2', figure), /source changed/);
    changed = false;
    fs.readFileSync = function (value, ...args) {
      const content = read.call(this, value, ...args);
      if (typeof value === 'number' && !changed) {
        changed = true;
        fs.renameSync(path.join(directory, 'book-2'), path.join(directory, 'book-2-old'));
        fs.mkdirSync(path.join(directory, 'book-2'));
      }
      return content;
    };
    assert.throws(() => assets.copyFigure(directory, 'book-1', 'book-2', figure), /destination changed/);
  } finally { fs.readFileSync = read; }
  assert.equal(fs.existsSync(path.join(directory, 'book-2', 'figures')), false);
}));
