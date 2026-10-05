'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');
const AcademicMath = require('../academic/academic-math.js');
const JSZip = require('jszip');

const projectRoot = path.join(__dirname, '..');
function outputDirectoryArgument(args) {
  const equalForm = args.find((argument) => argument.startsWith('--output-dir='));
  if (equalForm) return equalForm.slice('--output-dir='.length);
  const index = args.indexOf('--output-dir');
  if (index < 0) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error('--output-dir requires a directory path.');
  }
  return args[index + 1];
}

const outputOverride = outputDirectoryArgument(process.argv.slice(2));
const artifactDir = path.resolve(outputOverride || process.env.NEO_ACADEMIC_SMOKE_DIR ||
  path.join(projectRoot, 'node_modules', '.cache', 'academic-smoke-artifacts'));

const fixturePath = path.join(artifactDir, 'academic-smoke-fixture.html');
const bootstrapPath = path.join(artifactDir, 'academic-smoke-bootstrap.js');
const preloadPath = path.join(artifactDir, 'academic-smoke-preload.js');
const startPath = path.join(artifactDir, 'academic-smoke-start.js');
const isolatedUserData = path.join(artifactDir, 'electron-user-data');
const screenshotPath = path.join(artifactDir, 'academic-smoke.png');
const editorScreenshotPath = path.join(artifactDir, 'academic-editor.png');
const tableDialogScreenshotPath = path.join(artifactDir, 'academic-table-dialog.png');
const htmlPath = path.join(artifactDir, 'academic-smoke-export.html');
const pdfPath = path.join(artifactDir, 'academic-smoke.pdf');
const docxPath = path.join(artifactDir, 'academic-smoke.docx');
const failureHTMLPath = path.join(artifactDir, 'academic-smoke-failure.html');
const failureTracePath = path.join(artifactDir, 'academic-smoke-failure-trace.json');
const windows = [];
const exportedPayloads = [];
const validPreview = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZ8AAAAASUVORK5CYII=';
app.on('window-all-closed', () => {});

const asset = {
  file: 'figure-smoke.png',
  originalFile: 'figure-smoke.pdf',
  originalName: 'smoke-source.pdf',
  mime: 'image/png',
  originalMime: 'application/pdf',
  dataUrl: validPreview,
  width: 1,
  height: 1,
  previewPage: 1,
  pageCount: 2
};

function fileURL(filePath) {
  return pathToFileURL(filePath).href;
}

function pageScripts() {
  const files = [
    'academic/bibtex-parser.js',
    'academic/csl-renderer.js',
    'academic/academic-model.js',
    'academic/references.js',
    'academic/academic-objects.js',
    'academic/academic-review.js',
    'academic/academic-export.js',
    'academic/academic-ui.js',
    'academic/academic-clipboard.js'
  ];
  return files.map((file) => `<script src="${fileURL(path.join(projectRoot, file))}"></script>`).join('\n') +
    `<script src="${fileURL(bootstrapPath)}"></script>` +
    `<script src="${fileURL(path.join(projectRoot, 'academic.js'))}"></script>` +
    `<script src="${fileURL(startPath)}"></script>`;
}

