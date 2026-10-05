(function () {
  'use strict';

  // AcademicPlugin is a deep module with a small interface.
  // It provides a single seam for the core to integrate academic features.
  // All academic modules live behind this seam and are injected via adapters.
  // This keeps upstream core changes minimal and makes academic features opt-in.

  const DEFAULTS = Object.freeze({
    academicMode: false
  });

  function isAcademicBook(book) {
    if (!book || typeof book !== 'object') return false;
    const meta = book.metadata || {};
    return meta.academicMode === true || meta.theme !== undefined;
  }

  function createPlugin({ document, getBook, translate, report, model, i18n, neo }) {
    // Adapters for core seams
    const adapters = Object.freeze({
      bookStore: {
        readMetadata: (book) => model ? model.read(book) : (book && book.metadata ? book.metadata : {}),
        writeMetadata: (book, changes) => {
          if (!book) throw new Error(translate('Open a book first'));
          // Legacy books have book.academic field but no metadata; never persist changes to them
          const isLegacy = book.academic && typeof book.academic === 'object' && !(book.metadata && typeof book.metadata === 'object');
          if (isLegacy) {
            const current = model ? model.read(book) : {};
            return { ...current, ...changes };
          }
          const hasMetadata = book.metadata && typeof book.metadata === 'object';
          const current = model ? model.read(book) : (book.metadata || {});
          const next = { ...current, ...changes };
          // Create metadata if it didn't exist (new academic book)
          if (!hasMetadata) {
            book.metadata = next;
          } else {
            book.metadata = next;
          }
          if (book.academic) delete book.academic;
          return book.metadata;
        }
      },
      ipc: {
        logError: (msg) => neo && typeof neo.logError === 'function' && neo.logError(msg),
        academicState: (enabled) => neo && typeof neo.academicState === 'function' && neo.academicState(enabled),
        exportSave: (payload) => neo && typeof neo.exportSave === 'function' ? neo.exportSave(payload) : Promise.resolve(null),
        importFigure: (bookId) => neo && typeof neo.importAcademicFigure === 'function' ? neo.importAcademicFigure(bookId) : Promise.resolve(null),
        readFigure: (bookId, file) => neo && typeof neo.readAcademicFigure === 'function' ? neo.readAcademicFigure(bookId, file) : Promise.resolve(null),
        copyFigure: (source, target, figure) => neo && typeof neo.copyAcademicFigure === 'function' ? neo.copyAcademicFigure(source, target, figure) : Promise.resolve(null),
        renderMath: (source, format, display) => neo && typeof neo.renderAcademicMath === 'function' ? neo.renderAcademicMath(source, format, display) : Promise.resolve(source),
        writeBibliography: (bookId, text) => neo && typeof neo.writeAcademicBibliography === 'function' ? neo.writeAcademicBibliography(bookId, text) : Promise.resolve(null)
      },
      dom: {
        getSelection: () => window.getSelection(),
        execCommand: (cmd, ui, value) => document.execCommand(cmd, ui, value),
        dispatchEvent: (type, detail) => {
          document.dispatchEvent(new CustomEvent(type, { detail }));
        }
      }
    });

    // Load deep modules via factories, keeping implementation hidden
    const theme = (typeof window !== 'undefined' && window.NeoAcademicTheme) && window.NeoAcademicTheme.create({
      document,
      getBook,
      translate,
      report,
      model
    });

    const ui = (typeof window !== 'undefined' && window.NeoAcademicUI) && window.NeoAcademicUI.create({
      document,
      getBook,
      translate,
      report,
      uniqueId: (prefix) => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return prefix + '-' + crypto.randomUUID();
        return prefix + '-' + Math.random().toString(36).slice(2);
      }
    });

    // Internal state kept private to plugin
    let bookmark = null;
    let programmaticEdit = false;

    // Small interface functions
    function currentBook() { return getBook(); }
    function metadata() {
      const b = currentBook();
      return b ? adapters.bookStore.readMetadata(b) : null;
    }
    function commitMetadata(changes) {
      const b = currentBook();
      if (!b) throw new Error(translate('Open a book first'));
      return adapters.bookStore.writeMetadata(b, changes);
    }
    function applyMode(enabled) {
      document.body.classList.toggle('academic-mode', enabled);
      adapters.ipc.academicState(enabled);
    }
    function isActive() {
      const meta = metadata();
      return meta && meta.academicMode === true;
    }

    // Public interface - deep module with small surface
    return Object.freeze({
      // Lifecycle
      init: () => {
        // Plugin is initialized lazily by core
        return true;
      },
      shutdown: () => {
        // Clean up listeners etc.
        return true;
      },

      // State queries
      isActive,
      isAcademicBook,

      // Mode control
      toggleMode: () => {
        const meta = metadata();
        if (!meta) throw new Error(translate('Open a book first'));
        const enabled = !meta.academicMode;
        commitMetadata({ academicMode: enabled });
        applyMode(enabled);
        return enabled;
      },
      setMode: (enabled) => {
        commitMetadata({ academicMode: !!enabled });
        applyMode(!!enabled);
        return !!enabled;
      },

      // Metadata
      getMetadata: () => metadata(),
      updateMetadata: (changes) => commitMetadata(changes),

      // Theme
      getTheme: (kind) => {
        if (!theme) return null;
        const meta = metadata();
        if (!meta) return null;
        return theme.themeForBook(currentBook(), kind);
      },
      applyTheme: (root, name) => {
        if (theme) theme.applyTheme(root, name);
      },
      applyWritingTheme: (root, book) => {
        if (theme) {
          const t = theme.themeForBook(book || currentBook(), 'writing');
          theme.applyTheme(root, t.id);
        }
      },

      // UI helpers exposed as small interface
      ui: ui ? { dialog: ui.dialog, button: ui.button, eventAction: ui.eventAction } : null,

      // Adapters exposed for testing only via internal property
      _adapters: adapters
    });
  }

  // Export as UMD
  if (typeof window !== 'undefined') {
    window.NeoAcademicPlugin = { create: createPlugin };
  } else {
    module.exports = { createPlugin };
  }
})();
