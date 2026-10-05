(function() {
  const PRESETS = {
    'latex-plain': { id:'latex-plain', name:'LaTeX Plain', base:null, typography:{fontFamily:'Times New Roman, serif',fontSizePt:11,lineHeight:1.15,leading:'1.0',measure:'65ch'}, page:{marginTop:'1in',marginBottom:'1in',marginLeft:'1in',marginRight:'1in',columns:1}, headings:{h1:{size:16,weight:700,spacing:'1.2em'},h2:{size:14,weight:700,spacing:'1em'},h3:{size:12,weight:600,spacing:'0.8em'}}, captions:{figure:{fontSize:9,weight:400,align:'center'},table:{fontSize:9,weight:400,align:'center'}}, math:{displaySpacing:'1.2em',inlineSpacing:'0.1em'}, exportOverrides:{latex:{documentclass:'article',packages:['amsmath'],spacing:'single'}} },
    'latex-double': { id:'latex-double', name:'LaTeX Double Space', base:'latex-plain', typography:{fontSizePt:12,lineHeight:2.0,leading:'2.0'}, page:{marginTop:'1in',marginBottom:'1in',marginLeft:'1in',marginRight:'1in',columns:1}, headings:{h1:{size:16,weight:700,spacing:'1.2em'},h2:{size:14,weight:700,spacing:'1em'},h3:{size:12,weight:600,spacing:'0.8em'}}, captions:{figure:{fontSize:9,weight:400,align:'center'},table:{fontSize:9,weight:400,align:'center'}}, math:{displaySpacing:'1.2em',inlineSpacing:'0.1em'}, exportOverrides:{latex:{documentclass:'article',packages:['amsmath'],spacing:'double'}} },
    'nature': { id:'nature', name:'Nature', base:null, typography:{fontFamily:'Helvetica, Arial, sans-serif',fontSizePt:7,lineHeight:1.1,leading:'1.0',measure:'48ch'}, page:{marginTop:'0.75in',marginBottom:'0.75in',marginLeft:'0.75in',marginRight:'0.75in',columns:1}, headings:{h1:{size:9,weight:700,spacing:'0.6em'},h2:{size:8,weight:700,spacing:'0.5em'},h3:{size:7,weight:600,spacing:'0.4em'}}, captions:{figure:{fontSize:6,weight:400,align:'center'},table:{fontSize:6,weight:400,align:'center'}}, math:{displaySpacing:'0.8em',inlineSpacing:'0.05em'} },
    'science': { id:'science', name:'Science', base:null, typography:{fontFamily:'Helvetica, Arial, sans-serif',fontSizePt:9,lineHeight:1.2,leading:'1.0',measure:'44ch'}, page:{marginTop:'0.75in',marginBottom:'0.75in',marginLeft:'0.75in',marginRight:'0.75in',columns:2,columnGap:'0.3in'}, headings:{h1:{size:10,weight:700,spacing:'0.6em'},h2:{size:9,weight:700,spacing:'0.5em'},h3:{size:8,weight:600,spacing:'0.4em'}}, captions:{figure:{fontSize:8,weight:400,align:'center'},table:{fontSize:8,weight:400,align:'center'}}, math:{displaySpacing:'0.9em',inlineSpacing:'0.06em'} },
    'chicago': { id:'chicago', name:'Chicago Manual', base:'latex-plain', typography:{fontFamily:'Times New Roman, serif',fontSizePt:12,lineHeight:2.0,leading:'2.0',measure:'65ch'}, page:{marginTop:'1in',marginBottom:'1in',marginLeft:'1.25in',marginRight:'1.25in',columns:1}, headings:{h1:{size:18,weight:700,spacing:'1.4em'},h2:{size:14,weight:700,spacing:'1em'},h3:{size:12,weight:600,spacing:'0.8em'}}, captions:{figure:{fontSize:9,weight:400,align:'center'},table:{fontSize:9,weight:400,align:'center'}}, math:{displaySpacing:'1.2em',inlineSpacing:'0.1em'} },
    'ams': { id:'ams', name:'AMS', base:'latex-plain', typography:{fontFamily:'Times New Roman, serif',fontSizePt:10,lineHeight:1.3,leading:'1.0',measure:'65ch'}, page:{marginTop:'1in',marginBottom:'1in',marginLeft:'1in',marginRight:'1in',columns:1}, headings:{h1:{size:16,weight:700,spacing:'1.2em'},h2:{size:14,weight:700,spacing:'1em'},h3:{size:12,weight:600,spacing:'0.8em'}}, captions:{figure:{fontSize:9,weight:400,align:'center'},table:{fontSize:9,weight:400,align:'center'}}, math:{displaySpacing:'1.4em',inlineSpacing:'0.12em'} },
    'lncs': { id:'lncs', name:'LNCS', base:null, typography:{fontFamily:'Helvetica, Arial, sans-serif',fontSizePt:10,lineHeight:1.2,leading:'1.0',measure:'42ch'}, page:{marginTop:'0.75in',marginBottom:'0.75in',marginLeft:'0.75in',marginRight:'0.75in',columns:2,columnGap:'0.25in'}, headings:{h1:{size:12,weight:700,spacing:'0.8em'},h2:{size:10,weight:700,spacing:'0.6em'},h3:{size:9,weight:600,spacing:'0.5em'}}, captions:{figure:{fontSize:8,weight:400,align:'center'},table:{fontSize:8,weight:400,align:'center'}}, math:{displaySpacing:'0.9em',inlineSpacing:'0.06em'} }
  };

  function mergeTheme(base, over) {
    if (!base) return over;
    return {
      id: over.id,
      name: over.name ?? base.name,
      base: over.base ?? base.base,
      typography: { ...base.typography, ...over.typography },
      page: { ...base.page, ...over.page },
      headings: { h1:{...base.headings.h1,...over.headings?.h1}, h2:{...base.headings.h2,...over.headings?.h2}, h3:{...base.headings.h3,...over.headings?.h3} },
      captions: { figure:{...base.captions.figure,...over.captions?.figure}, table:{...base.captions.table,...over.captions?.table} },
      math: { ...base.math, ...over.math },
      exportOverrides: { ...base.exportOverrides, ...over.exportOverrides }
    };
  }

  class ThemeRegistry {
    constructor() { 
      this.map = new Map(Object.entries(PRESETS));
      // Load external presets if available
      try {
        if (typeof require !== 'undefined') {
          const presets = require('./themes/presets.js');
          Object.entries(presets).forEach(([id, preset]) => this.map.set(id, preset));
        }
      } catch(e) {}
    }
    listThemes() { return Array.from(this.map.values()).map(t=>({id:t.id,name:t.name})); }
    getTheme(id) {
      const t = this.map.get(id);
      if (!t) throw new Error('Theme not found: '+id);
      if (!t.base) return t;
      const base = this.getTheme(t.base);
      return mergeTheme(base, t);
    }
    registerTheme(theme) {
      if (!theme || !theme.id) throw new Error('Invalid theme descriptor');
      this.map.set(theme.id, theme);
    }
  }

  function create({ document, getBook, translate, report, model }) {
    const registry = new ThemeRegistry();
    const defaultId = 'latex-plain';
    function themeForBook(book, kind = 'writing') {
      const meta = model ? model.read(book) : (book && book.metadata ? book.metadata : {});
      const id = kind === 'export' ? (meta.exportTheme || meta.writingTheme || defaultId) : (meta.writingTheme || meta.exportTheme || meta.theme || defaultId);
      try { return registry.getTheme(id); } catch { return registry.getTheme(defaultId); }
    }
    function persistTheme(book, name, kind = 'writing') {
      if (!model) throw new Error('Model required for persistence');
      const meta = model.read(book);
      const key = kind === 'export' ? 'exportTheme' : 'writingTheme';
      book.metadata = { ...meta, [key]: name };
      return book;
    }
    function applyTheme(root, name) {
      if (!root) return;
      const theme = registry.getTheme(name);
      const t = theme.typography;
      const p = theme.page;
      root.dataset.theme = name;
      root.style.setProperty('--theme-font-family', t.fontFamily);
      root.style.setProperty('--theme-font-size-pt', String(t.fontSizePt));
      root.style.setProperty('--theme-line-height', String(t.lineHeight));
      root.style.setProperty('--theme-measure', t.measure);
      root.style.setProperty('--theme-margin-top', p.marginTop);
      root.style.setProperty('--theme-margin-bottom', p.marginBottom);
      root.style.setProperty('--theme-margin-left', p.marginLeft);
      root.style.setProperty('--theme-margin-right', p.marginRight);
      root.style.setProperty('--theme-columns', String(p.columns));
    }
    return {
      listThemes: () => registry.listThemes(),
      getTheme: (id) => registry.getTheme(id),
      registerTheme: (theme) => registry.registerTheme(theme),
      applyTheme,
      themeForBook,
      persistTheme,
      applyWritingTheme: (root, book) => {
        const theme = themeForBook(book, 'writing');
        applyTheme(root, theme.id);
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.NeoAcademicTheme = { create };
  } else {
    module.exports = { create };
  }
})();
