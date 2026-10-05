/* NEO — a paper's References tab
 *
 * Where the references are gathered: paste a DOI, an arXiv ID or a whole
 * BibTeX file into the box at the top; drop or import .bib, .ris or CSL
 * JSON; or link the file a reference manager keeps (Zotero's Better BibTeX
 * writes one and keeps it current), which NEO reads again whenever it comes
 * back into view. Each reference shows how often the paper cites it; a
 * click edits it. Loaded after paper/paper.js.
 */

'use strict';

let libraryFilter = '';
let libraryTrash = null; // the references last removed, with where they stood, for ⌘Z

// From switchTab
function paperShowReferences() {
  const aux = $('#aux-paper');
  $('#aux-title').textContent = t('References');
  let view = $('#references-view');
  if (!view) {
    view = document.createElement('div');
    view.id = 'references-view';
    aux.appendChild(view);
  }
  view.hidden = false;
  paperLibraryRender(true);
}
function paperHideReferences() {
  const view = $('#references-view');
  if (view) view.hidden = true;
}

function paperLibraryRender(fresh = false) {
  const view = $('#references-view');
  if (!view || view.hidden || !book || !isPaper()) return;
  if (fresh || !view.querySelector('.rl-add')) {
    view.innerHTML = `
      <div class="rl-top">
        <textarea class="rl-add" rows="1" spellcheck="false"></textarea>
        <div class="rl-tools"></div>
      </div>
      <div class="rl-list" role="list"></div>`;
    const add = view.querySelector('.rl-add');
    add.placeholder = t('Paste a DOI, an arXiv ID or BibTeX to add it · or type to search');
    add.setAttribute('aria-label', t('Add or search references'));
    add.value = libraryFilter;
    add.addEventListener('input', () => {
      autoGrow(add);
      libraryFilter = add.value;
      drawList();
    });
    add.addEventListener('paste', (e) => {
      const text = e.clipboardData.getData('text/plain');
      if (NeoReferences.sniff(text)) {
        e.preventDefault();
        paperImportText(text, t('the clipboard'));
      }
    });
    add.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      const text = add.value.trim();
      if (!text) return;
      if (NeoReferences.sniff(text)) { await paperImportText(text, t('what was pasted')); add.value = ''; libraryFilter = ''; drawList(); return; }
      const ident = NeoReferences.findIdentifier(text);
      if (!ident) { toast(t('Enter adds a DOI, an arXiv ID or BibTeX; anything else just searches')); return; }
      add.disabled = true;
      try {
        const item = await paperLookup(ident);
        toast(t('Added to the references: {ref}', { ref: NeoReferences.shortLabel(item) }));
        add.value = '';
        libraryFilter = '';
      } catch (err) {
        toast(t('Couldn’t look that up: {error}', { error: plainError(err) }), 8000);
      } finally {
        add.disabled = false;
        add.focus();
      }
      drawList();
    });
    if (fresh) add.focus({ preventScroll: true });
  }
  drawTools();
  drawList();
}

function drawTools() {
  const box = $('#references-view .rl-tools');
  if (!box) return;
  box.innerHTML = '';
  const link = (label, fn, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rl-tool';
    b.textContent = label;
    if (title) b.title = title;
    b.onclick = fn;
    box.appendChild(b);
  };
  link(t('Import a file…'), async () => {
    const file = await pickFile('.bib,.ris,.json,.txt');
    if (file) await paperImportText(await file.text(), file.name);
  }, t('BibTeX (.bib), RIS (.ris) or CSL JSON, from Zotero, Mendeley, EndNote or a publisher'));
  if (window.neo.paperLink) {
    if (paper.linkedPath) {
      const name = paper.linkedPath.split(/[\\/]/).pop();
      const span = document.createElement('span');
      span.className = 'rl-linked';
      span.textContent = t('Linked to {file}', { file: name });
      span.title = paper.linkedPath;
      box.appendChild(span);
      link(t('Unlink'), () => paperMenu({ command: 'unlinkLibrary' }).then(drawTools));
    } else {
      link(t('Link a reference library…'), paperLinkLibrary, t('A .bib file your reference manager keeps up to date (Zotero with Better BibTeX can). NEO reads it again whenever you come back.'));
    }
  }
  if (paper.refs.length) link(t('Export BibTeX…'), () => doExport('bib'));
  const cited = new Set(paperCitedIds());
  const uncited = paper.refs.filter((r) => !cited.has(r.id));
  // before submitting: the list down to what the paper cites
  if (uncited.length && uncited.length < paper.refs.length) {
    link(t('Remove {n} uncited', { n: uncited.length }), () => paperRemoveRefs(uncited, t('{n} uncited references', { n: uncited.length })),
      t('Take out every reference the paper doesn’t cite; {key} brings them back', { key: KZ }));
  }
  const count = document.createElement('span');
  count.className = 'rl-count';
  count.textContent = paper.refs.length ? t('{n} references · {c} cited', { n: paper.refs.length, c: paper.refs.filter((r) => cited.has(r.id)).length }) : '';
  box.appendChild(count);
}

