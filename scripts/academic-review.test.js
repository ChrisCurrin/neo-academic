'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const review = require('../academic/academic-review.js');

test('UMD build exposes NeoAcademicReview in a browser-like context', () => {
  const context = vm.createContext({});
  const source = fs.readFileSync(path.join(__dirname, '..', 'academic/academic-review.js'), 'utf8');
  vm.runInContext(source, context);
  assert.equal(typeof context.NeoAcademicReview.capture, 'function');
  assert.equal(context.NeoAcademicReview.capture('A', 'B', {
    chapterId: 'c1',
    author: 'Ari'
  }).after, 'B');
});

test('capture stores complete before and after snapshots for semantic text changes', () => {
  const before = '<p>First draft.</p>';
  const after = '<p>Revised draft.</p>';
  const revision = review.capture(before, after, {
    id: 'rev-1',
    chapterId: 'chapter-1',
    author: 'Ari',
    date: '2026-09-30T12:00:00Z'
  });

  assert.deepEqual(revision, {
    id: 'rev-1',
    chapterId: 'chapter-1',
    before,
    after,
    author: 'Ari',
    created: '2026-09-30T12:00:00Z',
    status: 'pending',
    summary: 'Chapter text changed'
  });
});

test('capture ignores markup-only and whitespace-only changes', () => {
  assert.equal(review.capture('<p>Hello&nbsp;world</p>', '<strong>Hello world</strong>', {
    chapterId: 'c1',
    author: 'Ari'
  }), null);
  assert.equal(review.capture('  Hello \n world ', 'Hello world', {
    chapterId: 'c1',
    author: 'Ari'
  }), null);
});

test('capture tracks academic source attributes and table style with unchanged visible text', () => {
  const equation = (source) =>
    `<div class="academic-equation" data-academic-id="eq1" data-source="${source}" data-math-format="tex" data-display="true"><span class="academic-equation-body"><svg><path d="M0 0"></path></svg></span><span class="academic-equation-number">(1)</span></div>`;
  const equationRevision = review.capture(equation('x+y'), equation('x-y'), {
    chapterId: 'c1',
    author: 'Ari'
  });
  assert.ok(equationRevision);
  assert.throws(
    () => review.resolve(equationRevision, 'reject', equation('x+y')),
    /chapter content has changed/
  );

  const table = (align) =>
    `<figure class="academic-table" data-academic-id="tb1"><table data-header="true" data-borders="true" data-shading="false" data-align="${align}"><tbody><tr><th>A</th></tr><tr><td>1</td></tr></tbody></table><figcaption>Table 1. Results</figcaption></figure>`;
  const tableRevision = review.capture(table('left'), table('right'), {
    chapterId: 'c1',
    author: 'Ari'
  });
  assert.ok(tableRevision);
  assert.throws(
    () => review.resolve(tableRevision, 'reject', table('left')),
    /chapter content has changed/
  );
});

test('derived citations, cross-reference labels, equation rendering, and numbering do not create changes', () => {
  const before = '<p><span class="academic-citation" data-cites="[&quot;ref-1&quot;]">(Old, 2020)</span> <span class="academic-xref" data-target="fig1" data-kind="figure">Figure 1</span></p>' +
    '<div class="academic-equation" data-academic-id="eq1" data-source="x+y" data-math-format="tex" data-display="true"><span class="academic-equation-body"><svg><path d="M0 0"></path></svg></span><span class="academic-equation-number">(1)</span></div>' +
    '<figure class="academic-figure" data-academic-id="fig1"><img src="data:image/png;base64,AA==" alt="chart"><figcaption>Figure 1. Sales</figcaption></figure>';
  const after = '<p><span class="academic-citation" data-cites="[&quot;ref-1&quot;]">(New, 2024)</span> <span class="academic-xref" data-target="fig1" data-kind="figure">Figure 3</span></p>' +
    '<div class="academic-equation" data-academic-id="eq1" data-source="x+y" data-math-format="tex" data-display="true"><span class="academic-equation-body"><svg><path d="M1 1"></path></svg></span><span class="academic-equation-number">(3)</span></div>' +
    '<figure class="academic-figure" data-academic-id="fig1"><img src="data:image/png;base64,AA==" alt="chart"><figcaption>Figure 3. Sales</figcaption></figure>';

  assert.equal(review.capture(before, after, { chapterId: 'c1', author: 'Ari' }), null);
  const revision = review.capture('Before', after, { chapterId: 'c1', author: 'Ari' });
  const renumbered = after.replace('Figure 3.', 'Figure 4.').replace('(3)', '(4)');
  assert.equal(review.resolve(revision, 'reject', renumbered).html, 'Before');
});

test('changes to citation targets, xref targets, and actual figure captions remain revisions', () => {
  const citation = (target) => `<span class="academic-citation" data-cites="[&quot;${target}&quot;]">(Author, 2024)</span>`;
  assert.ok(review.capture(citation('ref1'), citation('ref2'), { chapterId: 'c1', author: 'Ari' }));

  const xref = (target) => `<span class="academic-xref" data-target="${target}" data-kind="figure">Figure 1</span>`;
  assert.ok(review.capture(xref('fig1'), xref('fig2'), { chapterId: 'c1', author: 'Ari' }));

  const figure = (caption) => `<figure class="academic-figure" data-academic-id="fig1"><img src="chart.png" alt="chart"><figcaption>Figure 1. ${caption}</figcaption></figure>`;
  assert.ok(review.capture(figure('Sales'), figure('Revenue'), { chapterId: 'c1', author: 'Ari' }));
  assert.throws(
    () => review.resolve(review.capture('Original', figure('Sales'), { chapterId: 'c1', author: 'Ari' }),
      'reject', figure('Revenue')),
    /chapter content has changed/
  );
});

