(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NeoAcademicReview = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  let generatedId = 0;

  const blockTags = /<\/?(?:address|article|aside|blockquote|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };

  function createId(prefix) {
    generatedId += 1;
    return `${prefix}-${Date.now().toString(36)}-${generatedId.toString(36)}`;
  }

  function requireObject(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${name} must be an object.`);
    }
    return value;
  }

  function requireText(value, name) {
    if (typeof value !== 'string') {
      throw new TypeError(`${name} must be a string.`);
    }
    return value;
  }

  function requireIdentifier(value, name) {
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
      throw new TypeError(`${name} must be a non-empty string or number.`);
    }
    return value;
  }

  function createdAt(date) {
    if (date === undefined || date === null) return new Date().toISOString();
    if (date instanceof Date) {
      if (Number.isNaN(date.getTime())) throw new TypeError('date must be a valid Date or date string.');
      return date.toISOString();
    }
    if (typeof date !== 'string' || date.trim() === '') {
      throw new TypeError('date must be a valid Date or non-empty date string.');
    }
    return date;
  }

  function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, name) => {
      if (name[0] !== '#') return namedEntities[name.toLowerCase()] ?? entity;
      const hex = name[1].toLowerCase() === 'x';
      const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isInteger(point) || point < 0 || point > 0x10ffff ||
          (point >= 0xd800 && point <= 0xdfff)) return entity;
      return String.fromCodePoint(point);
    });
  }

  function plainText(html) {
    return decodeEntities(html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\b[^>]*\/?>/gi, '\n')
      .replace(blockTags, '\n')
      .replace(/<[^>]*>/g, ''))
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }

  function semanticText(html) {
    return plainText(html).replace(/\s+/g, ' ').trim();
  }

  function attributesOf(attributes) {
    const values = Object.create(null);
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let match;
    while ((match = pattern.exec(attributes))) {
      values[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return values;
  }

  function classElements(html, className) {
    const elements = [];
    const openingTags = /<([a-z][\w:-]*)\b([^>]*)>/gi;
    let opening;
    while ((opening = openingTags.exec(html))) {
      const attributes = attributesOf(opening[2]);
      if (!(attributes.class || '').split(/\s+/).includes(className)) continue;
      const closingTag = new RegExp(`<\\/${opening[1]}\\s*>`, 'ig');
      closingTag.lastIndex = openingTags.lastIndex;
      const closing = closingTag.exec(html);
      if (!closing) continue;
      elements.push({
        tag: opening[1],
        attributes,
        opening: opening[0],
        inner: html.slice(openingTags.lastIndex, closing.index),
        start: opening.index,
        innerStart: openingTags.lastIndex,
        innerEnd: closing.index,
        end: closingTag.lastIndex
      });
    }
    return elements;
  }

  function stableAttributes(attributes) {
    return Object.keys(attributes).sort().map((key) => [key, attributes[key]]);
  }

  function academicSignatures(html) {
    const signatures = [];
    const add = (className, kind, valueFor) => {
      for (const element of classElements(html, className)) {
        signatures.push({
          position: element.start,
          value: { kind, tag: element.tag, attributes: stableAttributes(element.attributes), ...valueFor(element) }
        });
      }
    };

    add('academic-citation', 'citation', () => ({}));
    add('academic-xref', 'cross-reference', () => ({}));
    add('academic-equation', 'equation', () => ({}));
    add('academic-figure', 'figure', (element) => {
      const image = element.inner.match(/<img\b([^>]*)>/i);
      return { image: image ? stableAttributes(attributesOf(image[1])) : null };
    });
    add('academic-table', 'table', (element) => {
      const table = element.inner.match(/<table\b([^>]*)>/i);
      const rows = [];
      for (const row of element.inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
        const cells = [];
        for (const cell of row[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
          cells.push({
            tag: cell[1].toLowerCase(),
            attributes: stableAttributes(attributesOf(cell[2])),
            text: semanticText(cell[3])
          });
        }
        rows.push(cells);
      }
      return {
        tableAttributes: table ? stableAttributes(attributesOf(table[1])) : null,
        rows
      };
    });

    return signatures.sort((a, b) => a.position - b.position).map((entry) => entry.value);
  }

  function stripDerivedContents(html) {
    const ranges = [
      ...classElements(html, 'academic-citation'),
      ...classElements(html, 'academic-xref'),
      ...classElements(html, 'academic-equation-body'),
      ...classElements(html, 'academic-equation-number')
    ].sort((a, b) => b.innerStart - a.innerStart);
    for (const element of ranges) {
      html = html.slice(0, element.innerStart) + html.slice(element.innerEnd);
    }
    return html;
  }

  function comparisonKey(html) {
    const visibleHtml = stripDerivedContents(html)
      .replace(/(<figcaption\b[^>]*>)([\s\S]*?)(<\/figcaption\s*>)/gi, (whole, open, content, close) =>
        open + content.replace(/^\s*(?:Figure|Table)\s+(?:\?|\d+)\.\s*/i, '') + close);
    return JSON.stringify([semanticText(visibleHtml), academicSignatures(html)]);
  }

  function hasSemanticChange(before, after) {
    return comparisonKey(before) !== comparisonKey(after);
  }

  function capture(beforeHtml, afterHtml, context) {
    requireText(beforeHtml, 'beforeHtml');
    requireText(afterHtml, 'afterHtml');
    context = requireObject(context, 'context');
    if (!hasSemanticChange(beforeHtml, afterHtml)) return null;

    const chapterId = requireIdentifier(context.chapterId, 'context.chapterId');
    if (typeof context.author !== 'string' || context.author.trim() === '') {
      throw new TypeError('context.author must be a non-empty string.');
    }

    return {
      id: context.id === undefined ? createId('revision') : requireIdentifier(context.id, 'context.id'),
      chapterId,
      before: beforeHtml,
      after: afterHtml,
      author: context.author,
      created: createdAt(context.date),
      status: 'pending',
      summary: typeof context.summary === 'string' && context.summary.trim()
        ? context.summary
        : 'Chapter text changed'
    };
  }

  function resolve(revision, decision, currentHtml) {
    requireObject(revision, 'revision');
    requireText(currentHtml, 'currentHtml');
    if (decision !== 'accept' && decision !== 'reject') {
      throw new TypeError("decision must be either 'accept' or 'reject'.");
    }
    requireText(revision.before, 'revision.before');
    requireText(revision.after, 'revision.after');

    if (decision === 'accept') {
      return { html: currentHtml, status: 'accepted' };
    }
    if (comparisonKey(currentHtml) !== comparisonKey(revision.after)) {
      throw new Error('Cannot reject revision: chapter content has changed since this revision. Resolve newer revisions first.');
    }
    return { html: revision.before, status: 'rejected' };
  }

  function record(revisions, beforeHtml, afterHtml, context) {
    if (!Array.isArray(revisions)) throw new TypeError('revisions must be an array.');
    requireText(beforeHtml, 'beforeHtml');
    requireText(afterHtml, 'afterHtml');
    context = requireObject(context, 'context');

    const chapterId = requireIdentifier(context.chapterId, 'context.chapterId');
    if (typeof context.author !== 'string' || context.author.trim() === '') {
      throw new TypeError('context.author must be a non-empty string.');
    }

    const latest = revisions[revisions.length - 1];
    const coalescible = latest && latest.status === 'pending' &&
      latest.chapterId === chapterId && latest.author === context.author &&
      comparisonKey(latest.after) === comparisonKey(beforeHtml);

    if (coalescible) {
      if (!hasSemanticChange(latest.before, afterHtml)) {
        return revisions.slice(0, -1);
      }
      if (!hasSemanticChange(beforeHtml, afterHtml)) return revisions.slice();
      const updated = {
        ...latest,
        after: afterHtml,
        summary: typeof context.summary === 'string' && context.summary.trim()
          ? context.summary
          : latest.summary
      };
      return [...revisions.slice(0, -1), updated];
    }

    const revision = capture(beforeHtml, afterHtml, { ...context, chapterId });
    return revision ? [...revisions, revision] : revisions.slice();
  }

  function comment(context) {
    context = requireObject(context, 'context');
    const anchor = requireObject(context.anchor || context, 'context.anchor');
    const chapterId = requireIdentifier(anchor.chapterId, 'anchor.chapterId');
    const quote = requireText(anchor.quote, 'anchor.quote');
    if (!quote.trim()) throw new TypeError('anchor.quote must not be empty.');
    const text = requireText(context.text, 'context.text');
    if (!text.trim()) throw new TypeError('context.text must not be empty.');
    if (anchor.paragraphIndex !== undefined &&
        (!Number.isInteger(anchor.paragraphIndex) || anchor.paragraphIndex < 0)) {
      throw new TypeError('anchor.paragraphIndex must be a non-negative integer.');
    }
    if (context.author !== undefined &&
        (typeof context.author !== 'string' || !context.author.trim())) {
      throw new TypeError('context.author must be a non-empty string when provided.');
    }

    return {
      id: context.id === undefined ? createId('comment') : requireIdentifier(context.id, 'context.id'),
      chapterId,
      quote,
      ...(anchor.paragraphIndex === undefined ? {} : { paragraphIndex: anchor.paragraphIndex }),
      text,
      ...(context.author === undefined ? {} : { author: context.author }),
      created: createdAt(context.date),
      resolved: false
    };
  }

  function locateComment(html, storedComment) {
    requireText(html, 'html');
    requireObject(storedComment, 'comment');
    const quote = requireText(storedComment.quote, 'comment.quote');
    const searchable = semanticText(html);
    const target = semanticText(quote);
    if (!target) return { found: false, ambiguous: false, matchCount: 0, index: -1 };

    const indexes = [];
    let fromIndex = 0;
    while (fromIndex <= searchable.length - target.length) {
      const index = searchable.indexOf(target, fromIndex);
      if (index === -1) break;
      indexes.push(index);
      fromIndex = index + Math.max(target.length, 1);
    }
    return {
      found: indexes.length > 0,
      ambiguous: indexes.length > 1,
      matchCount: indexes.length,
      index: indexes.length ? indexes[0] : -1
    };
  }

  return Object.freeze({ capture, resolve, record, comment, locateComment });
}));