// How often each reference is cited, from the page itself
function paperCitedIds() {
  const ids = [];
  for (const n of document.querySelectorAll('#chapters .cite')) for (const x of citeData(n)) ids.push(x.id);
  return ids;
}

function drawList() {
  const list = $('#references-view .rl-list');
  if (!list) return;
  list.innerHTML = '';
  const counts = new Map();
  for (const id of paperCitedIds()) counts.set(id, (counts.get(id) || 0) + 1);
  const q = libraryFilter.trim();
  const showing = NeoReferences.findIdentifier(q) || NeoReferences.sniff(q) ? '' : q;
  const items = paper.refs
    .map((it) => ({ it, s: NeoReferences.score(it, showing) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (showing ? b.s - a.s : 0) || refSortKey(a.it).localeCompare(refSortKey(b.it)));
  if (!paper.refs.length) {
    const empty = document.createElement('div');
    empty.className = 'rl-empty';
    empty.innerHTML = `<p></p><p class="soft"></p>`;
    empty.firstChild.textContent = t('No references yet.');
    empty.lastChild.textContent = t('Paste a DOI above, import a .bib from Zotero or Mendeley, or type @ in the paper and paste a DOI there. Every reference here can then be cited with @.');
    list.appendChild(empty);
    return;
  }
  for (const { it } of items) {
    const row = document.createElement('div');
    row.className = 'rl-row' + (counts.get(it.id) ? '' : ' uncited');
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;
    const main = document.createElement('div');
    main.className = 'rl-main';
    main.innerHTML = refLineHtml(it);
    const side = document.createElement('div');
    side.className = 'rl-side';
    const key = document.createElement('code');
    key.textContent = '@' + it.id;
    const n = counts.get(it.id) || 0;
    const used = document.createElement('span');
    used.className = 'rl-used';
    used.textContent = n ? t('cited {n}×', { n }) : t('not cited');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rl-del';
    del.textContent = '×';
    del.title = t('Remove from the references');
    del.setAttribute('aria-label', del.title);
    del.onclick = (e) => { e.stopPropagation(); paperDeleteRef(it, n); };
    side.append(key, used, del);
    row.append(main, side);
    row.onclick = () => paperEditRef(it);
    row.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); paperEditRef(it); } };
    list.appendChild(row);
  }
  if (!items.length) {
    const none = document.createElement('div');
    none.className = 'rl-empty soft';
    none.textContent = t('Nothing matches “{q}”', { q });
    list.appendChild(none);
  }
}
const refSortKey = (it) => (((it.author || it.editor || [])[0] || {}).family || it.title || it.id).toLowerCase() + NeoReferences.yearOf(it);

// One line for the list: authors (year). Title. Where it appeared.
function refLineHtml(it) {
  const names = (it.author || it.editor || []).map((a) => a.literal || [a.family, a.given ? a.given.split(/[\s-]+/).map((g) => g[0] + '.').join(' ') : ''].filter(Boolean).join(', '));
  const who = names.length > 6 ? names.slice(0, 6).join(', ') + ', …' : names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names.join('');
  const year = NeoReferences.yearOf(it);
  const rest = [it.volume && (it.volume + (it.issue ? `(${it.issue})` : '')), it.page, it.publisher].filter(Boolean).join(', ');
  const where = [it['container-title'] ? `<i>${escHtml(it['container-title'])}</i>` : '', escHtml(rest)].filter(Boolean).join(', ');
  return `<span class="rl-who">${escHtml(who || t('No author'))}</span>${year ? ` <span class="rl-year">(${escHtml(year)})</span>` : ''}. `
    + `<span class="rl-title">${escHtml(it.title || t('Untitled'))}</span>${where ? `. ${where}` : ''}`
    + (it.DOI ? ` <span class="rl-doi">doi:${escHtml(it.DOI)}</span>` : '');
}

