(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.NeoAcademicSearch = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function asString(value, name) {
    if (typeof value !== 'string') {
      throw new TypeError(name + ' must be a string');
    }
    return value;
  }

  function compile(query, options) {
    asString(query, 'query');
    const settings = options || {};
    const source = settings.regex === false ? escapeRegExp(query) : query;
    const flags = 'gu' + (settings.caseSensitive === true ? '' : 'i');

    try {
      return new RegExp(source, flags);
    } catch (error) {
      throw new Error('Invalid search regular expression: ' + error.message);
    }
  }

  function advanceStringIndex(text, index) {
    if (index >= text.length) return index + 1;
    const first = text.charCodeAt(index);
    if (first < 0xD800 || first > 0xDBFF || index + 1 >= text.length) return index + 1;
    const second = text.charCodeAt(index + 1);
    return second >= 0xDC00 && second <= 0xDFFF ? index + 2 : index + 1;
  }

  function find(text, query, options) {
    asString(text, 'text');
    const expression = compile(query, options);
    const matches = [];
    let match;

    while ((match = expression.exec(text)) !== null) {
      const result = {
        index: match.index,
        length: match[0].length,
        text: match[0],
        groups: match.groups ? Object.assign({}, match.groups) : {},
        captures: match.slice(1)
      };
      if (options && Object.prototype.hasOwnProperty.call(options, 'replacement')) {
        result.replacement = replaceMatch(text, result, options.replacement);
      }
      matches.push(result);

      if (match[0].length === 0) {
        expression.lastIndex = advanceStringIndex(text, expression.lastIndex);
      }
    }

    return matches;
  }

  function expandReplacement(text, match, replacement) {
    asString(replacement, 'replacement');
    const captures = Array.isArray(match.captures) ? match.captures : [];
    const groups = match.groups || {};
    let output = '';

    for (let i = 0; i < replacement.length; i += 1) {
      const char = replacement[i];
      if (char !== '$' || i + 1 >= replacement.length) {
        output += char;
        continue;
      }

      const next = replacement[i + 1];
      if (next === '$') {
        output += '$';
        i += 1;
      } else if (next === '&') {
        output += match.text;
        i += 1;
      } else if (next === '`') {
        output += text.slice(0, match.index);
        i += 1;
      } else if (next === "'") {
        output += text.slice(match.index + match.length);
        i += 1;
      } else if (next === '<' && match.groups && replacement.indexOf('>', i + 2) !== -1) {
        const close = replacement.indexOf('>', i + 2);
        const name = replacement.slice(i + 2, close);
        output += groups[name] == null ? '' : groups[name];
        i = close;
      } else if (next >= '1' && next <= '9') {
        const first = Number(next);
        const secondChar = replacement[i + 2];
        const second = secondChar >= '0' && secondChar <= '9' ? Number(secondChar) : 0;
        if (second && first * 10 + second <= captures.length) {
          output += captures[first * 10 + second - 1] || '';
          i += 2;
        } else if (first <= captures.length) {
          output += captures[first - 1] || '';
          i += 1;
        } else {
          output += '$';
        }
      } else {
        output += '$';
      }
    }

    return output;
  }

  function replaceMatch(text, match, replacement) {
    asString(text, 'text');
    if (!match || !Number.isInteger(match.index) || typeof match.text !== 'string' ||
        !Number.isInteger(match.length) || match.length !== match.text.length ||
        match.index < 0 || match.index + match.length > text.length ||
        text.slice(match.index, match.index + match.length) !== match.text) {
      throw new TypeError('match must describe a match within text');
    }

    const expanded = expandReplacement(text, match, replacement);
    return text.slice(0, match.index) + expanded + text.slice(match.index + match.length);
  }

  function replace(text, query, replacement, options) {
    asString(text, 'text');
    asString(replacement, 'replacement');
    const expression = compile(query, options);
    const count = find(text, query, options).length;
    const replacedText = text.replace(expression, replacement);
    return { text: replacedText, count: count };
  }

  return {
    compile: compile,
    find: find,
    replace: replace,
    replaceMatch: replaceMatch
  };
});
