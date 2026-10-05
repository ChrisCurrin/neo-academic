/* Portable clipboard boundary. metadataChanges contains object upserts, reference
 * additions, and diagnostics; callers commit them only after successful insertion.
 * DOM, ID allocation, asset storage, and math rendering are injected dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./academic-objects.js'), require('./references.js'),
      () => require('linkedom').parseHTML('<html><body></body></html>').document);
  } else root.NeoAcademicClipboard = factory(root.NeoAcademicObjects, root.NeoReferences, () => root.document);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (objects, references, defaultDocument) {
  'use strict';
  const MIME = 'application/x-neo-academic+json';
  const VERSION = 1;
  const LIMIT = 16 * 1024 * 1024;
  const IMAGE_LIMIT = 8 * 1024 * 1024;
  const fields = { figure: 'figures', table: 'tables', equation: 'equations' };
  const prefixes = { figure: 'fig', table: 'tbl', equation: 'eq' };
  const prose = new Set(['p', 'b', 'i', 'em', 'strong', 'br', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 's', 'u', 'sub', 'sup']);
  const discard = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
    'img', 'video', 'audio', 'source', 'link', 'meta', 'base', 'template', 'form', 'input']);
  const escape = (value) => objects.escapeHTML(value);
  const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

  function string(value, label, max = 200000) {
    if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${label}`);
    return value;
  }
  function bookId(value) {
    if (!string(value, 'book ID', 200).trim()) throw new Error('Invalid book ID');
    return value;
  }
  function identity(value) {
    if (!string(value, 'object ID', 128).match(/^[A-Za-z][A-Za-z0-9_-]*$/)) throw new Error('Invalid object ID');
    return value;
  }
  function boundedJSON(value, depth = 0, seen = new Set()) {
    if (depth > 32) throw new Error('Clipboard model is too deeply nested');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') { string(value, 'model text', IMAGE_LIMIT); return; }
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('Clipboard model must be JSON');
    seen.add(value);
    const keys = Object.keys(value);
    if (keys.length > 1000) throw new Error('Clipboard model contains too many items');
    for (const key of keys) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe clipboard model key');
      boundedJSON(value[key], depth + 1, seen);
    }
    seen.delete(value);
  }
  function raster(value) {
    return typeof value === 'string' && value.length <= IMAGE_LIMIT &&
      /^data:image\/(?:png|jpeg);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
      value.slice(value.indexOf(',') + 1).length > 0;
  }
  function safeFigureSVG(svg, document) {
    if (/<!|<\?/.test(svg)) throw new Error('Unsafe figure SVG');
    const tags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc']);
    const attrs = new Set(['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
      'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
      'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'font-family', 'font-size',
      'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'dx', 'dy', 'rotate', 'version']);
    const template = (document || defaultDocument()).createElement('template');
    template.innerHTML = svg;
    const roots = Array.from(template.content.childNodes).filter((node) => node.nodeType !== 3 || node.textContent.trim());
    if (roots.length !== 1 || roots[0].nodeType !== 1 || roots[0].tagName.toLowerCase() !== 'svg') {
      throw new Error('Unsafe figure SVG root');
    }
    let count = 0;
    function check(node, depth) {
      if (++count > 20000 || depth > 100) throw new Error('Figure SVG is too complex');
      if (node.nodeType === 3) return;
      if (node.nodeType !== 1 || !tags.has(node.tagName.toLowerCase()) ||
          (node !== roots[0] && node.tagName.toLowerCase() === 'svg')) throw new Error('Unsafe figure SVG element');
      for (const attr of Array.from(node.attributes)) {
        if (!attrs.has(attr.name) || /[<>&\\\0-\x1f]/.test(attr.value) ||
            (attr.name === 'xmlns' ? attr.value !== 'http://www.w3.org/2000/svg' :
              /url\s*\(|(?:https?|data|file|javascript):/i.test(attr.value))) throw new Error('Unsafe figure SVG attribute');
      }
      for (const child of Array.from(node.childNodes)) check(child, depth + 1);
    }
    check(roots[0], 0);
  }
  function image(value, fromBridge, document) {
    if (fromBridge && record(value)) value = value.dataUrl;
    if (raster(value)) return value;
    const match = typeof value === 'string' && value.length <= IMAGE_LIMIT &&
      /^data:image\/svg\+xml;base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(value);
    if (fromBridge && match && match[1]) {
      const svg = typeof Buffer !== 'undefined' ? Buffer.from(match[1], 'base64').toString('utf8') : atob(match[1]);
      safeFigureSVG(svg, document);
      return value;
    }
    throw new Error('Unsafe figure image; PNG/JPEG data or a validated bridge asset is required');
  }
  function normalize(kind, value) {
    boundedJSON(value);
    const model = objects[`normalize${kind[0].toUpperCase() + kind.slice(1)}`](value);
    if (kind === 'figure' && value.dataUrl !== undefined) model.dataUrl = image(value.dataUrl, false);
    return model;
  }
  function array(value, label) {
    if (!Array.isArray(value) || value.length > 1000) throw new Error(`Invalid ${label} array`);
    return value;
  }
  function normalizedMetadata(metadata) {
    if (!record(metadata)) throw new Error('Invalid clipboard metadata');
    const out = {};
    const used = new Set();
    for (const [kind, field] of Object.entries(fields)) {
      out[field] = array(metadata[field] === undefined ? [] : metadata[field], field).map((item) => {
        const model = normalize(kind, item);
        if (used.has(model.id)) throw new Error('Duplicate academic object ID');
        used.add(model.id);
        return model;
      });
    }
    const aliases = new Map();
    out.references = array(metadata.references === undefined ? [] : metadata.references, 'references').map((ref) => {
      boundedJSON(ref);
      const model = references.normalize(ref);
      for (const alias of new Set([model.id, model.key].filter(Boolean))) {
        string(alias, 'reference ID', 200);
        if (aliases.has(alias)) throw new Error('Ambiguous reference ID or key');
        aliases.set(alias, model);
      }
      return model;
    });
    return out;
  }
  function fragment(html, document) {
    string(html, 'clipboard HTML', 1024 * 1024);
    document = document || defaultDocument();
    if (!document || typeof document.createElement !== 'function') throw new Error('Clipboard requires a document');
    // Template contents stay inert, even when clipboard HTML contains image URLs.
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content;
  }
  function cites(node) {
    let ids;
    try { ids = JSON.parse(node.getAttribute('data-cites')); }
    catch (_) { throw new Error('Invalid citation marker'); }
    array(ids, 'citation');
    if (!ids.length || ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200)) {
      throw new Error('Invalid citation IDs');
    }
    return ids;
  }
  function kindOf(node) {
    return Object.keys(fields).find((kind) => node.classList.contains(`academic-${kind}`));
  }
  function walk(root, handlers) {
    let count = 0;
    function visit(node, depth) {
      if (++count > 20000 || depth > 100) throw new Error('Clipboard HTML is too complex');
      if (node.nodeType === 3) return escape(node.textContent);
      if (node.nodeType !== 1) return '';
      const tag = node.tagName.toLowerCase();
      if (discard.has(tag)) return '';
      const kind = kindOf(node);
      if (kind) return handlers.object(kind, identity(node.getAttribute('data-academic-id')), node);
      if (node.classList.contains('academic-citation')) return handlers.citation(cites(node), node);
      if (node.classList.contains('academic-xref')) {
        const target = identity(node.getAttribute('data-target'));
        const kind = node.getAttribute('data-kind');
        if (!Object.prototype.hasOwnProperty.call(fields, kind)) throw new Error('Invalid cross-reference kind');
        return handlers.xref(target, kind);
      }
      if (node.classList.contains('ph-mark')) {
        const sid = node.getAttribute('data-sid');
        if (typeof sid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sid)) throw new Error('Invalid placeholder ID');
        return handlers.placeholder(sid, node.textContent || '⚑');
      }
      const body = Array.from(node.childNodes).map((child) => visit(child, depth + 1)).join('');
      if (prose.has(tag)) return tag === 'br' ? '<br>' : `<${tag}>${body}</${tag}>`;
      // Non-academic tables/images are not silently turned into manuscript objects.
      if (['table', 'figure'].includes(tag)) throw new Error('Unmodeled academic object');
      return body;
    }
    return Array.from(root.childNodes).map((node) => visit(node, 0)).join('');
  }
  function citationHTML(ids, label) {
    return `<span class="academic-citation" data-cites="${escape(JSON.stringify(ids))}" contenteditable="false">${escape(label)}</span>`;
  }
  function xrefHTML(target, kind) {
    return objects.xrefHTML(target, kind);
  }
  function markerHTML(kind, id) {
    return `<span class="academic-${kind}" data-academic-id="${id}"></span>`;
  }
  function placeholderHTML(sid, label) {
    return `<span class="ph-mark" data-sid="${escape(sid)}" contenteditable="false">${escape(label)}</span>`;
  }
  function referenceAliases(refs) {
    const map = new Map();
    for (const ref of refs) for (const key of [ref.id, ref.key].filter(Boolean)) map.set(key, ref);
    return map;
  }

  function createTransfer(html, metadata, options = {}) {
    const sourceBookId = bookId(options.bookId);
    if (options.cut !== undefined && typeof options.cut !== 'boolean') throw new Error('Invalid cut flag');
    const models = normalizedMetadata(metadata);
    const transfer = { version: VERSION, sourceBookId, cut: options.cut === true, html: '',
      figures: [], tables: [], equations: [], references: [] };
    const aliases = referenceAliases(models.references);
    const selected = new Set();
    const referenced = new Set();
    transfer.html = walk(fragment(html, options.document), {
      object(kind, id, node) {
        if (selected.has(id)) throw new Error('Duplicate object in selection');
        selected.add(id);
        const field = fields[kind];
        const model = models[field].find((item) => item.id === id);
        if (!model) throw new Error(`Missing ${kind} model: ${id}`);
        const copy = { ...model };
        if (kind === 'figure' && !copy.dataUrl) {
          const img = node.querySelector('img');
          const src = img && img.getAttribute('src');
          if (raster(src)) copy.dataUrl = src;
        }
        transfer[field].push(copy);
        return markerHTML(kind, id);
      },
      citation(ids, node) {
        for (const id of ids) {
          const ref = aliases.get(id);
          if (!ref) continue;
          if (!referenced.has(ref.id)) { transfer.references.push(ref); referenced.add(ref.id); }
        }
        return citationHTML(ids, node.textContent);
      },
      xref: xrefHTML,
      placeholder: placeholderHTML
    });
    const payload = JSON.stringify(transfer);
    if (payload.length > LIMIT) throw new Error('Clipboard payload is too large');
    return payload;
  }
  function validatePayload(payload) {
    string(payload, 'clipboard payload', LIMIT);
    let value;
    try { value = JSON.parse(payload); } catch (_) { throw new Error('Malformed academic clipboard JSON'); }
    boundedJSON(value);
    if (!record(value) || value.version !== VERSION || typeof value.cut !== 'boolean') {
      throw new Error('Unsupported academic clipboard version or cut flag');
    }
    bookId(value.sourceBookId);
    string(value.html, 'clipboard HTML', 1024 * 1024);
    for (const field of [...Object.values(fields), 'references']) array(value[field], field);
    return { ...value, ...normalizedMetadata(value) };
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (record(value)) return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function content(ref) {
    const copy = { ...ref };
    delete copy.id; delete copy.key; delete copy.bibtex;
    return canonical(copy);
  }
  function mergeReferences(existing, incoming) {
    const aliases = referenceAliases(existing);
    const mapping = new Map();
    const additions = [];
    for (const ref of incoming) {
      const keys = [...new Set([ref.id, ref.key].filter(Boolean))];
      const collisions = [...new Set(keys.map((key) => aliases.get(key)).filter(Boolean))];
      let resolved = ref;
      if (collisions.length === 1 && content(collisions[0]) === content(ref)) resolved = collisions[0];
      else {
        if (collisions.length) {
          let suffix = 1;
          const base = ref.key || ref.id;
          while (aliases.has(`${base}-copy${suffix}`)) suffix++;
          resolved = { ...ref, id: `${base}-copy${suffix}`, key: `${base}-copy${suffix}` };
          if (resolved.id.length > 200) throw new Error('Reference conflict ID is too long');
        }
        additions.push(resolved);
        for (const key of [resolved.id, resolved.key].filter(Boolean)) aliases.set(key, resolved);
      }
      for (const key of keys) mapping.set(key, resolved.id);
    }
    return { mapping, additions };
  }

  async function prepareTransfer(payload, options = {}) {
    const transfer = validatePayload(payload);
    const targetBookId = bookId(options.bookId);
    const sameBook = targetBookId === transfer.sourceBookId;
    const metadata = normalizedMetadata(options.metadata || {});
    const root = fragment(transfer.html, options.document);
    const slots = new Map();
    const requestedRefs = new Set();
    const crossrefs = [];
    // Validate the complete fragment before invoking storage or rendering adapters.
    walk(root, {
      object(kind, id) {
        if (slots.has(id)) throw new Error('Duplicate object in clipboard HTML');
        const model = transfer[fields[kind]].find((item) => item.id === id);
        if (!model) throw new Error(`Missing ${kind} model: ${id}`);
        slots.set(id, { kind, model });
        return '';
      },
      citation(ids) { ids.forEach((id) => requestedRefs.add(id)); return ''; },
      xref(target, kind) { crossrefs.push({ target, kind }); return ''; },
      placeholder() { return ''; }
    });
    if ([...Object.values(fields)].some((field) => transfer[field].some((item) => !slots.has(item.id)))) {
      throw new Error('Clipboard contains an unplaced object model');
    }
    const aliases = referenceAliases(transfer.references);
    const unresolvedCites = [...requestedRefs].filter((id) => !aliases.has(id));
    if (transfer.references.some((ref) => ![ref.id, ref.key].some((id) => requestedRefs.has(id)))) {
      throw new Error('Clipboard contains an unreferenced reference model');
    }
    for (const { target, kind } of crossrefs) {
      if (slots.has(target) && slots.get(target).kind !== kind) {
        throw new Error('Cross-reference kind disagrees with its target');
      }
    }
    if (options.existingIds !== undefined && !Array.isArray(options.existingIds) && !(options.existingIds instanceof Set)) {
      throw new Error('existingIds must be an array or Set');
    }
    const occupied = new Set(options.existingIds || []);
    if (occupied.size > 100000) throw new Error('Too many existing object IDs');
    for (const id of occupied) identity(id);
    const reserved = new Set([...occupied, ...Object.values(fields).flatMap((field) => metadata[field].map((item) => item.id)),
      ...slots.keys()]);
    const changes = { figures: [], tables: [], equations: [], references: [], diagnostics: [] };
    const remapped = new Map();
    const built = new Map();
    const merged = mergeReferences(metadata.references, transfer.references);
    changes.references = merged.additions;
    const reservedRefs = new Set([...referenceAliases(metadata.references).keys(), ...aliases.keys(),
      ...referenceAliases(merged.additions).keys(), ...requestedRefs]);
    for (const missing of unresolvedCites) {
      let targetId = missing;
      if (!sameBook) {
        const base = `${missing.slice(0, 170)}-unresolved-copy`;
        let suffix = 1;
        while (reservedRefs.has(`${base}${suffix}`)) suffix++;
        targetId = `${base}${suffix}`;
        reservedRefs.add(targetId);
      }
      merged.mapping.set(missing, targetId);
      changes.diagnostics.push({ code: 'missing-citation', id: missing, targetId, sourceBookId: transfer.sourceBookId });
    }
    for (const [oldId, entry] of slots) {
      let id = oldId;
      if (!sameBook || !transfer.cut || occupied.has(oldId)) {
        if (typeof options.uniqueId !== 'function') throw new Error('Clipboard copy requires uniqueId');
        id = identity(options.uniqueId(prefixes[entry.kind]));
        if (reserved.has(id)) throw new Error('uniqueId returned an occupied object ID');
      }
      reserved.add(id);
      remapped.set(oldId, { id, kind: entry.kind });
    }
    if ([...slots.values()].some((entry) => entry.kind === 'equation') && typeof options.renderMath !== 'function') {
      throw new Error('Clipboard equations require renderMath');
    }
    if (!sameBook && [...slots.values()].some((entry) => entry.kind === 'figure') && typeof options.copyFigure !== 'function') {
      throw new Error('Cross-book figures require copyFigure');
    }
    for (const [oldId, { kind, model: original }] of slots) {
      let model = { ...original, id: remapped.get(oldId).id };
      if (kind === 'figure') {
        let dataUrl = model.dataUrl;
        if (!dataUrl && typeof options.readFigure === 'function' && model.file) {
          dataUrl = image(await options.readFigure(transfer.sourceBookId, model.file), true, options.document);
        }
        if (!sameBook) {
          const copied = await options.copyFigure({ ...model, ...(dataUrl ? { dataUrl } : {}) },
            transfer.sourceBookId, targetBookId);
          if (!record(copied)) throw new Error('copyFigure must return a figure model');
          if (!copied.file || (original.originalFile && !copied.originalFile)) {
            throw new Error('copyFigure must preserve destination asset and original filenames');
          }
          const stored = { ...model, ...copied, id: model.id };
          delete stored.dataUrl;
          model = normalize('figure', stored);
          // File references are assigned by the destination storage adapter, never the payload.
          if (!model.file || (original.originalFile && !model.originalFile)) {
            throw new Error('copyFigure must preserve destination asset and original filenames');
          }
          if (copied.dataUrl) dataUrl = image(copied.dataUrl, true, options.document);
        }
        if (!dataUrl && typeof options.readFigure === 'function' && model.file) {
          dataUrl = image(await options.readFigure(targetBookId, model.file), true, options.document);
        }
        if (!dataUrl) throw new Error('Clipboard figure requires image data or readFigure');
        delete model.dataUrl;
        changes.figures.push(model);
        built.set(oldId, objects.figureHTML(model, dataUrl));
      } else if (kind === 'table') {
        changes.tables.push(model);
        built.set(oldId, objects.tableHTML(model));
      } else {
        const rendered = await options.renderMath(model.source, model.format, model.display);
        const svg = typeof rendered === 'string' ? rendered : rendered && rendered.svg;
        if (!svg) throw new Error('renderMath must return SVG');
        built.set(oldId, objects.equationHTML(model, svg));
        changes.equations.push(model);
      }
    }
    const html = walk(root, {
      object: (kind, id) => built.get(id),
      citation(ids, node) { return citationHTML(ids.map((id) => merged.mapping.get(id)), node.textContent); },
      placeholder(sid, label) {
        if (sameBook) return placeholderHTML(sid, label);
        changes.diagnostics.push({ code: 'placeholder-not-transferred', id: sid, sourceBookId: transfer.sourceBookId });
        return escape(label);
      },
      xref(target, kind) {
        const copied = remapped.get(target);
        if (copied && copied.kind !== kind) throw new Error('Cross-reference kind disagrees with its target');
        if (copied) return xrefHTML(copied.id, kind);
        if (sameBook && occupied.has(target) && metadata[fields[kind]].some((item) => item.id === target)) {
          return xrefHTML(target, kind);
        }
        changes.diagnostics.push({ code: 'dangling-xref', id: target, kind, sourceBookId: transfer.sourceBookId });
        // Do not keep a cross-book target ID that could accidentally bind to an unrelated object.
        return `<span class="academic-xref-unresolved" data-academic-dangling="true">${escape(kind[0].toUpperCase() + kind.slice(1))} ?</span>`;
      }
    });
    return { html, metadataChanges: changes };
  }

  // Use only already-validated prepareTransfer output or locally generated object
  // HTML here. Chromium drops noneditable inline nodes during paragraph merging;
  // unlock them for native insertion, then restore locks before saving/revisions.
  function prepareInsertionHTML(html, options = {}) {
    const root = fragment(html, options.document);
    const nodes = Array.from(root.childNodes).filter((node) => node.nodeType !== 3 || node.textContent.trim());
    const inline = 'span.academic-citation,span.academic-xref,span.ph-mark,span.academic-equation';
    // A sole inline atom uses Chromium's atomic insertion path. Unlocking it can
    // instead produce a successful no-op at a block boundary; leave it intact.
    if (nodes.length === 1 && nodes[0].nodeType === 1 && nodes[0].matches(inline)) return html;
    root.querySelectorAll(inline)
      .forEach((node) => node.removeAttribute('contenteditable'));
    return Array.from(root.childNodes).map((node) => node.nodeType === 3 ? escape(node.textContent) : node.outerHTML || '').join('');
  }
  function restoreAtomicMarkers(root) {
    if (!root || typeof root.querySelectorAll !== 'function') throw new Error('Marker restoration requires a DOM root');
    root.querySelectorAll('.academic-citation,.academic-xref,.ph-mark,.academic-equation,.academic-figure,.academic-table')
      .forEach((node) => node.setAttribute('contenteditable', 'false'));
  }
  return Object.freeze({ MIME, MIME_TYPE: MIME, VERSION, createTransfer, prepareTransfer, prepareInsertionHTML, restoreAtomicMarkers });
}));
