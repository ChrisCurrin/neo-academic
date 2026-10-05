#!/usr/bin/env node
// NEO translation helper. No dependencies.
//
//   node scripts/i18n.js template      writes locales/_template.json: every
//                                      interface string, ready to translate
//   node scripts/i18n.js check fr      lists what locales/fr.json is missing,
//                                      and what it holds that NEO no longer uses
//   node scripts/i18n.js check fr-CA   the same for a regional file, which
//                                      only holds what differs from fr.json
//
// Strings are found in t('…'), tk('…'), tr('…'), translate('…'), and
// (window.)?NeoI18n.t('…') calls in the JavaScript, plus index.html data-i18n*.

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS_FILES = [
  'app.js', 'main.js', 'covers.js',
  'academic/academic.js', 'academic/academic-assets.js', 'academic/academic-export.js', 'academic/academic-math.js',
  'academic/academic-model.js', 'academic/academic-objects.js', 'academic/academic-review.js',
  'academic/academic-search.js', 'academic/academic-ui.js', 'academic/academic-clipboard.js',
  'academic/references.js', 'academic/csl-renderer.js', 'pdf-render.js'
];
const LOCALES = path.join(ROOT, 'locales');

function unescapeJs(s) {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, e) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', '0': '\0' }[e] ?? e;
  });
}

const decodeHtml = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function skipStringOrComment(src, i) {
  const quote = src[i];
  if (quote === "'" || quote === '"' || quote === '`') {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') j++;
      else if (src[j] === quote) return j + 1;
    }
    return src.length;
  }
  if (src[i] === '/' && src[i + 1] === '/') {
    const end = src.indexOf('\n', i + 2);
    return end < 0 ? src.length : end + 1;
  }
  if (src[i] === '/' && src[i + 1] === '*') {
    const end = src.indexOf('*/', i + 2);
    return end < 0 ? src.length : end + 2;
  }
  return i;
}

function matchingDelimiter(src, start) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = start; i < src.length; i++) {
    const skipped = skipStringOrComment(src, i);
    if (skipped !== i) { i = skipped - 1; continue; }
    if (pairs[src[i]]) stack.push(pairs[src[i]]);
    else if (src[i] === ')' || src[i] === ']' || src[i] === '}') {
      if (stack.pop() !== src[i]) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

function topLevelIndex(src, target) {
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const skipped = skipStringOrComment(src, i);
    if (skipped !== i) { i = skipped - 1; continue; }
    if (src[i] === target && !stack.length) return i;
    if (src[i] === '(') stack.push(')');
    else if (src[i] === '[') stack.push(']');
    else if (src[i] === '{') stack.push('}');
    else if (src[i] === ')' || src[i] === ']' || src[i] === '}') stack.pop();
  }
  return -1;
}

function staticString(src) {
  const value = src.trim();
  if (value.length < 2 || !["'", '"'].includes(value[0]) || value[value.length - 1] !== value[0]) return null;
  if (skipStringOrComment(value, 0) !== value.length) return null;
  return unescapeJs(value.slice(1, -1));
}

function staticStrings(expression) {
  const literal = staticString(expression);
  if (literal !== null) return [literal];
  const question = topLevelIndex(expression, '?');
  if (question < 0) return [];
  const colon = topLevelIndex(expression.slice(question + 1), ':');
  if (colon < 0) return [];
  const yes = staticString(expression.slice(question + 1, question + 1 + colon));
  const no = staticString(expression.slice(question + 2 + colon));
  return yes === null || no === null ? [] : [yes, no];
}

function collectStaticProperties(src, property, file, add) {
  const isStart = (c) => /[A-Za-z_$]/.test(c || '');
  const isPart = (c) => /[\w$]/.test(c || '');
  for (let i = 0; i < src.length;) {
    const skipped = skipStringOrComment(src, i);
    if (skipped !== i) { i = skipped; continue; }
    if (!isStart(src[i])) { i++; continue; }
    const start = i++;
    while (isPart(src[i])) i++;
    if (src.slice(start, i) !== property || src[start - 1] === '.') continue;
    let cursor = i;
    while (/\s/.test(src[cursor] || '')) cursor++;
    if (src[cursor] !== ':') continue;
    const valueStart = cursor + 1;
    const stack = [];
    let end = valueStart;
    for (; end < src.length; end++) {
      const valueSkipped = skipStringOrComment(src, end);
      if (valueSkipped !== end) { end = valueSkipped - 1; continue; }
      if (!stack.length && [',', '}', ']'].includes(src[end])) break;
      if (src[end] === '(') stack.push(')');
      else if (src[end] === '[') stack.push(']');
      else if (src[end] === '{') stack.push('}');
      else if (src[end] === ')' || src[end] === ']' || src[end] === '}') stack.pop();
    }
    for (const value of staticStrings(src.slice(valueStart, end))) add(value, file);
    i = end;
  }
}

function collectAcademicUiStrings(src, file, add) {
  const isStart = (c) => /[A-Za-z_$]/.test(c || '');
  const isPart = (c) => /[\w$]/.test(c || '');
  for (let i = 0; i < src.length;) {
    const skipped = skipStringOrComment(src, i);
    if (skipped !== i) { i = skipped; continue; }
    if (!isStart(src[i])) { i++; continue; }
    const start = i++;
    while (isPart(src[i])) i++;
    const name = src.slice(start, i);
    if (!['dialog', 'makeButton'].includes(name) || src[start - 1] === '.') continue;
    let open = i;
    while (/\s/.test(src[open] || '')) open++;
    if (src[open] !== '(') continue;
    const args = src.slice(open + 1);
    const firstComma = topLevelIndex(args, ',');
    if (firstComma < 0) continue;
    const firstArgument = args.slice(0, firstComma);
    if (name === 'makeButton') {
      for (const value of staticStrings(firstArgument)) add(value, file);
      continue;
    }
    for (const value of staticStrings(firstArgument)) add(value, file);
    let fields = args.slice(firstComma + 1).trimStart();
    if (fields[0] === '[') {
      const end = matchingDelimiter(fields, 0);
      if (end < 0) continue;
      collectStaticProperties(fields.slice(1, end), 'label', file, add);
      fields = fields.slice(end + 1).trimStart();
    }
    if (fields[0] === ',') fields = fields.slice(1).trimStart();
    const options = fields;
    if (options[0] === '{') {
      const end = matchingDelimiter(options, 0);
      if (end >= 0) collectStaticProperties(options.slice(1, end), 'submit', file, add);
    }
  }
}

function collect() {
  const keys = new Map(); // key -> Set(files)
  const add = (k, f) => {
    if (!k) return;
    if (!keys.has(k)) keys.set(k, new Set());
    keys.get(k).add(f);
  };
  const call = /(?<![\w$.])(?:window\.)?(?:NeoI18n\.)?(?:translate|tr|tk?)\(\s*'((?:[^'\\\n]|\\.)*)'/g;
  for (const f of JS_FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(call)) add(unescapeJs(m[1]), f);
    if (f === 'academic/academic.js') collectAcademicUiStrings(src, f, add);
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const tag of html.matchAll(/<(\w+)([^>]*)>([^<]*)/g)) {
    const [, , attrs, text] = tag;
    const attr = (name) => (attrs.match(new RegExp('\\s' + name + '="([^"]*)"')) || [])[1];
    if (/\sdata-i18n(\s|>|$)/.test(attrs + ' ')) add(decodeHtml(text), 'index.html');
    if (/\sdata-i18n-title\b/.test(attrs) && attr('title')) add(decodeHtml(attr('title')), 'index.html');
    if (/\sdata-i18n-placeholder\b/.test(attrs) && attr('placeholder')) add(decodeHtml(attr('placeholder')), 'index.html');
    if (/\sdata-i18n-ph\b/.test(attrs) && attr('data-ph')) add(decodeHtml(attr('data-ph')), 'index.html');
    if (attr('data-i18n-label')) add(decodeHtml(attr('data-i18n-label')), 'index.html');
  }
  return keys;
}

