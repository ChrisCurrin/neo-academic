const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseHTML, DOMParser } = require('linkedom');
const JSZip = require('jszip');
const exporter = require('../academic/academic-export.js');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVQAAAABJRU5ErkJggg==';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 10"><defs><path id="glyph" d="M0 0L10 10"/></defs><use href="#glyph"/><text x="12" y="9">x²</text></svg>';
const references = {
  citation(refs, ids, options) {
    assert.ok(['apa', 'mla', 'chicago', 'ieee'].includes(options.profile));
    return ids.map(id => '[' + refs.findIndex(r => r.id === id) + ': Author & 2024]').join('; ');
  },
  bibliography(refs, cited, options) {
    assert.ok(Array.isArray(cited));
    assert.ok(options.profile);
    return refs.map(r => ({ id: r.id, text: r.title + '. https://example.org/paper?a=1&b=2' }));
  },
  export(refs, format) {
    assert.equal(format, 'bib');
    return refs.map(r => '@article{' + r.id + ',\n title={Safe title}\n}').join('\n');
  }
};
function fixture() {
  return {
    title: 'Study & Findings', subtitle: 'An academic manuscript', author: 'Fallback author',
    metadata: {
      abstract: 'A <strong>plain-text</strong> abstract.',
      keywords: ['science', 'writing'],
      authors: [{ name: 'Ada & Bob', affiliation: 'University <West>', orcid: '0000-0001-2345-6789' }],
      references: [{ id: 'ref:/unsafe#id', type: 'article-journal', title: 'Research & analysis', author: [{ family: 'Author', given: 'A' }], issued: { 'date-parts': [[2024]] }, URL: 'https://example.org' }],
      figures: [{ id: '../figure#1', caption: 'Authoritative figure & caption', alt: 'Alternative <text>', dataUrl: png, source: 'Archive', license: 'CC BY', attribution: 'Ada' }],
      tables: [{ id: 'tab-a', caption: 'Authoritative table', rows: [['Name', 'Value'], ['Alpha & beta', '2'], ['Ragged']], header: true, borders: true, shading: true, align: 'center' }],
      equations: [{ id: 'eq-a', source: 'x^{2} + \\frac{1}{2}', format: 'tex', display: true }]
    },
    chapters: [{ id: 'ch1', title: 'Introduction', html: '<p>Normal <strong>bold <em>and italic</em></strong> text. <a href="https://example.org/a?x=1&amp;y=2">Link</a> <span class="academic-citation" data-cites=\'["ref:/unsafe#id"]\'>stale citation</span></p><h3>Methods</h3><p>See <span class="academic-xref" data-target="../figure#1" data-kind="figure">stale figure</span>, <span class="academic-xref" data-target="tab-a" data-kind="table">stale table</span> and <span class="academic-xref" data-target="eq-a" data-kind="equation">stale equation</span>.</p><figure class="academic-figure" data-academic-id="../figure#1"><img src="' + png + '"><figcaption>Stale caption</figcaption></figure><figure class="academic-table" data-academic-id="tab-a"><table><tr><td>Stale cell</td></tr></table></figure><div class="academic-equation" data-academic-id="eq-a" data-source="WRONG">' + svg + '</div><ul><li>First</li><li>Second</li></ul>' }]
  };
}
function build(input, format, profile = 'apa') {
  const { document } = parseHTML('<html><body></body></html>');
  return exporter.build(input, { format, profile, document, references });
}
async function zip(payload) {
  const result = new JSZip();
  for (const entry of payload.zipEntries) {
    assert.ok(!entry.path.includes('..') && !entry.path.startsWith('/'), 'asset paths are generated, not user supplied');
    result.file(entry.path, entry.content, { base64: !!entry.base64 });
  }
  return JSZip.loadAsync(await result.generateAsync({ type: 'nodebuffer' }));
}
const parseXml = value => new DOMParser().parseFromString(value, 'text/xml');

