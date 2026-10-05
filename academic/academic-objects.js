(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeoAcademicObjects = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const escapeHTML = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kinds = { figure: 'figures', table: 'tables', equation: 'equations' };
  const labels = { figure: 'Figure', table: 'Table', equation: 'Equation' };
  function id(value) {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value)) throw new Error('Invalid academic object ID');
    return value;
  }
  function text(value) {
    if (value == null) return '';
    if (typeof value !== 'string') throw new Error('Expected text');
    return value;
  }
  function normalizeFigure(value) {
    if (!value || typeof value !== 'object') throw new Error('Invalid figure');
    const out = { id: id(value.id) };
    for (const key of ['caption', 'alt', 'file', 'source', 'license', 'attribution', 'mime']) out[key] = text(value[key]);
    if (out.file && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(out.file)) throw new Error('Invalid figure filename');
    if (value.originalFile != null) {
      out.originalFile = text(value.originalFile);
      if (out.originalFile && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(out.originalFile)) throw new Error('Invalid original figure filename');
    }
    if (value.originalMime != null) {
      if (value.originalMime !== 'application/pdf') throw new Error('Invalid original figure MIME type');
      out.originalMime = value.originalMime;
    }
    if (value.originalName != null) out.originalName = text(value.originalName);
    for (const key of ['bytes', 'originalBytes', 'width', 'height', 'previewPage', 'pageCount']) {
      if (value[key] == null) continue;
      const minimum = key === 'bytes' || key === 'originalBytes' ? 0 : 1;
      const maximum = key === 'width' || key === 'height' ? 4096 :
        key === 'bytes' || key === 'originalBytes' ? 20 * 1024 * 1024 : Number.MAX_SAFE_INTEGER;
      if (!Number.isSafeInteger(value[key]) || value[key] < minimum || value[key] > maximum) throw new Error(`Invalid figure ${key}`);
      out[key] = value[key];
    }
    if (out.previewPage && out.pageCount && out.previewPage > out.pageCount) throw new Error('Figure preview page exceeds PDF page count');
    return out;
  }
  function boolean(value, fallback) {
    if (value == null) return fallback;
    if (typeof value !== 'boolean') throw new Error('Expected boolean');
    return value;
  }
  function normalizeTable(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.rows) || !value.rows.length ||
        value.rows.length > 1000 || !Array.isArray(value.rows[0]) || !value.rows[0].length || value.rows[0].length > 100) {
      throw new Error('Table must contain 1–1000 rows and 1–100 columns');
    }
    const width = value.rows[0].length;
    const rows = value.rows.map((row) => {
      if (!Array.isArray(row) || row.length !== width) throw new Error('Table rows must have equal widths');
      return row.map(text);
    });
    const align = value.align == null ? 'left' : value.align;
    if (!['left', 'center', 'right'].includes(align)) throw new Error('Invalid table alignment');
    return { id: id(value.id), caption: text(value.caption), rows, header: boolean(value.header, true),
      borders: boolean(value.borders, true), shading: boolean(value.shading, false), align };
  }
  function normalizeEquation(value) {
    if (!value || typeof value !== 'object') throw new Error('Invalid equation');
    const format = value.format == null ? 'tex' : value.format;
    if (!['tex', 'asciimath'].includes(format)) throw new Error('Invalid math format');
    const source = text(value.source);
    if (source.length > 20000) throw new Error('Equation source is too long');
    return { id: id(value.id), source, format, display: boolean(value.display, true) };
  }
  function caption(kind, number, value) {
    return `${labels[kind]} ${number == null ? '?' : escapeHTML(number)}.${value ? ' ' + escapeHTML(value) : ''}`;
  }
  function figureHTML(value, dataUrl, number) {
    if (dataUrl && typeof dataUrl === 'object') { number = dataUrl.number; dataUrl = dataUrl.dataUrl; }
    const model = normalizeFigure(value);
    if (dataUrl && !/^data:image\/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]*={0,2}$/.test(dataUrl)) throw new Error('Invalid figure image URL');
    return `<figure class="academic-figure" data-academic-id="${model.id}" contenteditable="false"><img src="${escapeHTML(dataUrl || '')}" alt="${escapeHTML(model.alt)}"><figcaption>${caption('figure', number, model.caption)}</figcaption></figure>`;
  }
  function tableHTML(value, number) {
    if (number && typeof number === 'object') number = number.number;
    const model = normalizeTable(value);
    const rows = model.rows.map((row, index) => {
      const tag = model.header && index === 0 ? 'th' : 'td';
      const border = model.borders ? '1px solid currentColor' : 'none';
      const background = model.shading && index % 2 === 0 ? 'background-color:rgba(127,127,127,0.12);' : '';
      return '<tr>' + row.map((cell) => `<${tag} style="border:${border};text-align:${model.align};${background}">${escapeHTML(cell)}</${tag}>`).join('') + '</tr>';
    });
    return `<figure class="academic-table" data-academic-id="${model.id}" contenteditable="false"><table data-header="${model.header}" data-borders="${model.borders}" data-shading="${model.shading}" data-align="${model.align}"><tbody>${rows.join('')}</tbody></table><figcaption>${caption('table', number, model.caption)}</figcaption></figure>`;
  }
  // SVG comes only from the local math renderer. Without it, show escaped source.
  function equationHTML(value, svg, number) {
    if (svg && typeof svg === 'object') { number = svg.number; svg = svg.svg; }
    const model = normalizeEquation(value);
    const tag = model.display ? 'div' : 'span';
    const body = svg ? safeMathSVG(svg) : escapeHTML(model.source);
    return `<${tag} class="academic-equation" data-academic-id="${model.id}" data-source="${escapeHTML(model.source)}" data-math-format="${model.format}" data-display="${model.display}" contenteditable="false"><span class="academic-equation-body">${body}</span>${model.display ? `<span class="academic-equation-number">(${number == null ? '?' : escapeHTML(number)})</span>` : ''}</${tag}>`;
  }
  function safeMathSVG(svg) {
    if (typeof svg !== 'string' || !/^\s*<svg[\s>]/.test(svg) || !/<\/svg>\s*$/.test(svg) || /<!|<\?/.test(svg)) throw new Error('Unsafe math SVG');
    const tags = new Set(['svg', 'g', 'path', 'rect', 'text', 'tspan', 'defs', 'use', 'title']);
    const attrs = new Set(['style', 'xmlns', 'xmlns:xlink', 'width', 'height', 'role', 'focusable', 'viewBox', 'stroke', 'fill', 'stroke-width',
      'transform', 'd', 'x', 'y', 'id', 'href', 'xlink:href', 'font-size', 'font-family', 'data-c', 'data-mml-node',
      'data-mjx-texclass', 'data-mjx-alternate', 'data-variant', 'data-mjx-error', 'data-table', 'data-labels', 'preserveAspectRatio']);
    const stack = [];
    for (const token of svg.matchAll(/<[^>]*>|[^<]+/g)) {
      if (!token[0].startsWith('<')) {
        if (/[<>]/.test(token[0])) throw new Error('Unsafe math SVG');
        continue;
      }
      const close = /^<\/([a-z]+)\s*>$/.exec(token[0]);
      if (close) { if (stack.pop() !== close[1]) throw new Error('Unsafe math SVG'); continue; }
      const open = /^<([a-z]+)([\s\S]*?)(\/?)>$/.exec(token[0]);
      if (!open || !tags.has(open[1])) throw new Error('Unsafe math SVG');
      let rest = open[2];
      const seen = new Set();
      while (rest.trim()) {
        const attr = /^\s+([A-Za-z][A-Za-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
        if (!attr) throw new Error('Unsafe math SVG');
        const key = attr[1], value = attr[2] == null ? attr[3] : attr[2];
        if (!attrs.has(key) || seen.has(key) || /[<>&\\]/.test(value) ||
            (key === 'xmlns' ? value !== 'http://www.w3.org/2000/svg' :
              key === 'xmlns:xlink' ? value !== 'http://www.w3.org/1999/xlink' :
                /(?:javascript|data|https?|file):|url\s*\(|expression\s*\(|@import/i.test(value)) ||
            ((key === 'href' || key === 'xlink:href') && !/^#[A-Za-z0-9_-]+$/.test(value)) ||
            (key === 'style' && !/^(?:\s*(?:vertical-align|min-width):\s*-?[\d.]+(?:ex|em|px);\s*)+$/.test(value))) throw new Error('Unsafe math SVG');
        seen.add(key);
        rest = rest.slice(attr[0].length);
      }
      if (!open[3]) stack.push(open[1]);
    }
    if (stack.length) throw new Error('Unsafe math SVG');
    return svg;
  }
  function xrefHTML(target, kind, number) {
    id(target);
    if (!Object.prototype.hasOwnProperty.call(kinds, kind)) throw new Error('Invalid cross-reference kind');
    return `<span class="academic-xref" data-target="${target}" data-kind="${kind}" contenteditable="false">${labels[kind]} ${number == null ? '?' : escapeHTML(number)}</span>`;
  }
  function parseCSV(csv) {
    if (typeof csv !== 'string') throw new Error('CSV must be text');
    csv = csv.replace(/^\uFEFF/, '');
    if (!csv) return [];
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    for (let i = 0; i < csv.length; i++) {
      const c = csv[i];
      if (quoted) {
        if (c === '"') {
          if (csv[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; }
        } else field += c;
      } else if (c === '"' && !field && !closed) quoted = true;
      else if (c === ',' || c === '\r' || c === '\n') {
        row.push(field); field = ''; closed = false;
        if (c !== ',') {
          rows.push(row); row = [];
          if (c === '\r' && csv[i + 1] === '\n') i++;
        }
      } else {
        if (closed || c === '"') throw new Error('Malformed CSV quoting');
        field += c;
      }
    }
    if (quoted) throw new Error('Unclosed CSV quote');
    if (row.length || field || closed || csv.endsWith(',')) { row.push(field); rows.push(row); }
    return rows;
  }
  function exportCSV(value) {
    const rows = Array.isArray(value) ? value : normalizeTable(value).rows;
    return rows.map((row) => row.map((cell) => {
      cell = text(cell);
      return /[",\r\n]/.test(cell) ? '"' + cell.replace(/"/g, '""') + '"' : cell;
    }).join(',')).join('\r\n');
  }
  function importCSV(csv, options) {
    const rows = parseCSV(csv);
    if (!rows.length) throw new Error('CSV is empty');
    const width = Math.max(...rows.map((row) => row.length));
    return normalizeTable({ ...options, rows: rows.map((row) => row.concat(Array(width - row.length).fill(''))) });
  }
  function resizeTable(value, rowCount, columnCount) {
    const model = normalizeTable(value);
    if (!Number.isInteger(rowCount) || !Number.isInteger(columnCount) || rowCount < 1 || rowCount > 1000 ||
        columnCount < 1 || columnCount > 100) throw new Error('Invalid table dimensions');
    return { ...model, rows: Array.from({ length: rowCount }, (_, r) =>
      Array.from({ length: columnCount }, (_, c) => model.rows[r] && model.rows[r][c] || '')) };
  }
  function editTableCell(value, row, column, content) {
    const model = normalizeTable(value);
    if (!Number.isInteger(row) || !Number.isInteger(column) || !model.rows[row] || column < 0 || column >= model.rows[row].length) throw new Error('Invalid cell coordinates');
    model.rows[row][column] = text(content);
    return model;
  }
  function editTableAxis(value, axis, index, remove) {
    const model = normalizeTable(value);
    if (!['row', 'column'].includes(axis)) throw new Error('Invalid table axis');
    const length = axis === 'row' ? model.rows.length : model.rows[0].length;
    if (!Number.isInteger(index) || index < 0 || index > length - (remove ? 1 : 0) || (remove && length === 1)) throw new Error('Invalid table edit');
    if (axis === 'row') model.rows.splice(index, remove ? 1 : 0, ...(remove ? [] : [Array(model.rows[0].length).fill('')]));
    else model.rows.forEach((row) => row.splice(index, remove ? 1 : 0, ...(remove ? [] : [''])));
    return normalizeTable(model);
  }
  // Pass DOM roots in chapter order. Models own content; document order owns
  // numbering. Returns a diagnostics array with a non-enumerable `numbers` map.
  // Inline equations deliberately have no referenceable number.
  function reconcile(root, metadata) {
    const roots = Array.isArray(root) ? root : [root];
    const diagnostics = [], numbers = { figure: {}, table: {}, equation: {} };
    const models = new Map(), seen = new Set(), counters = { figure: 0, table: 0, equation: 0 };
    for (const [kind, collection] of Object.entries(kinds)) {
      const values = metadata && metadata[collection] || [];
      if (!Array.isArray(values)) { diagnostics.push({ code: 'invalid-collection', kind }); continue; }
      for (const value of values) {
        try {
          const model = ({ figure: normalizeFigure, table: normalizeTable, equation: normalizeEquation })[kind](value);
          if (models.has(model.id)) diagnostics.push({ code: 'duplicate-model', id: model.id, kind });
          else models.set(model.id, { kind, model });
        } catch (error) { diagnostics.push({ code: 'invalid-model', id: value && value.id, kind, message: error.message }); }
      }
    }
    const elements = (selector) => roots.flatMap((node) => {
      if (!node || typeof node.querySelectorAll !== 'function') throw new Error('Reconciliation requires DOM roots in chapter order');
      return [...(node.matches && node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)];
    });
    for (const node of elements('.academic-figure,.academic-table,.academic-equation')) {
      const objectId = node.getAttribute('data-academic-id');
      const kind = Object.keys(kinds).find((key) => node.classList.contains('academic-' + key));
      const entry = models.get(objectId);
      node.setAttribute('contenteditable', 'false');
      if (!entry || entry.kind !== kind) { node.setAttribute('data-academic-dangling', 'true'); diagnostics.push({ code: 'missing-model', id: objectId, kind }); continue; }
      if (seen.has(objectId)) { node.setAttribute('data-academic-dangling', 'true'); diagnostics.push({ code: 'duplicate-object', id: objectId, kind }); continue; }
      seen.add(objectId);
      node.removeAttribute('data-academic-dangling');
      const number = kind === 'equation' && !entry.model.display ? null : ++counters[kind];
      if (number !== null) numbers[kind][objectId] = number;
      if (kind === 'figure') {
        const image = node.querySelector('img');
        const src = image && image.getAttribute('src');
        node.innerHTML = figureHTML(entry.model, src && /^data:image\/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]*={0,2}$/.test(src) ? src : '', number).replace(/^<figure[^>]*>|<\/figure>$/g, '');
      } else if (kind === 'table') {
        node.innerHTML = tableHTML(entry.model, number).replace(/^<figure[^>]*>|<\/figure>$/g, '');
      } else {
        const body = node.querySelector('.academic-equation-body');
        const svg = body && body.querySelector('svg') || node.querySelector('svg');
        let rendered = '';
        if (svg && node.getAttribute('data-source') === entry.model.source && node.getAttribute('data-math-format') === entry.model.format &&
            node.getAttribute('data-display') === String(entry.model.display)) {
          try { rendered = safeMathSVG(svg.outerHTML); } catch { /* replace unsafe output with source */ }
        }
        const holder = node.ownerDocument.createElement('div');
        holder.innerHTML = equationHTML(entry.model, rendered, number);
        const replacement = holder.firstElementChild;
        if (replacement.tagName !== node.tagName) node.replaceWith(replacement);
        else { node.innerHTML = replacement.innerHTML; for (const key of ['data-source', 'data-math-format', 'data-display']) node.setAttribute(key, replacement.getAttribute(key)); }
      }
    }
    for (const node of elements('.academic-xref')) {
      const kind = node.getAttribute('data-kind'), target = node.getAttribute('data-target');
      const validKind = Object.prototype.hasOwnProperty.call(kinds, kind);
      const number = validKind && Object.prototype.hasOwnProperty.call(numbers[kind], target) ? numbers[kind][target] : null;
      node.setAttribute('contenteditable', 'false');
      node.textContent = `${validKind ? labels[kind] : 'Object'} ${number || '?'}`;
      if (!number) { node.setAttribute('data-academic-dangling', 'true'); diagnostics.push({ code: 'dangling-xref', id: target, kind }); }
      else node.removeAttribute('data-academic-dangling');
    }
    for (const [objectId, entry] of models) if (!seen.has(objectId)) diagnostics.push({ code: 'unplaced-model', id: objectId, kind: entry.kind });
    Object.defineProperties(diagnostics, {
      numbers: { value: numbers },
      diagnostics: { value: diagnostics }
    });
    return diagnostics;
  }
  return { escapeHTML, normalizeFigure, normalizeTable, normalizeEquation, figureHTML, tableHTML, equationHTML,
    validateFigure: normalizeFigure, validateTable: normalizeTable, validateEquation: normalizeEquation,
    xrefHTML, safeMathSVG, parseCSV, exportCSV, importCSV, resizeTable, editTableCell, editTableAxis, reconcile };
}));
