'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const model = require('../academic/academic-model.js');

test('UMD build exposes NeoAcademicModel in a browser-like context', () => {
  const context = vm.createContext({});
  const source = fs.readFileSync(path.join(__dirname, '..', 'academic', 'academic-model.js'), 'utf8');
  vm.runInContext(source, context);
  assert.equal(typeof context.NeoAcademicModel.read, 'function');
  assert.equal(context.NeoAcademicModel.read({}).profile, 'apa');
});

test('read returns all normalized defaults for an empty book', () => {
  assert.deepEqual(model.read({}), {
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
});

test('read migrates legacy academic fields and lets metadata override even empty values', () => {
  const book = {
    academic: {
      abstract: 'legacy abstract',
      keywords: ['legacy'],
      authors: [{ name: 'Legacy author' }],
      references: [{ key: 'legacy-ref' }],
      profile: 'mla'
    },
    metadata: {
      abstract: '',
      keywords: [],
      profile: 'apa'
    }
  };
  const data = model.read(book);

  assert.equal(data.abstract, '');
  assert.deepEqual(data.keywords, []);
  assert.deepEqual(data.authors, [{ name: 'Legacy author' }]);
  assert.deepEqual(data.references, [{ key: 'legacy-ref' }]);
  assert.equal(data.profile, 'apa');
  assert.equal(book.academic.abstract, 'legacy abstract');
  assert.deepEqual(book.academic.keywords, ['legacy']);
});

test('read clones nested metadata so books and returned values stay isolated', () => {
  const book = {
    metadata: {
      authors: [{ name: 'One', affiliations: ['Lab'] }],
      figures: [{ id: 'figure-1', file: 'figures/figure-1.png', originalFile: 'figures/figure-1.pdf' }]
    }
  };
  const first = model.read(book);
  const second = model.read(book);
  first.authors[0].affiliations.push('Other');
  first.authors.push({ name: 'Two' });

  assert.deepEqual(book.metadata.authors, [{ name: 'One', affiliations: ['Lab'] }]);
  assert.deepEqual(second.authors, [{ name: 'One', affiliations: ['Lab'] }]);
  assert.equal(second.figures[0].originalFile, 'figures/figure-1.pdf');
  assert.notEqual(first.authors, second.authors);
});

test('read keeps long values intact and replaces malformed fields with defaults', () => {
  const abstract = 'a'.repeat(20000);
  const data = model.read({ metadata: { abstract, references: 'not an array', trackChanges: 1 } });
  assert.equal(data.abstract, abstract);
  assert.deepEqual(data.references, []);
  assert.equal(data.trackChanges, false);
});

test('parseAuthors preserves an empty affiliation before an ORCID', () => {
  const authors = model.parseAuthors(
    'Ada Example |  | 0000-0002-1825-0097\nGrace Hopper | Navy | https://orcid.org/0000-0002-1825-0097'
  );
  assert.deepEqual(authors, [
    { name: 'Ada Example', affiliation: '', orcid: '0000-0002-1825-0097' },
    { name: 'Grace Hopper', affiliation: 'Navy', orcid: '0000-0002-1825-0097' }
  ]);
});

test('parseAuthors accepts the known valid ORCID checksum and normalizes its URL form', () => {
  assert.deepEqual(model.parseAuthors('A Name | Lab | https://orcid.org/0000-0002-1825-0097'), [
    { name: 'A Name', affiliation: 'Lab', orcid: '0000-0002-1825-0097' }
  ]);
  assert.deepEqual(model.parseAuthors('A Name | Lab | https://orcid.org/0000-0002-1825-0097/'), [
    { name: 'A Name', affiliation: 'Lab', orcid: '0000-0002-1825-0097' }
  ]);
});

test('parseAuthors permits an optional ORCID and ignores blank lines', () => {
  assert.deepEqual(model.parseAuthors('\nA Name | University\n\nB Name\n'), [
    { name: 'A Name', affiliation: 'University', orcid: '' },
    { name: 'B Name', affiliation: '', orcid: '' }
  ]);
});

test('parseAuthors rejects empty names, extra separators, and malformed ORCID IDs', () => {
  assert.throws(() => model.parseAuthors(' | Lab'), /line 1: name must not be empty/);
  assert.throws(() => model.parseAuthors('A Name | Lab | 0000-0002-1825-0097 | extra'), /line 1: expected Name/);
  assert.throws(() => model.parseAuthors('A Name | Lab | 0000-0002-1825-0098'), /checksum does not match/);
  assert.throws(() => model.parseAuthors('A Name | Lab | https://example.com/0000-0002-1825-0097'), /Invalid ORCID/);
});

test('formatAuthors preserves an empty affiliation when an ORCID is present', () => {
  assert.equal(model.formatAuthors([
    { name: 'Ada Example', affiliation: '', orcid: '0000-0002-1825-0097' },
    { name: 'Grace Hopper', affiliation: 'Navy', orcid: '' },
    { name: 'A Name', affiliation: '', orcid: '' }
  ]), 'Ada Example |  | 0000-0002-1825-0097\nGrace Hopper | Navy\nA Name');
});

test('mergeReferences appends unique references without mutating inputs', () => {
  const existing = [{ id: '1', key: 'Smith2024' }];
  const incoming = [{ id: '2', key: 'Jones2025' }];
  const merged = model.mergeReferences(existing, incoming);
  assert.deepEqual(merged, [...existing, ...incoming]);
  assert.notEqual(merged, existing);
  assert.notEqual(merged[0], existing[0]);
});

test('mergeReferences detects collisions by either id or key', () => {
  assert.throws(
    () => model.mergeReferences([{ id: '1', key: 'Smith2024' }], [{ id: '2', key: 'Smith2024' }]),
    /Duplicate reference/
  );
  assert.throws(
    () => model.mergeReferences([{ id: '1', key: 'Smith2024' }], [{ id: '1', key: 'Jones2025' }]),
    /Duplicate reference/
  );
});

test('mergeReferences replace retains the existing position and skip preserves the existing item', () => {
  const existing = [
    { id: '1', key: 'Smith2024', text: 'old' },
    { id: '2', key: 'Jones2025', text: 'keep' }
  ];
  const incoming = [{ id: '1', key: 'Smith2024', text: 'new' }];
  assert.deepEqual(model.mergeReferences(existing, incoming, { duplicates: 'replace' }), [
    incoming[0],
    existing[1]
  ]);
  assert.deepEqual(model.mergeReferences(existing, incoming, { duplicates: 'skip' }), existing);
  assert.equal(existing[0].text, 'old');
});

test('mergeReferences rejects ambiguous replace collisions and invalid policies', () => {
  assert.throws(
    () => model.mergeReferences(
      [{ id: '1', key: 'A' }, { id: '2', key: 'B' }],
      [{ id: '1', key: 'B' }],
      { duplicates: 'replace' }
    ),
    /different existing references/
  );
  assert.throws(
    () => model.mergeReferences([], [], { duplicates: 'merge' }),
    /options.duplicates/
  );
});