test('capture preserves exact snapshots without mutating its inputs', () => {
  const before = Object.freeze('<p>Old</p>');
  const after = Object.freeze('<p>New</p>');
  const context = Object.freeze({ chapterId: 'c1', author: 'Ari' });
  const revision = review.capture(before, after, context);
  assert.equal(revision.before, before);
  assert.equal(revision.after, after);
  assert.equal(revision.status, 'pending');
});

test('resolve accepts without changing current content', () => {
  const revision = review.capture('Old', 'New', { chapterId: 'c1', author: 'Ari' });
  assert.deepEqual(review.resolve(revision, 'accept', '<p>Newer live text</p>'), {
    html: '<p>Newer live text</p>',
    status: 'accepted'
  });
});

test('resolve rejects the current revision and refuses to overwrite later edits', () => {
  const revision = review.capture('Old', 'New', { chapterId: 'c1', author: 'Ari' });
  assert.deepEqual(review.resolve(revision, 'reject', 'New'), {
    html: 'Old',
    status: 'rejected'
  });
  assert.throws(
    () => review.resolve(revision, 'reject', 'Later edit'),
    /chapter content has changed/
  );
});

test('record coalesces consecutive pending updates and retains the initial snapshot', () => {
  const first = review.record([], 'A', 'B', { chapterId: 'c1', author: 'Ari', id: 'rev-1' });
  const second = review.record(first, 'B', 'C', { chapterId: 'c1', author: 'Ari', id: 'rev-2' });

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0].id, 'rev-1');
  assert.equal(second[0].before, 'A');
  assert.equal(second[0].after, 'C');
  assert.equal(second[0].created, first[0].created);
});

test('record removes a coalesced revision reverted to its original semantic text', () => {
  const pending = review.record([], '<p>Original</p>', '<p>Changed</p>', {
    chapterId: 'c1',
    author: 'Ari'
  });
  const reverted = review.record(pending, '<p>Changed</p>', '<p>Original</p>', {
    chapterId: 'c1',
    author: 'Ari'
  });
  assert.deepEqual(reverted, []);
});

test('record does not coalesce another author or a discontinuous update', () => {
  const first = review.record([], 'A', 'B', { chapterId: 'c1', author: 'Ari' });
  const otherAuthor = review.record(first, 'B', 'C', { chapterId: 'c1', author: 'Bo' });
  const discontinuous = review.record(otherAuthor, 'Elsewhere', 'D', {
    chapterId: 'c1',
    author: 'Bo'
  });
  assert.equal(otherAuthor.length, 2);
  assert.equal(discontinuous.length, 3);
  assert.deepEqual(first.map((revision) => revision.after), ['B']);
});

test('sequential revisions on one chapter reject newest first without losing earlier edits', () => {
  const revisions = [
    review.capture('A', 'B', { chapterId: 'c1', author: 'Ari', id: 'rev-1' }),
    review.capture('B', 'C', { chapterId: 'c1', author: 'Ari', id: 'rev-2' })
  ];

  const newest = review.resolve(revisions[1], 'reject', 'C');
  assert.equal(newest.html, 'B');
  const oldest = review.resolve(revisions[0], 'reject', newest.html);
  assert.equal(oldest.html, 'A');
  assert.throws(() => review.resolve(revisions[0], 'reject', 'C'), /Resolve newer revisions first/);
});

test('comment validates and stores its quote anchor and non-empty text', () => {
  const stored = review.comment({
    id: 'comment-1',
    anchor: { chapterId: 'c1', quote: 'A selected sentence.', paragraphIndex: 2 },
    text: 'Could you clarify this?',
    author: 'Ari',
    date: '2026-09-30T12:00:00Z'
  });
  assert.deepEqual(stored, {
    id: 'comment-1',
    chapterId: 'c1',
    quote: 'A selected sentence.',
    paragraphIndex: 2,
    text: 'Could you clarify this?',
    author: 'Ari',
    created: '2026-09-30T12:00:00Z',
    resolved: false
  });
});

test('comment rejects missing anchors, empty quotes, and blank comment text', () => {
  assert.throws(() => review.comment({ text: 'Note' }), /anchor.chapterId/);
  assert.throws(() => review.comment({
    chapterId: 'c1',
    quote: '  ',
    text: 'Note'
  }), /anchor.quote must not be empty/);
  assert.throws(() => review.comment({
    chapterId: 'c1',
    quote: 'Quoted text',
    text: ' \n '
  }), /context.text must not be empty/);
  assert.throws(() => review.comment({
    chapterId: 'c1',
    quote: 'Quoted text',
    paragraphIndex: -1,
    text: 'Note'
  }), /paragraphIndex must be a non-negative integer/);
});

test('locateComment follows unique quotes and reports missing or ambiguous anchors', () => {
  const comment = { quote: 'moved quote' };
  assert.deepEqual(review.locateComment('<p>Some text</p><p>A moved quote appears.</p>', comment), {
    found: true,
    ambiguous: false,
    matchCount: 1,
    index: 12
  });
  assert.deepEqual(review.locateComment('<p>Nothing here</p>', comment), {
    found: false,
    ambiguous: false,
    matchCount: 0,
    index: -1
  });
  assert.equal(review.locateComment('moved quote; then moved quote', comment).ambiguous, true);
});

test('resolve validates its decision', () => {
  const revision = review.capture('A', 'B', { chapterId: 'c1', author: 'Ari' });
  assert.throws(() => review.resolve(revision, 'defer', 'B'), /decision must be either/);
});