// Text that holds references (a file, the clipboard) into this paper's list
async function paperImportText(text, from, { keepKeys = false, quiet = false } = {}) {
  let parsed;
  try {
    parsed = NeoReferences.parseAny(text);
  } catch (err) {
    parsed = { items: [], errors: [String(err && err.message || err)], kind: null };
  }
  if (!parsed.kind || !parsed.items.length) {
    if (!quiet) toast(t('No references found in {from}. NEO reads BibTeX, RIS and CSL JSON.', { from }), 8000);
    return { added: [], updated: [] };
  }
  const { items, added, updated } = NeoReferences.mergeReferences(paper.refs, parsed.items, { keepKeys });
  await paperSaveRefs(items);
  if (!quiet) {
    const parts = [];
    if (added.length) parts.push(t('{n} added', { n: added.length }));
    if (updated.length) parts.push(t('{n} already here, updated', { n: updated.length }));
    if (parsed.errors.length) parts.push(t('{n} skipped', { n: parsed.errors.length }));
    toast(t('References from {from}: {what}', { from, what: parts.join(' · ') }), 6000);
  }
  paperLibraryRender();
  return { added, updated };
}

async function paperLinkLibrary() {
  if (!window.neo.paperLink) return;
  const got = await window.neo.paperLink(book.id);
  if (!got) return;
  paper.linkedPath = got.path;
  paper.linkedStamp = got.mtime;
  await paperImportText(got.text, got.path.split(/[\\/]/).pop(), { keepKeys: true });
  paperReportState();
  paperLibraryRender();
}
// The linked file, read again if it changed since NEO last looked. What it
// holds updates the references by key; nothing is taken away for being
// gone from it (the paper may still cite it).
async function paperRefreshLinked() {
  if (!book || !isPaper() || !window.neo.paperLinked) return;
  const bookId = book.id;
  let got;
  try { got = await window.neo.paperLinked(bookId, paper.linkedStamp); } catch { return; }
  if (!book || book.id !== bookId) return;
  const was = paper.linkedPath;
  paper.linkedPath = got ? got.path : null;
  if (was !== paper.linkedPath) { paperReportState(); if (currentTab === 'references') drawTools(); }
  if (!got) return;
  if (got.missing) {
    if (paper.linkedStamp !== 'missing') toast(t('The linked reference library isn’t where it was: {file}', { file: got.path }), 8000);
    paper.linkedStamp = 'missing';
    return;
  }
  const first = paper.linkedStamp === null;
  paper.linkedStamp = got.mtime;
  if (got.same || !got.text) return;
  const { added, updated } = await paperImportText(got.text, got.path.split(/[\\/]/).pop(), { keepKeys: true, quiet: true });
  if (!first && (added.length || updated.length)) toast(t('Reference library read again: {n} new', { n: added.length }));
}

async function paperDeleteRef(it, cited) {
  if (cited) {
    const ok = await optionModal(t('Remove “{ref}”?', { ref: NeoReferences.shortLabel(it) }),
      t('The paper cites it {n} times. Those citations will show as missing until it’s added back.', { n: cited }),
      [{ label: t('Remove'), value: true, danger: true }]);
    if (!ok) return;
  }
  await paperRemoveRefs([it], NeoReferences.shortLabel(it));
}
// references out of the list, remembered where they stood for ⌘Z
async function paperRemoveRefs(items, what) {
  const gone = new Set(items);
  libraryTrash = paper.refs.map((item, at) => ({ item, at })).filter((x) => gone.has(x.item));
  await paperSaveRefs(paper.refs.filter((r) => !gone.has(r)));
  toast(t('Removed {ref} — {key} brings it back', { ref: what, key: KZ }));
  paperLibraryRender();
}
document.addEventListener('keydown', async (e) => {
  if (!libraryTrash || currentTab !== 'references' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.code !== 'KeyZ') return;
  // ⌘Z in a box with words in it takes back typing; the search box, empty, is where the caret sits after a removal
  const box = e.target && e.target.closest && e.target.closest('textarea, input');
  if (box && box.value) return;
  e.preventDefault();
  const back = libraryTrash;
  libraryTrash = null;
  const items = [...paper.refs];
  for (const { item, at } of back) items.splice(Math.min(at, items.length), 0, item);
  await paperSaveRefs(items);
  paperLibraryRender();
});

