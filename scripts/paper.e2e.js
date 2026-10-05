// End-to-end tests for papers. NEO runs on a throwaway library; a paper is
// made the way a writer makes one (New Paper on a shelf) and written in with
// real keys: a heading, a sentence, $maths$, a citation picked with @, a
// figure, a table. Then every way out is taken and read back.
// Run with `npm run test:paper`; NEO_SHOTS=<folder> saves a screenshot of
// each step there.

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-paper-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-paper-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const LIB = path.join(tmp, 'NEO Library');
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: 'Ada Lovelace', penNames: [], firstRunDone: true, pageTheme: process.env.NEO_THEME || 'paper',
  shelves: [{ id: 'shelf-1', name: 'Papers', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
// exports land in the test folder, no dialog
const OUT = path.join(tmp, 'out');
fs.mkdirSync(OUT);
dialog.showSaveDialog = async (_w, opts) => ({ canceled: false, filePath: path.join(OUT, path.basename(opts.defaultPath)) });
require('../main.js');

const SHOTS = process.env.NEO_SHOTS || '';
let wc;
let shot = 0;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function snap(name) {
  if (!SHOTS) return;
  await tick(250);
  const img = await wc.capturePage();
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, `${String(++shot).padStart(2, '0')}-${name}.png`), img.toPNG());
}
async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 && !modifiers.some((m) => m === 'meta' || m === 'control')) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(30);
}
async function type(text) {
  for (const k of text) {
    if (k === '\n') {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      wc.sendInputEvent({ type: 'char', keyCode: '\r' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    } else {
      wc.sendInputEvent({ type: 'keyDown', keyCode: k });
      wc.sendInputEvent({ type: 'char', keyCode: k });
      wc.sendInputEvent({ type: 'keyUp', keyCode: k });
    }
    await tick(12);
  }
  await tick(250);
}
const bodyHtml = () => js(`document.querySelector('.chapter-body').innerHTML`);
const saved = async () => {
  await js('flushAllSaves()');
  await tick(400);
  const dir = fs.readdirSync(LIB).find((d) => d.startsWith('book-'));
  const meta = JSON.parse(fs.readFileSync(path.join(LIB, dir, 'book.json'), 'utf8'));
  return { dir: path.join(LIB, dir), meta, html: fs.readFileSync(path.join(LIB, dir, 'chapters', meta.chapterOrder[0] + '.html'), 'utf8') };
};
// the caret at the end of the paper's last paragraph
const caretAtEnd = () => js(`(() => {
  const body = document.querySelector('.chapter-body');
  body.focus();
  const r = document.createRange();
  r.selectNodeContents(body.lastElementChild);
  r.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
})()`);

const BIB = `@article{smith2020neural,
  author = {Smith, Jane and Doe, John and Lee, Ann},
  title = {Neural dynamics of inhibition},
  journal = {Journal of Neuroscience}, year = {2020}, volume = {40}, number = {3}, pages = {100--120},
  doi = {10.1234/jn.2020.1}
}
@book{doe2019brains,
  author = {Doe, John}, title = {Brains and Minds}, publisher = {MIT Press}, year = {2019}
}`;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('New Paper on a shelf makes a paper and opens it on its title page', async () => {
  await js(`createPaperOnShelf(library.shelves[0])`);
  await tick(1500);
  assert.equal(await js('isPaper()'), true);
  assert.equal(await js(`document.activeElement.id`), 'tp-title');
  assert.equal(await js(`document.querySelector('.tab[data-tab="references"]').hidden`), false);
  assert.equal(await js(`document.querySelector('.tab[data-tab="outline"]').hidden`), true);
  assert.match(await bodyHtml(), /<p class="h1" data-id="sec-\w+"[^>]*>Introduction<\/p>/);
  await type('Inhibition in cortical circuits');
  await snap('new-paper');
});

test('the empty abstract shows its six moves; writing it leaves only their names', async () => {
  const shown = () => js(`getComputedStyle(document.querySelector('.tp-abstract-guide')).display`);
  assert.deepEqual(await js(`[...document.querySelectorAll('.tp-abstract-guide b')].map((b) => b.textContent)`),
    ['Status quo', 'Problem', 'Broader solution', 'What we did', 'What we found', 'Implications']);
  assert.equal(await shown(), 'block', 'the scaffold, while the abstract is empty');
  await snap('abstract-empty');
  await js(`document.getElementById('tp-abstract').focus()`);
  await type('Cortex keeps excitation and inhibition in balance.');
  assert.equal(await shown(), 'flex', 'only the names, while writing');
  await snap('abstract-writing');
  await js(`document.getElementById('tp-title').focus()`);
  await tick(100);
  assert.equal(await shown(), 'none', 'gone, once the caret is elsewhere');
  await js(`(() => { const a = document.getElementById('tp-abstract'); a.innerHTML = ''; a.dispatchEvent(new Event('input')); })()`);
});

test('MathJax and citeproc load', async () => {
  for (let i = 0; i < 60 && !(await js('!!(window.MathJax && window.MathJax.tex2svg && window.CSL)')); i++) await tick(200);
  assert.equal(await js('!!(window.MathJax && window.MathJax.tex2svg)'), true);
  assert.equal(await js('!!window.CSL'), true);
  assert.equal(await js('typeof window.module'), 'undefined', 'citeproc leaves no module behind');
});

test('references pasted as BibTeX into the References tab', async () => {
  await js(`switchTab('references')`);
  await tick(200);
  await js(`paperImportText(${JSON.stringify(BIB)}, 'test')`);
  await tick(400);
  assert.equal(await js(`document.querySelectorAll('#references-view .rl-row').length`), 2);
  await snap('references-tab');
  const { dir } = await saved();
  const refs = JSON.parse(fs.readFileSync(path.join(dir, 'references.json'), 'utf8'));
  assert.deepEqual(refs.map((r) => r.id), ['smith2020neural', 'doe2019brains']);
  await js(`switchTab('manuscript')`);
  await tick(200);
});

test('typing: a sentence, $maths$, and a citation picked with @', async () => {
  await caretAtEnd();
  await type('Cortex balances excitation and inhibition $E = I$ as shown by @smi');
  assert.equal(await js(`!!document.querySelector('.paper-picker')`), true, 'the picker opens on @');
  assert.match(await js(`document.querySelector('.paper-picker .pp-row.active .pp-main').textContent`), /Smith et al\. 2020/);
  await snap('picker');
  await key('Enter');
  await tick(500);
  const html = await bodyHtml();
  assert.match(html, /<span class="math" contenteditable="false">E = I<\/span>/);
  assert.match(html, /<span class="cite" contenteditable="false" data-cite="\[\{&quot;id&quot;:&quot;smith2020neural&quot;\}\]">\(Smith et al\., 2020\)<\/span>/);
  assert.equal(await js(`!!document.querySelector('.chapter-body .math').shadowRoot.querySelector('svg')`), true, 'the maths is drawn');
  // a second @ right after joins the citation
  await type(' @doe');
  await key('Enter');
  await tick(500);
  assert.match(await js(`document.querySelector('.chapter-body .cite').textContent`), /^\(Doe, 2019; Smith et al\., 2020\)$/);
  await type('.');
  assert.match(await js(`document.querySelector('#paper-refs').textContent`), /Brains and Minds/);
  await snap('cited');
});

test('# makes a section heading, numbered; Enter after it is body text', async () => {
  await type('\n# Methods\nWe recorded from cortex.');
  const html = await bodyHtml();
  assert.match(html, /<p class="h1" data-id="sec-\w+" data-num="2">Methods<\/p><p>We recorded from cortex\.<\/p>/);
  const { html: disk } = await saved();
  assert.doesNotMatch(disk, /data-num/, 'numbers are never saved');
});

test('$$ on its own line makes a numbered display equation', async () => {
  await type('\n$$\\int_0^1 f(x)\\,dx = 1$$\n');
  await tick(300);
  const html = await bodyHtml();
  assert.match(html, /<p class="eq" contenteditable="false" data-id="eq-\w+" data-num="1">\\int_0\^1 f\(x\)\\,dx = 1<\/p>/);
  await type('Then more.');
});

test('a figure, captioned, and a cross-reference to it with @fig', async () => {
  await caretAtEnd();
  // a small plot, drawn the way a figure is made: an image file
  await js(`(async () => {
    const c = new OffscreenCanvas(480, 240);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 480, 240);
    g.strokeStyle = '#345'; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x <= 440; x += 4) g.lineTo(20 + x, 200 - 150 * Math.exp(-((x - 220) ** 2) / 6000));
    g.stroke();
    g.strokeStyle = '#999'; g.lineWidth = 1; g.strokeRect(20, 20, 440, 180);
    const blob = await c.convertToBlob({ type: 'image/png' });
    await paperAddFigure(new File([blob], 'plot.png', { type: 'image/png' }), document.querySelector('.chapter-body'));
  })()`);
  await tick(500);
  await type('Firing rates across layers');
  await key('Enter');
  await type('As @fig');
  assert.match(await js(`document.querySelector('.paper-picker .pp-row.active .pp-main').textContent`), /Figure 1/);
  await key('Enter');
  await type(' shows.');
  const html = await bodyHtml();
  assert.match(html, /<figure class="fig" contenteditable="false" data-id="(fig-\w+)" data-src="figure-\w+\.png" data-num="1"><img alt="" src="blob:[^"]+"><figcaption contenteditable="true" data-num="1">Firing rates across layers<\/figcaption><\/figure>/);
  assert.match(html, /<span class="xref" contenteditable="false" data-ref="fig-\w+">Figure 1<\/span> shows\./);
  const { dir, html: disk } = await saved();
  assert.doesNotMatch(disk, /blob:/);
  const file = /data-src="(figure-\w+\.png)"/.exec(disk)[1];
  assert.ok(fs.existsSync(path.join(dir, file)));
  await snap('figure');
});

test('a table pasted from a spreadsheet', async () => {
  await caretAtEnd();
  await js(`(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Layer\\tRate (Hz)\\nL2/3\\t4.1\\nL5\\t7.9\\n');
    document.querySelector('.chapter-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  })()`);
  await tick(300);
  await type('Mean firing rate by layer');
  const html = await bodyHtml();
  assert.match(html, /<figure class="tbl" contenteditable="false" data-id="tab-\w+" data-num="1"><figcaption contenteditable="true" data-num="1">Mean firing rate by layer<\/figcaption><table><tr><th contenteditable="true">Layer<\/th><th contenteditable="true">Rate \(Hz\)<\/th><\/tr><tr><td contenteditable="true">L2\/3<\/td>/);
  await snap('table');
});

test('the authors, abstract and keywords on the title page', async () => {
  await js(`(() => {
    paperMeta().authors = [
      { name: 'Ada Lovelace', affiliations: ['University of London'], email: 'ada@example.org', orcid: '0000-0002-1825-0097', corresponding: true },
      { name: 'Charles Babbage', affiliations: ['University of Cambridge'] }
    ];
    paperShowAuthors();
    const abs = document.getElementById('tp-abstract');
    abs.innerHTML = '<p>We ask how cortex stays balanced. We find that it does.</p>';
    abs.dispatchEvent(new Event('input'));
    const kw = document.getElementById('tp-keywords');
    kw.textContent = 'cortex, inhibition, balance';
    kw.dispatchEvent(new Event('input'));
  })()`);
  await tick(300);
  assert.equal(await js(`document.getElementById('tp-authors').textContent`), 'Ada Lovelace1*, Charles Babbage2');
  assert.equal(await js(`validOrcid('0000-0002-1825-0097')`), true);
  assert.equal(await js(`validOrcid('0000-0002-1825-0098')`), false);
  const { meta } = await saved();
  assert.deepEqual(meta.paper.keywords, ['cortex', 'inhibition', 'balance']);
  assert.equal(meta.author, 'Ada Lovelace & Charles Babbage');
  await js(`document.getElementById('paper-scroll').scrollTop = 0`);
  await snap('title-page');
});

test('⌘Z takes back a citation just picked, leaving what was typed', async () => {
  await caretAtEnd();
  await type(' See @doe');
  await key('Enter');
  await tick(400);
  assert.equal(await js(`document.querySelectorAll('.chapter-body .cite').length`), 2);
  await key('z', [process.platform === 'darwin' ? 'meta' : 'control']);
  await tick(600);
  assert.equal(await js(`document.querySelectorAll('.chapter-body .cite').length`), 1);
  assert.match(await js(`document.querySelector('.chapter-body').lastElementChild.textContent`), /See @doe$/);
  // the @ and what followed go, by hand, as a writer would
  await caretAtEnd();
  for (let i = 0; i < ' See @doe'.length; i++) await key('Backspace');
});

test('a citation, clicked, takes a page and can name its authors', async () => {
  await js(`openCitePop(document.querySelector('.chapter-body .cite'))`);
  await tick(200);
  await snap('cite-pop');
  await js(`(() => {
    const loc = document.querySelector('.cite-pop .cp-loc');
    loc.value = 'p. 12';
    loc.dispatchEvent(new Event('change'));
  })()`);
  await tick(500);
  assert.equal(await js(`document.querySelector('.chapter-body .cite').textContent`), '(Doe, 2019; Smith et al., 2020, p. 12)');
  await js(`(() => {
    const box = document.querySelector('.cite-pop .cp-narrative input');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
  })()`);
  await tick(500);
  assert.equal(await js(`document.querySelector('.chapter-body .cite').textContent`), 'Smith et al. (2020, p. 12); Doe (2019)');
  await js(`(() => {
    const box = document.querySelector('.cite-pop .cp-narrative input');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    const loc = document.querySelector('.cite-pop .cp-loc');
    loc.value = '';
    loc.dispatchEvent(new Event('change'));
    closePaperPop();
  })()`);
  await tick(300);
});

test('maths, clicked, opens its TeX with a live preview', async () => {
  await js(`openMathEditor(document.querySelector('.chapter-body .math'))`);
  await tick(200);
  assert.equal(await js(`document.querySelector('.math-pop .mp-src').value`), 'E = I');
  await js(`(() => { const t = document.querySelector('.math-pop .mp-src'); t.value = 'E \\\\approx I'; t.dispatchEvent(new Event('input')); })()`);
  await tick(200);
  assert.equal(await js(`!!document.querySelector('.math-pop .mp-preview svg')`), true);
  await snap('math-editor');
  await key('Enter');
  await tick(300);
  assert.equal(await js(`document.querySelector('.chapter-body .math').textContent`), 'E \\approx I');
});

test('the authors dialog and the pane of sections', async () => {
  await js(`paperEditAuthors()`);
  await tick(200);
  assert.equal(await js(`document.querySelectorAll('.paper-authors .pa-row').length`), 2);
  await snap('authors');
  await js(`document.querySelector('.paper-authors .m-cancel').click()`);
  await js(`document.getElementById('nav-pane').classList.add('open'); renderNav()`);
  await tick(300);
  assert.deepEqual(await js(`[...document.querySelectorAll('#nav-list .paper-sec .n-label')].map((n) => n.textContent)`),
    ['Title and abstract', 'Introduction', 'Methods', 'References']);
  await snap('pane');
  await js(`document.getElementById('nav-pane').classList.remove('open')`);
});

test('a section moved in the pane takes everything under it, and the numbers follow', async () => {
  await js(`paperMoveSection(1, 0)`);
  await tick(400);
  assert.deepEqual(await js(`[...document.querySelectorAll('.chapter-body p.h1')].map((h) => h.dataset.num + ' ' + h.textContent)`), ['1 Methods', '2 Introduction']);
  assert.equal(await js(`document.querySelector('.chapter-body').firstElementChild.nextElementSibling.textContent`), 'We recorded from cortex.');
  assert.equal(await js(`document.querySelector('.chapter-body .xref').textContent`), 'Figure 1');
  await key('z', [process.platform === 'darwin' ? 'meta' : 'control']);
  await tick(600);
  assert.deepEqual(await js(`[...document.querySelectorAll('.chapter-body p.h1')].map((h) => h.textContent)`), ['Introduction', 'Methods'], '⌘Z puts it back');
});

test('a numeric style numbers by first citation', async () => {
  await js(`paperMenu({ command: 'style', value: 'ieee' })`);
  await tick(800);
  assert.equal(await js(`document.querySelector('.chapter-body .cite').textContent`), '[1], [2]');
  assert.match(await js(`document.querySelector('#paper-refs .pr-entry').textContent`), /\[1\]\s*J\. Smith/);
  await js(`paperMenu({ command: 'style', value: 'apa' })`);
  await tick(800);
});

test('every way out', async () => {
  const JSZip = require('jszip');
  for (const format of ['pdf', 'html', 'docx', 'latex', 'pandoc', 'bib']) {
    await js(`paperExport(${JSON.stringify(format)})`);
    await tick(300);
  }
  for (let i = 0; i < 50 && fs.readdirSync(OUT).length < 6; i++) await tick(200);
  const files = fs.readdirSync(OUT).sort();
  assert.deepEqual(files.map((f) => path.extname(f)).sort(), ['.bib', '.docx', '.html', '.pdf', '.zip', '.zip']);
  const html = fs.readFileSync(path.join(OUT, files.find((f) => f.endsWith('.html'))), 'utf8');
  assert.match(html, /<h1 class="title">Inhibition in cortical circuits<\/h1>/);
  assert.match(html, /\(Doe, 2019; Smith et al\., 2020\)/);
  assert.match(html, /<figure id="fig-\w+"><img src="data:image\/png;base64,/);
  assert.match(html, /<div class="eq" id="eq-\w+"><span class="eq-body"><svg/);
  assert.match(html, /Smith, J\., Doe, J\., (&amp;|&#38;) Lee, A\. \(2020\)/);
  const pdf = fs.readFileSync(path.join(OUT, files.find((f) => f.endsWith('.pdf'))));
  assert.equal(pdf.slice(0, 4).toString(), '%PDF');
  const latex = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, files.find((f) => /-latex\.zip$/.test(f)))));
  const tex = await latex.file('paper.tex').async('string');
  assert.match(tex, /\\citep\{doe2019brains,smith2020neural\}|\\citep\{smith2020neural,doe2019brains\}/);
  assert.match(tex, /\\section\{Methods\}\\label\{sec:\w+\}/);
  assert.match(tex, /\\\(E \\approx I\\\)/);
  assert.match(tex, /Figure~\\ref\{fig:\w+\}/);
  assert.match(await latex.file('references.bib').async('string'), /@article\{smith2020neural,/);
  assert.ok(Object.keys(latex.files).some((f) => /^figures\/figure-\w+\.png$/.test(f)));
  const md = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, files.find((f) => /-markdown\.zip$/.test(f)))));
  const text = await md.file('paper.md').async('string');
  assert.match(text, /\[@smith2020neural; @doe2019brains\]|\[@doe2019brains; @smith2020neural\]/);
  assert.match(text, /\{#fig:\w+\}/);
  assert.ok(md.file('apa.csl'));
  const docx = await JSZip.loadAsync(fs.readFileSync(path.join(OUT, files.find((f) => f.endsWith('.docx')))));
  const doc = await docx.file('word/document.xml').async('string');
  assert.match(doc, /Neural dynamics of inhibition/);
  assert.ok(Object.keys(docx.files).filter((f) => f.startsWith('word/media/')).length >= 3, 'the figure and the maths are pictures in Word');
  if (SHOTS) for (const f of files) fs.copyFileSync(path.join(OUT, f), path.join(SHOTS, f));
});

test('the paper reopens as it was left', async () => {
  const { meta } = await saved();
  await js(`backToShelf()`);
  await tick(500);
  await snap('shelf');
  await js(`openBook(${JSON.stringify(meta.id)})`);
  await tick(1500);
  assert.equal(await js(`document.querySelectorAll('#chapters .math, #chapters .eq').length`), 2);
  assert.equal(await js(`[...document.querySelectorAll('#chapters .math, #chapters .eq')].every((n) => n.shadowRoot && n.shadowRoot.querySelector('svg'))`), true);
  assert.match(await js(`document.querySelector('#chapters figure img').src`), /^blob:/);
  assert.equal(await js(`document.querySelector('#chapters .xref').textContent`), 'Figure 1');
  await snap('reopened');
});

test('a paper’s own citation style (style.csl) is used again when it reopens', async () => {
  await js(`(async () => {
    const xml = await window.neo.paperAsset('ieee.csl');
    await window.neo.paperWrite(book.id, 'style.csl', btoa(unescape(encodeURIComponent(xml))));
    paperMeta().style = 'custom';
    paperMeta().customStyleTitle = 'My Journal';
    paper.proc = null;
    await saveMeta();
  })()`);
  const id = await js('book.id');
  await js(`backToShelf()`);
  await tick(400);
  await js(`openBook(${JSON.stringify(id)})`);
  await tick(1500);
  assert.equal(await js(`document.querySelector('#chapters .cite').textContent`), '[1], [2]');
  const { html } = await saved();
  assert.match(html, /<span class="cite"[^>]*>\[1\], \[2\]<\/span>/);
});

app.whenReady().then(async () => {
  for (let i = 0; i < 100 && !BrowserWindow.getAllWindows().length; i++) await tick(50);
  const win = BrowserWindow.getAllWindows()[0];
  wc = win.webContents;
  if (wc.isLoading()) await new Promise((resolve) => wc.once('did-finish-load', resolve));
  win.setSize(1280, 900);
  await tick(800);
  const errors = [];
  wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message); });
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log('ok -', name);
    } catch (err) {
      failed++;
      console.log('not ok -', name, '\n', err && err.stack || err);
      await snap('FAILED-' + name.slice(0, 30).replace(/\W+/g, '-'));
    }
  }
  if (errors.length) console.log('console errors:\n' + errors.join('\n'));
  console.log(failed ? `${failed} of ${tests.length} failed` : `all ${tests.length} passed`);
  app.exit(failed ? 1 : 0);
});
