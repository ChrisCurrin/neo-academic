(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NeoAcademicModel = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    abstract: '',
    keywords: [],
    authors: [],
    references: [],
    figures: [],
    tables: [],
    equations: [],
    reviewComments: [],
    revisions: [],
    paperType: '',
    profile: 'apa',
    citationStyle: 'author-date',
    academicMode: false,
    trackChanges: false,
    writingTheme: 'latex-plain',
    exportTheme: 'latex-plain'
  });
  const ARRAY_FIELDS = Object.freeze([
    'keywords', 'authors', 'references', 'figures', 'tables', 'equations',
    'reviewComments', 'revisions'
  ]);
  const STRING_FIELDS = Object.freeze([
    'abstract', 'paperType', 'profile', 'citationStyle'
  ]);
  const ORCID_ID = /^(\d{4})-(\d{4})-(\d{4})-(\d{3})(\d|X)$/i;

  function clone(value, seen) {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return new Date(value.getTime());
    seen = seen || new WeakMap();
    if (seen.has(value)) return seen.get(value);

    const copy = Array.isArray(value)
      ? []
      : Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
    seen.set(value, copy);
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        value: clone(value[key], seen),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return copy;
  }

  function recordOrEmpty(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function read(book) {
    if (book === null || book === undefined) book = {};
    if (typeof book !== 'object' || Array.isArray(book)) {
      throw new TypeError('book must be an object.');
    }

    const legacy = recordOrEmpty(book.academic);
    const metadata = recordOrEmpty(book.metadata);
    const normalized = {
      ...clone(DEFAULTS),
      ...clone(legacy),
      ...clone(metadata)
    };

    for (const field of ARRAY_FIELDS) {
      if (!Array.isArray(normalized[field])) normalized[field] = [];
    }
    for (const field of STRING_FIELDS) {
      if (typeof normalized[field] !== 'string') normalized[field] = DEFAULTS[field];
    }
    for (const field of ['academicMode', 'trackChanges']) {
      if (typeof normalized[field] !== 'boolean') normalized[field] = DEFAULTS[field];
    }
    return normalized;
  }

  function normalizeOrcid(value, lineNumber) {
    let id = value.trim();
    if (!id) return '';

    if (/^https:\/\//i.test(id)) {
      const match = id.match(/^https:\/\/orcid\.org\/([^/]+)\/?$/i);
      if (!match) throw new Error(`Invalid ORCID on line ${lineNumber}: expected an ORCID ID or https://orcid.org URL.`);
      id = match[1];
    }

    const match = id.match(ORCID_ID);
    if (!match) {
      throw new Error(`Invalid ORCID on line ${lineNumber}: expected the format 0000-0000-0000-0000.`);
    }
    const digits = `${match[1]}${match[2]}${match[3]}${match[4]}`;
    let total = 0;
    for (const digit of digits) total = (total + Number(digit)) * 2;
    const checkValue = (12 - (total % 11)) % 11;
    const expected = checkValue === 10 ? 'X' : String(checkValue);
    if (match[5].toUpperCase() !== expected) {
      throw new Error(`Invalid ORCID on line ${lineNumber}: checksum does not match.`);
    }
    return `${match[1]}-${match[2]}-${match[3]}-${match[4]}${expected}`;
  }

  function parseAuthors(text) {
    if (typeof text !== 'string') throw new TypeError('text must be a string.');
    const authors = [];
    for (const [index, line] of text.split(/\r\n?|\n/).entries()) {
      if (!line.trim()) continue;
      const fields = line.split('|').map((field) => field.trim());
      const lineNumber = index + 1;
      if (fields.length > 3) {
        throw new Error(`Invalid author on line ${lineNumber}: expected Name | Affiliation | ORCID.`);
      }
      const name = fields[0] || '';
      if (!name.trim()) {
        throw new Error(`Invalid author on line ${lineNumber}: name must not be empty.`);
      }
      authors.push({
        name,
        affiliation: fields[1] || '',
        orcid: normalizeOrcid(fields[2] || '', lineNumber)
      });
    }
    return authors;
  }

  function formatAuthors(authors) {
    if (!Array.isArray(authors)) throw new TypeError('authors must be an array.');
    return authors.map((author, index) => {
      if (!author || typeof author !== 'object' || Array.isArray(author)) {
        throw new TypeError(`authors[${index}] must be an object.`);
      }
      if (typeof author.name !== 'string' || !author.name.trim()) {
        throw new TypeError(`authors[${index}].name must be a non-empty string.`);
      }
      const name = author.name.trim();
      const affiliation = typeof author.affiliation === 'string' ? author.affiliation.trim() : '';
      const orcid = typeof author.orcid === 'string' ? author.orcid.trim() : '';
      if (orcid) return `${name} | ${affiliation} | ${orcid}`;
      if (affiliation) return `${name} | ${affiliation}`;
      return name;
    }).join('\n');
  }

  function identityValue(reference, field) {
    if (!reference || typeof reference !== 'object') return null;
    const value = reference[field];
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return normalized || null;
  }

  function collisionIndexes(references, candidate) {
    const id = identityValue(candidate, 'id');
    const key = identityValue(candidate, 'key');
    if (id === null && key === null) return [];
    const matches = [];
    references.forEach((reference, index) => {
      const idMatch = id !== null && identityValue(reference, 'id') === id;
      const keyMatch = key !== null && identityValue(reference, 'key') === key;
      if (idMatch || keyMatch) matches.push(index);
    });
    return matches;
  }

  function mergeReferences(existing, incoming, options) {
    if (!Array.isArray(existing)) throw new TypeError('existing must be an array.');
    if (!Array.isArray(incoming)) throw new TypeError('incoming must be an array.');
    options = options === undefined ? {} : options;
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('options must be an object.');
    }
    const duplicates = options.duplicates === undefined ? 'error' : options.duplicates;
    if (!['error', 'replace', 'skip'].includes(duplicates)) {
      throw new TypeError("options.duplicates must be 'error', 'replace', or 'skip'.");
    }

    const result = clone(existing);
    for (const [index, candidate] of incoming.entries()) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new TypeError(`incoming[${index}] must be an object.`);
      }
      const collisions = collisionIndexes(result, candidate);
      if (!collisions.length) {
        result.push(clone(candidate));
        continue;
      }
      if (duplicates === 'error') {
        const identity = identityValue(candidate, 'key') ?? identityValue(candidate, 'id');
        throw new Error(`Duplicate reference id or key: ${identity}.`);
      }
      if (duplicates === 'skip') continue;
      if (collisions.length > 1) {
        throw new Error('Cannot replace reference: its id and key collide with different existing references.');
      }
      result[collisions[0]] = clone(candidate);
    }
    return result;
  }

  return Object.freeze({ read, parseAuthors, formatAuthors, mergeReferences });
}));