// A reference's details, by hand
const REF_TYPES = [
  ['article-journal', tk('Journal article')], ['book', tk('Book')], ['chapter', tk('Book chapter')], ['paper-conference', tk('Conference paper')],
  ['article', tk('Preprint')], ['thesis', tk('Thesis')], ['report', tk('Report')], ['webpage', tk('Web page')], ['dataset', tk('Dataset')],
  ['software', tk('Software')], ['manuscript', tk('Manuscript')], ['document', tk('Other')]
];
function paperEditRef(it) {
  const draft = { ...it };
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `<div class="modal paper-ref" role="dialog" aria-modal="true"><h2></h2><div class="pr-grid"></div>
    <div class="pa-foot"><button class="m-cancel btn-quiet" type="button"></button><button class="m-ok btn-gold" type="button"></button></div></div>`;
  bd.querySelector('h2').textContent = t('Reference');
  bd.querySelector('.m-cancel').textContent = t('Cancel');
  bd.querySelector('.m-ok').textContent = t('Save');
  const grid = bd.querySelector('.pr-grid');
  const fields = {};
  const row = (label, el, wide) => {
    const l = document.createElement('label');
    l.className = 'pr-field' + (wide ? ' wide' : '');
    const s = document.createElement('span');
    s.textContent = label;
    l.append(s, el);
    grid.appendChild(l);
    return el;
  };
  const input = (name, label, value, wide, multi) => {
    const el = document.createElement(multi ? 'textarea' : 'input');
    el.spellcheck = false;
    el.value = value || '';
    if (multi) el.rows = 3;
    fields[name] = row(label, el, wide);
    return el;
  };
  const type = document.createElement('select');
  for (const [v, l] of REF_TYPES) { const o = document.createElement('option'); o.value = v; o.textContent = t(l); type.appendChild(o); }
  type.value = REF_TYPES.some(([v]) => v === it.type) ? it.type : 'document';
  fields.type = row(t('Type'), type);
  input('id', t('Citation key'), it.id);
  const names = (list) => (list || []).map((a) => a.literal ? a.literal : [[a['non-dropping-particle'], a.family].filter(Boolean).join(' '), a.given].filter(Boolean).join(', ')).join('\n');
  input('author', t('Authors, one per line: Family, Given'), names(it.author), true, true);
  input('title', t('Title'), it.title, true);
  input('container-title', t('Journal, book or proceedings'), it['container-title'], true);
  input('year', t('Year'), NeoReferences.yearOf(it));
  input('volume', t('Volume'), it.volume);
  input('issue', t('Issue'), it.issue);
  input('page', t('Pages'), it.page);
  input('publisher', t('Publisher'), it.publisher);
  input('publisher-place', t('Place'), it['publisher-place']);
  input('DOI', 'DOI', it.DOI);
  input('URL', 'URL', it.URL, true);
  document.body.appendChild(bd);
  fields.title.focus();
  const close = () => bd.remove();
  bd.querySelector('.m-cancel').onclick = close;
  bd.querySelector('.m-ok').onclick = async () => {
    const key = fields.id.value.trim();
    if (!NeoReferences.KEY.test(key)) { toast(t('A citation key is one word: letters, digits, and - _ : .')); fields.id.focus(); return; }
    if (key !== it.id && paper.refs.some((r) => r.id === key)) { toast(t('Another reference already has the key {key}', { key })); fields.id.focus(); return; }
    draft.id = key;
    draft.type = type.value;
    for (const k of ['title', 'container-title', 'volume', 'issue', 'page', 'publisher', 'publisher-place', 'URL']) {
      const v = fields[k].value.trim();
      if (v) draft[k] = v; else delete draft[k];
    }
    const doi = fields.DOI.value.trim();
    if (doi) draft.DOI = NeoReferences.cleanDoi(doi); else delete draft.DOI;
    const year = fields.year.value.trim();
    if (/^\d{4}$/.test(year)) {
      const parts = it.issued && it.issued['date-parts'] && String(it.issued['date-parts'][0][0]) === year ? it.issued['date-parts'][0] : [+year];
      draft.issued = { 'date-parts': [parts] };
    } else if (!year) delete draft.issued;
    const people = fields.author.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      if (!l.includes(',')) return /\s/.test(l) && !/^\{/.test(l) ? { family: l.split(/\s+/).pop(), given: l.split(/\s+/).slice(0, -1).join(' ') } : { literal: l.replace(/[{}]/g, '') };
      const [family, ...given] = l.split(',');
      return { family: family.trim(), given: given.join(',').trim() };
    });
    if (people.length) draft.author = people; else delete draft.author;
    // by key: the list may have been read again (a sync, the linked file) while this was open
    const items = paper.refs.map((r) => (r.id === it.id ? draft : r));
    if (key !== it.id) renameCitations(it.id, key);
    close();
    await paperSaveRefs(items);
    paperLibraryRender();
  };
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); bd.querySelector('.m-ok').click(); }
  });
}
// a key changed by hand: every citation of it follows
function renameCitations(from, to) {
  const bodies = new Set();
  for (const n of document.querySelectorAll('#chapters .cite')) {
    const items = citeData(n);
    if (!items.some((x) => x.id === from)) continue;
    for (const x of items) if (x.id === from) x.id = to;
    n.dataset.cite = JSON.stringify(items);
    bodies.add(n.closest('.chapter-body'));
  }
  for (const body of bodies) syncChapter(body, body.closest('.chapter').dataset.id);
}
