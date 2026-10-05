'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, Menu } = require('electron');

const projectRoot = path.join(__dirname, '..');
function outputDirectory() {
  const args = process.argv.slice(2);
  let fromArguments = null;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--output-dir') {
      if (!args[index + 1]) throw new Error('--output-dir requires a path.');
      fromArguments = args[++index];
    } else if (args[index].startsWith('--output-dir=')) {
      fromArguments = args[index].slice('--output-dir='.length);
      if (!fromArguments) throw new Error('--output-dir requires a path.');
    }
  }
  const selected = fromArguments || process.env.NEO_ACADEMIC_SMOKE_DIR ||
    path.join(os.homedir(), '.cache', 'neo-academic-app-smoke');
  const resolved = path.resolve(selected);
  fs.mkdirSync(resolved, { recursive: true });
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`Smoke output path is not a directory: ${resolved}`);
  return resolved;
}
const artifactDir = outputDirectory();

const isolationRoot = path.resolve(fs.mkdtempSync(path.join(artifactDir, 'academic-app-smoke-isolated-')));
const ownershipMarker = path.join(isolationRoot, '.academic-app-smoke-owner');
const userDataPath = path.join(isolationRoot, 'user-data');
const documentsPath = path.join(isolationRoot, 'documents');
const libraryPath = path.join(documentsPath, 'NEO Library');
const screenshotPath = path.join(artifactDir, 'academic-app-smoke.png');
const preferenceWrites = [];
const externalOpenAttempts = [];
const rendererErrors = [];
let createdIsolation = true;
let mainWindow = null;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, description, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await delay(50);
  }
  fail(`Timed out waiting for ${description}.`);
}

function safeRemoveIsolation() {
  if (createdIsolation && fs.existsSync(ownershipMarker) &&
      fs.readFileSync(ownershipMarker, 'utf8') === String(process.pid)) {
    fs.rmSync(isolationRoot, { recursive: true, force: true });
    createdIsolation = false;
  }
}

