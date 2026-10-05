/* Reference domain API; independent of storage and UI.
 * Browser: load bibtex-parser.js and csl-renderer.js before calling import/export/render.
 * Imports retain duplicates for caller resolution. Rendered strings are plain text.
 * Numeric order defaults to database order; pass options.citedIds to both rendering
 * methods for manuscript first-appearance order. Both accept options.style;
 * pass style: 'numeric' to bibliography as well as citation for numbered entries
 * with APA/MLA/Chicago (IEEE defaults to numeric). No Zotero/Mendeley integration. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(function () { return require('./bibtex-parser.js'); }, function () { return require('./csl-renderer.js'); });
  } else root.NeoReferences = factory(function () { return root.NeoBibtex; }, function () { return root.NeoCSL; });
}(typeof globalThis !== 'undefined' ? globalThis : this, function (getBibtex, getCSL) {
  'use strict';
  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function clone(value, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object') throw new TypeError('Reference fields must be JSON-compatible');
    seen = seen || new Set();
    if (seen.has(value)) throw new TypeError('Reference fields must not contain cycles');
    seen.add(value);
    let result;
    if (Array.isArray(value)) result = value.map(function (item) { return clone(item, seen); });
    else {
      result = {};
      Object.keys(value).filter(function (key) { return !forbidden.has(key); }).forEach(function (key) {
        result[key] = clone(value[key], seen);
      });
    }
    seen.delete(value);
    return result;
  }
  function string(value, field) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') throw new TypeError('Reference "' + field + '" must be a string');
    return value.trim();
  }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (object(value)) return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
    return JSON.stringify(value);
  }
  function stableId(ref) {
    const content = Object.assign({}, ref);
    ['id', 'key', 'bibtex'].forEach(function (field) { delete content[field]; });
    const text = canonical(content);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
    return 'neo-' + hash.toString(16).padStart(8, '0');
  }
  function people(value, field) {
    if (value === undefined || value === null || value === '') return [];
    if (typeof value === 'string') {
      const parser = getBibtex();
      if (!parser) throw new Error('NeoBibtex must be loaded to normalize author strings');
      return parser.parseNames(value);
    }
    if (!Array.isArray(value)) throw new TypeError('Reference "' + field + '" must be a name string or array');
    return value.map(function (person) {
      if (!object(person)) throw new TypeError('Reference "' + field + '" names must be objects');
      const name = clone(person);
      ['family', 'given', 'literal', 'suffix', 'dropping-particle', 'non-dropping-particle'].forEach(function (key) {
        if (name[key] !== undefined) name[key] = string(name[key], field + '.' + key);
      });
      if (!name.family && !name.given && !name.literal) throw new Error('Reference "' + field + '" contains an empty name');
      if (!name.literal) { name.family = name.family || ''; name.given = name.given || ''; }
      return name;
    });
  }
  function normalize(input) {
    if (!object(input)) throw new TypeError('Reference must be an object');
    const ref = clone(input);
    ref.key = string(ref.key, 'key');
    const id = typeof ref.id === 'number' ? String(ref.id) : string(ref.id, 'id');
    ref.type = string(ref.type, 'type') || 'document';
    ref.title = string(ref.title, 'title');
    ref.author = people(ref.author, 'author');
    if (ref.editor !== undefined) ref.editor = people(ref.editor, 'editor');
    ['DOI', 'URL', 'category', 'container-title', 'publisher', 'publisher-place', 'volume', 'issue', 'page', 'ISBN', 'ISSN'].forEach(function (field) {
      if (ref[field] === undefined && (field === 'DOI' || field === 'URL') && ref[field.toLowerCase()] !== undefined) ref[field] = ref[field.toLowerCase()];
      if (ref[field] !== undefined) {
        if (['volume', 'issue', 'page'].includes(field) && typeof ref[field] === 'number') ref[field] = String(ref[field]);
        ref[field] = string(ref[field], field);
      }
    });
    ['text', 'label'].forEach(function (field) {
      if (ref[field] !== undefined && typeof ref[field] !== 'string') throw new TypeError('Reference "' + field + '" must be a string');
    });
    if (ref.issued !== undefined && ref.issued !== null) {
      if (!object(ref.issued)) throw new TypeError('Reference "issued" must be a CSL date object');
      const dates = ref.issued['date-parts'];
      if (dates !== undefined) {
        if (!Array.isArray(dates) || dates.length > 2 || dates.some(function (date) {
          return !Array.isArray(date) || date.length < 1 || date.length > 3 ||
            date.some(function (part) { return !Number.isInteger(part); }) ||
            (date.length > 1 && (date[1] < 1 || date[1] > 12)) ||
            (date.length > 2 && (date[2] < 1 || date[2] > 31));
        })) throw new Error('Reference "issued.date-parts" must contain valid [year, month?, day?] dates');
      } else if (!ref.issued.literal && !ref.issued.raw) throw new Error('Reference "issued" requires date-parts, literal or raw');
    } else if (ref.year !== undefined && ref.year !== '') {
      if (!/^-?\d{1,6}$/.test(String(ref.year))) throw new Error('Reference "year" must be an integer year');
      ref.issued = { 'date-parts': [[Number(ref.year)]] };
    } else ref.issued = { 'date-parts': [] };
    // An empty date is the normalized representation of an unknown date.
    ref.id = id || ref.key || stableId(ref);
    return ref;
  }
  function list(refs) {
    if (!Array.isArray(refs)) throw new TypeError('References must be an array');
    return refs.map(function (ref, i) {
      try { return normalize(ref); }
      catch (error) { throw new Error('Reference ' + (i + 1) + ': ' + error.message); }
    });
  }
  function dependency(get, name) {
    const api = get();
    if (!api) throw new Error(name + ' must be loaded before using this operation');
    return api;
  }
  function format(value) {
    if (!['bib', 'json'].includes(value)) throw new Error('Unsupported reference format "' + value + '"; expected bib or json');
  }
  function importReferences(text, value) {
    format(value);
    if (typeof text !== 'string' || !text.trim()) throw new Error('Reference import requires nonempty text');
    let refs;
    if (value === 'bib') refs = dependency(getBibtex, 'NeoBibtex').parse(text);
    else {
      try { refs = JSON.parse(text); }
      catch (error) { throw new Error('CSL JSON parse error: ' + error.message); }
      if (object(refs)) refs = [refs];
      if (!Array.isArray(refs)) throw new Error('CSL JSON must be a reference object or array');
    }
    if (!refs.length) throw new Error('Reference import contains no entries');
    return list(refs);
  }
  function exportReferences(refs, value) {
    format(value);
    const normalized = list(refs);
    return value === 'json' ? JSON.stringify(normalized, null, 2) : dependency(getBibtex, 'NeoBibtex').stringify(normalized);
  }
  function validate(refs, citedIds) {
    if (!Array.isArray(refs)) throw new TypeError('References must be an array');
    if (citedIds !== undefined && (!Array.isArray(citedIds) || citedIds.some(function (id) { return typeof id !== 'string'; }))) {
      throw new TypeError('Cited ids must be an array of strings');
    }
    const diagnostics = [], identities = new Map(), normalized = [];
    function add(code, message, index, id, severity) {
      diagnostics.push({ code: code, message: message, index: index, id: id, severity: severity || 'warning' });
    }
    refs.forEach(function (input, index) {
      let ref;
      try { ref = normalize(input); }
      catch (error) { add('invalid-reference', error.message, index, input && input.id, 'error'); return; }
      normalized.push(ref);
      if (!input.id && !input.key) add('missing-key', 'Reference has no explicit id or citation key; generated ' + ref.id, index, ref.id);
      new Set([ref.id, ref.key].filter(Boolean)).forEach(function (identity) {
        if (identities.has(identity)) add('duplicate-id', 'Duplicate or ambiguous reference identifier "' + identity + '" (also reference ' + (identities.get(identity) + 1) + ')', index, ref.id, 'error');
        else identities.set(identity, index);
      });
      if (!ref.title && !ref.text && !ref.label) add('missing-title', 'Reference "' + ref.id + '" has no title or manual reference text', index, ref.id);
      if (!ref.author.length) add('missing-author', 'Reference "' + ref.id + '" has no author', index, ref.id);
      if (!ref.issued || !ref.issued['date-parts'] || !ref.issued['date-parts'].length) add('missing-date', 'Reference "' + ref.id + '" has no publication year', index, ref.id);
      if (ref.DOI && !/^10\.\d{4,9}\/\S+$/i.test(ref.DOI.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ''))) add('invalid-doi', 'Reference "' + ref.id + '" has an invalid DOI', index, ref.id);
      if (ref.URL) {
        try {
          const url = new URL(ref.URL);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsafe scheme');
        } catch (_) { add('invalid-url', 'Reference "' + ref.id + '" URL must be an absolute HTTP(S) URL', index, ref.id, 'error'); }
      }
    });
    const used = new Set();
    (citedIds || []).forEach(function (id) {
      if (!identities.has(id)) {
        if (!used.has(id)) add('missing-reference', 'Citation "' + id + '" has no matching reference', null, id, 'error');
      }
      used.add(id);
    });
    if (citedIds !== undefined) normalized.forEach(function (ref) {
      if (!used.has(ref.id) && !used.has(ref.key)) add('uncited-reference', 'Reference "' + ref.id + '" is not cited', identities.get(ref.id), ref.id);
    });
    return diagnostics;
  }
  return {
    normalize: normalize, import: importReferences, export: exportReferences, validate: validate,
    citation: function (refs, ids, opts) { return dependency(getCSL, 'NeoCSL').citation(list(refs), ids, opts); },
    bibliography: function (refs, ids, opts) { return dependency(getCSL, 'NeoCSL').bibliography(list(refs), ids, opts); }
  };
}));