function writeFixture() {
  const original = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const html = original
    .replace('href="styles.css"', `href="${fileURL(path.join(projectRoot, 'styles.css'))}"`)
    .replace(
      /  <script src="i18n\.js"><\/script>[\s\S]*?  <script src="academic\.js"><\/script>/,
      pageScripts()
    );
  if (html === original || /src="app\.js"/.test(html)) {
    throw new Error('Could not replace the root index scripts with the smoke fixture bootstrap.');
  }
  fs.writeFileSync(fixturePath, html);

  fs.writeFileSync(bootstrapPath, `
    window.__smoke = { errors: [], saves: [], payloads: [], toasts: [], insertions: [] };
    window.addEventListener('error', event => window.__smoke.errors.push(event.message));
    const nativeExecCommand = document.execCommand.bind(document);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value(command, showUI, value) {
        let insertion = null;
        if (command === 'insertHTML') {
          const probe = document.createElement('template');
          probe.innerHTML = String(value || '');
          insertion = {
            html: String(value || ''),
            citations: Array.from(probe.content.querySelectorAll('.academic-citation'), node => ({
              html: node.outerHTML,
              className: node.className,
              cites: node.dataset.cites
            }))
          };
          const selection = window.getSelection();
          const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
          const node = range && range.startContainer;
          const element = node && (node.nodeType === 1 ? node : node.parentElement);
          const ancestors = [];
          for (let current = element; current && ancestors.length < 8; current = current.parentElement) {
            ancestors.push({
              tag: current.tagName,
              className: current.className || '',
              contenteditable: current.getAttribute('contenteditable'),
              isContentEditable: current.isContentEditable,
              html: current.outerHTML && current.outerHTML.slice(0, 500)
            });
          }
          const parent = element && element.parentElement;
          const style = element && window.getComputedStyle(element);
          const body = element && element.closest('.chapter-body');
          let bodyChild = element;
          while (bodyChild && bodyChild.parentElement !== body) bodyChild = bodyChild.parentElement;
          const bodyChildren = body ? Array.from(body.childNodes) : [];
          const bodyChildIndex = bodyChildren.indexOf(bodyChild);
          insertion.sourceCaret = range && {
            startType: node.nodeType === 3 ? 'text' : node.tagName,
            startText: node.nodeType === 3 ? node.data : null,
            startOffset: range.startOffset,
            endOffset: range.endOffset,
            collapsed: range.collapsed,
            rangeText: range.toString(),
            targetChapter: element && element.closest('.chapter') && element.closest('.chapter').dataset.id,
            bodyEditable: element && element.closest('.chapter-body') && element.closest('.chapter-body').isContentEditable,
            activeElement: document.activeElement && {
              tag: document.activeElement.tagName,
              className: document.activeElement.className || '',
              contenteditable: document.activeElement.getAttribute('contenteditable')
            },
            parentHTML: parent && parent.outerHTML && parent.outerHTML.slice(0, 1000),
            previousSiblingHTML: parent && parent.previousElementSibling && parent.previousElementSibling.outerHTML.slice(0, 1000),
            precedingBodyHTML: bodyChildIndex >= 0 ? bodyChildren.slice(Math.max(0, bodyChildIndex - 4), bodyChildIndex).map(sibling =>
              sibling.nodeType === 1 ? sibling.outerHTML : sibling.textContent
            ) : [],
            computedStyle: style && {
              display: style.display,
              userSelect: style.userSelect,
              position: style.position
            },
            ancestors
          };
        }
        const result = nativeExecCommand(command, showUI, value);
        if (insertion) {
          const selection = window.getSelection();
          const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
          const selectedNode = range && range.startContainer;
          const selectedElement = selectedNode && (selectedNode.nodeType === 1 ? selectedNode : selectedNode.parentElement);
          const destination = selectedElement && selectedElement.closest('.chapter-body');
          insertion.result = result;
          insertion.targetChapter = destination && destination.closest('.chapter').dataset.id;
          insertion.afterNative = destination ? {
            html: destination.innerHTML,
            markers: Array.from(destination.querySelectorAll('.academic-citation, .academic-xref, [data-academic-id]'), node => node.outerHTML),
            citations: Array.from(destination.querySelectorAll('.academic-citation'), node => ({
              html: node.outerHTML,
              className: node.className,
              cites: node.dataset.cites
            }))
          } : null;
          window.__smoke.insertions.push(insertion);
        }
        return result;
      }
    });
    window.NeoI18n = {
      t(message, values) {
        return values ? Object.entries(values).reduce(
          (text, [key, value]) => text.split('{' + key + '}').join(value),
          message
        ) : message;
      }
    };
    var book = {
      id: 'academic-electron-smoke',
      title: 'Academic smoke manuscript',
      subtitle: '',
      author: 'Smoke Tester',
      chapterOrder: ['chapter-smoke', 'chapter-middle', 'chapter-paste'],
      chapterTitles: {
        'chapter-smoke': 'Before',
        'chapter-middle': 'Introduction',
        'chapter-paste': 'After'
      }
    };
    var currentTab = 'manuscript';
    var chapterHTML = {};
    window.__smoke.structuralEdits = [];
    var saveMeta = () => window.__smoke.saves.push('saveMeta');
    var scheduleMetaSave = () => window.__smoke.saves.push('scheduleMetaSave');
    var scheduleChapterSave = id => window.__smoke.saves.push('chapter:' + id);
    var flushAllSaves = () => {};
    var snapshotStructure = label => window.__smoke.saves.push('snapshot:' + label);
    var captureBody = body => body.innerHTML;
    var syncChapter = (body, id) => {
      chapterHTML[id] = body.innerHTML;
      window.__smoke.saves.push('sync:' + id);
    };
    var captureRevision = (body, before) => window.__smoke.saves.push('revision:' + before);
    var toast = message => window.__smoke.toasts.push(message);
    var switchTab = tab => { currentTab = tab; };
    var focusChapter = () => {};
    document.addEventListener('neo:academic-structural-edit', () => {
      window.__smoke.structuralEdits.push({
        chapters: book.chapterOrder.map(id => ({ id, html: chapterHTML[id] }))
      });
    });
    document.getElementById('bookshelf-view').hidden = true;
    document.getElementById('editor-view').hidden = false;
    document.getElementById('side-pane').classList.add('open');
    document.getElementById('academic-panel').hidden = false;
    const chapter = document.createElement('article');
    chapter.className = 'chapter';
    chapter.dataset.id = 'chapter-smoke';
    const body = document.createElement('div');
    body.className = 'chapter-body';
    body.contentEditable = 'true';
    body.innerHTML = '<p>Before the academic section.</p>';
    chapter.appendChild(body);
    document.getElementById('chapters').appendChild(chapter);
    chapterHTML['chapter-smoke'] = body.innerHTML;
    const middle = document.createElement('article');
    middle.className = 'chapter';
    middle.dataset.id = 'chapter-middle';
    const middleBody = document.createElement('div');
    middleBody.className = 'chapter-body';
    middleBody.contentEditable = 'true';
    middleBody.innerHTML = '<p>Beginning of manuscript. Continue writing here.</p>';
    middle.appendChild(middleBody);
    document.getElementById('chapters').appendChild(middle);
    chapterHTML['chapter-middle'] = middleBody.innerHTML;
    const destination = document.createElement('article');
    destination.className = 'chapter';
    destination.dataset.id = 'chapter-paste';
    const destinationBody = document.createElement('div');
    destinationBody.className = 'chapter-body';
    destinationBody.contentEditable = 'true';
    destinationBody.innerHTML = '<p>After the academic section.</p>';
    destination.appendChild(destinationBody);
    document.getElementById('chapters').appendChild(destination);
    chapterHTML['chapter-paste'] = destinationBody.innerHTML;
  `);

  fs.writeFileSync(preloadPath, `
    const { contextBridge, ipcRenderer } = require('electron');
    contextBridge.exposeInMainWorld('neo', {
      importAcademicFigure: bookId => ipcRenderer.invoke('smoke:figure', bookId),
      readAcademicFigure: (bookId, file) => ipcRenderer.invoke('smoke:read-figure', bookId, file),
      renderAcademicMath: (source, format, display) => ipcRenderer.invoke('smoke:render-math', source, format, display),
      writeAcademicBibliography: (bookId, content) => ipcRenderer.invoke('smoke:write-bibliography', bookId, content),
      exportSave: payload => ipcRenderer.invoke('smoke:export', payload),
      logError: message => ipcRenderer.invoke('smoke:log-error', message)
    });
  `);
  fs.writeFileSync(startPath, `document.dispatchEvent(new Event('neo:book-opened'));\n`);
}

