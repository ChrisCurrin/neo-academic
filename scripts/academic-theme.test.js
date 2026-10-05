const { test } = require('node:test');
const assert = require('node:assert/strict');

test('theme registry lists and retrieves presets', () => {
  const theme = require('../academic/academic-theme');
  const { create } = theme;
  const mod = create({ document: {}, getBook: () => null, translate: (k)=>k, report: ()=>{}, model: { read: () => ({}) } });
  const list = mod.listThemes();
  assert.ok(list.length >= 7);
  const t = mod.getTheme('latex-plain');
  assert.equal(t.id, 'latex-plain');
  assert.equal(t.typography.fontSizePt, 11);
});

test('theme registry inheritance merges base', () => {
  const theme = require('../academic/academic-theme');
  const { create } = theme;
  const mod = create({ document: {}, getBook: () => null, translate: (k)=>k, report: ()=>{}, model: { read: () => ({}) } });
  const t = mod.getTheme('latex-double');
  assert.equal(t.id, 'latex-double');
  assert.equal(t.typography.lineHeight, 2.0);
  assert.equal(t.typography.fontFamily, 'Times New Roman, serif');
});

test('applyTheme sets data-theme attribute', () => {
  const theme = require('../academic/academic-theme');
  const { create } = theme;
  const root = { dataset: {}, style: { setProperty: ()=>{} } };
  const mod = create({ document: {}, getBook: () => null, translate: (k)=>k, report: ()=>{}, model: { read: () => ({}) } });
  mod.applyTheme(root, 'nature');
  assert.equal(root.dataset.theme, 'nature');
});

test('persistTheme writes metadata.writingTheme', () => {
  const theme = require('../academic/academic-theme');
  const { create } = theme;
  const book = { metadata: {} };
  const model = { read: (b) => b.metadata || {} };
  const mod = create({ document: {}, getBook: () => book, translate: (k)=>k, report: ()=>{}, model });
  mod.persistTheme(book, 'ams');
  assert.equal(book.metadata.writingTheme, 'ams');
});

test('themeForBook uses writingTheme over exportTheme', () => {
  const theme = require('../academic/academic-theme');
  const { create } = theme;
  const book = { metadata: { writingTheme: 'nature', exportTheme: 'chicago' } };
  const model = { read: (b) => b.metadata || {} };
  const mod = create({ document: {}, getBook: () => book, translate: (k)=>k, report: ()=>{}, model });
  const t1 = mod.themeForBook(book, 'writing');
  const t2 = mod.themeForBook(book, 'export');
  assert.equal(t1.id, 'nature');
  assert.equal(t2.id, 'chicago');
});