function schedulePostExitCleanup() {
  const nodePath = (process.env.PATH || '').split(path.delimiter)
    .map((directory) => path.join(directory, 'node'))
    .find((candidate) => {
      try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
    });
  if (!nodePath || !fs.existsSync(ownershipMarker)) return;
  const cleanup = `
    const fs = require('node:fs');
    const root = process.argv[1];
    const marker = root + '/.academic-app-smoke-owner';
    const owner = process.argv[2];
    const parent = Number(process.argv[3]);
    const waitForExit = () => {
      try { process.kill(parent, 0); setTimeout(waitForExit, 40); return; }
      catch (error) { if (error.code !== 'ESRCH') { setTimeout(waitForExit, 100); return; } }
      try {
        if (fs.readFileSync(marker, 'utf8') === owner) fs.rmSync(root, { recursive: true, force: true });
      } catch {}
    };
    waitForExit();
  `;
  const child = spawn(nodePath, ['-e', cleanup, isolationRoot, String(process.pid), String(process.pid)], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

function instrumentWindow(window) {
  mainWindow = window;
  window.webContents.on('console-message', (event) => {
    if (Number(event.level) >= 3) rendererErrors.push(String(event.message));
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererErrors.push('Renderer process exited: ' + JSON.stringify(details));
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    rendererErrors.push(`Page load failed (${code}): ${description} (${url})`);
  });
  window.webContents.on('did-finish-load', () => {
    window.webContents.executeJavaScript(`
      (() => {
        window.__academicAppSmokeErrors = [];
        window.addEventListener('error', event => window.__academicAppSmokeErrors.push(event.message));
        window.addEventListener('unhandledrejection', event =>
          window.__academicAppSmokeErrors.push(String(event.reason && event.reason.stack || event.reason))
        );
      })()
    `).catch((error) => rendererErrors.push('Could not install page error listener: ' + error.message));
  });
}

function configureIsolationBeforeMain() {
  fs.writeFileSync(ownershipMarker, String(process.pid));
  fs.mkdirSync(userDataPath);
  fs.mkdirSync(documentsPath);
  fs.mkdirSync(libraryPath);

  app.setPath('userData', userDataPath);
  app.setPath('documents', documentsPath);
  assert(path.resolve(app.getPath('userData')) === path.resolve(userDataPath),
    'Electron userData path did not accept the isolated directory.');
  assert(path.resolve(app.getPath('documents')) === path.resolve(documentsPath),
    'Electron documents path did not accept the isolated directory.');

  const settingsFile = path.join(userDataPath, 'settings.json');
  assert(!fs.existsSync(settingsFile), 'Isolated app settings unexpectedly exist before startup.');

  const fixtureLibrary = {
    authorName: 'Smoke Tester',
    authors: [{ id: 'smoke-author', name: 'Smoke Tester' }],
    currentAuthorId: 'smoke-author',
    firstRunDone: true,
    hintShown: true,
    pageTheme: 'night',
    writingStyle: 'pantser',
    shelves: [{ id: 'smoke-shelf', name: 'Smoke tests', bookIds: [] }]
  };
  fs.writeFileSync(path.join(libraryPath, 'library.json'), JSON.stringify(fixtureLibrary, null, 2));

  const preferences = require('electron').systemPreferences;
  assert(preferences && typeof preferences.setUserDefault === 'function',
    'Cannot intercept macOS system preference writes; refusing to start the real main process.');
  const blockedPreferenceWrite = (...args) => {
    preferenceWrites.push(args);
  };
  try {
    preferences.setUserDefault = blockedPreferenceWrite;
    if (preferences.setUserDefault !== blockedPreferenceWrite) {
      Object.defineProperty(preferences, 'setUserDefault', {
        configurable: true,
        value: blockedPreferenceWrite
      });
    }
  } catch (error) {
    fail('Cannot safely intercept system preference writes: ' + error.message);
  }
  assert(preferences.setUserDefault === blockedPreferenceWrite,
    'System preference write interception could not be verified.');

  const shell = require('electron').shell;
  if (shell && typeof shell.openExternal === 'function') {
    shell.openExternal = async (url) => {
      externalOpenAttempts.push(String(url));
      throw new Error('External opening is disabled in the academic app smoke harness.');
    };
  }

  app.on('browser-window-created', (_event, window) => instrumentWindow(window));
  process.chdir(projectRoot);
  const loadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function (file, options) {
    const resolved = path.isAbsolute(file) ? file : path.join(projectRoot, file);
    return loadFile.call(this, resolved, options);
  };
  require('../main.js');
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(source);
}

async function waitForPage(window, expression, description, timeoutMs = 15000) {
  await waitFor(async () => {
    try {
      return !!(await evaluate(window, expression));
    } catch {
      return false;
    }
  }, description, timeoutMs);
}

function findMenuItem(label, menu = Menu.getApplicationMenu()) {
  if (!menu) return null;
  for (const item of menu.items) {
    if (item.label === label) return item;
    const found = item.submenu && findMenuItem(label, item.submenu);
    if (found) return found;
  }
  return null;
}

async function reportRendererFailures(window) {
  try {
    const pageErrors = await evaluate(window, 'window.__academicAppSmokeErrors || []');
    rendererErrors.push(...pageErrors.map(String));
  } catch (error) {
    rendererErrors.push('Could not read page errors: ' + error.message);
  }
  if (rendererErrors.length) fail('Renderer errors: ' + rendererErrors.join(' | '));
  if (externalOpenAttempts.length) {
    fail('The app attempted external opening: ' + externalOpenAttempts.join(', '));
  }
}

async function selectCaret(window, text, offset) {
  const found = await evaluate(window, `(() => {
    const body = document.querySelector('#chapters .chapter-body');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.data.indexOf(${JSON.stringify(text)});
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index + ${offset});
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return true;
    }
    return false;
  })()`);
  assert(found, `Could not place the manuscript caret in "${text}".`);
}

async function fillAndSubmitDialog(window, values) {
  await evaluate(window, `(() => {
    const form = document.querySelector('.academic-dialog form');
    if (!form) throw new Error('Expected an academic dialog form.');
    const controls = Array.from(form.querySelectorAll('input, textarea, select'));
    const values = ${JSON.stringify(values)};
    if (controls.length !== values.length) {
      throw new Error('Unexpected academic dialog control count: ' + controls.length);
    }
    controls.forEach((control, index) => {
      if (control.type === 'checkbox') control.checked = !!values[index];
      else {
        control.value = values[index];
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    form.requestSubmit();
  })()`);
}

async function addReference(window) {
  await evaluate(window, `document.getElementById('academic-add-ref').click()`);
  await waitForPage(window, `!!document.querySelector('.academic-dialog form')`, 'reference editor');
  await fillAndSubmitDialog(window, [
    'smoke2026', 'Reference without a publication year', 'Smoke, Author', '',
    'Smoke Journal', '', '', '', 'article-journal'
  ]);
  await waitForPage(window,
    `!document.querySelector('.academic-dialog') && book.metadata.references.some(ref => ref.key === 'smoke2026')`,
    'reference with optional year');
  const year = await evaluate(window,
    `book.metadata.references.find(ref => ref.key === 'smoke2026').issued['date-parts'].length`);
  assert(year === 0, 'The optional publication year was not stored as absent.');
}

async function insertCitation(window) {
  await selectCaret(window, 'Legacy manuscript paragraph.', 0);
  await evaluate(window, `document.getElementById('academic-insert-citation').click()`);
  await waitForPage(window, `!!document.querySelector('.academic-dialog form')`, 'citation picker');
  await evaluate(window, `(() => {
    const select = document.querySelector('.academic-dialog select[multiple]');
    if (!select) throw new Error('Expected the multi-reference citation picker.');
    const option = Array.from(select.options).find(item => item.value === 'smoke2026');
    if (!option) throw new Error('The new reference is missing from the citation picker.');
    option.selected = true;
    select.form.requestSubmit();
  })()`);
  try {
    await waitForPage(window,
      `!document.querySelector('.academic-dialog') && !!document.querySelector('#chapters .academic-citation[data-cites*="smoke2026"]')`,
      'citation insertion');
  } catch (error) {
    const state = await evaluate(window, `JSON.stringify({
      dialog: document.querySelector('.academic-dialog') && document.querySelector('.academic-dialog').innerText,
      citations: Array.from(document.querySelectorAll('#chapters .academic-citation'), node => ({
        html: node.outerHTML, editable: node.getAttribute('contenteditable')
      })),
      html: document.querySelector('#chapters .chapter-body') && document.querySelector('#chapters .chapter-body').innerHTML,
      hint: document.getElementById('hint') && document.getElementById('hint').textContent,
      references: book.metadata.references.map(ref => ({ id: ref.id, key: ref.key }))
    })`);
    throw new Error(`${error.message}; renderer state=${state}`);
  }
}

async function cutAndImmediatelyUndoCitation(window, bookId) {
  const cut = await evaluate(window, `(() => {
    const citation = document.querySelector('#chapters .academic-citation[data-cites*="smoke2026"]');
    if (!citation) throw new Error('Expected the newly inserted citation before cut.');
    const body = citation.closest('.chapter-body');
    body.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNode(citation);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const startingBreakRun = breakRun;
    const startingUndoCount = undoStack.length;
    const data = new DataTransfer();
    const cutEvent = new ClipboardEvent('cut', {
      bubbles: true, cancelable: true, clipboardData: data
    });
    body.dispatchEvent(cutEvent);
    const cutResult = {
      prevented: cutEvent.defaultPrevented,
      types: Array.from(data.types),
      customType: window.NeoAcademicClipboard.MIME,
      text: data.getData('text/plain'),
      startingBreakRun,
      breakRun: breakRun - startingBreakRun,
      undoSnapshots: undoStack.length - startingUndoCount,
      citationRemoved: !body.querySelector('.academic-citation')
    };
    const mac = ${JSON.stringify(process.platform === 'darwin')};
    const undoEvent = new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', metaKey: mac, ctrlKey: !mac,
      bubbles: true, cancelable: true
    });
    body.dispatchEvent(undoEvent);
    cutResult.undoPrevented = undoEvent.defaultPrevented;
    cutResult.breakRunAfterUndo = breakRun;
    return cutResult;
  })()`);
  assert(cut.prevented, 'Academic cut did not claim the synthetic clipboard event.');
  assert(cut.types.includes('text/plain') && cut.text,
    'Academic cut did not populate plain text on the synthetic DataTransfer.');
  assert(cut.types.includes(cut.customType),
    'Academic cut did not populate its structured clipboard transfer.');
  assert(cut.breakRun === 1 && cut.undoSnapshots === 1,
    'Academic cut did not raise one immediate structural-undo snapshot.');
  assert(cut.breakRunAfterUndo === cut.startingBreakRun,
    'The immediate platform undo did not consume exactly the academic cut break.');
  assert(cut.citationRemoved, 'The academic cut left the selected citation in the manuscript.');
  assert(cut.undoPrevented, 'The immediate platform undo key did not route to structural undo.');

  await waitForPage(window, `!!document.querySelector('#chapters .academic-citation[data-cites*="smoke2026"]')`,
    'immediate restoration of cut citation');
  await waitFor(async () => {
    const [meta, chapter] = await Promise.all([
      evaluate(window, `window.neo.readBookMeta(${JSON.stringify(bookId)})`),
      evaluate(window, `window.neo.readChapter(${JSON.stringify(bookId)}, 'chapter-smoke')`)
    ]);
    return !!meta && meta.metadata.references.some((ref) => ref.key === 'smoke2026') &&
      chapter.includes('academic-citation') && chapter.includes('smoke2026');
  }, 'citation and metadata persisted over IPC after undo', 15000);

  const restored = await evaluate(window, `(() => {
    const citation = document.querySelector('#chapters .academic-citation[data-cites*="smoke2026"]');
    return {
      referenceCount: book.metadata.references.filter(ref => ref.key === 'smoke2026').length,
      citationCount: document.querySelectorAll('#chapters .academic-citation').length,
      protected: citation && citation.getAttribute('contenteditable'),
      dataCites: citation && citation.dataset.cites
    };
  })()`);
  assert(restored.referenceCount === 1 && restored.citationCount === 1,
    'Structural undo failed to restore the citation without dropping its reference metadata.');
  assert(restored.protected === 'false' && restored.dataCites.includes('smoke2026'),
    'Structural undo restored an unprotected or detached academic citation.');
}

async function insertTable(window) {
  await selectCaret(window, 'Legacy manuscript paragraph.', 0);
  await evaluate(window, `document.getElementById('academic-insert-table').click()`);
  await waitForPage(window, `!!document.querySelector('.academic-dialog form')`, 'table editor');
  await evaluate(window, `(() => {
    const form = document.querySelector('.academic-dialog form');
    const controls = Array.from(form.querySelectorAll('input, textarea, select'));
    if (controls.length < 4) throw new Error('Table editor controls are missing.');
    controls[0].value = 'Smoke table';
    controls[1].value = '2';
    controls[1].dispatchEvent(new Event('input', { bubbles: true }));
    controls[2].value = '2';
    controls[2].dispatchEvent(new Event('input', { bubbles: true }));
    const cells = Array.from(form.querySelectorAll('.academic-table-editor input'));
    if (cells.length !== 4) throw new Error('Expected a 2 by 2 table grid.');
    cells.forEach((cell, index) => {
      cell.value = 'R' + Math.floor(index / 2 + 1) + 'C' + (index % 2 + 1);
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    });
    form.requestSubmit();
  })()`);
  await waitForPage(window, `!!document.querySelector('#chapters .academic-table')`, 'table insertion');
}

async function insertEquation(window) {
  await selectCaret(window, 'Legacy manuscript paragraph.', 0);
  await evaluate(window, `document.getElementById('academic-insert-equation').click()`);
  await waitForPage(window, `!!document.querySelector('.academic-dialog form')`, 'equation editor');
  await evaluate(window, `(() => {
    const form = document.querySelector('.academic-dialog form');
    const controls = Array.from(form.querySelectorAll('input, textarea, select'));
    if (controls.length !== 3) throw new Error('Unexpected equation editor controls.');
    controls[0].value = '\\\\frac{x}{y}';
    controls[0].dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitForPage(window, `!!document.querySelector('.academic-dialog .academic-math-preview svg')`,
    'rendered equation preview', 25000);
  await evaluate(window, `document.querySelector('.academic-dialog form').requestSubmit()`);
  await waitForPage(window, `!!document.querySelector('#chapters .academic-equation svg')`,
    'equation insertion', 25000);
}

async function prepareEditorScreenshot(window) {
  const initiallyHidden = await evaluate(window, `document.getElementById('academic-panel').hidden`);
  if (!initiallyHidden) {
    await evaluate(window, `document.getElementById('academic-toggle').click()`);
    await waitForPage(window, `document.getElementById('academic-panel').hidden`,
      'closing the academic panel with its toggle');
  }
  await evaluate(window, `document.getElementById('academic-toggle').click()`);
  await waitForPage(window, `!document.getElementById('academic-panel').hidden`,
    'opening the academic panel with its toggle');

  let state;
  try {
    state = await evaluate(window, `(() => {
    try {
    const panel = document.getElementById('academic-panel');
    const sidePane = document.getElementById('side-pane');
    if (!book.metadata || book.metadata.academicMode !== true) {
      throw new Error('Cannot capture screenshot with Academic Mode off.');
    }
    if (!sidePane.classList.contains('open')) {
      throw new Error('The academic side pane is not open.');
    }
    if (panel.hidden) throw new Error('The Academic panel is not open.');

    const details = Array.from(panel.querySelectorAll('details.academic-details'));
    const references = details.find(item => /References/.test(item.querySelector('summary').textContent));
    const objects = details.find(item => /Figures, equations|tables/i.test(item.querySelector('summary').textContent));
    if (!references || !objects) throw new Error('Academic References/Objects details are missing.');
    if (!references.open) references.querySelector('summary').click();
    if (!objects.open) objects.querySelector('summary').click();

    const paneRect = sidePane.getBoundingClientRect();
    const referencesTop = references.getBoundingClientRect().top;
    sidePane.scrollTop += referencesTop - paneRect.top - 110;

    const paperScroll = document.getElementById('paper-scroll');
    const chapterBody = document.querySelector('#chapters .chapter-body');
    const paragraph = chapterBody && Array.from(chapterBody.querySelectorAll('p'))
      .find(item => item.textContent.includes('Legacy manuscript paragraph.')) || chapterBody;
    if (!paperScroll || !paragraph) throw new Error('The actual manuscript chapter body is missing.');
    const paperRect = paperScroll.getBoundingClientRect();
    const paragraphRect = paragraph.getBoundingClientRect();
    paperScroll.scrollTop += paragraphRect.top - paperRect.top - paperRect.height * 0.18;

    const finalPaperRect = paperScroll.getBoundingClientRect();
    const finalBodyRect = chapterBody.getBoundingClientRect();
    const titlePage = document.getElementById('title-page');
    const titlePageRect = titlePage.getBoundingClientRect();
    const referencesRect = references.getBoundingClientRect();
    const objectsRect = objects.getBoundingClientRect();
    return {
      mode: book.metadata.academicMode,
      panelVisible: !panel.hidden,
      sidePaneOpen: sidePane.classList.contains('open'),
      referencesOpen: references.open,
      objectsOpen: objects.open,
      referencesVisible: referencesRect.bottom > paneRect.top && referencesRect.top < paneRect.bottom,
      objectsVisible: objectsRect.bottom > paneRect.top && objectsRect.top < paneRect.bottom,
      chapterText: chapterBody.textContent,
      chapterVisible: finalBodyRect.bottom > finalPaperRect.top && finalBodyRect.top < finalPaperRect.bottom,
      titlePageOutOfView: titlePageRect.bottom <= finalPaperRect.top || titlePageRect.top >= finalPaperRect.bottom
    };
    } catch (error) {
      return { error: String(error && error.stack || error) };
    }
  })()`);
  } catch (error) {
    const details = await evaluate(window, `JSON.stringify({
      mode: typeof book !== 'undefined' && book.metadata && book.metadata.academicMode,
      sidePane: document.getElementById('side-pane') && document.getElementById('side-pane').className,
      panelHidden: document.getElementById('academic-panel') && document.getElementById('academic-panel').hidden,
      toggleHidden: document.getElementById('academic-toggle') && document.getElementById('academic-toggle').hidden,
      details: Array.from(document.querySelectorAll('#academic-panel details > summary'), item => item.textContent),
      paperScroll: !!document.getElementById('paper-scroll'),
      chapterBody: !!document.querySelector('#chapters .chapter-body'),
      titlePage: !!document.getElementById('title-page')
    })`).catch((diagnosticError) => diagnosticError.message);
    fail(`Could not prepare representative screenshot: ${error.message}; state=${details}`);
  }
  if (state.error) fail('Could not prepare representative screenshot: ' + state.error);
  assert(state.mode && state.panelVisible && state.sidePaneOpen,
    'Screenshot setup did not leave academic mode and its open side panel visible.');
  assert(state.referencesOpen && state.objectsOpen && (state.referencesVisible || state.objectsVisible),
    'Screenshot setup did not open and show the academic References or Objects details.');
  assert(state.chapterText.includes('Legacy manuscript paragraph.') && state.chapterVisible && state.titlePageOutOfView,
    'Screenshot setup did not scroll to visible manuscript content below the title page.');
}

async function runSmoke() {
  configureIsolationBeforeMain();
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, 'the main BrowserWindow');
  const window = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) instrumentWindow(window);

  await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    if (document.readyState === 'complete') resolve();
    else {
      window.addEventListener('load', resolve, { once: true });
      setTimeout(() => reject(new Error('Renderer load timed out.')), 20000);
    }
  })`);
  await waitForPage(window, `!!window.neo && typeof window.neo.createBook === 'function'`,
    'the real preload bridge');
  const actualLibraryPath = await evaluate(window, 'window.neo.libraryPath()');
  assert(path.resolve(actualLibraryPath) === path.resolve(libraryPath),
    `Main process selected an unexpected library path: ${actualLibraryPath}`);
  assert(!fs.existsSync(path.join(userDataPath, 'settings.json')),
    'A user settings file appeared before the isolated first-run fixture was read.');

  const bookId = await evaluate(window, `(async () => {
    const meta = await window.neo.createBook({ title: 'Academic app smoke', author: 'Smoke Tester' });
    meta.chapterOrder = ['chapter-smoke'];
    meta.chapterTitles = { 'chapter-smoke': 'Methods' };
    await window.neo.writeBookMeta(meta.id, meta);
    await window.neo.writeChapter(meta.id, 'chapter-smoke', '<p>Legacy manuscript paragraph.</p>');
    return meta.id;
  })()`);
  assert(typeof bookId === 'string' && bookId.startsWith('book-'), 'The preload bridge did not create the test book.');
  const bookFile = path.join(libraryPath, bookId, 'book.json');
  const legacyBeforeOpen = JSON.parse(fs.readFileSync(bookFile, 'utf8'));
  assert(!Object.hasOwn(legacyBeforeOpen, 'metadata') && !Object.hasOwn(legacyBeforeOpen, 'academic'),
    'The legacy test book unexpectedly contains academic metadata.');

  await evaluate(window, `openBook(${JSON.stringify(bookId)})`);
  await waitForPage(window, `!document.getElementById('editor-view').hidden &&
    document.querySelector('#chapters .chapter-body')`, 'legacy book in the actual editor');
  const afterLegacyOpen = JSON.parse(fs.readFileSync(bookFile, 'utf8'));
  assert(!Object.hasOwn(afterLegacyOpen, 'metadata') && !Object.hasOwn(afterLegacyOpen, 'academic'),
    'Opening a legacy novel wrote academic metadata before an academic action.');

  const modeItem = findMenuItem('Academic Mode');
  assert(modeItem && typeof modeItem.click === 'function',
    'The main process did not build the native Academic Mode menu item.');
  const academicMenu = findMenuItem('Academic');
  assert(academicMenu && academicMenu.submenu,
    'The native Academic menu is missing.');
  for (const commandLabel of ['Insert Citation', 'Insert Table', 'Insert Equation']) {
    const item = findMenuItem(commandLabel);
    assert(item && item.enabled === false,
      `Native menu command "${commandLabel}" should start disabled for a legacy novel.`);
  }
  modeItem.click(modeItem, window, { shift: false, control: false, alt: false, meta: false });
  await waitForPage(window, `book.metadata && book.metadata.academicMode === true`,
    'Academic Mode native menu action');
  await waitFor(() => {
    const item = findMenuItem('Academic Mode');
    return !!item && item.checked === true;
  }, 'native Academic Mode menu tick');
  for (const commandLabel of ['Insert Citation', 'Insert Table', 'Insert Equation']) {
    const item = findMenuItem(commandLabel);
    assert(item && item.enabled === true,
      `Native menu command "${commandLabel}" did not enable after Academic Mode was selected.`);
  }

  await waitForPage(window, `!document.getElementById('academic-panel').hidden`, 'academic metadata panel');
  await addReference(window);
  await insertCitation(window);
  await cutAndImmediatelyUndoCitation(window, bookId);
  await insertTable(window);
  await insertEquation(window);
  await evaluate(window, `flushAllSaves(); true`);

  await waitFor(async () => {
    const [meta, chapter] = await Promise.all([
      evaluate(window, `window.neo.readBookMeta(${JSON.stringify(bookId)})`),
      evaluate(window, `window.neo.readChapter(${JSON.stringify(bookId)}, 'chapter-smoke')`)
    ]);
    return !!meta && !!meta.metadata && meta.metadata.references.some((ref) => ref.key === 'smoke2026') &&
      meta.metadata.tables.length === 1 && meta.metadata.equations.length === 1 &&
      chapter.includes('academic-citation') && chapter.includes('academic-table') && chapter.includes('academic-equation');
  }, 'academic metadata and manuscript HTML saved through real IPC', 20000);

  await evaluate(window, `openBook(${JSON.stringify(bookId)})`);
  await waitForPage(window, `!!document.querySelector('#chapters .academic-citation') &&
    !!document.querySelector('#chapters .academic-table') &&
    !!document.querySelector('#chapters .academic-equation')`, 'academic markup after reopening');
  const persisted = await evaluate(window, `(() => ({
    mode: book.metadata.academicMode,
    reference: book.metadata.references.find(ref => ref.key === 'smoke2026'),
    tableCount: book.metadata.tables.length,
    equationCount: book.metadata.equations.length,
    protectedCitation: document.querySelector('#chapters .academic-citation').getAttribute('contenteditable'),
    objects: Array.from(document.querySelectorAll('#chapters [data-academic-id]'), node => ({
      id: node.dataset.academicId,
      tag: node.tagName.toLowerCase(),
      protected: node.getAttribute('contenteditable')
    }))
  }))()`);
  assert(persisted.mode === true, 'Academic Mode was not persisted.');
  assert(persisted.reference && persisted.reference.issued['date-parts'].length === 0,
    'The reference with its optional year omitted did not survive reopening.');
  assert(persisted.tableCount === 1 && persisted.equationCount === 1,
    'Academic table/equation models did not survive reopening.');
  assert(persisted.protectedCitation === 'false',
    'The citation span lost its contenteditable protection after persistence.');
  assert(persisted.objects.length === 2 && persisted.objects.every((object) => object.id && object.protected === 'false'),
    'Academic table/equation markup lost its protected object spans after persistence.');

  await waitFor(() => {
    const item = findMenuItem('Academic Mode');
    return !!item && item.checked === true;
  }, 'persisted native Academic Mode menu tick');
  await prepareEditorScreenshot(window);
  await evaluate(window, `new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  )`);
  await delay(250);
  const png = await window.webContents.capturePage();
  fs.writeFileSync(screenshotPath, png.toPNG());
  assert(fs.statSync(screenshotPath).size > 1000, 'The editor screenshot was not captured.');

  await evaluate(window, `flushAllSaves(); true`);
  await reportRendererFailures(window);
  assert(preferenceWrites.length === 5,
    `Expected all five macOS preference writes to be intercepted, saw ${preferenceWrites.length}.`);
  console.log(JSON.stringify({
    ok: true,
    bookId,
    isolatedLibrary: libraryPath,
    screenshot: screenshotPath,
    assertions: [
      'isolated userData and Documents paths before main.js',
      'legacy novel remains without academic metadata until an academic action',
      'native Academic Mode menu state and command enabled states',
      'optional-year reference, academic cut clipboard event, immediate structural undo, table and equation',
      'metadata and protected manuscript markup persisted and reloaded with representative editor screenshot',
      'macOS preferences intercepted; no external opening attempted'
    ]
  }, null, 2));
}

async function main() {
  let failure = null;
  try {
    await runSmoke();
  } catch (error) {
    failure = error;
    console.error('Academic app smoke failed:', error && error.stack || error);
    if (rendererErrors.length) console.error('Renderer errors:', rendererErrors);
    if (externalOpenAttempts.length) console.error('Blocked external open attempts:', externalOpenAttempts);
  } finally {
    if (mainWindow && !mainWindow.isDestroyed()) {
      await new Promise((resolve) => {
        mainWindow.once('closed', resolve);
        mainWindow.close();
        setTimeout(resolve, 3000);
      });
      if (!mainWindow.isDestroyed()) mainWindow.destroy();
    }
    await new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };
      app.once('will-quit', finish);
      app.quit();
      setTimeout(finish, 3000);
    });
    schedulePostExitCleanup();
    app.exit(failure ? 1 : 0);
  }
  if (failure) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Academic app smoke harness failed:', error && error.stack || error);
  safeRemoveIsolation();
  process.exitCode = 1;
  app.quit();
});