function installIPC() {
  ipcMain.handle('smoke:figure', async (_event, bookId) => {
    if (bookId !== assetBookId) throw new Error('Unexpected figure import book');
    return { ...asset };
  });
  ipcMain.handle('smoke:read-figure', async (_event, bookId, file) => {
    if (bookId !== assetBookId || file !== asset.file) throw new Error('Unexpected figure preview request');
    return validPreview;
  });
  ipcMain.handle('smoke:render-math', async (_event, source, format, display) =>
    AcademicMath.renderServer(source, format, display));
  ipcMain.handle('smoke:write-bibliography', async () => true);
  ipcMain.handle('smoke:export', async (_event, payload) => {
    exportedPayloads.push(payload);
    return '/exports/' + payload.defaultName + '.' + (payload.format === 'pdf' ? 'pdf' : payload.format);
  });
  ipcMain.handle('smoke:log-error', async (_event, message) => {
    console.error('Renderer reported:', message);
  });
}

const assetBookId = 'academic-electron-smoke';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source);
}

async function waitFor(window, expression, description, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(window, expression)) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function submitDialog(window, values) {
  const filled = await evaluate(window, `(() => {
    const form = document.querySelector('.academic-dialog form');
    if (!form) throw new Error('Expected academic dialog');
    const controls = Array.from(form.querySelectorAll('input, textarea, select'));
    if (controls.length !== ${values.length}) throw new Error(
      'Unexpected dialog control count: ' + controls.length + ' in ' + form.querySelector('h2').textContent
    );
    const values = ${JSON.stringify(values)};
    controls.forEach((control, index) => {
      if (control.type === 'checkbox') control.checked = !!values[index];
      else control.value = values[index];
    });
    form.requestSubmit();
    return true;
  })()`);
  if (!filled) throw new Error('Could not submit the academic dialog.');
}

async function addReference(window, key, title, author, year) {
  await evaluate(window, `document.getElementById('academic-add-ref').click()`);
  await waitFor(window, `!!document.querySelector('.academic-dialog form')`, 'reference dialog');
  await submitDialog(window, [key, title, author, String(year), 'Smoke Journal', '', '', '', 'article-journal']);
  await waitFor(window, `!document.querySelector('.academic-dialog') && window.book.metadata.references.some(ref => ref.key === ${JSON.stringify(key)})`,
    `saved reference ${key}`);
}

async function selectCaret(window, text, offset) {
  await evaluate(window, `(() => {
    const body = document.querySelector('[data-id="chapter-middle"] .chapter-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.data.indexOf(${JSON.stringify(text)});
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index + ${offset});
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
        return true;
      }
    }
    throw new Error('Text for caret was not found: ' + ${JSON.stringify(text)});
  })()`);
}

async function addCitation(window, key) {
  await evaluate(window, `document.getElementById('academic-insert-citation').click()`);
  await waitFor(window, `!!document.querySelector('.academic-dialog form')`, 'citation dialog');
  await evaluate(window, `(() => {
    const select = document.querySelector('.academic-dialog select[multiple]');
    if (!select) throw new Error('Expected multi-select citation picker');
    const option = Array.from(select.options).find(item => item.value === ${JSON.stringify(key)});
    if (!option) throw new Error('Citation option was not rendered');
    option.selected = true;
    select.form.requestSubmit();
    return true;
  })()`);
  await waitFor(window, `!document.querySelector('.academic-dialog') &&
    document.querySelector('#chapters .academic-citation[data-cites*=${JSON.stringify(key)}]')`,
  `inserted citation ${key}`);
}

async function ensureRendererHealthy(window) {
  const state = await evaluate(window, `JSON.stringify({
    errors: window.__smoke.errors,
    toasts: window.__smoke.toasts,
    text: document.querySelector('#chapters').textContent
  })`);
  const parsed = JSON.parse(state);
  if (parsed.errors.length || parsed.toasts.some((message) => /^Academic writing:/.test(message))) {
    throw new Error('Renderer error(s): ' + JSON.stringify(parsed));
  }
}

