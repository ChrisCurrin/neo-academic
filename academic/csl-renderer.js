/* Plain-text approximations of four profiles, not a full CSL processor.
 * Render results with textContent, never innerHTML. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeoCSL = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const profiles = ['apa', 'mla', 'chicago', 'ieee'];
  function options(value) {
    const result = Object.assign({ profile: 'apa' }, value || {});
    if (!profiles.includes(result.profile)) throw new Error('Unknown citation profile "' + result.profile + '"');
    result.style = result.style || (result.profile === 'ieee' ? 'numeric' : 'author-date');
    if (!['numeric', 'author-date', 'narrative'].includes(result.style)) throw new Error('Unknown citation style "' + result.style + '"');
    return result;
  }
  function year(ref) {
    const dates = ref.issued && ref.issued['date-parts'];
    return dates && dates[0] && dates[0][0] !== undefined ? String(dates[0][0]) : 'n.d.';
  }
  function names(ref) { return Array.isArray(ref.author) ? ref.author : []; }
  function family(person) { return person.literal || person.family || person.given || 'Anonymous'; }
  function initials(value) {
    return (value || '').split(/\s+/).filter(Boolean).map(function (word) {
      return word.split('-').map(function (part) { return Array.from(part)[0] + '.'; }).join('-');
    }).join(' ');
  }
  function authorLabel(ref, profile) {
    const authors = names(ref);
    if (!authors.length) return ref.title || ref.label || ref.text || ref.key || ref.id;
    if (authors.length === 1) return family(authors[0]);
    if (authors.length === 2) return family(authors[0]) + (profile === 'apa' ? ' & ' : ' and ') + family(authors[1]);
    return family(authors[0]) + ' et al.';
  }
  function resolve(refs, id) { return refs.find(function (ref) { return ref.id === id || ref.key === id; }); }
  function unique(ids) { return Array.from(new Set(ids)); }
  function idsArray(ids) {
    if (!Array.isArray(ids) || ids.some(function (id) { return typeof id !== 'string' || !id.trim(); })) {
      throw new TypeError('Citation ids must be an array of nonempty strings');
    }
    return unique(ids);
  }
  // Explicit citedIds fixes first-appearance numbering across a manuscript.
  // Without it both APIs use reference database order.
  function ordered(refs, citedIds) {
    if (citedIds === undefined || citedIds === null) return refs;
    const found = idsArray(citedIds).map(function (id) { return resolve(refs, id); }).filter(Boolean);
    return Array.from(new Set(found));
  }
  function citation(refs, ids, value) {
    const opts = options(value);
    const order = ordered(refs, opts.citedIds);
    const selected = idsArray(ids).map(function (id) { return { id: id, ref: resolve(refs, id) }; });
    const seen = new Set();
    const items = selected.filter(function (item) {
      const id = item.ref ? item.ref.id : item.id;
      if (seen.has(id)) return false;
      seen.add(id); return true;
    });
    if (!items.length) return '';
    function missing(item) { return 'Missing reference: ' + item.id; }
    if (opts.style === 'numeric') {
      return '[' + items.map(function (item) {
        const index = order.indexOf(item.ref);
        return item.ref && index >= 0 ? String(index + 1) : missing(item);
      }).join(', ') + ']';
    }
    const labels = items.map(function (item) {
      if (!item.ref) return missing(item);
      const ref = item.ref;
      const label = authorLabel(ref, opts.profile);
      const date = year(ref);
      if (opts.profile === 'mla') {
        return opts.style === 'narrative' ? label : label + (opts.locator ? ' ' + opts.locator : '');
      }
      if (opts.style === 'narrative') return label.replace(' & ', ' and ') + ' (' + date + ')';
      return label + (opts.profile === 'apa' ? ', ' : ' ') + date;
    });
    return opts.style === 'narrative' ? labels.join('; ') : '(' + labels.join('; ') + ')';
  }
  function authorList(ref, profile) {
    const authors = names(ref);
    function name(person, index) {
      if (person.literal) return person.literal;
      const given = profile === 'apa' || profile === 'ieee' ? initials(person.given) : person.given;
      const last = person.family || '';
      const suffix = person.suffix ? ', ' + person.suffix : '';
      return profile === 'ieee' || (profile !== 'apa' && index > 0)
        ? [given, last].filter(Boolean).join(' ') + suffix
        : last + (given ? ', ' + given : '') + suffix;
    }
    const list = authors.map(name);
    if (profile === 'mla' && list.length > 2) return list[0] + ', et al.';
    if (list.length < 2) return list[0] || '';
    const conjunction = profile === 'apa' ? ' & ' : ' and ';
    return list.slice(0, -1).join(', ') + (list.length > 2 ? ',' : '') + conjunction + list[list.length - 1];
  }
  function period(value) { return value ? value + (/[.!?]$/.test(value) ? '' : '.') : ''; }
  function bibliographyText(ref, profile) {
    if (!ref.title && (ref.text || ref.label)) return ref.text || ref.label;
    const author = authorList(ref, profile);
    const title = ref.title || '[Untitled]';
    const date = year(ref);
    const container = ref['container-title'] || '';
    const publisher = [ref['publisher-place'], ref.publisher].filter(Boolean).join(': ');
    const volume = ref.volume || '';
    const issue = ref.issue || '';
    const pages = ref.page || '';
    const link = ref.DOI ? 'https://doi.org/' + ref.DOI.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '') : ref.URL || '';
    let text;
    if (profile === 'apa') {
      const source = container + (volume ? ', ' + volume : '') + (issue ? '(' + issue + ')' : '') + (pages ? ', ' + pages : '');
      text = [period(author), '(' + date + ').', period(title), period(source || publisher), link].filter(Boolean).join(' ');
    } else if (profile === 'mla') {
      text = [period(author), container ? '“' + period(title) + '”' : period(title),
        [container, volume ? 'vol. ' + volume : '', issue ? 'no. ' + issue : '',
          publisher, date, pages ? 'pp. ' + pages : ''].filter(Boolean).join(', ') + '.',
        period(link)].filter(Boolean).join(' ');
    } else if (profile === 'chicago') {
      const source = container
        ? container + (volume ? ' ' + volume : '') + (issue ? ', no. ' + issue : '') + ' (' + date + ')' + (pages ? ': ' + pages : '')
        : [publisher, date].filter(Boolean).join(', ');
      text = [period(author), container ? '“' + period(title) + '”' : period(title), period(source), period(link)].filter(Boolean).join(' ');
    } else {
      text = [author ? author + ',' : '', container ? '“' + title + ',”' : title + ',',
        [container || publisher, volume ? 'vol. ' + volume : '', issue ? 'no. ' + issue : '',
          pages ? 'pp. ' + pages : '', date].filter(Boolean).join(', ') + '.',
        ref.DOI ? 'doi: ' + ref.DOI + '.' : link ? '[Online]. Available: ' + link : ''].filter(Boolean).join(' ');
    }
    return text;
  }
  function bibliography(refs, citedIds, value) {
    const opts = options(value);
    const order = ordered(refs, opts.citedIds);
    let selected = ordered(refs, citedIds).slice();
    if (opts.style === 'numeric') selected.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    else selected.sort(function (a, b) {
      const x = authorLabel(a, opts.profile).toLocaleLowerCase() + '\0' + year(a) + '\0' + (a.title || '');
      const y = authorLabel(b, opts.profile).toLocaleLowerCase() + '\0' + year(b) + '\0' + (b.title || '');
      return x.localeCompare(y);
    });
    return selected.map(function (ref) {
      return { id: ref.id, text: (opts.style === 'numeric' ? '[' + (order.indexOf(ref) + 1) + '] ' : '') + bibliographyText(ref, opts.profile) };
    });
  }
  return { citation: citation, bibliography: bibliography };
}));
