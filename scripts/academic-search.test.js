'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AcademicSearch = require('../academic/academic-search');

test('compile makes literal searches global, Unicode-aware, and case-insensitive by default', () => {
  const expression = AcademicSearch.compile('a+b');
  assert.equal(expression.global, true);
  assert.equal(expression.unicode, true);
  assert.equal(expression.ignoreCase, true);
  assert.deepEqual(AcademicSearch.find('A+B a+b aaab', 'a+b', { regex: false })
    .map(({ index, text }) => ({ index, text })), [
    { index: 0, text: 'A+B' },
    { index: 4, text: 'a+b' }
  ]);
});

test('compile reports invalid regular expressions descriptively', () => {
  assert.throws(
    () => AcademicSearch.compile('('),
    (error) => error instanceof Error &&
      error.message.startsWith('Invalid search regular expression:')
  );
});

test('find advances zero-width matches by Unicode code point', () => {
  const matches = AcademicSearch.find('A😀B', '(?=.)', { regex: true });
  assert.deepEqual(matches.map(({ index, length, text }) => ({ index, length, text })), [
    { index: 0, length: 0, text: '' },
    { index: 1, length: 0, text: '' },
    { index: 3, length: 0, text: '' }
  ]);
});

test('find returns stable capture and named-group data', () => {
  const [match] = AcademicSearch.find('Author: Ada', '(?<label>Author):\\s+(\\w+)', {
    regex: true,
    caseSensitive: true
  });
  assert.deepEqual(match, {
    index: 0,
    length: 11,
    text: 'Author: Ada',
    groups: { label: 'Author' },
    captures: ['Author', 'Ada']
  });
});

test('replace uses literal pattern matching and leaves uncaptured $1 literal', () => {
  assert.deepEqual(
    AcademicSearch.replace('a+b and a+b', 'a+b', '$1', { regex: false }),
    { text: '$1 and $1', count: 2 }
  );
});

test('replace expands native regular-expression replacement tokens', () => {
  const result = AcademicSearch.replace(
    'before Ada Lovelace after',
    '(?<first>Ada) (?<last>Lovelace)',
    '$$:$&:$1:$2:$<last>:$`:$\'',
    { regex: true, caseSensitive: true }
  );
  assert.deepEqual(result, {
    text: 'before $:Ada Lovelace:Ada:Lovelace:Lovelace:before : after after',
    count: 1
  });
});

test('replaceMatch expands captures and surrounding-text tokens for one match', () => {
  const text = 'prefix Ada suffix';
  const [match] = AcademicSearch.find(text, '(?<name>Ada)', {
    regex: true,
    caseSensitive: true
  });
  assert.equal(
    AcademicSearch.replaceMatch(text, match, '$$ $& $1 $<name> $` $\''),
    'prefix $ Ada Ada Ada prefix   suffix suffix'
  );
});

test('replace counts and replaces zero-width matches without splitting surrogate pairs', () => {
  assert.deepEqual(
    AcademicSearch.replace('😀', '(?=.)', '-', { regex: true }),
    { text: '-😀', count: 1 }
  );
});