test('UMD browser global and CommonJS expose the same self-contained build API', () => {
  assert.equal(typeof exporter.build, 'function');
  const context = { document: parseHTML('<html></html>').document, NeoReferences: references };
  vm.runInNewContext(fs.readFileSync(require.resolve('../academic/academic-export.js'), 'utf8'), context);
  assert.equal(typeof context.NeoAcademicExport.build, 'function');
  const payload = context.NeoAcademicExport.build(fixture(), { format: 'html' });
  assert.match(payload.content, /Authoritative figure/);
});

test('HTML and PDF retain structural formatting, metadata objects, safe preview, TOC and bibliography', () => {
  for (const format of ['html', 'pdf']) {
    const payload = build(fixture(), format);
    assert.equal(payload.format, format);
    assert.equal(payload.defaultName, 'Study & Findings');
    const { document } = parseHTML(payload.content);
    assert.equal(document.querySelector('title').textContent, 'Study & Findings');
    assert.equal(document.querySelector('strong em').textContent, 'and italic');
    assert.equal(document.querySelector('h3').textContent, 'Methods');
    assert.equal(document.querySelector('figcaption').textContent, 'Figure 1. Authoritative figure & caption');
    assert.equal(document.querySelector('table th').textContent, 'Name');
    assert.equal(document.querySelectorAll('table tr').length, 3);
    assert.equal(document.querySelector('.toc a').getAttribute('href'), '#chapter-1');
    assert.equal(document.querySelector('.bibliography p').textContent, 'Research & analysis. https://example.org/paper?a=1&b=2');
    assert.equal(document.querySelector('.citation').textContent, '[0: Author & 2024]');
    assert.equal(document.querySelector('.equation-number').textContent, '(1)');
    const math = document.querySelector('.math');
    assert.match(decodeURIComponent(math.src.split(',').slice(1).join(',')), /<use href="#glyph"/);
    assert.ok(!payload.content.includes('Stale') && !payload.content.includes('stale') && !payload.content.includes('WRONG'));
    assert.match(payload.content, /@page\{size:letter;margin:1in\}/);
    assert.match(payload.content, /line-height:2/);
    assert.match(payload.content, /University &lt;West&gt;/);
  }
});

test('four manuscript profiles control HTML and DOCX typography and bibliography heading', async () => {
  for (const [profile, heading] of [['apa', 'References'], ['mla', 'Works Cited'], ['chicago', 'Bibliography'], ['ieee', 'References']]) {
    const payload = build(fixture(), 'html', profile);
    assert.match(payload.content, new RegExp('data-profile="' + profile + '"'));
    assert.ok(payload.content.includes('<h2>' + heading + '</h2>'));
    assert.match(payload.content, new RegExp('font-size:' + (profile === 'ieee' ? 10 : 12) + 'pt'));
    const archive = await zip(build(fixture(), 'docx', profile));
    assert.match(await archive.file('word/styles.xml').async('string'), new RegExp('w:line="' + (profile === 'ieee' ? 240 : 480) + '"'));
    if (profile === 'ieee') {
      assert.match(payload.content, /column-count:2/);
      assert.match(await archive.file('word/document.xml').async('string'), /w:cols w:num="2"/);
    }
  }
});

