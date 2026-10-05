/* Academic export API: build(manuscript, { format, profile, document?, references? }).
 * Node callers inject a DOM document; browsers use the current document.
 * Object metadata is authoritative, while chapter DOM determines placement.
 * Figures must be hydrated PNG/JPEG/GIF/SVG data URLs. HTML/PDF, DOCX and Typst
 * equations require local MathJax SVG/image previews. TeX math is never inferred
 * from AsciiMath. TeX/Typst return ZIP payloads with source, assets and bibliography.
 * DOCX SVG previews require SVG-capable Word; older viewers see a PNG placeholder.
 * Markdown uses Pandoc citations with embedded CSL references and a preformatted
 * profile bibliography; use --citeproc and a matching --csl for citation rendering.
 * TXT is an explicit textual representation of figures/equations, not a binary
 * image export. EPUB packages the same safe static content and actual image assets.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.NeoAcademicExport = factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const PROFILES = {
    apa: { font: 'Times New Roman', size: 12, spacing: 2, bibliography: 'References' },
    mla: { font: 'Times New Roman', size: 12, spacing: 2, bibliography: 'Works Cited' },
    chicago: { font: 'Times New Roman', size: 12, spacing: 2, bibliography: 'Bibliography' },
    ieee: { font: 'Times New Roman', size: 10, spacing: 1, bibliography: 'References', columns: 2 }
  };
  const str = value => value == null ? '' : String(value);
  const xml = value => str(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const tex = value => str(value).replace(/[\\{}$&#%_^~]/g, c => ({
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&',
    '#': '\\#', '%': '\\%', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}'
  }[c]));
  const md = value => str(value).replace(/[\\`*_{}[\]<>()!#+|~@$]/g, '\\$&');
  const typ = value => str(value).replace(/[\\#*\[\]_$<>@`]/g, '\\$&');
  const safeUrl = value => /^(https?:\/\/|mailto:)/i.test(str(value).trim()) && !/[\u0000-\u0020]/.test(str(value)) ? str(value) : '';
  const svgUrl = content => 'data:image/svg+xml,' + encodeURIComponent(content).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const children = node => Array.from(node.childNodes || []);
  const text = nodes => nodes.map(n => n.type === 'text' ? n.value : n.text || text(n.children || [])).join('');
  const name = value => str(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 120) || 'Manuscript';
  const FALLBACK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVQAAAABJRU5ErkJggg==';

  function adapter(options) {
    if (options.references || options.refsAdapter || options.referenceAdapter) return options.references || options.refsAdapter || options.referenceAdapter;
    if (root.NeoReferences) return root.NeoReferences;
    if (typeof require === 'function') {
      try { return require('./references.js'); } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes("'./references.js'")) throw error;
      }
    }
    return null;
  }

  function context(input, options) {
    const dom = options.document || options.domDocument || root.document;
    if (!dom || typeof dom.createElement !== 'function') throw new Error('Academic export requires a DOM document (options.document in Node).');
    const profile = options.profile || input.profile || 'apa';
    if (!PROFILES[profile]) throw new Error('Unknown academic profile: ' + profile);
    const meta = input.metadata || {};
    const refs = Array.isArray(meta.references) ? meta.references : [];
    const maps = {};
    ['figure', 'table', 'equation'].forEach(kind => {
      maps[kind] = new Map();
      (meta[kind === 'equation' ? 'equations' : kind + 's'] || []).forEach((model, index) => {
        const id = str(model.id);
        if (!id || maps[kind].has(id)) throw new Error('Missing or duplicate ' + kind + ' ID: ' + id);
        maps[kind].set(id, { ...model, id, number: index + 1, key: kind + '-' + (index + 1) });
      });
    });
    const refKeys = new Map();
    refs.forEach((ref, index) => {
      const id = str(ref.id || ref.key);
      if (!id || refKeys.has(id)) throw new Error('Missing or duplicate reference ID: ' + id);
      refKeys.set(id, 'ref-' + (index + 1));
    });
    return { input, meta, dom, profile, settings: PROFILES[profile], refs, refKeys, maps,
      adapter: adapter(options), cited: [], assets: [], emitted: new Set(), counters: { figure: 0, table: 0, equation: 0 } };
  }

  function sanitizeSvg(source, ctx) {
    const holder = ctx.dom.createElement('div');
    holder.innerHTML = source;
    const svg = holder.firstElementChild;
    if (!svg || svg.localName.toLowerCase() !== 'svg') throw new Error('Invalid SVG preview.');
    const tags = new Set(['svg', 'g', 'path', 'defs', 'use', 'rect', 'line', 'circle', 'ellipse',
      'polygon', 'polyline', 'text', 'tspan', 'title', 'desc', 'clippath', 'mask']);
    const attributes = new Set(['xmlns', 'xmlns:xlink', 'viewbox', 'width', 'height', 'id', 'd', 'fill',
      'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule',
      'clip-rule', 'transform', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
      'points', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family',
      'text-anchor', 'dominant-baseline', 'role', 'aria-label', 'focusable', 'preserveaspectratio',
      'href', 'xlink:href', 'clip-path', 'mask']);
    function clean(node) {
      if (node.nodeType === 3) return xml(node.textContent);
      if (node.nodeType !== 1 || !tags.has(node.localName.toLowerCase())) return '';
      const tag = node.localName;
      let attrs = '';
      Array.from(node.attributes).forEach(attr => {
        const key = attr.name.toLowerCase();
        const val = attr.value;
        if (!attributes.has(key)) return;
        if ((key === 'href' || key === 'xlink:href') && !/^#[\w:.-]+$/.test(val)) return;
        if (/url\s*\(/i.test(val) && !/^url\(#[\w:.-]+\)$/.test(val)) return;
        if (/javascript:|data:|https?:|expression\s*\(/i.test(val) && key !== 'xmlns' && key !== 'xmlns:xlink') return;
        attrs += ' ' + attr.name + '="' + xml(val) + '"';
      });
      if (tag.toLowerCase() === 'svg' && !node.hasAttribute('xmlns')) attrs += ' xmlns="http://www.w3.org/2000/svg"';
      return '<' + tag + attrs + '>' + children(node).map(clean).join('') + '</' + tag + '>';
    }
    return clean(svg);
  }

  function imageData(value, ctx) {
    const match = /^data:image\/(png|jpeg|jpg|gif|svg\+xml)(;base64|;charset=utf-8|;utf8)?,([\s\S]+)$/i.exec(str(value));
    if (!match) throw new Error('Academic images must be hydrated safe image data URLs.');
    const type = match[1].toLowerCase();
    let content = match[3], base64 = str(match[2]).toLowerCase() === ';base64';
    if (base64 && !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new Error('Invalid image base64.');
    if (type === 'svg+xml') {
      if (base64) {
        content = typeof Buffer !== 'undefined' ? Buffer.from(content, 'base64').toString('utf8') : decodeURIComponent(escape(root.atob(content)));
      } else {
        try { content = decodeURIComponent(content); } catch (_) { throw new Error('Invalid SVG data URL.'); }
      }
      content = sanitizeSvg(content, ctx);
      base64 = false;
    } else if (!base64) throw new Error('Raster images must use base64 data URLs.');
    const ext = type === 'svg+xml' ? 'svg' : type === 'jpg' ? 'jpeg' : type;
    const dataUrl = base64 ? 'data:image/' + ext + ';base64,' + content : svgUrl(content);
    return { ext, content, base64, dataUrl, mime: 'image/' + (ext === 'svg' ? 'svg+xml' : ext) };
  }

  function imageRatio(image) {
    if (image.ext === 'svg') {
      const box = /viewBox="([^"]+)"/i.exec(image.content);
      if (box) {
        const numbers = box[1].trim().split(/[\s,]+/).map(Number);
        if (numbers.length === 4 && numbers[2] > 0 && numbers[3] > 0) return numbers[2] / numbers[3];
      }
      return 3;
    }
    const binary = typeof Buffer !== 'undefined' ? Buffer.from(image.content, 'base64') : Uint8Array.from(root.atob(image.content), c => c.charCodeAt(0));
    const u16 = i => binary[i] * 256 + binary[i + 1];
    const u32 = i => u16(i) * 65536 + u16(i + 2);
    if (image.ext === 'png' && binary.length >= 24 && u32(20)) return u32(16) / u32(20);
    if (image.ext === 'gif' && binary.length >= 10 && binary[8] + binary[9] * 256) return (binary[6] + binary[7] * 256) / (binary[8] + binary[9] * 256);
    if (image.ext === 'jpeg') {
      let pos = 2;
      while (pos + 8 < binary.length && binary[pos] === 255) {
        const marker = binary[pos + 1], length = u16(pos + 2);
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && u16(pos + 5)) return u16(pos + 7) / u16(pos + 5);
        if (length < 2) break;
        pos += length + 2;
      }
    }
    return 5 / 3;
  }

  function objectNode(node, kind, ctx) {
    const id = node.getAttribute('data-academic-id');
    const model = ctx.maps[kind].get(id);
    if (!model) throw new Error('No authoritative metadata for ' + kind + ': ' + id);
    if (ctx.emitted.has(model.key)) throw new Error('Duplicate academic object in manuscript: ' + id);
    ctx.emitted.add(model.key);
    model.number = kind === 'equation' && model.display === false ? null : ++ctx.counters[kind];
    const result = { type: kind, model };
    if (kind === 'figure') result.image = imageData(model.dataUrl || (node.querySelector('img') || {}).src, ctx);
    if (kind === 'equation') {
      const svg = node.querySelector('svg');
      const img = node.querySelector('img');
      if (model.dataUrl) result.image = imageData(model.dataUrl, ctx);
      else if (svg) {
        const content = sanitizeSvg(svg.outerHTML, ctx);
        result.image = { ext: 'svg', content, base64: false, mime: 'image/svg+xml', dataUrl: svgUrl(content) };
      } else if (img) result.image = imageData(img.src, ctx);
      if (!['tex', 'asciimath'].includes(model.format)) throw new Error('Unsupported equation source format: ' + model.format);
    }
    if (result.image) {
      result.asset = 'assets/' + model.key + '.' + result.image.ext;
      ctx.assets.push({ path: result.asset, content: result.image.content, base64: result.image.base64 });
    }
    return result;
  }

  function parseNode(node, ctx) {
    if (node.nodeType === 3) return { type: 'text', value: node.textContent };
    if (node.nodeType !== 1) return null;
    const tag = node.localName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'img'].includes(tag)) return null;
    const has = cls => node.classList.contains(cls);
    for (const kind of ['figure', 'table', 'equation']) if (has('academic-' + kind)) return objectNode(node, kind, ctx);
    if (has('academic-citation')) {
      let ids;
      try { ids = JSON.parse(node.getAttribute('data-cites')); } catch (_) { throw new Error('Invalid citation data-cites JSON.'); }
      if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string' || !ctx.refKeys.has(id))) throw new Error('Citation references an unknown ID.');
      ids.forEach(id => { if (!ctx.cited.includes(id)) ctx.cited.push(id); });
      if (!ctx.adapter) throw new Error('NeoReferences adapter is required for citations.');
      return { type: 'citation', ids, text: str(ctx.adapter.citation(ctx.refs, ids, { profile: ctx.profile, style: ctx.input.citationStyle || ctx.meta.citationStyle, citedIds: ctx.cited })) };
    }
    if (has('academic-xref')) {
      const kind = node.getAttribute('data-kind'), id = node.getAttribute('data-target');
      const model = ctx.maps[kind] && ctx.maps[kind].get(id);
      if (!model) throw new Error('Cross-reference targets an unknown object: ' + id);
      return { type: 'xref', kind, model, text: kind[0].toUpperCase() + kind.slice(1) + ' ' + model.number };
    }
    const content = children(node).map(child => parseNode(child, ctx)).filter(Boolean);
    if (tag === 'br') return { type: 'break' };
    if (['strong', 'b', 'em', 'i', 'sup', 'sub', 's', 'del', 'code'].includes(tag)) {
      return { type: ({ b: 'strong', i: 'em', del: 's' })[tag] || tag, children: content };
    }
    if (tag === 'a') return { type: 'link', href: safeUrl(node.getAttribute('href')), children: content };
    if (/^h[1-6]$/.test(tag)) return { type: 'heading', level: Number(tag[1]), children: content };
    if (['p', 'div', 'blockquote', 'ul', 'ol', 'li', 'pre'].includes(tag)) return { type: tag, children: content };
    return { type: 'group', children: content };
  }

  function chapters(ctx) {
    return (ctx.input.chapters || []).map((chapter, index) => {
      const holder = ctx.dom.createElement('div');
      holder.innerHTML = str(chapter.html);
      return { title: str(chapter.title), key: 'chapter-' + (index + 1), nodes: children(holder).map(n => parseNode(n, ctx)).filter(Boolean) };
    });
  }

  function table(model) {
    const rows = Array.isArray(model.rows) ? model.rows.map(row => Array.isArray(row) ? row.map(str) : []) : [];
    if (Array.isArray(model.header)) rows.unshift(model.header.map(str));
    return { rows, header: Boolean(model.header), align: ['left', 'center', 'right'].includes(model.align) ? model.align : 'left' };
  }

  function equationTex(model) {
    if (model.format !== 'tex') throw new Error('AsciiMath cannot be emitted as TeX; provide a local SVG/image preview.');
    const source = str(model.source);
    // Sources are mathematical input, not a route to arbitrary TeX document commands.
    if (/[$%#]|[\u0000-\u0008\u000b\u000c\u000e-\u001f]|\^\^|\\[()[\]]/.test(source)) {
      throw new Error('Unsafe TeX equation source.');
    }
    const commands = new Set(('begin end frac dfrac tfrac sqrt root text textrm textbf textit operatorname mathrm mathbf mathit mathsf mathtt mathbb mathcal mathscr boldsymbol binom dbinom tbinom over under atop choose left right middle big Big bigg Bigg bigl bigr Bigl Bigr biggl biggr Biggl Biggr limits nolimits substack overset underset overline underline widehat widetilde hat tilde bar vec dot ddot acute grave breve check mathop mathrel mathbin mathord mathpunct mathopen mathclose sum prod coprod int iint iiint oint oiint bigcup bigcap bigvee bigwedge bigoplus bigotimes lim limsup liminf min max sup inf det gcd log ln exp sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth ker dim hom Pr mod pmod bmod alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega infty partial nabla ell hbar imath jmath Re Im emptyset varnothing forall exists nexists neg land lor lnot to mapsto rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow uparrow downarrow Uparrow Downarrow longrightarrow longleftarrow longleftrightarrow Longrightarrow Longleftarrow Longleftrightarrow hookrightarrow hookleftarrow le leq ge geq ne neq approx sim simeq equiv cong propto ll gg prec succ preceq succeq subset supset subseteq supseteq in notin ni cup cap setminus times div cdot ast star circ bullet pm mp oplus ominus otimes oslash odot parallel perp angle triangle triangleq square diamond prime degree ldots cdots vdots ddots dots langle rangle lbrace rbrace lvert rvert lVert rVert vert Vert backslash colon quad qquad enspace thinspace displaystyle textstyle scriptstyle scriptscriptstyle phantom vphantom hphantom color').split(' '));
    for (const match of source.matchAll(/\\([a-zA-Z]+|.)/g)) {
      if (!commands.has(match[1]) && !/^[\\{},;:! |&_^~]$/.test(match[1])) throw new Error('Unsupported or unsafe TeX math command: \\' + match[1]);
    }
    const environments = source.matchAll(/\\(?:begin|end)\s*\{([^}]+)\}/g);
    for (const match of environments) if (!/^(?:[pbBvV]?matrix|cases|aligned|alignedat|gathered|smallmatrix|split)$/.test(match[1])) throw new Error('Unsupported TeX math environment.');
    const stack = [];
    for (const match of source.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
      if (match[1] === 'begin') stack.push(match[2]);
      else if (stack.pop() !== match[2]) throw new Error('Unbalanced TeX math environment.');
    }
    if (stack.length) throw new Error('Unbalanced TeX math environment.');
    let balance = 0;
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\\') { i++; continue; }
      if (source[i] === '{') balance++;
      if (source[i] === '}' && --balance < 0) throw new Error('Unbalanced TeX equation.');
    }
    if (balance !== 0) throw new Error('Unbalanced TeX equation.');
    return source;
  }

  function bibliography(ctx) {
    if (!ctx.refs.length) return [];
    if (!ctx.adapter) throw new Error('NeoReferences adapter is required for a bibliography.');
    return ctx.adapter.bibliography(ctx.refs, ctx.cited, { profile: ctx.profile, style: ctx.input.citationStyle || ctx.meta.citationStyle, citedIds: ctx.cited });
  }

  function authors(ctx) {
    return (ctx.meta.authors || []).map(a => [a.name, a.affiliation, a.orcid && 'ORCID: ' + a.orcid].filter(Boolean).join(' — ')).join('\n') || str(ctx.input.author);
  }

  function attribution(model) {
    return [model.attribution, model.source && 'Source: ' + model.source, model.license && 'License: ' + model.license].filter(Boolean).join(' · ');
  }

  function htmlNode(n, ctx) {
    const nested = () => (n.children || []).map(child => htmlNode(child, ctx)).join('');
    if (n.type === 'text') return xml(n.value);
    if (n.type === 'break') return '<br>';
    if (n.type === 'citation') return '<span class="citation">' + xml(n.text) + '</span>';
    if (n.type === 'xref') return '<a href="#' + n.model.key + '">' + xml(n.text) + '</a>';
    if (n.type === 'link') return n.href ? '<a href="' + xml(n.href) + '">' + nested() + '</a>' : nested();
    if (n.type === 'heading') return '<h' + n.level + '>' + nested() + '</h' + n.level + '>';
    if (n.type === 'figure') return '<figure id="' + n.model.key + '"><img src="' + xml(n.image.dataUrl) + '" alt="' + xml(n.model.alt) + '"><figcaption>Figure ' + n.model.number + '. ' + xml(n.model.caption) + '</figcaption><p class="attribution">' + xml(attribution(n.model)) + '</p></figure>';
    if (n.type === 'table') {
      const t = table(n.model);
      return '<figure id="' + n.model.key + '"><figcaption>Table ' + n.model.number + '. ' + xml(n.model.caption) + '</figcaption><table class="' + (n.model.borders === false ? 'borderless' : 'bordered') + (n.model.shading ? ' shaded' : '') + '" style="text-align:' + t.align + '">' + t.rows.map((row, i) => '<tr>' + row.map(cell => '<' + (i === 0 && t.header ? 'th' : 'td') + '>' + xml(cell) + '</' + (i === 0 && t.header ? 'th' : 'td') + '>').join('') + '</tr>').join('') + '</table></figure>';
    }
    if (n.type === 'equation') {
      const preview = n.image ? '<img class="math" src="' + xml(n.image.dataUrl) + '" alt="' + xml((n.model.format === 'tex' ? 'TeX: ' : 'AsciiMath: ') + str(n.model.source)) + '">' : (n.model.format === 'tex' ? '\\(' + xml(equationTex(n.model)) + '\\)' : '');
      if (!n.image) throw new Error('HTML/PDF equations require a local MathJax SVG/image preview.');
      const tag = n.model.display === false ? 'span' : 'div';
      return '<' + tag + ' class="equation" id="' + n.model.key + '">' + preview + (n.model.display === false ? '' : '<span class="equation-number">(' + n.model.number + ')</span>') + '</' + tag + '>';
    }
    const tags = { strong: 'strong', em: 'em', sup: 'sup', sub: 'sub', s: 's', code: 'code',
      p: 'p', div: 'div', blockquote: 'blockquote', ul: 'ul', ol: 'ol', li: 'li', pre: 'pre' };
    return tags[n.type] ? '<' + tags[n.type] + '>' + nested() + '</' + tags[n.type] + '>' : nested();
  }

  function html(ctx, sections, bib) {
    const s = ctx.settings;
    const margin = s.columns ? '1in 0.75in 0.75in' : '1in';
    const css = '@page{size:letter;margin:' + margin + '}*{box-sizing:border-box}body{margin:' + margin + ';font-family:"' + s.font + '",serif;font-size:' + s.size + 'pt;line-height:' + s.spacing + ';color:#000}p{margin:0 0 0.5em}main p{text-indent:0.5in}h1,h2,h3,h4,h5,h6{line-height:1.3;break-after:avoid}h1{text-align:center}h2{font-size:1.2em}a{color:inherit}header{text-align:center}header p{white-space:pre-line}figure{margin:1em 0;break-inside:avoid}img{max-width:100%;height:auto}.math{max-height:12em;vertical-align:middle}.equation{position:relative;text-align:center;break-inside:avoid}.equation-number{float:right}table{border-collapse:collapse;width:100%;font-size:inherit}td,th{padding:0.3em}.bordered td,.bordered th{border:1px solid #555}.shaded th{background:#eee}.attribution{font-size:0.85em}.bibliography p{padding-left:0.5in;text-indent:-0.5in;overflow-wrap:anywhere}.toc ol{list-style:none;padding:0}' + (s.columns ? 'main,.bibliography{column-count:2;column-gap:0.25in}' : '') + '@media print{body{margin:0}.toc{break-after:page}header{break-after:page}}';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><title>' + xml(ctx.input.title) + '</title><style>' + css + '</style></head><body data-profile="' + ctx.profile + '"><header><h1>' + xml(ctx.input.title) + '</h1><p>' + xml(ctx.input.subtitle) + '</p><p>' + xml(authors(ctx)) + '</p></header>' +
      (ctx.meta.abstract ? '<section><h2>Abstract</h2><p>' + xml(ctx.meta.abstract) + '</p></section>' : '') +
      (ctx.meta.keywords && ctx.meta.keywords.length ? '<p><strong>Keywords:</strong> ' + xml(ctx.meta.keywords.join(', ')) + '</p>' : '') +
      '<nav class="toc" aria-label="Contents"><h2>Contents</h2><ol>' + sections.map(s => '<li><a href="#' + s.key + '">' + xml(s.title) + '</a></li>').join('') + '</ol></nav><main>' +
      sections.map(s => '<section id="' + s.key + '"><h2>' + xml(s.title) + '</h2>' + s.nodes.map(n => htmlNode(n, ctx)).join('') + '</section>').join('') +
      '</main><section class="bibliography"><h2>' + ctx.settings.bibliography + '</h2>' + bib.map(b => '<p id="' + (ctx.refKeys.get(str(b.id)) || 'reference') + '">' + xml(b.text) + '</p>').join('') + '</section></body></html>';
  }

  function markdownNode(n, ctx) {
    const inner = () => (n.children || []).map(child => markdownNode(child, ctx)).join('');
    if (n.type === 'text') return md(n.value);
    if (n.type === 'break') return '  \n';
    if (n.type === 'citation') return '[' + n.ids.map(id => '@' + ctx.refKeys.get(id)).join('; ') + ']';
    if (n.type === 'xref') return '[' + md(n.text) + '](#' + n.model.key + ')';
    if (n.type === 'link') return n.href ? '[' + inner() + '](<' + n.href.replace(/[<>\\]/g, c => encodeURIComponent(c)) + '>)' : inner();
    if (n.type === 'strong') return '**' + inner() + '**';
    if (n.type === 'em') return '*' + inner() + '*';
    if (n.type === 'code' || n.type === 'pre') return '<code>' + xml(text(n.children)) + '</code>';
    if (n.type === 'heading') return '\n' + '#'.repeat(n.level) + ' ' + inner() + '\n\n';
    if (n.type === 'figure') return '\n\n![' + md('Figure ' + n.model.number + '. ' + str(n.model.caption)) + '](' + n.image.dataUrl + '){#' + n.model.key + '}\n\n' + md(attribution(n.model)) + '\n\n';
    if (n.type === 'equation') {
      if (n.model.format === 'tex') {
        const source = equationTex(n.model);
        return n.model.display === false ? '[$' + source + '$]{#' + n.model.key + '}' : '\n\n::: {#' + n.model.key + '}\n$$' + source + '$$\n:::\n\n';
      }
      if (!n.image) throw new Error('AsciiMath Markdown export requires a local SVG/image preview.');
      const preview = '![' + md('Equation' + (n.model.number == null ? '' : ' ' + n.model.number) + ' (AsciiMath): ' + str(n.model.source)) + '](' + n.image.dataUrl + '){#' + n.model.key + '}';
      return n.model.display === false ? preview : '\n\n' + preview + '\n\n';
    }
    if (n.type === 'table') {
      const t = table(n.model), width = Math.max(1, ...t.rows.map(r => r.length));
      const row = r => '| ' + Array.from({ length: width }, (_, i) => md(r[i] || '').replace(/\r?\n/g, '<br>')).join(' | ') + ' |';
      const first = t.header ? t.rows[0] || [] : [];
      return '\n\n' + row(first) + '\n' + row(Array(width).fill(t.align === 'center' ? ':---:' : t.align === 'right' ? '---:' : '---')) +
        '\n' + (t.header ? t.rows.slice(1) : t.rows).map(row).join('\n') + '\n\n: ' + md('Table ' + n.model.number + '. ' + str(n.model.caption)) + ' {#' + n.model.key + '}\n\n';
    }
    if (n.type === 'ul' || n.type === 'ol') return '\n' + (n.children || []).filter(c => c.type === 'li').map((c, i) => (n.type === 'ol' ? (i + 1) + '. ' : '- ') + markdownNode(c, ctx).trim().replace(/\n/g, '\n  ')).join('\n') + '\n\n';
    if (n.type === 'blockquote') return '\n' + inner().trim().replace(/^/gm, '> ') + '\n\n';
    if (['sup', 'sub', 's'].includes(n.type)) return '<' + n.type + '>' + inner() + '</' + n.type + '>';
    return inner() + (['p', 'div', 'li'].includes(n.type) ? '\n\n' : '');
  }

  function bibSource(ctx) {
    // Use generated keys everywhere: arbitrary CSL IDs cannot become source syntax or paths.
    const refs = ctx.refs.map(r => ({ ...r, id: ctx.refKeys.get(str(r.id || r.key)), key: ctx.refKeys.get(str(r.id || r.key)) }));
    if (!refs.length) return '';
    return str(ctx.adapter.export(refs, 'bib'));
  }

  function imageCommand(n, dialect, inline) {
    if (!n.image) throw new Error(dialect + ' equation export requires a local SVG/image preview.');
    if (dialect === 'tex') {
      if (n.image.ext === 'gif') throw new Error('LaTeX cannot embed GIF images; hydrate the figure or equation as PNG/JPEG/SVG.');
      const size = inline ? 'height=1.5em' : 'width=0.8\\linewidth';
      return n.image.ext === 'svg' ? '\\includesvg[' + size + ']{' + n.asset.slice(0, -4) + '}' : '\\includegraphics[' + size + ']{' + n.asset + '}';
    }
    return '#image("' + n.asset + '", ' + (inline ? 'height: 1.5em' : 'width: 80%') + ')';
  }

  function sourceNode(n, ctx, dialect) {
    const escape = dialect === 'tex' ? tex : typ;
    const inner = () => (n.children || []).map(child => sourceNode(child, ctx, dialect)).join('');
    if (n.type === 'text') return escape(n.value);
    if (n.type === 'break') return dialect === 'tex' ? '\\\\\n' : '#linebreak()\n';
    if (n.type === 'citation') return dialect === 'tex' ? '\\autocite{' + n.ids.map(id => ctx.refKeys.get(id)).join(',') + '}' : n.ids.map(id => '#cite(<' + ctx.refKeys.get(id) + '>)').join(' ');
    if (n.type === 'xref') return dialect === 'tex' ? escape(n.kind[0].toUpperCase() + n.kind.slice(1)) + '~\\ref{' + n.model.key + '}' : '#link(<' + n.model.key + '>)[' + escape(n.text) + ']';
    if (n.type === 'link') return n.href ? (dialect === 'tex' ? '\\href{' + tex(n.href) + '}{' + inner() + '}' : '#link(' + JSON.stringify(n.href) + ')[' + inner() + ']') : inner();
    if (n.type === 'strong' || n.type === 'em') return dialect === 'tex' ? '\\' + (n.type === 'strong' ? 'textbf' : 'emph') + '{' + inner() + '}' : '#' + (n.type === 'strong' ? 'strong' : 'emph') + '[' + inner() + ']';
    if (n.type === 'sup' || n.type === 'sub') return dialect === 'tex' ? '\\text' + (n.type === 'sup' ? 'superscript' : 'subscript') + '{' + inner() + '}' : '#' + n.type + '[' + inner() + ']';
    if (n.type === 'heading') return dialect === 'tex' ? '\n\\' + (n.level === 1 ? 'section' : n.level === 2 ? 'subsection' : 'subsubsection') + '{' + inner() + '}\n' : '\n' + '='.repeat(n.level) + ' ' + inner() + '\n\n';
    if (n.type === 'figure') {
      const caption = escape(n.model.caption), credit = escape(attribution(n.model));
      return dialect === 'tex' ? '\n\\begin{figure}[htbp]\\centering\n' + imageCommand(n, dialect) + '\n\\caption{' + caption + '}\\label{' + n.model.key + '}\n{\\small ' + credit + '}\n\\end{figure}\n' : '\n#figure(' + imageCommand(n, dialect).slice(1) + ', caption: [' + caption + ']) <' + n.model.key + '>\n' + credit + '\n\n';
    }
    if (n.type === 'table') {
      const t = table(n.model), width = Math.max(1, ...t.rows.map(r => r.length));
      if (dialect === 'typ') return '\n#figure(table(columns: ' + width + ', align: ' + t.align + ', stroke: ' + (n.model.borders === false ? 'none' : '0.5pt') + ', ' + (n.model.shading && t.header ? 'fill: (x, y) => if y == 0 { luma(92%) } else { none }, ' : '') + t.rows.map((r, i) => Array.from({ length: width }, (_, j) => '[' + (i === 0 && t.header ? '#strong[' + escape(r[j] || '') + ']' : escape(r[j] || '')) + ']').join(', ')).join(', ') + '), kind: table, caption: [' + escape(n.model.caption) + ']) <' + n.model.key + '>\n\n';
      const border = n.model.borders !== false, spec = Array(width).fill(t.align[0]).join(border ? '|' : '');
      return '\n\\begin{table}[htbp]\\centering\\caption{' + escape(n.model.caption) + '}\\label{' + n.model.key + '}\n\\begin{tabular}{' + (border ? '|' : '') + spec + (border ? '|' : '') + '}\n' + (border ? '\\hline\n' : '') + t.rows.map((r, i) => (i === 0 && t.header && n.model.shading ? '\\rowcolor{gray!15}' : '') + Array.from({ length: width }, (_, j) => i === 0 && t.header ? '\\textbf{' + escape(r[j] || '') + '}' : escape(r[j] || '')).join(' & ') + ' \\\\' + (border ? ' \\hline' : '')).join('\n') + '\n\\end{tabular}\\end{table}\n';
    }
    if (n.type === 'equation') {
      if (dialect === 'tex' && n.model.format === 'tex') {
        const source = equationTex(n.model);
        return n.model.display === false ? '\\(' + source + '\\)' : '\n\\begin{equation}\\label{' + n.model.key + '}' + source + '\\end{equation}\n';
      }
      const picture = imageCommand(n, dialect, n.model.display === false);
      if (n.model.display === false) return dialect === 'tex' ? picture : '#box[' + picture + '] <' + n.model.key + '>';
      return dialect === 'tex' ? '\n\\begin{equation}\\label{' + n.model.key + '}\\text{' + picture + '}\\end{equation}\n' : '\n#figure(' + picture.slice(1) + ', kind: "equation", caption: [Equation ' + n.model.number + ']) <' + n.model.key + '>\n\n';
    }
    if (n.type === 'ul' || n.type === 'ol') return dialect === 'tex' ? '\n\\begin{' + (n.type === 'ul' ? 'itemize' : 'enumerate') + '}\n' + (n.children || []).map(c => '\\item ' + sourceNode(c, ctx, dialect)).join('\n') + '\n\\end{' + (n.type === 'ul' ? 'itemize' : 'enumerate') + '}\n' : '\n' + (n.children || []).map(c => (n.type === 'ul' ? '- ' : '+ ') + sourceNode(c, ctx, dialect).trim()).join('\n') + '\n\n';
    if (n.type === 'blockquote') return dialect === 'tex' ? '\\begin{quote}' + inner() + '\\end{quote}' : '#quote(block: true)[' + inner() + ']';
    if (n.type === 'code' || n.type === 'pre') return dialect === 'tex' ? '\\texttt{' + escape(text(n.children)) + '}' : '#raw(' + JSON.stringify(text(n.children)) + ')';
    return inner() + (['p', 'div', 'li'].includes(n.type) ? '\n\n' : '');
  }

  function source(ctx, sections, dialect) {
    const escape = dialect === 'tex' ? tex : typ, s = ctx.settings;
    const body = sections.map(ch => (dialect === 'tex' ? '\\section{' + escape(ch.title) + '}\n' : '= ' + escape(ch.title) + '\n\n') + ch.nodes.map(n => sourceNode(n, ctx, dialect)).join('')).join('\n');
    if (dialect === 'tex') {
      const style = { apa: 'apa', mla: 'mla', chicago: 'chicago-authordate', ieee: 'ieee' }[ctx.profile];
      return '\\documentclass[' + s.size + 'pt' + (s.columns ? ',twocolumn' : '') + ']{article}\n\\usepackage[' + (s.columns ? 'top=1in,bottom=0.75in,left=0.75in,right=0.75in' : 'margin=1in') + ',letterpaper]{geometry}\n\\usepackage{fontspec}\n\\setmainfont{Times New Roman}\n\\usepackage{setspace,graphicx,svg,amsmath,hyperref}\n\\usepackage[table]{xcolor}\n\\usepackage[backend=biber,style=' + style + ']{biblatex}\n\\addbibresource{bibliography.bib}\n\\' + (s.spacing === 2 ? 'doublespacing' : 'singlespacing') + '\n\\title{' + escape(ctx.input.title) + (ctx.input.subtitle ? '\\\\' + escape(ctx.input.subtitle) : '') + '}\n\\author{' + escape(authors(ctx)).replace(/\n/g, '\\\\') + '}\n\\date{}\n\\begin{document}\\maketitle\n' + (ctx.meta.abstract ? '\\begin{abstract}' + escape(ctx.meta.abstract) + '\\end{abstract}\n' : '') + (ctx.meta.keywords && ctx.meta.keywords.length ? '\\noindent\\textbf{Keywords:} ' + escape(ctx.meta.keywords.join(', ')) + '\n' : '') + '\\tableofcontents\n\\newpage\n' + body + '\\printbibliography[title={' + s.bibliography + '}]\n\\end{document}\n';
    }
    return '#set page(paper: "us-letter", margin: ' + (s.columns ? '(top: 1in, bottom: 0.75in, x: 0.75in)' : '1in') + ')\n#set text(font: "Times New Roman", size: ' + s.size + 'pt)\n#set par(leading: ' + (s.spacing === 2 ? '1em' : '0.65em') + ', first-line-indent: 0.5in)\n#set heading(numbering: "1.")\n#align(center)[#text(size: 18pt, weight: "bold")[' + escape(ctx.input.title) + ']\n\n' + escape(ctx.input.subtitle) + '\n\n' + escape(authors(ctx)) + ']\n\n' + (ctx.meta.abstract ? '== Abstract\n' + escape(ctx.meta.abstract) + '\n\n' : '') + (ctx.meta.keywords && ctx.meta.keywords.length ? '*Keywords:* ' + escape(ctx.meta.keywords.join(', ')) + '\n\n' : '') + '#outline()\n#pagebreak()\n' + (s.columns ? '#columns(2, gutter: 0.25in)[\n' : '') + body + '#bibliography("bibliography.bib", style: "' + ({ apa: 'apa', mla: 'modern-language-association', chicago: 'chicago-author-date', ieee: 'ieee' }[ctx.profile]) + '", title: [' + s.bibliography + '])\n' + (s.columns ? ']\n' : '');
  }

  function docx(ctx, sections, bib) {
    const entries = [], rels = [], media = new Map();
    let relationship = 1, bookmark = 1, drawing = 1;
    const rel = (type, target, external) => {
      const id = 'rId' + relationship++;
      rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '" Target="' + xml(target) + '"' + (external ? ' TargetMode="External"' : '') + '/>');
      return id;
    };
    const run = (value, props) => '<w:r>' + (props ? '<w:rPr>' + props + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xml(value) + '</w:t></w:r>';
    const field = (instruction, result, props) => '<w:fldSimple w:instr="' + xml(instruction) + '">' + run(result, props) + '</w:fldSimple>';
    const mark = (key, content) => {
      const id = bookmark++;
      return '<w:bookmarkStart w:id="' + id + '" w:name="' + key.replace(/-/g, '_') + '"/>' + content + '<w:bookmarkEnd w:id="' + id + '"/>';
    };
    const para = (content, style) => '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + content + '</w:p>';
    function picture(n) {
      if (!n.image) throw new Error('DOCX equations require a local SVG/image preview.');
      let rid = media.get(n.asset);
      if (!rid) {
        entries.push({ path: 'word/media/' + n.asset.split('/').pop(), content: n.image.content, base64: n.image.base64 });
        rid = rel('image', 'media/' + n.asset.split('/').pop());
        media.set(n.asset, rid);
      }
      let blip = '<a:blip r:embed="' + rid + '"/>';
      if (n.image.ext === 'svg') {
        let fallback = media.get('fallback');
        if (!fallback) {
          entries.push({ path: 'word/media/fallback.png', content: FALLBACK_PNG, base64: true });
          fallback = rel('image', 'media/fallback.png'); media.set('fallback', fallback);
        }
        blip = '<a:blip r:embed="' + fallback + '"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="' + rid + '"/></a:ext></a:extLst></a:blip>';
      }
      const id = drawing++, ratio = imageRatio(n.image), maxHeight = n.type === 'equation' ? 457200 : 5486400;
      const cx = Math.max(1, Math.round(Math.min(ctx.settings.columns ? 2857500 : 4572000, maxHeight * ratio))), cy = Math.max(1, Math.round(cx / ratio));
      return '<w:r><w:drawing><wp:inline><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="' + n.model.key + '" descr="' + xml(n.model.alt || n.model.source || n.model.caption) + '"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + n.model.key + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill>' + blip + '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    }
    function inline(n, props) {
      const inner = next => (n.children || []).map(c => inline(c, next || props)).join('');
      if (n.type === 'text') return run(n.value, props);
      if (n.type === 'break') return '<w:r><w:br/></w:r>';
      if (n.type === 'citation') return field(' CITATION ' + n.ids.map((id, i) => (i ? '\\m ' : '') + ctx.refKeys.get(id).replace(/-/g, '_')).join(' ') + ' ', n.text);
      if (n.type === 'xref') return field(' REF ' + n.model.key.replace(/-/g, '_') + ' \\h ', n.text);
      if (n.type === 'link' && n.href) return '<w:hyperlink r:id="' + rel('hyperlink', n.href, true) + '">' + inner() + '</w:hyperlink>';
      if (n.type === 'strong' || n.type === 'em') return inner((props || '') + (n.type === 'strong' ? '<w:b/>' : '<w:i/>'));
      if (n.type === 'sup' || n.type === 'sub') return inner((props || '') + '<w:vertAlign w:val="' + (n.type === 'sup' ? 'superscript' : 'subscript') + '"/>');
      if (n.type === 's') return inner((props || '') + '<w:strike/>');
      if (n.type === 'equation') {
        if (n.model.display === false) return picture(n);
        const label = mark(n.model.key, run('Equation ') + field(' SEQ Equation \\r ' + n.model.number + ' \\* ARABIC ', n.model.number));
        return picture(n) + run(' (') + label + run(')');
      }
      return inner();
    }
    function block(n) {
      if (n.type === 'figure') return para(picture(n)) + para(mark(n.model.key, run('Figure ') + field(' SEQ Figure \\r ' + n.model.number + ' \\* ARABIC ', n.model.number)) + run('. ' + str(n.model.caption)), 'Caption') + (attribution(n.model) ? para(run(attribution(n.model))) : '');
      if (n.type === 'table') {
        const t = table(n.model);
        const border = n.model.borders === false ? 'nil' : 'single';
        const width = Math.max(1, ...t.rows.map(r => r.length)), cellWidth = Math.floor((ctx.settings.columns ? 4860 : 9360) / width);
        return para(mark(n.model.key, run('Table ') + field(' SEQ Table \\r ' + n.model.number + ' \\* ARABIC ', n.model.number)) + run('. ' + str(n.model.caption)), 'Caption') + '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => '<w:' + side + ' w:val="' + border + '" w:sz="4"/>').join('') + '</w:tblBorders></w:tblPr><w:tblGrid>' + Array.from({ length: width }, () => '<w:gridCol w:w="' + cellWidth + '"/>').join('') + '</w:tblGrid>' + t.rows.map((row, i) => '<w:tr>' + (i === 0 && t.header ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + Array.from({ length: width }, (_, j) => '<w:tc><w:tcPr><w:tcW w:w="' + cellWidth + '" w:type="dxa"/>' + (n.model.shading && i === 0 && t.header ? '<w:shd w:fill="EEEEEE"/>' : '') + '</w:tcPr><w:p><w:pPr><w:jc w:val="' + t.align + '"/></w:pPr>' + run(row[j] || '', i === 0 && t.header ? '<w:b/>' : '') + '</w:p></w:tc>').join('') + '</w:tr>').join('') + '</w:tbl>';
      }
      if (n.type === 'heading') return para(inline(n), 'Heading' + n.level);
      if (n.type === 'ul' || n.type === 'ol') return (n.children || []).map((c, i) => para(run(n.type === 'ul' ? '• ' : (i + 1) + '. ') + inline(c))).join('');
      if (['div', 'group', 'p', 'li', 'blockquote'].includes(n.type) && (n.children || []).some(c => ['figure', 'table', 'heading', 'p', 'div', 'ul', 'ol'].includes(c.type))) return blocks(n.children);
      return para(inline(n));
    }
    function blocks(nodes) {
      let output = '', pending = [];
      const flush = () => { if (pending.length) output += para(pending.map(n => inline(n)).join('')); pending = []; };
      nodes.forEach(n => {
        if (['text', 'strong', 'em', 'link', 'citation', 'xref', 'sup', 'sub', 's', 'code', 'break'].includes(n.type) || n.type === 'equation' && n.model.display === false) pending.push(n);
        else { flush(); output += block(n); }
      });
      flush(); return output;
    }
    const styleId = rel('styles', 'styles.xml');
    void styleId;
    rel('settings', 'settings.xml');
    const bibliographyRun = b => {
      const value = str(b.text), url = /https?:\/\/[^\s<>]+/g;
      let last = 0, result = '', match;
      while ((match = url.exec(value))) {
        result += run(value.slice(last, match.index));
        result += '<w:hyperlink r:id="' + rel('hyperlink', match[0], true) + '">' + run(match[0]) + '</w:hyperlink>';
        last = match.index + match[0].length;
      }
      return result + run(value.slice(last));
    };
    let body = para(run(ctx.input.title), 'Title') + para(run(ctx.input.subtitle)) + para(run(authors(ctx)));
    if (ctx.meta.abstract) body += para(run('Abstract'), 'Heading1') + para(run(ctx.meta.abstract));
    if (ctx.meta.keywords && ctx.meta.keywords.length) body += para(run('Keywords: ' + ctx.meta.keywords.join(', ')));
    body += para(run('Contents'), 'Heading1') + para(field(' TOC \\o "1-6" \\h \\z \\u ', sections.map(s => s.title).join('\n')));
    if (ctx.settings.columns) body += '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720"/></w:sectPr></w:pPr></w:p>';
    body += sections.map(s => para(mark(s.key, run(s.title)), 'Heading1') + blocks(s.nodes)).join('');
    body += para(run(ctx.settings.bibliography), 'Heading1') + bib.map(b => para(bibliographyRun(b), 'Bibliography')).join('');
    body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="' + (ctx.settings.columns ? 1080 : 1440) + '" w:bottom="' + (ctx.settings.columns ? 1080 : 1440) + '" w:left="' + (ctx.settings.columns ? 1080 : 1440) + '" w:header="720" w:footer="720"/>' + (ctx.settings.columns ? '<w:cols w:num="2" w:space="360"/>' : '') + '</w:sectPr>';
    const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    entries.push({ path: 'word/document.xml', content: declaration + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body + '</w:body></w:document>' });
    entries.push({ path: 'word/styles.xml', content: declaration + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="' + ctx.settings.size * 2 + '"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="' + ctx.settings.spacing * 240 + '" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' + Array.from({ length: 6 }, (_, i) => '<w:style w:type="paragraph" w:styleId="Heading' + (i + 1) + '"><w:name w:val="heading ' + (i + 1) + '"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="' + i + '"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>').join('') + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/></w:style><w:style w:type="paragraph" w:styleId="Bibliography"><w:name w:val="Bibliography"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:style></w:styles>' });
    entries.push({ path: 'word/settings.xml', content: declaration + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="false"/></w:settings>' });
    if (ctx.refs.length) {
      rel('customXml', '../customXml/item1.xml');
      const sources = ctx.refs.map((r, index) => {
        const people = (r.author || []).map(a => '<b:Person><b:Last>' + xml(a.family || a.literal) + '</b:Last><b:First>' + xml(a.given) + '</b:First></b:Person>').join('');
        const year = r.issued && r.issued['date-parts'] && r.issued['date-parts'][0] && r.issued['date-parts'][0][0];
        return '<b:Source><b:Tag>' + ctx.refKeys.get(str(r.id || r.key)).replace(/-/g, '_') + '</b:Tag><b:SourceType>' + (r.type === 'book' ? 'Book' : 'JournalArticle') + '</b:SourceType><b:Guid>{00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0') + '}</b:Guid><b:LCID>1033</b:LCID><b:Title>' + xml(r.title) + '</b:Title><b:Year>' + xml(year) + '</b:Year><b:JournalName>' + xml(r['container-title']) + '</b:JournalName><b:Publisher>' + xml(r.publisher) + '</b:Publisher><b:URL>' + xml(safeUrl(r.URL)) + '</b:URL><b:Author><b:Author><b:NameList>' + people + '</b:NameList></b:Author></b:Author></b:Source>';
      }).join('');
      const selectedStyle = { apa: 'APASixthEditionOfficeOnline', mla: 'MLASeventhEditionOfficeOnline', chicago: 'ChicagoFifteenthEditionOfficeOnline', ieee: 'IEEE2006OfficeOnline' }[ctx.profile];
      entries.push({ path: 'customXml/item1.xml', content: declaration + '<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" SelectedStyle="\\' + selectedStyle + '.xsl" StyleName="' + ctx.profile.toUpperCase() + '">' + sources + '</b:Sources>' });
      entries.push({ path: 'customXml/itemProps1.xml', content: declaration + '<ds:datastoreItem ds:itemID="{8E1EBE2D-4066-45B0-AF01-981C047A6742}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/></ds:schemaRefs></ds:datastoreItem>' });
      entries.push({ path: 'customXml/_rels/item1.xml.rels', content: declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>' });
    }
    entries.push({ path: 'word/_rels/document.xml.rels', content: declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>' });
    entries.push({ path: '_rels/.rels', content: declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' });
    const extensions = new Map([['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml']]);
    ctx.assets.forEach(a => { const ext = a.path.split('.').pop(); extensions.set(ext, 'image/' + (ext === 'svg' ? 'svg+xml' : ext)); });
    if (ctx.assets.some(a => a.path.endsWith('.svg'))) extensions.set('png', 'image/png');
    entries.push({ path: '[Content_Types].xml', content: declaration + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + Array.from(extensions, ([ext, mime]) => '<Default Extension="' + ext + '" ContentType="' + mime + '"/>').join('') + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' + (ctx.refs.length ? '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>' : '') + '</Types>' });
    return entries;
  }

  function plainNode(n) {
    const inner = () => (n.children || []).map(plainNode).join('');
    if (n.type === 'text') return n.value;
    if (n.type === 'break') return '\n';
    if (n.type === 'citation' || n.type === 'xref') return n.text;
    if (n.type === 'link') return inner() + (n.href ? ' (' + n.href + ')' : '');
    if (n.type === 'figure') return '\n\nFigure ' + n.model.number + '. ' + str(n.model.caption) + '\n[Image: ' + str(n.model.alt || n.model.file || n.model.caption) + ']\n' + attribution(n.model) + '\n\n';
    if (n.type === 'table') return '\n\nTable ' + n.model.number + '. ' + str(n.model.caption) + '\n' + table(n.model).rows.map(r => r.join('\t')).join('\n') + '\n\n';
    if (n.type === 'equation') return (n.model.display === false ? '' : '\n\n') + '[Equation' + (n.model.number == null ? '' : ' ' + n.model.number) + ' (' + (n.model.format === 'asciimath' ? 'AsciiMath' : 'TeX') + '): ' + str(n.model.source) + ']' + (n.model.display === false ? '' : '\n\n');
    if (n.type === 'ul' || n.type === 'ol') return '\n' + (n.children || []).map((c, i) => (n.type === 'ul' ? '• ' : (i + 1) + '. ') + plainNode(c).trim()).join('\n') + '\n\n';
    return inner() + (['p', 'div', 'heading', 'li', 'pre', 'blockquote'].includes(n.type) ? '\n\n' : '');
  }

  function epub(ctx, sections, bib) {
    const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
    const xhtml = (title, body) => declaration + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><title>' + xml(title) + '</title><link rel="stylesheet" type="text/css" href="academic.css"/></head><body>' + body + '</body></html>';
    const entries = [
      { path: 'mimetype', content: 'application/epub+zip', store: true },
      { path: 'META-INF/container.xml', content: declaration + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { path: 'OEBPS/academic.css', content: 'body{font-family:serif;line-height:' + ctx.settings.spacing + ';margin:5%}h1,h2{break-after:avoid}img{max-width:100%;height:auto}figure{margin:1em 0;break-inside:avoid}table{border-collapse:collapse;width:100%}.bordered td,.bordered th{border:1px solid #555}td,th{padding:0.3em}.shaded th{background:#eee}.equation{text-align:center}.equation-number{float:right}.bibliography p{margin-left:1em;text-indent:-1em}.attribution{font-size:0.85em}' }
    ];
    const links = [{ href: 'title.xhtml', title: str(ctx.input.title) || 'Title' }, ...sections.map(s => ({ href: s.key + '.xhtml', title: s.title })), { href: 'bibliography.xhtml', title: ctx.settings.bibliography }];
    entries.push({ path: 'OEBPS/nav.xhtml', content: xhtml('Contents', '<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>' + links.map(l => '<li><a href="' + l.href + '">' + xml(l.title) + '</a></li>').join('') + '</ol></nav>') });
    entries.push({ path: 'OEBPS/title.xhtml', content: xhtml(ctx.input.title, '<h1>' + xml(ctx.input.title) + '</h1><p>' + xml(ctx.input.subtitle) + '</p><p>' + xml(authors(ctx)).replace(/\n/g, '<br/>') + '</p>' + (ctx.meta.abstract ? '<h2>Abstract</h2><p>' + xml(ctx.meta.abstract) + '</p>' : '') + (ctx.meta.keywords && ctx.meta.keywords.length ? '<p>Keywords: ' + xml(ctx.meta.keywords.join(', ')) + '</p>' : '')) });
    sections.forEach(section => {
      let body = '<section id="' + section.key + '"><h1>' + xml(section.title) + '</h1>' + section.nodes.map(n => htmlNode(n, ctx)).join('') + '</section>';
      function replace(nodes) {
        nodes.forEach(n => {
          if (n.image) body = body.split(xml(n.image.dataUrl)).join(n.asset);
          if (n.type === 'xref') {
            const target = sections.find(s => ctx.locations.get(n.model.key) === s.key);
            body = body.split('href="#' + n.model.key + '"').join('href="' + target.key + '.xhtml#' + n.model.key + '"');
          }
          replace(n.children || []);
        });
      }
      replace(section.nodes);
      body = body.replace(/<img([^>]*?)>/g, '<img$1/>').replace(/<br>/g, '<br/>');
      entries.push({ path: 'OEBPS/' + section.key + '.xhtml', content: xhtml(section.title, body) });
    });
    entries.push({ path: 'OEBPS/bibliography.xhtml', content: xhtml(ctx.settings.bibliography, '<section class="bibliography"><h1>' + ctx.settings.bibliography + '</h1>' + bib.map(b => '<p id="' + (ctx.refKeys.get(str(b.id)) || 'reference') + '">' + xml(b.text) + '</p>').join('') + '</section>') });
    ctx.assets.forEach(a => entries.push({ ...a, path: 'OEBPS/' + a.path }));
    let hash = 2166136261;
    for (const c of str(ctx.input.title) + authors(ctx)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    const manifest = '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="academic.css" media-type="text/css"/>' + links.map((l, i) => '<item id="section-' + i + '" href="' + l.href + '" media-type="application/xhtml+xml"/>').join('') + ctx.assets.map((a, i) => '<item id="asset-' + i + '" href="' + a.path + '" media-type="image/' + (a.path.endsWith('.svg') ? 'svg+xml' : a.path.split('.').pop()) + '"/>').join('');
    entries.push({ path: 'OEBPS/content.opf', content: declaration + '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:neo:academic:' + hash.toString(16) + '</dc:identifier><dc:title>' + xml(ctx.input.title || 'Manuscript') + '</dc:title><dc:creator>' + xml(authors(ctx)) + '</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">' + new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') + '</meta></metadata><manifest>' + manifest + '</manifest><spine>' + links.map((_, i) => '<itemref idref="section-' + i + '"/>').join('') + '</spine></package>' });
    return entries;
  }

  function build(input, options) {
    options = options || {};
    input = input || {};
    const format = options.format || 'html';
    if (!['html', 'pdf', 'md', 'tex', 'typ', 'docx', 'txt', 'epub'].includes(format)) throw new Error('Unsupported academic export format: ' + format);
    const ctx = context(input, options), sections = chapters(ctx), bib = bibliography(ctx);
    ctx.locations = new Map();
    function locate(nodes, key) {
      nodes.forEach(n => { if (n.model && ['figure', 'table', 'equation'].includes(n.type)) ctx.locations.set(n.model.key, key); locate(n.children || [], key); });
    }
    sections.forEach(s => locate(s.nodes, s.key));
    // Metadata alone is not placement: references may only target objects actually present.
    function check(nodes) {
      nodes.forEach(n => {
        if (n.type === 'xref') {
          if (!ctx.emitted.has(n.model.key)) throw new Error('Cross-reference targets an object not present in the manuscript: ' + n.model.id);
          if (n.model.number == null) throw new Error('Cross-reference targets an unnumbered inline equation: ' + n.model.id);
          n.text = n.kind[0].toUpperCase() + n.kind.slice(1) + ' ' + n.model.number;
        }
        check(n.children || []);
      });
    }
    sections.forEach(s => check(s.nodes));
    const defaultName = name(input.title);
    if (format === 'txt') return { format, defaultName, content: [str(input.title), str(input.subtitle), authors(ctx), ctx.meta.abstract && 'Abstract\n' + ctx.meta.abstract, ctx.meta.keywords && ctx.meta.keywords.length && 'Keywords: ' + ctx.meta.keywords.join(', '), 'Contents\n' + sections.map(s => s.title).join('\n'), ...sections.map(s => s.title + '\n\n' + s.nodes.map(plainNode).join('')), ctx.settings.bibliography + '\n\n' + bib.map(b => b.text).join('\n\n')].filter(Boolean).join('\n\n') + '\n' };
    if (format === 'epub') return { format, defaultName, zipEntries: epub(ctx, sections, bib) };
    if (format === 'html' || format === 'pdf') return { format, defaultName, content: html(ctx, sections, bib) };
    if (format === 'md') {
      const yaml = { title: md(input.title), subtitle: md(input.subtitle), author: authors(ctx).split('\n').map(md), abstract: md(ctx.meta.abstract), keywords: (ctx.meta.keywords || []).map(md), 'citation-style': ctx.profile, 'suppress-bibliography': true, references: ctx.refs.map(r => ({ ...r, id: ctx.refKeys.get(str(r.id || r.key)) })) };
      return { format, defaultName, content: '---\n' + Object.entries(yaml).map(([key, value]) => key + ': ' + JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')).join('\n') + '\n---\n\n# Contents\n\n' + sections.map(s => '- [' + md(s.title) + '](#' + s.key + ')').join('\n') + '\n\n' + sections.map(s => '# ' + md(s.title) + ' {#' + s.key + '}\n\n' + s.nodes.map(n => markdownNode(n, ctx)).join('')).join('\n') + '\n# ' + ctx.settings.bibliography + '\n\n' + bib.map(b => md(b.text)).join('\n\n') + '\n' };
    }
    if (format === 'tex' || format === 'typ') return { format: 'zip', defaultName: defaultName + '-' + format, zipEntries: [
      { path: 'manuscript.' + format, content: source(ctx, sections, format) },
      { path: 'bibliography.bib', content: bibSource(ctx) },
      { path: 'equation-sources.json', content: JSON.stringify(Array.from(ctx.maps.equation.values()).filter(m => ctx.emitted.has(m.key)).map(m => ({ id: m.id, source: str(m.source), format: m.format, display: m.display !== false })), null, 2) + '\n' },
      ...ctx.assets,
      { path: 'README.txt', content: format === 'tex' ? 'Compile with XeLaTeX, Biber, then XeLaTeX twice. Install Times New Roman and the selected biblatex style. SVG previews require the svg package, Inkscape, and explicitly enabled --shell-escape; only compile trusted sources. Equations in AsciiMath remain image previews, not converted TeX. Original equation sources and formats are preserved in equation-sources.json.\n' : 'Compile with Typst: typst compile manuscript.typ. Equation previews are embedded images; neither TeX nor AsciiMath is silently converted to Typst math. Original equation sources and formats are preserved in equation-sources.json. Times New Roman must be installed.\n' }
    ] };
    return { format: 'docx', defaultName, zipEntries: docx(ctx, sections, bib) };
  }

  return { build };
}));
