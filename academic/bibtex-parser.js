/* BibTeX subset parser/serializer. Unicode is preserved; this is not a TeX engine. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeoBibtex = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const types = {
    article: 'article-journal', book: 'book', booklet: 'book', inbook: 'chapter',
    incollection: 'chapter', inproceedings: 'paper-conference', conference: 'paper-conference',
    proceedings: 'book', phdthesis: 'thesis', mastersthesis: 'thesis',
    techreport: 'report', manual: 'report', misc: 'document', unpublished: 'manuscript',
    online: 'webpage'
  };
  const reverseTypes = {
    'article-journal': 'article', book: 'book', chapter: 'incollection',
    'paper-conference': 'inproceedings', thesis: 'phdthesis', report: 'techreport',
    manuscript: 'unpublished', webpage: 'online', document: 'misc'
  };
  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);

  function clean(value) {
    let out = '';
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === '\\' && i + 1 < value.length && /[\\{}"]/.test(value[i + 1])) {
        out += value[++i];
      } else if (c !== '{' && c !== '}') out += c;
    }
    return out.trim();
  }

  function splitNames(value, delimiter) {
    const parts = [];
    let start = 0, depth = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '\\') { i++; continue; }
      if (value[i] === '{') depth++;
      else if (value[i] === '}') depth--;
      if (depth === 0) {
        const match = delimiter === ','
          ? (value[i] === ',' ? ',' : null)
          : value.slice(i).match(/^\s+and\s+/i);
        if (match) {
          parts.push(value.slice(start, i).trim());
          const length = typeof match === 'string' ? match.length : match[0].length;
          i += length - 1;
          start = i + 1;
        }
      }
    }
    parts.push(value.slice(start).trim());
    return parts;
  }

  function parseNames(value) {
    if (!value || !value.trim()) return [];
    return splitNames(value, 'and').map(function (name) {
      if (name[0] === '{' && name[name.length - 1] === '}') return { literal: clean(name) };
      const parts = splitNames(name, ',').map(clean);
      if (parts.length > 3 || !parts[0]) throw new Error('BibTeX: invalid author name "' + name + '"');
      if (parts.length > 1) {
        const result = { family: parts[0], given: parts[parts.length - 1] };
        if (parts.length === 3) result.suffix = parts[1];
        return result;
      }
      const words = parts[0].split(/\s+/);
      let familyStart = words.length - 1;
      for (let i = 1; i < words.length - 1; i++) {
        if (/^\p{Ll}/u.test(words[i])) { familyStart = i; break; }
      }
      return { family: words.slice(familyStart).join(' '), given: words.slice(0, familyStart).join(' ') };
    });
  }

  function parse(text) {
    if (typeof text !== 'string') throw new TypeError('BibTeX input must be a string');
    let pos = 0;
    const macros = Object.create(null);
    'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').forEach(function (month, i) {
      macros[month] = String(i + 1);
    });
    const entries = [];
    function fail(message) {
      throw new Error('BibTeX parse error at character ' + (pos + 1) + ': ' + message);
    }
    function space() {
      while (pos < text.length) {
        if (/\s/.test(text[pos])) pos++;
        else if (text[pos] === '%') {
          while (pos < text.length && text[pos] !== '\n') pos++;
        } else break;
      }
    }
    function word() {
      space();
      const start = pos;
      while (pos < text.length && /[A-Za-z0-9_:.+\/-]/.test(text[pos])) pos++;
      if (start === pos) fail('expected an identifier');
      return text.slice(start, pos);
    }
    function expect(c) {
      space();
      if (text[pos] !== c) fail('expected "' + c + '"');
      pos++;
    }
    function delimited(open) {
      const close = open === '{' ? '}' : '"';
      pos++;
      let depth = 0, out = '';
      while (pos < text.length) {
        const c = text[pos++];
        if (c === '\\') {
          if (pos === text.length) fail('unfinished escape');
          out += c + text[pos++];
        } else if (c === close && depth === 0) return out;
        else {
          if (c === '{') depth++;
          else if (c === '}') {
            if (depth === 0) fail('unbalanced braces in quoted value');
            depth--;
          }
          out += c;
        }
      }
      fail('unterminated ' + (open === '{' ? 'braced' : 'quoted') + ' value');
    }
    function value() {
      let out = '';
      do {
        space();
        if (text[pos] === '{' || text[pos] === '"') out += delimited(text[pos]);
        else {
          const token = word();
          if (/^\d+$/.test(token)) out += token;
          else if (Object.prototype.hasOwnProperty.call(macros, token.toLowerCase())) out += macros[token.toLowerCase()];
          else fail('undefined string macro "' + token + '"');
        }
        space();
        if (text[pos] !== '#') break;
        pos++;
      } while (true);
      return out;
    }
    while (true) {
      space();
      if (pos === text.length) break;
      expect('@');
      const type = word().toLowerCase();
      space();
      const open = text[pos];
      if (open !== '{' && open !== '(') fail('expected entry opening brace or parenthesis');
      const close = open === '{' ? '}' : ')';
      if (type === 'comment') {
        if (open === '{') delimited('{');
        else {
          pos++;
          let depth = 1;
          while (pos < text.length && depth) {
            const c = text[pos++];
            if (c === '\\') pos++;
            else if (c === '{' || c === '"') { pos--; delimited(c); }
            else if (c === '(') depth++;
            else if (c === ')') depth--;
          }
          if (depth) fail('unterminated comment');
        }
        continue;
      }
      pos++;
      if (type === 'preamble') { value(); space(); if (text[pos] === ',') pos++; expect(close); continue; }
      if (type === 'string') {
        const name = word().toLowerCase();
        expect('=');
        macros[name] = value();
        space(); if (text[pos] === ',') pos++;
        expect(close);
        continue;
      }
      space();
      const start = pos;
      while (pos < text.length && text[pos] !== ',' && text[pos] !== close) pos++;
      const key = text.slice(start, pos).trim();
      if (!key || /[\s{}()"\\#=]/.test(key)) fail('invalid or missing citation key');
      const fields = Object.create(null);
      space();
      if (text[pos] === ',') {
        pos++;
        while (true) {
          space();
          if (text[pos] === close) break;
          const field = word().toLowerCase();
          if (forbidden.has(field)) fail('unsafe field "' + field + '"');
          if (Object.prototype.hasOwnProperty.call(fields, field)) fail('duplicate field "' + field + '"');
          expect('=');
          fields[field] = value();
          space();
          if (text[pos] !== ',') break;
          pos++;
        }
      }
      expect(close);
      let ref = {};
      if (fields.neo_data) {
        try {
          ref = JSON.parse(decodeURIComponent(clean(fields.neo_data)), function (k, v) {
            return forbidden.has(k) ? undefined : v;
          });
          if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw new Error('expected object');
        } catch (error) { fail('invalid neo_data metadata: ' + error.message); }
      }
      ref.id = ref.id || key;
      ref.key = ref.key === '' && ref.id === key ? '' : key;
      ref.type = types[type] || type;
      const mapping = {
        title: 'title', journal: 'container-title', booktitle: 'container-title',
        publisher: 'publisher', address: 'publisher-place', volume: 'volume',
        number: 'issue', pages: 'page', doi: 'DOI', url: 'URL', isbn: 'ISBN',
        issn: 'ISSN', abstract: 'abstract', keywords: 'keyword', note: 'note',
        category: 'category'
      };
      Object.keys(mapping).forEach(function (field) {
        if (fields[field] !== undefined) ref[mapping[field]] = clean(fields[field]);
      });
      ['author', 'editor'].forEach(function (field) {
        if (fields[field] !== undefined) ref[field] = parseNames(fields[field]);
      });
      if (fields.year !== undefined) {
        const year = clean(fields.year);
        if (!/^-?\d{1,6}$/.test(year)) fail('invalid year "' + year + '" in "' + key + '"');
        const previous = ref.issued && ref.issued['date-parts'];
        const date = previous && previous[0] ? previous[0].slice() : [];
        date[0] = Number(year);
        ref.issued = { 'date-parts': [date] };
      }
      ref.bibtex = { type: type, fields: fields };
      entries.push(ref);
    }
    return entries;
  }

  function stringify(refs) {
    if (!Array.isArray(refs)) throw new TypeError('BibTeX references must be an array');
    function escape(value) { return String(value).replace(/[\\{}"]/g, '\\$&'); }
    return refs.map(function (ref) {
      const key = ref.key || ref.id;
      if (typeof key !== 'string' || !key || /[\s{},()"\\#=@]/.test(key)) {
        throw new Error('BibTeX export: invalid citation key "' + key + '"');
      }
      const fields = Object.create(null);
      if (ref.bibtex && ref.bibtex.fields) {
        Object.keys(ref.bibtex.fields).forEach(function (field) {
          if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(field) && !forbidden.has(field)) {
            fields[field] = clean(ref.bibtex.fields[field]);
          }
        });
      }
      const mapping = {
        title: 'title', publisher: 'publisher', 'publisher-place': 'address',
        volume: 'volume', issue: 'number', page: 'pages', DOI: 'doi', URL: 'url',
        ISBN: 'isbn', ISSN: 'issn', abstract: 'abstract', keyword: 'keywords',
        note: 'note', category: 'category'
      };
      Object.keys(mapping).forEach(function (field) {
        if (ref[field]) fields[mapping[field]] = ref[field];
      });
      if (ref['container-title']) fields[ref.type === 'article-journal' ? 'journal' : 'booktitle'] = ref['container-title'];
      const date = ref.issued && ref.issued['date-parts'];
      if (date && date[0] && date[0][0] !== undefined) fields.year = date[0][0];
      const lines = Object.keys(fields).filter(function (field) {
        return !['neo_data', 'author', 'editor'].includes(field);
      }).map(function (field) { return '  ' + field + ' = {' + escape(fields[field]) + '}'; });
      ['author', 'editor'].forEach(function (field) {
        if (ref[field] && ref[field].length) {
          const names = ref[field].map(function (person) {
            return person.literal ? '{' + escape(person.literal) + '}'
              : escape(person.family || '') + ', ' + (person.suffix ? escape(person.suffix) + ', ' : '') + escape(person.given || '');
          }).join(' and ');
          lines.push('  ' + field + ' = {' + names + '}');
        }
      });
      const metadata = Object.assign({}, ref);
      delete metadata.bibtex;
      lines.push('  neo_data = {' + encodeURIComponent(JSON.stringify(metadata)) + '}');
      const type = reverseTypes[ref.type] || (ref.bibtex && ref.bibtex.type) || 'misc';
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(type)) throw new Error('BibTeX export: invalid entry type');
      return '@' + type + '{' + key + ',\n' + lines.join(',\n') + '\n}';
    }).join('\n\n');
  }
  return { parse: parse, stringify: stringify, parseNames: parseNames };
}));