const readLocale = (code) => JSON.parse(fs.readFileSync(path.join(LOCALES, code + '.json'), 'utf8'));

const [cmd, code] = process.argv.slice(2);
const keys = collect();

if (cmd === 'template') {
  const out = { _meta: { name: 'Language name in that language', translators: [] } };
  for (const k of [...keys.keys()].sort((a, b) => a.localeCompare(b))) out[k] = '';
  fs.writeFileSync(path.join(LOCALES, '_template.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`locales/_template.json: ${keys.size} strings`);
} else if (cmd === 'check' && code) {
  // a regional file (fr-CA) only holds what differs from its base (fr)
  const own = readLocale(code);
  const baseCode = code.split('-')[0];
  const regional = baseCode !== code;
  const dict = regional ? { ...readLocale(baseCode), ...own } : own;
  const missing = [...keys.keys()].filter((k) => {
    const v = dict[k];
    return !(typeof v === 'string' ? v : v && typeof v === 'object' && v.other);
  });
  const unused = Object.keys(own).filter((k) => k !== '_meta' && !keys.has(k));
  // every {placeholder} of the English must survive the translation
  const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const broken = [...keys.keys()].filter((k) => {
    const v = dict[k];
    if (!v) return false;
    const forms = typeof v === 'string' ? [v] : Object.values(v);
    return forms.some((f) => vars(f).replace(/\{n\},?/g, '') !== vars(k).replace(/\{n\},?/g, ''));
  });
  console.log(`${code}: ${keys.size - missing.length}/${keys.size} translated` +
    (regional ? ` (${Object.keys(own).length - 1} regional, the rest from ${baseCode}.json)` : ''));
  if (missing.length) console.log('\nMissing:\n  ' + missing.join('\n  '));
  if (broken.length) console.log('\nPlaceholders differ from the English:\n  ' + broken.join('\n  '));
  if (unused.length) console.log('\nNo longer used:\n  ' + unused.join('\n  '));
  process.exitCode = missing.length || broken.length ? 1 : 0;
} else {
  console.log('usage: node scripts/i18n.js template | check <code>');
}