async function exerciseManuscript(window) {
  await waitFor(window, `!!document.querySelector('#chapters .chapter-body')`, 'manuscript chapter');
  await addReference(window, 'ada2020', 'A Study of Careful Writing', 'Ada Example', 2020);
  await addReference(window, 'grace2022', 'A Second Smoke Reference', 'Grace Writer', 2022);

  await selectCaret(window, 'Continue writing here.', 0);
  await addCitation(window, 'ada2020');
  await selectCaret(window, 'Continue writing here.', 0);
  await addCitation(window, 'grace2022');
  const citationState = await evaluate(window, `JSON.stringify({
    citations: Array.from(document.querySelectorAll('#chapters .academic-citation'), node => ({
      ids: JSON.parse(node.dataset.cites), text: node.textContent
    })),
    activeInEditor: !!document.activeElement.closest('.chapter-body')
  })`);
  const citations = JSON.parse(citationState);
  if (citations.citations.length !== 2) throw new Error('Two citations were not inserted through the toolbar.');
  if (!citations.activeInEditor) throw new Error('The caret did not return to the manuscript after modal insertion.');

  await selectCaret(window, 'Continue writing here.', 0);
  await evaluate(window, `document.getElementById('academic-insert-figure').click()`);
  await waitFor(window, `!!document.querySelector('.academic-dialog form')`, 'figure details dialog');
  await submitDialog(window, ['Smoke PDF preview', 'Rendered first page from the PDF', 'Source document', 'CC BY', 'Smoke author']);
  await waitFor(window, `!!document.querySelector('#chapters .academic-figure img')`, 'inserted PDF preview');
  const figureState = JSON.parse(await evaluate(window, `JSON.stringify({
    figure: window.book.metadata.figures[0],
    src: document.querySelector('#chapters .academic-figure img').getAttribute('src')
  })`));
  if (figureState.figure.originalFile !== asset.originalFile || figureState.figure.file !== asset.file) {
    throw new Error('The original PDF was not retained with its PNG preview metadata.');
  }
  if (figureState.src !== validPreview) throw new Error('The PDF preview image was not inserted into the manuscript.');

  await selectCaret(window, 'Continue writing here.', 0);
  await evaluate(window, `document.getElementById('academic-insert-table').click()`);
  await waitFor(window, `!!document.querySelector('.academic-dialog form')`, 'table editor dialog');
  const grid = JSON.parse(await evaluate(window, `(() => {
    const form = document.querySelector('.academic-dialog form');
    const controls = Array.from(form.querySelectorAll('input, textarea, select'));
    controls[0].value = 'Smoke table';
    controls[1].value = '2';
    controls[1].dispatchEvent(new Event('input', { bubbles: true }));
    controls[2].value = '2';
    controls[2].dispatchEvent(new Event('input', { bubbles: true }));
    const cells = Array.from(form.querySelectorAll('.academic-table-editor input'));
    cells.forEach((cell, index) => {
      cell.value = 'R' + Math.floor(index / 2 + 1) + 'C' + (index % 2 + 1);
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return JSON.stringify({ count: cells.length, csv: controls[3].value });
  })()`));
  if (grid.count !== 4 || !grid.csv.includes('R2C2')) throw new Error('The live table grid did not update CSV contents.');
  await delay(100);
  fs.writeFileSync(tableDialogScreenshotPath, (await window.webContents.capturePage()).toPNG());
  await evaluate(window, `document.querySelector('.academic-dialog form').requestSubmit()`);
  await waitFor(window, `!!document.querySelector('#chapters .academic-table')`, 'inserted table');

  await selectCaret(window, 'Continue writing here.', 0);
  await evaluate(window, `document.getElementById('academic-insert-equation').click()`);
  await waitFor(window, `!!document.querySelector('.academic-dialog form')`, 'equation editor dialog');
  await evaluate(window, `(() => {
    const form = document.querySelector('.academic-dialog form');
    const controls = Array.from(form.querySelectorAll('input, textarea, select'));
    controls[0].value = '\\\\frac{a}{b}';
    controls[0].dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(window, `!!document.querySelector('.academic-dialog .academic-math-preview svg')`, 'real MathJax preview', 15000);
  await evaluate(window, `document.querySelector('.academic-dialog form').requestSubmit()`);
  await waitFor(window, `!!document.querySelector('#chapters .academic-equation svg')`, 'inserted rendered equation', 15000);

  await selectCaret(window, 'Continue writing here.', 0);
  await evaluate(window, `document.getElementById('academic-insert-xref').click()`);
  await waitFor(window, `!!document.querySelector('.academic-dialog form')`, 'cross-reference picker');
  await evaluate(window, `(() => {
    const select = document.querySelector('.academic-dialog select');
    const option = Array.from(select.options).find(item => item.textContent.includes('Smoke table'));
    if (!option) throw new Error('Table target missing from cross-reference choices');
    select.value = option.value;
    select.form.requestSubmit();
    return true;
  })()`);
  try {
    await waitFor(window, `!!document.querySelector('#chapters .academic-xref')`, 'inserted cross-reference');
  } catch (error) {
    const state = await evaluate(window, `JSON.stringify({
      chapters: Array.from(document.querySelectorAll('#chapters > .chapter'), chapter => ({
        id: chapter.dataset.id,
        htmlLength: chapter.querySelector('.chapter-body').innerHTML.length,
        markers: Array.from(chapter.querySelectorAll('.academic-citation, .academic-xref'), node => node.outerHTML),
        objects: Array.from(chapter.querySelectorAll('[data-academic-id]'), node => node.className)
      })),
      latestInsertion: (() => {
        const insertion = window.__smoke.insertions.at(-1);
        const probe = document.createElement('template');
        if (insertion) probe.innerHTML = insertion.html;
        return insertion && {
          htmlLength: insertion.html.length,
          targetChapter: insertion.targetChapter,
          sourceCaret: insertion.sourceCaret,
          inputMarkers: Array.from(probe.content.querySelectorAll('.academic-citation, .academic-xref, [data-academic-id]'), node => node.outerHTML),
          result: insertion.result,
          afterNative: insertion.afterNative && {
            htmlLength: insertion.afterNative.html.length,
            markers: insertion.afterNative.markers
          }
        };
      })(),
      errors: window.__smoke.errors,
      toasts: window.__smoke.toasts
    })`);
    throw new Error(`${error.message}: ${state}`);
  }

  await evaluate(window, `window.NeoAcademic.refresh()`);
  const details = JSON.parse(await evaluate(window, `JSON.stringify({
    citations: document.querySelectorAll('#chapters .academic-citation').length,
    figures: document.querySelectorAll('#chapters .academic-figure').length,
    tables: document.querySelectorAll('#chapters .academic-table').length,
    equations: document.querySelectorAll('#chapters .academic-equation').length,
    diagnostics: document.getElementById('academic-diagnostics').textContent,
    xref: document.querySelector('#chapters .academic-xref').textContent,
    equationSVG: !!document.querySelector('#chapters .academic-equation svg')
  })`));
  if (details.citations !== 2 || details.figures !== 1 || details.tables !== 1 || details.equations !== 1) {
    throw new Error('Unexpected rendered manuscript object counts: ' + JSON.stringify(details));
  }
  if (!details.equationSVG || !/Table 1/.test(details.xref)) throw new Error('Math or cross-reference rendering did not reconcile.');

  const original = JSON.parse(await evaluate(window, `JSON.stringify((() => {
    const source = document.querySelector('[data-id="chapter-middle"] .chapter-body');
    return {
      ids: Array.from(source.querySelectorAll('[data-academic-id]'), node => ({
        kind: ['figure', 'table', 'equation'].find(kind => node.classList.contains('academic-' + kind)),
        id: node.dataset.academicId
      })),
      cites: Array.from(source.querySelectorAll('.academic-citation'), node => JSON.parse(node.dataset.cites)),
      xref: source.querySelector('.academic-xref').dataset.target
    };
  })())`));
  const copyTransfer = JSON.parse(await evaluate(window, `(() => {
    const source = document.querySelector('[data-id="chapter-middle"] .chapter-body');
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const clipboard = {};
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      setData(type, value) { clipboard[type] = value; },
      getData(type) { return clipboard[type] || ''; }
    } });
    source.dispatchEvent(event);
    return JSON.stringify({ prevented: event.defaultPrevented, payload: clipboard[window.NeoAcademicClipboard.MIME] });
  })()`));
  if (!copyTransfer.prevented || !copyTransfer.payload) throw new Error('Copy did not create an academic clipboard transfer.');

  await evaluate(window, `document.querySelector('[data-id="chapter-paste"] .chapter-body').innerHTML = '<p>Paste destination.</p>'`);
  const pasteCopy = JSON.parse(await evaluate(window, `(() => {
    const body = document.querySelector('[data-id="chapter-paste"] .chapter-body');
    const range = document.createRange();
    range.setStart(body, body.childNodes.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      getData(type) { return type === window.NeoAcademicClipboard.MIME ? ${JSON.stringify(copyTransfer.payload)} : ''; }
    } });
    return JSON.stringify({ consumed: window.NeoAcademic.handlePaste(event, body), prevented: event.defaultPrevented });
  })()`));
  if (!pasteCopy.consumed || !pasteCopy.prevented) throw new Error('Academic copy paste was not consumed.');
  try {
    await waitFor(window, `(() => {
    const body = document.querySelector('[data-id="chapter-paste"] .chapter-body');
    return body.querySelectorAll('.academic-figure').length === 1 &&
      body.querySelectorAll('.academic-table').length === 1 &&
      body.querySelectorAll('.academic-equation').length === 1 &&
      body.querySelectorAll('.academic-citation').length === 2 &&
      Array.from(body.querySelectorAll('.academic-citation')).every(node => node.getAttribute('contenteditable') === 'false');
    })()`, 'copied academic content');
  } catch (error) {
    const state = await evaluate(window, `JSON.stringify({
      destinationCounts: {
        figures: document.querySelectorAll('[data-id="chapter-paste"] .academic-figure').length,
        tables: document.querySelectorAll('[data-id="chapter-paste"] .academic-table').length,
        equations: document.querySelectorAll('[data-id="chapter-paste"] .academic-equation').length,
        citations: document.querySelectorAll('[data-id="chapter-paste"] .academic-citation').length,
        citationHTML: Array.from(document.querySelectorAll('[data-id="chapter-paste"] .academic-citation'), node => node.outerHTML),
        xrefs: document.querySelectorAll('[data-id="chapter-paste"] .academic-xref').length
      },
      models: {
        figures: window.book.metadata.figures.map(item => item.id),
        tables: window.book.metadata.tables.map(item => item.id),
        equations: window.book.metadata.equations.map(item => item.id)
      },
      latestInsertion: (() => {
        const insertion = window.__smoke.insertions.at(-1);
        return insertion && {
          htmlLength: insertion.html.length,
          citations: insertion.citations,
          result: insertion.result,
          afterNative: insertion.afterNative && {
            htmlLength: insertion.afterNative.html.length,
            citations: insertion.afterNative.citations
          }
        };
      })(),
      destinationHTML: (() => {
        const body = document.querySelector('[data-id="chapter-paste"] .chapter-body');
        return {
          htmlLength: body.innerHTML.length,
          citations: Array.from(body.querySelectorAll('.academic-citation'), node => node.outerHTML),
          classes: Array.from(body.querySelectorAll('[class]'), node => node.className)
        };
      })(),
      errors: window.__smoke.errors,
      toasts: window.__smoke.toasts
    })`);
    throw new Error(`${error.message}: ${state}`);
  }
  const copied = JSON.parse(await evaluate(window, `JSON.stringify((() => {
    const body = document.querySelector('[data-id="chapter-paste"] .chapter-body');
    return {
      ids: Array.from(body.querySelectorAll('[data-academic-id]'), node => ({
        kind: ['figure', 'table', 'equation'].find(kind => node.classList.contains('academic-' + kind)),
        id: node.dataset.academicId
      })),
      cites: Array.from(body.querySelectorAll('.academic-citation'), node => JSON.parse(node.dataset.cites)),
      xref: body.querySelector('.academic-xref').dataset.target
    };
  })())`));
  for (const entry of original.ids) {
    const copiedEntry = copied.ids.find((candidate) => candidate.kind === entry.kind);
    if (!copiedEntry || copiedEntry.id === entry.id) throw new Error(`Copy did not assign a new ${entry.kind} ID.`);
  }
  const copiedTable = copied.ids.find((entry) => entry.kind === 'table');
  if (copied.xref !== copiedTable.id) throw new Error('Copied cross-reference did not target the copied table.');
  if (JSON.stringify(copied.cites) !== JSON.stringify(original.cites)) throw new Error('Copy did not preserve citation links.');

  const beforeCut = JSON.parse(await evaluate(window, `JSON.stringify({
    chapterCount: document.querySelectorAll('#chapters > .chapter').length,
    structuralEdits: window.__smoke.structuralEdits.length,
    objectIds: Array.from(document.querySelectorAll('#chapters [data-academic-id]'), node => node.dataset.academicId),
    destinationCounts: {
      objects: document.querySelectorAll('[data-id="chapter-paste"] [data-academic-id]').length,
      citations: document.querySelectorAll('[data-id="chapter-paste"] .academic-citation').length
    },
    recentInsertions: window.__smoke.insertions.slice(-2).map(insertion => ({
      result: insertion.result,
      targetChapter: insertion.targetChapter,
      inputHtmlLength: insertion.html.length,
      citations: insertion.citations,
      sourceCaret: insertion.sourceCaret,
      afterNative: insertion.afterNative && {
        htmlLength: insertion.afterNative.html.length,
        markers: insertion.afterNative.markers,
        citations: insertion.afterNative.citations
      }
    }))
  })`));
  if (beforeCut.chapterCount !== 3 || beforeCut.objectIds.length !== 6) {
    throw new Error(`Expected three chapter containers and original plus copied academic objects before cut: ${JSON.stringify(beforeCut)}`);
  }

  const cutTransfer = JSON.parse(await evaluate(window, `(() => {
    const first = document.querySelector('[data-id="chapter-smoke"] .chapter-body');
    const last = document.querySelector('[data-id="chapter-paste"] .chapter-body');
    const start = first.querySelector('p').firstChild;
    const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
    let end;
    while (walker.nextNode()) end = walker.currentNode;
    const range = document.createRange();
    range.setStart(start, 0);
    if (end) range.setEnd(end, end.data.length);
    else range.setEnd(last, last.childNodes.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    const clipboard = {};
    const event = new Event('cut', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      setData(type, value) { clipboard[type] = value; },
      getData(type) { return clipboard[type] || ''; }
    } });
    first.dispatchEvent(event);
    const middle = document.querySelector('[data-id="chapter-middle"] .chapter-body');
    return JSON.stringify({
      prevented: event.defaultPrevented,
      payload: clipboard[window.NeoAcademicClipboard.MIME],
      chapterCount: document.querySelectorAll('#chapters > .chapter').length,
      chapterIds: Array.from(document.querySelectorAll('#chapters > .chapter'), node => node.dataset.id),
      middleHTML: middle.innerHTML,
      middleSavedHTML: chapterHTML['chapter-middle'],
      remainingMarkers: document.querySelectorAll('#chapters .academic-citation, #chapters .academic-xref, #chapters [data-academic-id]').length,
      structuralEdits: window.__smoke.structuralEdits.slice(-1)[0]
    });
  })()`));
  if (!cutTransfer.prevented || !cutTransfer.payload) throw new Error('Cross-chapter cut did not create an academic clipboard transfer.');
  if (cutTransfer.chapterCount !== 3 || JSON.stringify(cutTransfer.chapterIds) !== JSON.stringify(['chapter-smoke', 'chapter-middle', 'chapter-paste'])) {
    throw new Error('Cross-chapter cut detached or reordered a chapter container.');
  }
  if (cutTransfer.middleHTML !== '<p><br></p>' || cutTransfer.middleSavedHTML !== '<p><br></p>') {
    throw new Error(`The fully selected middle chapter was not persisted as an empty placeholder: ${JSON.stringify(cutTransfer)}`);
  }
  if (cutTransfer.remainingMarkers !== 0) throw new Error('Cut left academic markers in the manuscript.');
  if (!cutTransfer.structuralEdits ||
      cutTransfer.structuralEdits.chapters.find((chapter) => chapter.id === 'chapter-middle')?.html !== '<p><br></p>' ||
      beforeCut.structuralEdits + 1 !== (await evaluate(window, 'window.__smoke.structuralEdits.length'))) {
    throw new Error('The cut did not publish a native structural snapshot after syncing all chapters.');
  }
  await evaluate(window, `(() => {
    const middle = document.querySelector('[data-id="chapter-middle"] .chapter-body');
    middle.innerHTML = window.chapterHTML['chapter-middle'];
  })()`);
  const persistedMiddle = JSON.parse(await evaluate(window, `JSON.stringify({
    html: document.querySelector('[data-id="chapter-middle"] .chapter-body').innerHTML,
    markers: document.querySelector('[data-id="chapter-middle"] .chapter-body').querySelectorAll('.academic-citation, .academic-xref, [data-academic-id]').length,
    chapterCount: document.querySelectorAll('#chapters > .chapter').length
  })`));
  if (persistedMiddle.html !== '<p><br></p>' || persistedMiddle.markers !== 0 || persistedMiddle.chapterCount !== 3) {
    throw new Error('The empty middle chapter reappeared after restoring saved chapter HTML.');
  }

  const pastedTwice = JSON.parse(await evaluate(window, `(() => {
    const body = document.querySelector('[data-id="chapter-smoke"] .chapter-body');
    const range = document.createRange();
    range.setStart(body, body.childNodes.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    const makePaste = () => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: {
        getData(type) { return type === window.NeoAcademicClipboard.MIME ? ${JSON.stringify(cutTransfer.payload)} : ''; }
      } });
      return { consumed: window.NeoAcademic.handlePaste(event, body), prevented: event.defaultPrevented };
    };
    return JSON.stringify([makePaste(), makePaste()]);
  })()`));
  if (pastedTwice.some((result) => !result.consumed || !result.prevented)) {
    throw new Error('Repeated cut-payload paste was not consumed by the academic handler.');
  }
  await waitFor(window, `(() => {
    const body = document.querySelector('[data-id="chapter-smoke"] .chapter-body');
    return body.querySelectorAll('[data-academic-id]').length === 12 &&
      body.querySelectorAll('.academic-citation').length === 8 &&
      Array.from(body.querySelectorAll('.academic-citation')).every(node => node.getAttribute('contenteditable') === 'false') &&
      body.querySelectorAll('.academic-xref').length === 4;
  })()`, 'serialized overlapping clipboard pastes');
  const repeatedPaste = JSON.parse(await evaluate(window, `JSON.stringify((() => {
    const body = document.querySelector('[data-id="chapter-smoke"] .chapter-body');
    const ids = Array.from(body.querySelectorAll('[data-academic-id]'), node => node.dataset.academicId);
    const tables = new Set(Array.from(body.querySelectorAll('.academic-table'), node => node.dataset.academicId));
    const cites = Array.from(body.querySelectorAll('.academic-citation'), node => JSON.parse(node.dataset.cites));
    const citationsAtomic = Array.from(body.querySelectorAll('.academic-citation'), node => node.getAttribute('contenteditable') === 'false').every(Boolean);
    const refs = new Set(window.book.metadata.references.flatMap(ref => [ref.id, ref.key]));
    const validCitationLinks = cites.every(ids => ids.every(id => refs.has(id)));
    const xrefs = Array.from(body.querySelectorAll('.academic-xref'), node => node.dataset.target);
    return {
      ids,
      uniqueIds: new Set(ids).size,
      tables: Array.from(tables),
      xrefs,
      validXrefs: xrefs.every(id => tables.has(id)),
      citationsAtomic,
      validCitationLinks
    };
  })())`));
  if (repeatedPaste.uniqueIds !== 12) throw new Error('Overlapping pastes created duplicate academic object IDs.');
  for (const id of beforeCut.objectIds) {
    if (!repeatedPaste.ids.includes(id)) throw new Error(`The first cut-paste lost original object ID ${id}.`);
  }
  if (!repeatedPaste.validXrefs || !repeatedPaste.validCitationLinks || !repeatedPaste.citationsAtomic) {
    throw new Error('Repeated paste did not preserve/remap cross-reference and citation links.');
  }
  const middleAfterPastes = JSON.parse(await evaluate(window, `JSON.stringify({
    html: document.querySelector('[data-id="chapter-middle"] .chapter-body').innerHTML,
    saved: chapterHTML['chapter-middle'],
    chapters: document.querySelectorAll('#chapters > .chapter').length
  })`));
  if (middleAfterPastes.html !== '<p><br></p>' || middleAfterPastes.saved !== '<p><br></p>' || middleAfterPastes.chapters !== 3) {
    throw new Error('Paste into the first chapter resurrected the cut middle chapter.');
  }
  const pendingDialog = await evaluate(window, `!!document.querySelector('.academic-dialog')`);
  if (pendingDialog) throw new Error('An academic modal remained open after the manuscript workflow.');
  await delay(100);
  fs.writeFileSync(editorScreenshotPath, (await window.webContents.capturePage()).toPNG());
  await ensureRendererHealthy(window);
}

async function verifyHTMLAndPDF(window) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const payload = await evaluate(window, `window.NeoAcademic.payload('pdf')`);
  if (payload.format !== 'pdf' || typeof payload.content !== 'string') throw new Error('Academic PDF HTML payload was not built.');
  fs.writeFileSync(htmlPath, payload.content);

  const printWindow = new BrowserWindow({
    width: 900,
    height: 1100,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  windows.push(printWindow);
  await printWindow.loadFile(htmlPath);
  await printWindow.webContents.executeJavaScript('document.fonts.ready');
  await printWindow.webContents.executeJavaScript(
    'Promise.all(Array.from(document.images, image => image.decode().catch(() => {})))'
  );
  await delay(150);
  fs.writeFileSync(screenshotPath, (await printWindow.webContents.capturePage()).toPNG());
  const pageState = JSON.parse(await evaluate(printWindow, `JSON.stringify({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    text: document.body.innerText
  })`));
  if (pageState.width > pageState.viewport + 1) throw new Error(`Export page overflows horizontally: ${pageState.width}/${pageState.viewport}`);
  for (const marker of ['Academic smoke manuscript', 'Smoke PDF preview', 'Smoke table', 'Example']) {
    if (!pageState.text.includes(marker)) throw new Error(`Academic export is missing ${JSON.stringify(marker)}.`);
  }

  const pdf = await printWindow.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
  });
  fs.writeFileSync(pdfPath, pdf);
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Chromium did not produce a PDF document.');
  const loaded = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableWorker: true }).promise;
  const textParts = [];
  let imageOps = 0;
  for (let pageNumber = 1; pageNumber <= loaded.numPages; pageNumber += 1) {
    const page = await loaded.getPage(pageNumber);
    const text = await page.getTextContent();
    textParts.push(...text.items.map((item) => item.str));
    const operators = await page.getOperatorList();
    imageOps += operators.fnArray.filter((op) => [
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintImageMaskXObject,
      pdfjs.OPS.paintImageMaskXObjectGroup
    ].includes(op)).length;
  }
  const pdfText = textParts.join(' ');
  if (!pdfText.includes('Academic smoke manuscript') || !pdfText.includes('Smoke table')) {
    throw new Error('Chromium PDF text extraction did not contain manuscript content.');
  }
  if (imageOps < 1) throw new Error(`Expected the inserted figure in PDF resources; found ${imageOps} image operators.`);
  return { pages: loaded.numPages, imageOps, exportHtmlBytes: Buffer.byteLength(payload.content) };
}

async function verifyDOCX(window) {
  const payload = await evaluate(window, `window.NeoAcademic.payload('docx')`);
  if (payload.format !== 'docx' || !Array.isArray(payload.zipEntries)) throw new Error('Academic DOCX payload was not built.');
  const archive = new JSZip();
  for (const entry of payload.zipEntries) archive.file(entry.path, entry.content);
  const bytes = await archive.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(docxPath, bytes);
  const docx = await JSZip.loadAsync(bytes);
  for (const name of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml']) {
    if (!docx.file(name)) throw new Error(`DOCX export is missing ${name}.`);
  }
  const xml = await docx.file('word/document.xml').async('string');
  for (const marker of ['Academic smoke manuscript', 'Smoke table', 'Smoke PDF preview']) {
    if (!xml.includes(marker)) throw new Error(`DOCX document XML is missing ${JSON.stringify(marker)}.`);
  }
  if (!Object.keys(docx.files).some((name) => name.startsWith('word/media/'))) {
    throw new Error('DOCX export did not include the inserted figure media.');
  }
  return { bytes: bytes.length, entries: Object.keys(docx.files).length };
}

async function cleanup() {
  for (const window of windows) {
    if (!window.isDestroyed()) window.destroy();
  }
  await delay(500);
  for (const file of [fixturePath, bootstrapPath, preloadPath, startPath]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  if (fs.existsSync(isolatedUserData)) fs.rmSync(isolatedUserData, { recursive: true, force: true });
}

async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });
  if (fs.existsSync(isolatedUserData)) fs.rmSync(isolatedUserData, { recursive: true, force: true });
  app.setPath('userData', isolatedUserData);
  installIPC();
  writeFixture();

  await app.whenReady();
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath
    }
  });
  windows.push(window);
  window.webContents.on('console-message', ({ level, message }) => {
    if (level >= 2) console.error('Renderer console:', message);
  });
  window.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('Fixture load failed:', code, description);
  });
  await window.loadFile(fixturePath);
  await waitFor(window, `!!window.NeoAcademic && window.book && !!document.querySelector('#chapters .chapter-body')`,
    'academic application initialization');
  await exerciseManuscript(window);
  const pdf = await verifyHTMLAndPDF(window);
  const docx = await verifyDOCX(window);
  await ensureRendererHealthy(window);
  console.log(JSON.stringify({
    status: 'passed',
    screenshots: { editor: editorScreenshotPath, tableDialog: tableDialogScreenshotPath, export: screenshotPath },
    htmlPath,
    pdfPath,
    docxPath,
    pdf,
    docx
  }, null, 2));
  await cleanup();
  app.exit(0);
}

main().catch(async (error) => {
  console.error(error && error.stack || error);
  try {
    if (windows[0] && !windows[0].isDestroyed()) {
      const failureHTML = await windows[0].webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('#chapters > .chapter')).map(chapter =>
          '<!-- ' + chapter.dataset.id + ' -->' + chapter.querySelector('.chapter-body').innerHTML
        ).join('\\n')`
      );
      if (failureHTML) fs.writeFileSync(failureHTMLPath, failureHTML);
      const failureTrace = await windows[0].webContents.executeJavaScript(`JSON.stringify({
        insertions: window.__smoke.insertions,
        chapters: Array.from(document.querySelectorAll('#chapters > .chapter'), chapter => ({
          id: chapter.dataset.id,
          html: chapter.querySelector('.chapter-body').innerHTML
        }))
      })`);
      fs.writeFileSync(failureTracePath, failureTrace);
      const image = await windows[0].webContents.capturePage();
      if (image) {
        fs.writeFileSync(editorScreenshotPath, image.toPNG());
      }
    }
  } catch (_) {
  } finally {
    await cleanup();
    app.exit(1);
  }
});