test('Markdown is standalone Pandoc input with embedded images, safe citation keys, math, tables and xrefs', () => {
  const payload = build(fixture(), 'md');
  assert.equal(payload.format, 'md');
  assert.match(payload.content, /\[@ref-1\]/);
  assert.match(payload.content, /\*\*bold \*and italic\*\*\*/);
  assert.match(payload.content, /::: \{#equation-1\}\n\$\$x\^\{2\} \+ \\frac\{1\}\{2\}\$\$/);
  assert.match(payload.content, /data:image\/png;base64/);
  assert.match(payload.content, /Table 1\. Authoritative table \{#table-1\}/);
  assert.match(payload.content, /\[Figure 1\]\(#figure-1\)/);
  assert.match(payload.content, /\| :---: \| :---: \|/);
  assert.match(payload.content, /"id":"ref-1"/);
  assert.match(payload.content, /Research & analysis/);
});

test('LaTeX and Typst payloads are ZIP archives with actual assets and bibliography', async () => {
  for (const format of ['tex', 'typ']) {
    const payload = build(fixture(), format, 'ieee');
    assert.equal(payload.format, 'zip');
    assert.equal(payload.defaultName, 'Study & Findings-' + format);
    const archive = await zip(payload);
    const source = await archive.file('manuscript.' + format).async('string');
    assert.match(await archive.file('bibliography.bib').async('string'), /@article\{ref-1/);
    assert.equal((await archive.file('assets/figure-1.png').async('nodebuffer')).toString('base64'), png.split(',')[1]);
    assert.match(await archive.file('assets/equation-1.svg').async('string'), /viewBox="0 0 30 10"/);
    assert.match(source, /Authoritative figure/);
    assert.match(source, /Authoritative table/);
    assert.match(source, /bibliography\.bib/);
    if (format === 'tex') {
      assert.match(source, /\\autocite\{ref-1\}/);
      assert.match(source, /\\ref\{figure-1\}/);
      assert.match(source, /\\textbf\{bold \\emph\{and italic\}\}/);
      assert.match(source, /\\begin\{equation\}\\label\{equation-1\}x\^\{2\}/);
      assert.match(source, /\\includegraphics\[.*\]\{assets\/figure-1\.png\}/);
      assert.match(source, /\\rowcolor\{gray!15\}/);
      assert.match(source, /style=ieee/);
      assert.match(source, /10pt,twocolumn/);
    } else {
      assert.match(source, /#cite\(<ref-1>\)/);
      assert.match(source, /#link\(<figure-1>\)\[Figure 1\]/);
      assert.match(source, /#strong\[bold #emph\[and italic\]\]/);
      assert.match(source, /image\("assets\/equation-1.svg"/);
      assert.match(source, /style: "ieee"/);
      assert.match(source, /#columns\(2/);
    }
  }
});

test('DOCX is real OOXML with relationships, binary media, fields, captions, tables and bibliography sources', async () => {
  const payload = build(fixture(), 'docx');
  assert.equal(payload.format, 'docx');
  const archive = await zip(payload);
  const document = parseXml(await archive.file('word/document.xml').async('string'));
  assert.equal(document.documentElement.nodeName, 'w:document');
  assert.equal(document.getElementsByTagName('w:tbl').length, 1);
  assert.equal(document.getElementsByTagName('w:tr').length, 3);
  assert.equal(document.getElementsByTagName('w:tc').length, 6);
  assert.equal(document.getElementsByTagName('w:tblHeader').length, 1);
  assert.ok(document.getElementsByTagName('w:b').length > 0);
  assert.ok(document.getElementsByTagName('w:i').length > 0);
  assert.equal(document.getElementsByTagName('w:drawing').length, 2);
  assert.ok(document.getElementsByTagName('asvg:svgBlip').length > 0);
  const instructions = Array.from(document.getElementsByTagName('w:fldSimple')).map(n => n.getAttribute('w:instr')).join('\n');
  assert.match(instructions, /CITATION ref_1/);
  assert.match(instructions, /REF figure_1 \\h/);
  assert.match(instructions, /SEQ Figure/);
  assert.match(instructions, /SEQ Table/);
  assert.match(instructions, /SEQ Equation/);
  assert.match(instructions, /TOC/);
  assert.match(document.documentElement.textContent, /Research & analysis/);
  assert.match(document.documentElement.textContent, /Authoritative figure/);
  assert.equal(document.getElementsByTagName('w:pgMar')[0].getAttribute('w:left'), '1440');
  const rels = parseXml(await archive.file('word/_rels/document.xml.rels').async('string'));
  for (const item of rels.getElementsByTagName('Relationship')) {
    if (item.getAttribute('TargetMode') === 'External') {
      assert.match(item.getAttribute('Target'), /^https:\/\/example\.org/);
      continue;
    }
    const target = item.getAttribute('Target');
    assert.ok(archive.file(target.startsWith('../') ? target.slice(3) : 'word/' + target), target + ' relationship is resolvable');
  }
  const sources = parseXml(await archive.file('customXml/item1.xml').async('string'));
  assert.equal(sources.getElementsByTagName('b:Tag')[0].textContent, 'ref_1');
  assert.equal(sources.getElementsByTagName('b:Year')[0].textContent, '2024');
  const registry = parseXml(await archive.file('customXml/itemProps1.xml').async('string'));
  assert.equal(registry.getElementsByTagName('ds:schemaRef')[0].getAttribute('ds:uri'), 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography');
  assert.equal(parseXml(await archive.file('customXml/_rels/item1.xml.rels').async('string')).getElementsByTagName('Relationship')[0].getAttribute('Target'), 'itemProps1.xml');
  assert.match(await archive.file('[Content_Types].xml').async('string'), /customXmlProperties/);
  assert.equal((await archive.file('word/media/figure-1.png').async('nodebuffer')).toString('base64'), png.split(',')[1]);
  assert.match(await archive.file('[Content_Types].xml').async('string'), /image\/svg\+xml/);
  assert.equal(parseXml(await archive.file('_rels/.rels').async('string')).getElementsByTagName('Relationship')[0].getAttribute('Target'), 'word/document.xml');
});

test('AsciiMath is never silently treated as TeX and image-based exports remain possible', async () => {
  const input = fixture();
  input.metadata.equations[0].format = 'asciimath';
  input.metadata.equations[0].source = 'sqrt(x)';
  for (const format of ['html', 'pdf', 'md', 'tex', 'typ', 'docx']) {
    const payload = build(input, format);
    if (format === 'tex') {
      const archive = await zip(payload);
      const source = await archive.file('manuscript.tex').async('string');
      assert.match(source, /\\includesvg/);
      assert.ok(!source.includes('sqrt(x)'));
      assert.match(await archive.file('README.txt').async('string'), /AsciiMath remain image previews/);
      assert.deepEqual(JSON.parse(await archive.file('equation-sources.json').async('string')), [{ id: 'eq-a', source: 'sqrt(x)', format: 'asciimath', display: true }]);
    }
    if (format === 'md') {
      assert.match(payload.content, /!\[Equation 1 \\?\(AsciiMath\\?\): sqrt\\?\(x\\?\)\]\(data:image\/svg\+xml,/);
      assert.ok(!payload.content.includes('$sqrt(x)$'));
    }
  }
  input.chapters[0].html = input.chapters[0].html.replace(svg, '');
  for (const format of ['html', 'pdf', 'md', 'tex', 'typ', 'docx']) assert.throws(() => build(input, format), /preview/);
});

test('TeX-only equations work in Markdown and LaTeX, with explicit missing preview errors elsewhere', () => {
  const input = fixture();
  input.chapters[0].html = input.chapters[0].html.replace(svg, '');
  assert.match(build(input, 'md').content, /\$\$x/);
  assert.ok(build(input, 'tex').zipEntries.some(e => e.path === 'manuscript.tex'));
  for (const format of ['html', 'pdf', 'typ', 'docx']) assert.throws(() => build(input, format), /preview/);
});

test('untrusted text, markup, links, object IDs and SVG cannot inject executable export content', async () => {
  const input = fixture();
  input.title = '</title><script>alert(1)</script> \\input{owned} #panic("owned")';
  input.metadata.figures[0].caption = '<img src=x onerror=alert(1)> \\input{owned} #panic("owned")';
  input.metadata.tables[0].rows[1][0] = '</w:t><w:pwn/> <script>owned</script> \\input{owned} #panic("owned")';
  input.metadata.abstract = '<script>alert(1)</script>';
  const maliciousSvg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><img src="x" onerror="alert(1)"/></foreignObject><use href="https://evil.example"/><path fill="url(https://evil.example)" d="M0 0"/></svg>';
  input.chapters[0].html += '<script>alert(1)</script><iframe src="https://evil.example"></iframe><p onclick="alert(1)">safe <a href="javascript:alert(1)">unsafe link</a></p>';
  input.chapters[0].html = input.chapters[0].html.replace(svg, maliciousSvg);
  for (const format of ['html', 'pdf', 'md', 'tex', 'typ', 'docx']) {
    const payload = build(input, format);
    assert.ok(!payload.defaultName.includes('/'));
    if (format === 'html' || format === 'pdf') {
      const { document } = parseHTML(payload.content);
      assert.equal(document.querySelectorAll('script,iframe,[onclick],[onload],[onerror]').length, 0);
      assert.equal(document.querySelectorAll('a[href^="javascript:"]').length, 0);
      assert.ok(document.querySelector('title').textContent.includes('<script>'));
      const imageSource = decodeURIComponent(document.querySelector('.math').src.split(',').slice(1).join(','));
      assert.ok(!/script|foreignObject|evil\.example|onload|onerror/.test(imageSource));
    } else if (format === 'md') {
      assert.ok(payload.content.includes('\\<script\\>'));
      assert.ok(!payload.content.includes('<script>'));
      assert.ok(!payload.content.includes('](javascript:'));
    } else {
      const archive = await zip(payload);
      if (format === 'docx') {
        const document = parseXml(await archive.file('word/document.xml').async('string'));
        assert.equal(document.getElementsByTagName('w:pwn').length, 0);
        assert.match(document.documentElement.textContent, /<script>owned<\/script>/);
      } else {
        const content = await archive.file('manuscript.' + format).async('string');
        if (format === 'tex') assert.ok(!content.includes('\\input{owned}'));
        else assert.ok(!/(?<!\\)#panic\("owned"\)/.test(content));
      }
      const imageSource = await archive.file(format === 'docx' ? 'word/media/equation-1.svg' : 'assets/equation-1.svg').async('string');
      assert.ok(!/script|foreignObject|evil\.example|onload|onerror/.test(imageSource));
    }
  }
});

test('dangerous TeX equation commands, comments, macros and unbalanced environments are rejected', () => {
  for (const source of ['\\input{evil}', '\\write18{evil}', '\\csname input\\endcsname', '\\def\\x{evil}', '\\href{evil}{x}', 'x%comment', 'x$$', 'x^{', '\\end{document}', '\\begin{matrix}x', '\\begin{matrix}x\\end{cases}', '^^5cinput{evil}']) {
    const input = fixture();
    input.metadata.equations[0].source = source;
    for (const format of ['md', 'tex']) assert.throws(() => build(input, format), /TeX|math/);
  }
});

test('invalid formats, profiles, missing authoritative objects and broken references produce clear errors', () => {
  assert.throws(() => build(fixture(), 'odt'), /Unsupported/);
  assert.throws(() => build(fixture(), 'html', 'unknown'), /profile/);
  assert.throws(() => exporter.build(fixture(), { format: 'html' }), /DOM document/);
  const input = fixture();
  input.metadata.figures = [];
  assert.throws(() => build(input, 'html'), /unknown object|authoritative/);
  const badCitation = fixture();
  badCitation.chapters[0].html = '<span class="academic-citation" data-cites="INVALID">text</span>';
  assert.throws(() => build(badCitation, 'html'), /JSON/);
  badCitation.chapters[0].html = '<span class="academic-citation" data-cites=\'["missing"]\'>text</span>';
  assert.throws(() => build(badCitation, 'html'), /unknown ID/);
  const missingPlacement = fixture();
  missingPlacement.chapters[0].html = '<span class="academic-xref" data-kind="figure" data-target="../figure#1">Figure</span>';
  assert.throws(() => build(missingPlacement, 'html'), /not present/);
  const missingImage = fixture();
  missingImage.metadata.figures[0].dataUrl = 'file:///private/image.png';
  assert.throws(() => build(missingImage, 'html'), /hydrated safe/);
});

test('data URL hydration may be supplied through DOM; inline equations and formatting survive', async () => {
  const input = fixture();
  delete input.metadata.figures[0].dataUrl;
  input.metadata.equations[0].display = false;
  input.chapters[0].html = input.chapters[0].html.replace(/<span class="academic-xref" data-target="eq-a"[\s\S]*?<\/span>/, 'an inline equation');
  const html = build(input, 'html').content;
  const { document } = parseHTML(html);
  assert.equal(document.querySelector('.equation').localName, 'span');
  assert.equal(document.querySelector('.equation-number'), null);
  const archive = await zip(build(input, 'docx'));
  assert.ok(!(await archive.file('word/document.xml').async('string')).includes('SEQ Equation'));
  input.metadata.equations[0].format = 'asciimath';
  input.metadata.equations[0].source = 'x^2';
  for (const format of ['tex', 'typ']) {
    const result = await zip(build(input, format));
    const source = await result.file('manuscript.' + format).async('string');
    assert.match(source, format === 'tex' ? /height=1.5em/ : /height: 1.5em/);
    assert.ok(!source.includes(format === 'tex' ? '\\begin{equation}' : 'kind: "equation"'));
  }
});

test('object numbering follows chapter placement rather than metadata order and skips inline equations', () => {
  const input = fixture();
  input.metadata.figures.unshift({ id: 'unused', caption: 'Not placed', dataUrl: png });
  input.metadata.equations.unshift({ id: 'inline', source: 'z', format: 'tex', display: false });
  input.chapters[0].html = '<span class="academic-equation" data-academic-id="inline">' + svg + '</span>' + input.chapters[0].html;
  const { document } = parseHTML(build(input, 'html').content);
  assert.equal(document.querySelector('figcaption').textContent, 'Figure 1. Authoritative figure & caption');
  assert.equal(document.querySelector('a[href="#figure-2"]').textContent, 'Figure 1');
  assert.equal(document.querySelector('.equation-number').textContent, '(1)');
  input.chapters[0].html += '<span class="academic-xref" data-kind="equation" data-target="inline"></span>';
  assert.throws(() => build(input, 'html'), /unnumbered inline equation/);
});

test('input models are not mutated by any exporter', () => {
  const input = fixture(), before = JSON.stringify(input);
  for (const format of ['html', 'pdf', 'md', 'tex', 'typ', 'docx', 'txt', 'epub']) build(input, format);
  assert.equal(JSON.stringify(input), before);
});

test('normal, charset and base64 SVG data URLs are sanitized and exported as image assets', async () => {
  for (const dataUrl of ['data:image/svg+xml,' + encodeURIComponent(svg), 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')]) {
    const input = fixture();
    input.metadata.figures[0].dataUrl = dataUrl;
    const archive = await zip(build(input, 'tex'));
    assert.match(await archive.file('assets/figure-1.svg').async('string'), /<use href="#glyph"/);
    assert.match(await archive.file('manuscript.tex').async('string'), /\\includesvg/);
  }
});

test('real NeoReferences adapter works without dependency injection in each format', async () => {
  const { document } = parseHTML('<html></html>');
  for (const profile of ['apa', 'mla', 'chicago', 'ieee']) {
    for (const format of ['html', 'pdf', 'md', 'tex', 'typ', 'docx']) {
      const payload = exporter.build(fixture(), { format, profile, document });
      assert.ok(payload.content || payload.zipEntries);
      if (format === 'tex' || format === 'typ') {
        const archive = await zip(payload);
        assert.match(await archive.file('bibliography.bib').async('string'), /@\w+\{ref-1/);
      }
    }
  }
});

test('citations and bibliography share explicit citation style and manuscript ordering for every profile', () => {
  const input = fixture();
  input.metadata.citationStyle = 'numeric';
  const { document } = parseHTML('<html></html>');
  for (const profile of ['apa', 'mla', 'chicago', 'ieee']) {
    const calls = [];
    const refs = {
      ...references,
      citation(items, ids, options) { calls.push({ ...options, citedIds: [...options.citedIds] }); return '[1]'; },
      bibliography(items, ids, options) { calls.push({ ...options, citedIds: [...options.citedIds] }); return [{ id: items[0].id, text: '[1] Reference' }]; }
    };
    const payload = exporter.build(input, { format: 'html', profile, document, references: refs });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].style, 'numeric');
    assert.equal(calls[0].profile, profile);
    assert.deepEqual(calls[0].citedIds, ['ref:/unsafe#id']);
    assert.match(payload.content, /\[1\] Reference/);
  }
});

test('empty manuscripts and non-academic inline runs export without requiring references', async () => {
  const { document } = parseHTML('<html></html>');
  for (const format of ['html', 'pdf', 'md', 'tex', 'typ', 'docx', 'txt', 'epub']) {
    const payload = exporter.build({ title: '' }, { format, document });
    assert.ok(payload.content || payload.zipEntries);
    assert.match(payload.defaultName, /^Manuscript/);
    if (payload.zipEntries) await zip(payload);
  }
  const archive = await zip(exporter.build({ title: 'Inline', chapters: [{ title: 'Chapter', html: 'word <b>bold</b> tail' }] }, { format: 'docx', document }));
  const result = parseXml(await archive.file('word/document.xml').async('string'));
  assert.ok(Array.from(result.getElementsByTagName('w:p')).some(p => p.textContent === 'word bold tail'));
});

test('TXT explicitly preserves object descriptions, source formats, tables, citations and bibliography', () => {
  const input = fixture();
  input.metadata.equations[0].format = 'asciimath';
  input.metadata.equations[0].source = 'sqrt(x)';
  input.chapters[0].html = input.chapters[0].html.replace(svg, '');
  const payload = build(input, 'txt');
  assert.equal(payload.format, 'txt');
  assert.match(payload.content, /Normal bold and italic text/);
  assert.match(payload.content, /Figure 1\. Authoritative figure & caption/);
  assert.match(payload.content, /\[Image: Alternative <text>\]/);
  assert.match(payload.content, /Name\tValue\nAlpha & beta\t2/);
  assert.match(payload.content, /\[Equation 1 \(AsciiMath\): sqrt\(x\)\]/);
  assert.match(payload.content, /Research & analysis/);
  assert.ok(!payload.content.includes('stale'));
});

test('EPUB 3 ZIP includes uncompressed mimetype, navigation, valid XHTML and binary academic resources', async () => {
  const input = fixture();
  input.chapters.push({ title: 'Discussion', html: '<p>Revisit <span class="academic-xref" data-target="../figure#1" data-kind="figure">stale</span>.</p>' });
  const payload = build(input, 'epub');
  assert.equal(payload.format, 'epub');
  assert.equal(payload.zipEntries[0].path, 'mimetype');
  assert.equal(payload.zipEntries[0].store, true);
  const result = new JSZip();
  for (const entry of payload.zipEntries) result.file(entry.path, entry.content, { base64: !!entry.base64, compression: entry.store ? 'STORE' : 'DEFLATE' });
  const bytes = await result.generateAsync({ type: 'nodebuffer' });
  assert.equal(bytes.readUInt16LE(8), 0, 'mimetype first local file is uncompressed');
  assert.equal(bytes.subarray(30, 38).toString(), 'mimetype');
  const archive = await JSZip.loadAsync(bytes);
  assert.equal(await archive.file('mimetype').async('string'), 'application/epub+zip');
  assert.equal(parseXml(await archive.file('META-INF/container.xml').async('string')).getElementsByTagName('rootfile')[0].getAttribute('full-path'), 'OEBPS/content.opf');
  const opf = parseXml(await archive.file('OEBPS/content.opf').async('string'));
  assert.equal(opf.documentElement.getAttribute('version'), '3.0');
  for (const item of opf.getElementsByTagName('item')) assert.ok(archive.file('OEBPS/' + item.getAttribute('href')));
  const chapterSource = await archive.file('OEBPS/chapter-1.xhtml').async('string');
  assert.ok(!chapterSource.includes('data:image/'));
  assert.match(chapterSource, /src="assets\/figure-1.png"/);
  assert.match(chapterSource, /src="assets\/equation-1.svg"/);
  assert.ok(!/<img[^>]*[^/]>/g.test(chapterSource), 'XHTML images are self-closed');
  const chapter = parseXml(chapterSource);
  assert.equal(chapter.getElementsByTagName('table').length, 1);
  assert.equal(chapter.getElementsByTagName('th')[0].textContent, 'Name');
  assert.match(await archive.file('OEBPS/chapter-2.xhtml').async('string'), /href="chapter-1.xhtml#figure-1"/);
  assert.match(await archive.file('OEBPS/nav.xhtml').async('string'), /epub:type="toc"/);
  assert.match(await archive.file('OEBPS/bibliography.xhtml').async('string'), /Research &amp; analysis/);
  assert.equal((await archive.file('OEBPS/assets/figure-1.png').async('nodebuffer')).toString('base64'), png.split(',')[1]);
});
