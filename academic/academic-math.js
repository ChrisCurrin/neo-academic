(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require);
  else root.NeoAcademicMath = factory(null);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (load) {
  'use strict';
  let engine;
  function validate(source, format, display) {
    if (typeof source !== 'string' || source.length > 20000) throw new Error('Invalid equation source (maximum 20000 characters)');
    if (!['tex', 'asciimath'].includes(format)) throw new Error('Invalid math format');
    if (typeof display !== 'boolean') throw new Error('Invalid math display mode');
    // TeX's optional HTML extensions must never produce active markup.
    if (/\\(?:href|url|htmlClass|htmlId|htmlStyle|htmlData|require)\b/i.test(source)) throw new Error('Unsafe TeX command');
  }
  function renderServer(source, format = 'tex', display = true) {
    validate(source, format, display);
    if (!load) throw new Error('Math renderer is available only in the main process');
    if (!engine) {
      const { mathjax } = load('mathjax-full/js/mathjax.js');
      const { TeX } = load('mathjax-full/js/input/tex.js');
      const { AsciiMath } = load('mathjax-full/js/input/asciimath.js');
      const { SVG } = load('mathjax-full/js/output/svg.js');
      const { liteAdaptor } = load('mathjax-full/js/adaptors/liteAdaptor.js');
      const { RegisterHTMLHandler } = load('mathjax-full/js/handlers/html.js');
      load('mathjax-full/js/input/tex/ams/AmsConfiguration.js');
      const adaptor = liteAdaptor();
      RegisterHTMLHandler(adaptor);
      engine = { adaptor, docs: {
        tex: mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams'], maxBuffer: 20000 }), OutputJax: new SVG({ fontCache: 'none' }) }),
        asciimath: mathjax.document('', { InputJax: new AsciiMath(), OutputJax: new SVG({ fontCache: 'none' }) })
      } };
    }
    const node = engine.docs[format].convert(source, { display });
    const svg = engine.adaptor.innerHTML(node);
    if (!/^\s*<svg[\s>]/.test(svg) || /data-mjx-error|<merror\b/.test(svg)) throw new Error('Unable to render equation');
    return svg;
  }
  async function render(source, format = 'tex', display = true, adapter) {
    validate(source, format, display);
    const fn = adapter || (typeof window !== 'undefined' && window.neo && window.neo.renderAcademicMath);
    if (fn) return fn(source, format, display);
    return renderServer(source, format, display);
  }
  return { validate, render, renderServer };
}));
