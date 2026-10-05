'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const References = require('../academic/references.js');
const Bibtex = require('../academic/bibtex-parser.js');
const CSL = require('../academic/csl-renderer.js');

const article = {
  id: 'smith', key: 'Smith2024', type: 'article-journal', title: 'Reliable results',
  author: [{ family: 'Smith', given: 'Jane Ann' }, { family: 'Jones', given: 'Robert' }],
  issued: { 'date-parts': [[2024]] }, 'container-title': 'Journal of Tests',
  volume: '12', issue: '3', page: '10–20', DOI: '10.1234/results', category: 'methods'
};
const book = {
  id: 'ada', key: 'Ada2020', type: 'book', title: 'Computing',
  author: [{ family: 'Lovelace', given: 'Ada' }], year: 2020,
  publisher: 'Example Press', 'publisher-place': 'London'
};
const refs = [article, book];

test('Node entry points and browser UMD globals share the API without DOM access', () => {
  assert.equal(typeof Bibtex.parse, 'function');
  assert.equal(typeof CSL.bibliography, 'function');
  const context = vm.createContext({ URL });
  // Globals can be loaded in either order; dependencies are resolved on use.
  ['academic/references.js', 'academic/csl-renderer.js', 'academic/bibtex-parser.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  });
  assert.equal(typeof context.NeoReferences.normalize, 'function');
  assert.equal(typeof context.NeoBibtex.parse, 'function');
  assert.equal(typeof context.NeoCSL.citation, 'function');
  const imported = context.NeoReferences.import(JSON.stringify(refs), 'json');
  assert.equal(context.NeoReferences.citation(imported, ['Smith2024'], { style: 'numeric' }), '[1]');
});

test('legacy manual fields survive normalization and rendering', () => {
  const legacy = { key: 'Old', text: '  Original manual entry.  ', label: 'Original label', author: 'Jane Smith', year: '2024' };
  const normalized = References.normalize(legacy);
  assert.equal(normalized.id, 'Old');
  assert.equal(normalized.text, legacy.text);
  assert.equal(normalized.label, legacy.label);
  assert.deepEqual(normalized.author, [{ family: 'Smith', given: 'Jane' }]);
  assert.deepEqual(normalized.issued, { 'date-parts': [[2024]] });
  assert.equal(References.bibliography([legacy], ['Old'], { profile: 'apa' })[0].text, legacy.text);
  assert.deepEqual(References.normalize(normalized), normalized);
  assert.deepEqual(legacy, { key: 'Old', text: '  Original manual entry.  ', label: 'Original label', author: 'Jane Smith', year: '2024' });
});

test('generated identities are deterministic, property-order independent and reusable', () => {
  const first = References.normalize({ title: '匿名研究', author: [{ literal: '研究機関' }] });
  const second = References.normalize({ author: [{ literal: '研究機関' }], title: '匿名研究' });
  assert.equal(first.id, second.id);
  assert.match(first.id, /^neo-[0-9a-f]{8}$/);
  assert.equal(first.key, '');
  assert.deepEqual(References.normalize(first), first);
  assert.equal(References.normalize({ id: 42, title: 'A' }).id, '42');
  assert.notEqual(References.normalize({ title: 'Different' }).id, first.id);
  assert(References.validate([first]).some((d) => d.code === 'missing-key') === false);
  assert(References.validate([{ title: 'No key' }]).some((d) => d.code === 'missing-key'));
});

test('CSL JSON round trips Unicode, extended fields, literal dates, legacy metadata and unknown dates', () => {
  const values = [
    { ...article, title: 'Café — 日本語 😀', author: [{ literal: 'Équipe {研究}' }], custom: { nested: ['å'] }, issued: { 'date-parts': [[2024, 2, 29]] } },
    { title: 'Undated', text: 'Original', label: 'Keep me', category: 'misc' },
    { id: 'literal', title: 'In press', issued: { literal: 'forthcoming' } }
  ];
  const normalized = values.map(References.normalize);
  assert.deepEqual(References.import(References.export(values, 'json'), 'json'), normalized);
  assert.deepEqual(References.import(JSON.stringify(article), 'json'), [References.normalize(article)]);
});

test('BibTeX parses nested protection, quoted escapes, concatenated macros, comments and standard names', () => {
  const text = String.raw`
% ignored line
@string{journalName = "Café " # {Journal}}
@string(prefix = "A ")
@preamble{"not a reference"}
@comment{ignored {nested} text}
@comment(ignored (nested) text)
@article{Unicode2024,
  title = prefix # {Study of {Nested {Braces}} and \{literal\}} # " \"quotes\"",
  author = {Ludwig van Beethoven and de la Cruz, Jr, Juan and {Research and Development}},
  journal = journalName, year = 2024, month = jan,
  doi = {10.1234/é}, custom = {extra {value}},
}`;
  const [ref] = References.import(text, 'bib');
  assert.equal(ref.title, 'A Study of Nested Braces and {literal} "quotes"');
  assert.equal(ref['container-title'], 'Café Journal');
  assert.deepEqual(ref.author, [
    { family: 'van Beethoven', given: 'Ludwig' },
    { family: 'de la Cruz', given: 'Juan', suffix: 'Jr' },
    { literal: 'Research and Development' }
  ]);
  assert.deepEqual(ref.issued, { 'date-parts': [[2024]] });
  assert.equal(ref.bibtex.fields.custom, 'extra {value}');
});

test('BibTeX supports incollection/editor, thesis, online and unknown entry types', () => {
  const parsed = References.import(`
@incollection{chapter, title={Chapter}, editor={Doe, Jane}, booktitle={Collection}, pages={2--9}}
@phdthesis{thesis, title={Thesis}, year={2020}}
@online{site, title={Site}, url={https://example.org}}
@dataset{data, title={Data}}
`, 'bib');
  assert.deepEqual(parsed.map((ref) => ref.type), ['chapter', 'thesis', 'webpage', 'dataset']);
  assert.deepEqual(parsed[0].editor, [{ family: 'Doe', given: 'Jane' }]);
});

test('BibTeX round trips normalized data including legacy fields, braces, backslashes and Unicode', () => {
  const values = [
    { ...article, title: 'É {literal} "quote" \\path 😀', author: [{ family: 'García', given: 'María José' }, { literal: 'R&D and {Group}' }], text: 'Original entry', label: 'Short', custom: { code: 5 }, issued: { 'date-parts': [[2024, 5, 9]] } },
    { title: 'Anonymous reference', text: 'Unchanged', label: 'Legacy', category: 'manual' },
    book
  ];
  const normalized = values.map(References.normalize);
  const imported = References.import(References.export(values, 'bib'), 'bib');
  imported.forEach((ref, index) => {
    const copy = { ...ref };
    delete copy.bibtex;
    assert.deepEqual(copy, normalized[index]);
  });
  assert.equal(References.import(References.export(imported, 'bib'), 'bib')[0].title, normalized[0].title);
});

test('duplicate imports are retained, never silently replaced, and identified for caller resolution', () => {
  const duplicated = References.import('@book{same,title={First}}\n@book{same,title={Second}}', 'bib');
  assert.equal(duplicated.length, 2);
  assert.deepEqual(duplicated.map((ref) => ref.title), ['First', 'Second']);
  assert(References.validate(duplicated).some((d) => d.code === 'duplicate-id' && d.severity === 'error'));
  const json = References.import(JSON.stringify([article, article]), 'json');
  assert.equal(json.length, 2);
  assert(References.validate([{ ...article, key: 'ada' }, book]).some((d) => d.code === 'duplicate-id'));
});

test('all profiles have distinct, meaningful bibliography text', () => {
  const apa = References.bibliography([article], ['smith'], { profile: 'apa' })[0].text;
  const mla = References.bibliography([article], ['smith'], { profile: 'mla' })[0].text;
  const chicago = References.bibliography([article], ['smith'], { profile: 'chicago' })[0].text;
  const ieee = References.bibliography([article], ['smith'], { profile: 'ieee' })[0].text;
  assert.equal(new Set([apa, mla, chicago, ieee]).size, 4);
  assert.match(apa, /Smith, J\. A\. & Jones, R\. \(2024\)\./);
  assert.match(apa, /Journal of Tests, 12\(3\), 10–20/);
  assert.match(mla, /Smith, Jane Ann and Robert Jones/);
  assert.match(mla, /vol\. 12, no\. 3.*2024, pp\. 10–20/);
  assert.match(chicago, /Journal of Tests 12, no\. 3 \(2024\): 10–20/);
  assert.match(ieee, /^\[1\] J\. A\. Smith and R\. Jones,/);
  assert.match(ieee, /doi: 10\.1234\/results/);
  assert.match(References.bibliography([book], undefined, { profile: 'apa' })[0].text, /London: Example Press/);
});

test('multi-citations accept ids and keys, deduplicate aliases and support all in-text styles', () => {
  assert.equal(References.citation(refs, ['smith', 'Smith2024', 'ada'], { profile: 'apa', style: 'numeric' }), '[1, 2]');
  assert.equal(References.citation(refs, ['smith', 'ada'], { profile: 'apa', style: 'author-date' }), '(Smith & Jones, 2024; Lovelace, 2020)');
  assert.equal(References.citation(refs, ['smith', 'ada'], { profile: 'apa', style: 'narrative' }), 'Smith and Jones (2024); Lovelace (2020)');
  assert.equal(References.citation(refs, ['smith'], { profile: 'chicago' }), '(Smith and Jones 2024)');
  assert.equal(References.citation(refs, ['ada'], { profile: 'mla', locator: '42' }), '(Lovelace 42)');
  assert.equal(References.citation(refs, ['ada'], { profile: 'mla', style: 'narrative' }), 'Lovelace');
  assert.equal(References.citation(refs, ['ada'], { profile: 'ieee' }), '[2]');
  assert.equal(References.citation(refs, []), '');
});

test('three authors use et al.; missing authors and dates have readable fallbacks', () => {
  const many = { ...article, author: [...article.author, { family: 'Chen', given: 'Li' }] };
  assert.equal(References.citation([many], ['smith'], { profile: 'apa' }), '(Smith et al., 2024)');
  assert.equal(References.citation([{ key: 'anon', title: 'Unknown' }], ['anon']), '(Unknown, n.d.)');
  assert.equal(References.citation([{ key: 'legacy', label: 'Manual' }], ['legacy']), '(Manual, n.d.)');
});

test('numeric bibliography and citations use database order unless an explicit manuscript order is shared', () => {
  const defaultRows = References.bibliography(refs, ['ada', 'smith'], { profile: 'ieee' });
  assert.deepEqual(defaultRows.map((row) => row.id), ['smith', 'ada']);
  assert.match(defaultRows[1].text, /^\[2\]/);
  const opts = { profile: 'ieee', citedIds: ['Ada2020', 'Smith2024', 'ada', 'missing'] };
  assert.equal(References.citation(refs, ['smith', 'ada'], opts), '[2, 1]');
  const rows = References.bibliography(refs, ['ada', 'smith'], opts);
  assert.deepEqual(rows.map((row) => row.id), ['ada', 'smith']);
  assert.match(rows[0].text, /^\[1\]/);
  assert.match(rows[1].text, /^\[2\]/);
  assert.match(References.bibliography(refs, ['ada'], { profile: 'apa', style: 'numeric' })[0].text, /^\[2\]/);
  assert.deepEqual(References.bibliography(refs, [], opts), []);
});

test('alphabetical bibliography filters aliases, while missing citations remain visible and diagnostic', () => {
  assert.deepEqual(References.bibliography(refs, ['smith', 'ada', 'Smith2024']).map((r) => r.id), ['ada', 'smith']);
  assert.equal(References.citation(refs, ['missing'], { style: 'numeric' }), '[Missing reference: missing]');
  assert.equal(References.citation(refs, ['missing']), '(Missing reference: missing)');
  assert.deepEqual(References.bibliography(refs, ['missing']), []);
  const diagnostics = References.validate(refs, ['missing', 'missing', 'Smith2024']);
  assert.equal(diagnostics.filter((d) => d.code === 'missing-reference').length, 1);
  assert(diagnostics.some((d) => d.code === 'uncited-reference' && d.id === 'ada'));
  assert(!diagnostics.some((d) => d.code === 'uncited-reference' && d.id === 'smith'));
});

test('APA, MLA and Chicago numeric bibliographies match citations, including subset numbering gaps', () => {
  const third = { id: 'third', title: 'Third', author: [{ family: 'Anderson', given: 'Zoe' }], year: 2025 };
  const database = [...refs, third];
  for (const profile of ['apa', 'mla', 'chicago']) {
    const opts = { profile, style: 'numeric' };
    assert.equal(References.citation(database, ['smith'], opts), '[1]');
    assert.equal(References.citation(database, ['third'], opts), '[3]');
    const rows = References.bibliography(database, ['third', 'smith'], opts);
    assert.deepEqual(rows.map((row) => row.id), ['smith', 'third']);
    assert.match(rows[0].text, /^\[1\] /);
    assert.match(rows[1].text, /^\[3\] /);
    const subset = References.bibliography(database, ['Ada2020'], opts);
    assert.equal(References.citation(database, ['Ada2020'], opts), '[2]');
    assert.match(subset[0].text, /^\[2\] /);
    assert.equal(References.bibliography(database, ['smith'], { profile })[0].text.startsWith('[1]'), false);
  }
});

test('numeric APA, MLA and Chicago support shared first-appearance order without renumbering subsets', () => {
  const third = { id: 'third', title: 'Third', year: 2025 };
  const database = [...refs, third];
  for (const profile of ['apa', 'mla', 'chicago']) {
    const opts = { profile, style: 'numeric', citedIds: ['third', 'Ada2020', 'Smith2024'] };
    assert.equal(References.citation(database, ['smith', 'third'], opts), '[3, 1]');
    const rows = References.bibliography(database, ['smith', 'third'], opts);
    assert.deepEqual(rows.map((row) => row.id), ['third', 'smith']);
    assert.match(rows[0].text, /^\[1\] /);
    assert.match(rows[1].text, /^\[3\] /);
  }
});

test('manual validation diagnoses incomplete data, DOI, unsafe URLs and structural problems', () => {
  const diagnostics = References.validate([
    {}, { key: 'bad', title: 'Unsafe', DOI: 'nope', URL: 'javascript:alert(1)' },
    { key: 'date', issued: { 'date-parts': [[2024, 13]] } },
    { key: 'people', author: [{}] }
  ], ['unresolved']);
  for (const code of ['missing-key', 'missing-title', 'missing-author', 'missing-date', 'invalid-doi', 'invalid-url', 'invalid-reference', 'missing-reference']) {
    assert(diagnostics.some((d) => d.code === code), code);
  }
  assert(diagnostics.every((d) => typeof d.message === 'string' && d.message.length && ['warning', 'error'].includes(d.severity)));
  assert.deepEqual(References.validate([article], ['smith']), []);
});

test('malformed CSL JSON and manual data fail descriptively', () => {
  const invalid = ['{', 'null', '42', '"text"', '[null]', '[{} , {"author":42}]', '[{"title":3}]',
    '[{"issued":{"date-parts":[["2024"]]}}]', '[{"issued":{"date-parts":[[2024,2,32]]}}]'];
  invalid.forEach((text) => assert.throws(() => References.import(text, 'json'), /CSL JSON|Reference/));
  assert.throws(() => References.import('', 'json'), /nonempty/);
  assert.throws(() => References.import('[]', 'json'), /no entries/);
  assert.throws(() => References.normalize({ year: 'yesterday' }), /year/);
  assert.throws(() => References.normalize({ author: ['John'] }), /names must be objects/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => References.normalize(cyclic), /cycles/);
  assert.throws(() => References.export(refs, 'xml'), /Unsupported/);
  assert.throws(() => References.citation(refs, ['smith'], { profile: 'unknown' }), /profile/);
  assert.throws(() => References.citation(refs, ['smith'], { style: 'unknown' }), /style/);
  assert.throws(() => References.citation(refs, 'smith'), /array/);
});

test('malformed BibTeX gives positional errors instead of partial import', () => {
  const invalid = [
    '@book{', '@book{,title={A}}', '@book{key,title={Unclosed}',
    '@book{key,title="Unclosed}', '@book{key,title={A} year=2024}',
    '@book{key,title={A},title={B}}', '@book{key,title=undefinedMacro}',
    '@string{x="a"', '@book{key,year={tomorrow}}',
    '@book{key,title="bad }"}', '@comment(unterminated',
    '@book{key,neo_data={not-json}}', '@book{bad key,title={A}}',
    '@book{key,title={Fine}} trailing junk'
  ];
  invalid.forEach((text) => assert.throws(() => References.import(text, 'bib'), /BibTeX.*character/));
  assert.throws(() => References.import('@string{x={a}}', 'bib'), /no entries/);
  assert.throws(() => References.export([{ id: 'bad,key', title: 'X' }], 'bib'), /invalid citation key/);
});

test('imports and renderers never evaluate HTML/script payloads or pollute object prototypes', () => {
  const payload = '<img src=x onerror="globalThis.compromised=true"><script>alert(1)</script>';
  const imported = References.import(JSON.stringify([{ id: 'unsafe', title: payload, URL: 'javascript:alert(1)' }]), 'json');
  assert(References.bibliography(imported, ['unsafe'])[0].text.includes(payload));
  assert(References.validate(imported).some((d) => d.code === 'invalid-url'));
  const pollution = References.import('[{"id":"safe","title":"ok","__proto__":{"polluted":true},"custom":{"constructor":{"prototype":{"polluted":true}}}}]', 'json');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(pollution[0], '__proto__'), false);
  assert.equal(Object.hasOwn(pollution[0].custom, 'constructor'), false);
  const roundtrip = References.import(References.export(imported, 'bib'), 'bib');
  assert.equal(roundtrip[0].title, payload);
  assert.equal(globalThis.compromised, undefined);
  assert.throws(() => References.import('@book{x,__proto__={pollution}}', 'bib'), /unsafe field/);
});

test('normalization and rendering do not mutate their callers', () => {
  const original = JSON.stringify(refs);
  References.normalize(article);
  References.export(refs, 'json');
  References.export(refs, 'bib');
  References.citation(refs, ['ada', 'smith']);
  References.bibliography(refs, ['ada', 'smith']);
  References.validate(refs, ['smith']);
  assert.equal(JSON.stringify(refs), original);
});
