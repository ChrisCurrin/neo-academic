(function () {
  const panel = document.getElementById('academic-panel');
  if (!panel) return;

  const abstractInput = document.getElementById('academic-abstract');
  const keywordsInput = document.getElementById('academic-keywords');
  const refsList = document.getElementById('academic-ref-list');
  const addRefButton = document.getElementById('academic-add-ref');
  const addCitationButton = document.getElementById('academic-insert-citation');

  function currentBook() {
    return (typeof book !== 'undefined' && book) ? book : null;
  }

  function ensureAcademicData() {
    const b = currentBook();
    if (!b) return null;
    b.academic = b.academic || {};
    b.metadata = b.metadata || {};
    b.metadata.abstract = b.metadata.abstract || b.academic.abstract || '';
    b.metadata.keywords = Array.isArray(b.metadata.keywords) ? b.metadata.keywords : (Array.isArray(b.academic.keywords) ? b.academic.keywords : []);
    b.academic.references = Array.isArray(b.academic.references) ? b.academic.references : [];
    return b;
  }

  function saveAcademicData() {
    const b = ensureAcademicData();
    if (!b) return;

    const refs = Array.from(refsList.querySelectorAll('.academic-ref-item')).map((item) => ({
      key: item.dataset.key || '',
      text: item.dataset.text || item.textContent.trim(),
      label: item.dataset.label || item.textContent.trim()
    })).filter((ref) => ref.key || ref.text);

    const academic = b.academic;
    academic.abstract = (abstractInput.value || '').trim();
    academic.keywords = (keywordsInput.value || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    academic.references = refs;

    b.metadata = b.metadata || {};
    b.metadata.abstract = academic.abstract;
    b.metadata.keywords = academic.keywords;
    b.metadata.references = refs;

    if (typeof saveBook === 'function') {
      saveBook(b);
    } else if (typeof flushAllSaves === 'function') {
      flushAllSaves();
    } else if (typeof saveLibrary === 'function') {
      saveLibrary();
    } else if (window.localStorage) {
      localStorage.setItem('neo-academic', JSON.stringify({ abstract: academic.abstract, keywords: academic.keywords, references: refs }));
    }
  }

  function renderReferences() {
    const b = ensureAcademicData();
    if (!b) return;

    const refs = Array.isArray(b.academic.references) ? b.academic.references : [];
    refsList.innerHTML = '';

    refs.forEach((ref) => {
      const item = document.createElement('div');
      item.className = 'academic-ref-item';
      item.dataset.key = ref.key || '';
      item.dataset.text = ref.text || ref.label || '';
      item.dataset.label = ref.label || ref.text || '';
      item.textContent = ref.label || ref.text || ref.key || 'Reference';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.className = 'academic-ref-remove';
      remove.addEventListener('click', () => {
        item.remove();
        saveAcademicData();
      });
      item.appendChild(remove);
      refsList.appendChild(item);
    });
  }

  function syncAcademicFields() {
    const b = ensureAcademicData();
    if (!b) return;

    const academic = b.academic || {};
    abstractInput.value = academic.abstract || b.metadata.abstract || '';
    keywordsInput.value = (academic.keywords || b.metadata.keywords || []).join(', ');
    renderReferences();
  }

  function addReference() {
    const key = window.prompt('Reference key or citation name (e.g. Smith2024)', 'Smith2024');
    if (!key) return;
    const label = window.prompt('Reference label to show in the manuscript (e.g. Smith, 2024)', key);
    const ref = { key: key.trim(), text: label && label.trim() ? label.trim() : key.trim(), label: label && label.trim() ? label.trim() : key.trim() };

    const item = document.createElement('div');
    item.className = 'academic-ref-item';
    item.dataset.key = ref.key;
    item.dataset.text = ref.text;
    item.dataset.label = ref.label;
    item.textContent = ref.label;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.className = 'academic-ref-remove';
    remove.addEventListener('click', () => {
      item.remove();
      saveAcademicData();
    });
    item.appendChild(remove);
    refsList.appendChild(item);
    saveAcademicData();
  }

  function insertCitation() {
    const first = refsList.querySelector('.academic-ref-item');
    if (!first) {
      window.alert('Add at least one reference before inserting a citation.');
      return;
    }

    const key = first.dataset.key || first.dataset.label || first.dataset.text || 'Ref';
    const citationText = `[${key}]`;

    const active = document.activeElement;
    if (active && active.isContentEditable) {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      if (range) {
        range.deleteContents();
        range.insertNode(document.createTextNode(citationText));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
    }

    if (document.execCommand) {
      document.execCommand('insertText', false, citationText);
      return;
    }

    const target = document.querySelector('#paper [contenteditable="true"]') || document.body;
    if (target && target.isContentEditable) {
      target.textContent += citationText;
    } else {
      window.alert('Click inside the manuscript to insert a citation.');
    }
  }

  abstractInput.addEventListener('input', saveAcademicData);
  keywordsInput.addEventListener('input', saveAcademicData);
  addRefButton.addEventListener('click', addReference);
  addCitationButton.addEventListener('click', insertCitation);

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      insertCitation();
    }
  });

  if (window.localStorage) {
    try {
      const stored = JSON.parse(localStorage.getItem('neo-academic') || 'null');
      if (stored && Array.isArray(stored.references)) {
        const refs = stored.references.slice(0, 10);
        refsList.innerHTML = '';
        refs.forEach((ref) => {
          const item = document.createElement('div');
          item.className = 'academic-ref-item';
          item.dataset.key = ref.key || '';
          item.dataset.text = ref.text || ref.label || '';
          item.dataset.label = ref.label || ref.text || '';
          item.textContent = ref.label || ref.text || ref.key || 'Reference';
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = '×';
          remove.className = 'academic-ref-remove';
          remove.addEventListener('click', () => {
            item.remove();
            saveAcademicData();
          });
          item.appendChild(remove);
          refsList.appendChild(item);
        });
        abstractInput.value = stored.abstract || '';
        keywordsInput.value = Array.isArray(stored.keywords) ? stored.keywords.join(', ') : '';
      }
    } catch (err) {
      // ignore invalid local storage payloads
    }
  }

  syncAcademicFields();
})();
