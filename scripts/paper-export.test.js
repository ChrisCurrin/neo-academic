'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const X = require('../paper/export.js');

const T = (text, f = {}) => ({ text, ...f });
const model = () => ({
  title: 'Balance & control in 100% of cortex',
  subtitle: '',
  authors: [
    { name: 'Ada Lovelace', affiliations: [0], email: 'ada@example.org', orcid: '0000-0002-1825-0097', corresponding: true },
    { name: 'Charles Babbage', affiliations: [1] }
  ],
  affiliations: ['University of London', 'University of Cambridge'],
  abstract: [[T('We ask '), { math: 'x_1' }, T('.')]],
  keywords: ['cortex', 'inhibition'],
  numbered: true,
  double: false,
  style: { id: 'apa', title: 'APA 7th', numeric: false, xml: '<style/>' },
  bibtex: '@article{smith2020,\n  title = {T}\n}\n',
  bibliography: { entries: [{ id: 'smith2020', html: '<div class="csl-entry">Smith, J. (2020). <i>T</i>.</div>' }], hanging: true, numeric: false },
  blocks: [
    { type: 'heading', level: 1, num: '1', id: 'sec-ab12', runs: [T('Introduction')] },
    { type: 'para', runs: [T('Costs $5 & rise_'), T('fast', { i: true }), T(' '), { cite: [{ id: 'smith2020', locator: '4', label: 'page' }], html: '(Smith, 2020, p. 4)' }, T(', as '), { xref: 'fig-cd34', kind: 'fig', num: '1', label: 'Figure 1' }, T(' and '), { xref: 'eq-ef56', kind: 'eq', num: '1', label: 'Equation (1)' }, T(' show.')] },
    { type: 'para', runs: [{ cite: [{ id: 'smith2020' }, { id: 'doe2019' }], narrative: true, html: 'Smith (2020); Doe (2019)' }, T(' argue.')] },
    { type: 'para', runs: [{ cite: [{ id: 'a', prefix: 'see' }, { id: 'b', locator: '2–3' }], html: '(see A; B, pp. 2–3)' }] },
    { type: 'para', runs: [{ cite: [{ id: 'a', locator: '1' }, { id: 'b', locator: '9' }], html: '(A, p. 1; B, p. 9)' }] },
    { type: 'heading', level: 2, num: '1.1', id: 'sec-gh78', runs: [T('Model')] },
    { type: 'equation', id: 'eq-ef56', num: '1', tex: 'a = b \\\\ c = d', svg: '<svg/>' },
    { type: 'figure', id: 'fig-cd34', num: '1', name: 'figure-cd34.png', mime: 'image/png', base64: 'AAAA', width: 50, alt: 'A plot', w: 400, h: 200, caption: [T('Rates')] },
    { type: 'table', id: 'tab-ij90', num: '1', caption: [T('Means')], header: true, rows: [[[T('Layer')], [T('Rate')]], [[T('L5')], [T('7.9')]]] }
  ]
});

test('LaTeX: natbib citations, labels, escapes, floats and the bibliography', () => {
  const files = X.latex(model());
  const tex = files.find((f) => f.path === 'paper.tex').content;
  assert.match(tex, /\\title\{Balance \\& control in 100\\% of cortex\}/);
  assert.match(tex, /\\author\[1\]\{Ada Lovelace\\thanks\{Correspondence: \\href\{mailto:ada@example\.org\}/);
  assert.match(tex, /\\affil\[2\]\{University of Cambridge\}/);
  assert.match(tex, /\\begin\{abstract\}\nWe ask \\\(x_1\\\)\.\n\\end\{abstract\}/);
  assert.match(tex, /Costs \\\$5 \\& rise\\_\\emph\{fast\} \\citep\[p\.~4\]\{smith2020\}, as Figure~\\ref\{fig:cd34\} and Equation~\\eqref\{eq:ef56\} show\./);
  assert.match(tex, /\\citet\{smith2020\}; \\citet\{doe2019\} argue\./);
  assert.match(tex, /\\citep\[see\]\[pp\.~2–3\]\{a,b\}/, 'one note before and one after the group: \\citep takes them');
  assert.match(tex, /\(\\citealp\[p\.~1\]\{a\}; \\citealp\[p\.~9\]\{b\}\)/, 'a page for each: one \\citealp each');
  assert.match(tex, /\\section\{Introduction\}\\label\{sec:ab12\}/);
  assert.match(tex, /\\subsection\{Model\}\\label\{sec:gh78\}/);
  assert.match(tex, /\\begin\{equation\}\n\\begin\{split\}\na = b \\\\ c = d\n\\end\{split\}\n\\label\{eq:ef56\}/);
  assert.match(tex, /\\includegraphics\[width=0\.50\\linewidth\]\{figures\/figure-cd34\.png\}\n\\caption\{Rates\}\n\\label\{fig:cd34\}/);
  assert.match(tex, /\\begin\{tabular\}\{ll\}\n\\toprule\nLayer & Rate \\\\\n\\midrule\nL5 & 7\.9 \\\\\n\\bottomrule/);
  assert.match(tex, /\\bibliographystyle\{plainnat\}\n\\bibliography\{references\}/);
  assert.ok(files.some((f) => f.path === 'figures/figure-cd34.png' && f.base64));
  assert.equal(files.find((f) => f.path === 'references.bib').content, model().bibtex);
  const unnumbered = X.latex({ ...model(), numbered: false, style: { numeric: true } }).find((f) => f.path === 'paper.tex').content;
  assert.match(unnumbered, /\\section\*\{Introduction\}/);
  assert.match(unnumbered, /\\usepackage\[numbers,square,sort&compress\]\{natbib\}/);
  assert.match(unnumbered, /\\bibliographystyle\{unsrtnat\}/);
});

test('Pandoc Markdown: [@key], pandoc-crossref labels, YAML front matter and the style', () => {
  const files = X.pandoc(model());
  const md = files.find((f) => f.path === 'paper.md').content;
  assert.match(md, /^---\ntitle: "Balance & control in 100% of cortex"\nauthor:\n {2}- name: "Ada Lovelace"\n {4}affiliation: "University of London"\n {4}email: "ada@example\.org"\n {4}orcid: "0000-0002-1825-0097"\n {4}corresponding: true/);
  assert.match(md, /abstract: \|\n {2}We ask \$x_1\$\./);
  assert.match(md, /bibliography: references\.bib\ncsl: apa\.csl/);
  assert.match(md, /# Introduction \{#sec:ab12\}/);
  assert.match(md, /Costs \\\$5 & rise\\_\*fast\* \[@smith2020, p\. 4\], as @fig:cd34 and @eq:ef56 show\./);
  assert.match(md, /@smith2020; @doe2019 argue\./);
  assert.match(md, /\[see @a; @b, p\. 2–3\]/);
  assert.match(md, /\$\$\na = b \\\\ c = d\n\$\$ \{#eq:ef56\}/);
  assert.match(md, /!\[Rates\]\(figures\/figure-cd34\.png\)\{#fig:cd34 width=50%\}/);
  assert.match(md, /\| Layer \| Rate \|\n\| --- \| --- \|\n\| L5 \| 7\.9 \|\n\n: Means \{#tbl:ij90\}/);
  assert.ok(files.some((f) => f.path === 'apa.csl'));
});

test('HTML: the paper as one page, with numbers, links and the reference list', () => {
  const html = X.html(model());
  assert.match(html, /<h1 class="title">Balance &amp; control in 100% of cortex<\/h1>/);
  assert.match(html, /<span class="author">Ada Lovelace<sup>1<\/sup><sup>\*<\/sup> <a class="orcid" href="https:\/\/orcid\.org\/0000-0002-1825-0097"/);
  assert.match(html, /<h2 id="sec-ab12"><span class="num">1<\/span> Introduction<\/h2>/);
  assert.match(html, /<h3 id="sec-gh78"><span class="num">1\.1<\/span> Model<\/h3>/);
  assert.match(html, /<span class="cite"><a href="#ref-smith2020">\(Smith, 2020, p\. 4\)<\/a><\/span>/);
  assert.match(html, /<a class="xref" href="#fig-cd34">Figure 1<\/a>/);
  assert.match(html, /<figure id="fig-cd34" style="--w:50%"><img src="data:image\/png;base64,AAAA" alt="A plot"><figcaption><b>Figure 1\.<\/b> Rates<\/figcaption><\/figure>/);
  assert.match(html, /<div class="entry" id="ref-smith2020">/);
  assert.match(X.html(model(), { print: true }), /font-size: 11pt/);
});

test('Word: styles, bookmarks for cross-references, pictures, a table and page numbers', () => {
  const files = X.docx(model());
  const doc = files.find((f) => f.path === 'word/document.xml').content;
  assert.match(doc, /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">Balance &amp; control in 100% of cortex<\/w:t>/);
  assert.match(doc, /<w:pStyle w:val="Heading1"\/><\/w:pPr><w:bookmarkStart w:id="\d+" w:name="_sec_ab12"\/><w:r><w:t xml:space="preserve">1<\/w:t><\/w:r><w:r><w:tab\/><\/w:r>/);
  assert.match(doc, /<w:hyperlink w:anchor="_fig_cd34"><w:r><w:t xml:space="preserve">Figure 1<\/w:t><\/w:r><\/w:hyperlink>/);
  assert.match(doc, /<w:r><w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">fast<\/w:t><\/w:r>/);
  assert.match(doc, /\(Smith, 2020, p\. 4\)/);
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /<w:pStyle w:val="Bibliography"\/>/);
  assert.match(doc, /<w:footerReference w:type="default" r:id="rIdFooter"\/>/);
  assert.ok(files.some((f) => f.path === 'word/media/image1.png'));
  assert.match(files.find((f) => f.path === 'word/_rels/document.xml.rels').content, /Target="media\/image1\.png"/);
  assert.match(files.find((f) => f.path === 'word/styles.xml').content, /w:styleId="FirstParagraph"><w:name w:val="First Paragraph"\/><w:basedOn w:val="BodyText"\/>/);
  // the first paragraph under a heading is set flush, the next indented
  const after = doc.split('_sec_ab12')[1];
  assert.ok(after.indexOf('FirstParagraph') < after.indexOf('BodyText'));
});

test('citeproc HTML becomes Word runs; numbered entries keep their number and a tab', () => {
  assert.deepEqual(X.htmlToRuns('Smith, J. (2020). <i>T</i>. A &#38; B.'), [
    { text: 'Smith, J. (2020). ', i: false, b: false, sup: false, sub: false },
    { text: 'T', i: true, b: false, sup: false, sub: false },
    { text: '. A & B.', i: false, b: false, sup: false, sub: false }
  ]);
  const runs = X.htmlToRuns('<div class="csl-entry"><div class="csl-left-margin">[1]</div><div class="csl-right-inline">J. Smith</div></div>');
  assert.equal(runs.map((r) => r.text).join(''), '[1]\tJ. Smith');
  assert.equal(X.crossId('tab-ij90'), 'tbl:ij90');
  assert.equal(X.texEsc('50% & $x_1$ {a} ~ ^'), '50\\% \\& \\$x\\_1\\$ \\{a\\} \\textasciitilde{} \\textasciicircum{}');
});

test('edge cases: align as written, line breaks in cells and the abstract, entities in references', () => {
  const m = model();
  m.blocks = [
    { type: 'equation', id: 'eq-aa11', num: '1', tex: '\\begin{align} a &= b \\\\ c &= d \\end{align}' },
    { type: 'table', id: 'tab-bb22', num: '1', caption: [T('Two\nlines')], header: false, rows: [[[T('a\n\nb')]]] }
  ];
  m.abstract = [[T('line one\nline two: x')]];
  const tex = X.latex(m).find((f) => f.path === 'paper.tex').content;
  assert.match(tex, /\\begin\{align\} a &= b \\\\ c &= d \\label\{eq:aa11\}\n\\end\{align\}/);
  assert.doesNotMatch(tex, /\\begin\{equation\}\n\\begin\{align\}/);
  assert.match(tex, /\\caption\{Two lines\}/);
  assert.match(tex, /\na b \\\\\n/);
  const md = X.pandoc(m).find((f) => f.path === 'paper.md').content;
  assert.match(md, /abstract: \|\n {2}line one\n {2}line two: x\n/);
  assert.equal(X.htmlToRuns('p &#60; 0.05 &#38; more').map((r) => r.text).join(''), 'p < 0.05 & more');
});

test('figure layout: placement, both columns, wrapped text and panels, as LaTeX lays them out', () => {
  const m = model();
  const pic = (name) => ({ name, mime: 'image/png', base64: 'AAAA', w: 100, h: 50 });
  m.blocks = [
    { type: 'figure', id: 'fig-p1', num: '1', place: 'H', caption: [T('Pinned')], ...pic('figure-a.png') },
    { type: 'figure', id: 'fig-p2', num: '2', span: true, place: 'H', caption: [T('Wide')], ...pic('figure-b.png') },
    { type: 'figure', id: 'fig-p3', num: '3', wrap: 'right', width: 33, caption: [T('Beside')], ...pic('figure-c.png') },
    { type: 'figure', id: 'fig-p4', num: '4', width: 100, caption: [T('Both')], ...pic('figure-d.png'),
      panels: [{ ...pic('figure-d.png'), sub: [T('Before')] }, { ...pic('figure-e.png'), sub: [T('After')] }] },
    { type: 'table', id: 'tab-t1', num: '1', span: true, place: 't', caption: [T('T')], header: true, rows: [[[T('a')]]] }
  ];
  const files = X.latex(m);
  const tex = files.find((f) => f.path === 'paper.tex').content;
  assert.match(tex, /\\usepackage\{subcaption\}\n\\usepackage\{float\}\n\\usepackage\{wrapfig\}/);
  assert.match(tex, /\\begin\{figure\}\[H\]\n\\centering\n\\includegraphics\[width=\\linewidth\]\{figures\/figure-a\.png\}/);
  assert.match(tex, /\\begin\{figure\*\}\[tp\][\s\S]*?\\end\{figure\*\}/, 'a figure across both columns takes no [H]');
  assert.match(tex, /\\begin\{wrapfigure\}\{r\}\{0\.33\\linewidth\}\n\\centering\n\\includegraphics\[width=\\linewidth\]\{figures\/figure-c\.png\}/);
  assert.match(tex, /\\begin\{subfigure\}\[t\]\{0\.48\\linewidth\}\n\\centering\n\\includegraphics\[width=\\linewidth\]\{figures\/figure-d\.png\}\n\\caption\{Before\}\n\\label\{fig:p4-a\}\n\\end\{subfigure\}\\hfill\n\\begin\{subfigure\}/);
  assert.match(tex, /\\caption\{After\}\n\\label\{fig:p4-b\}\n\\end\{subfigure\}\n\\caption\{Both\}/);
  assert.match(tex, /\\begin\{table\*\}\[t\][\s\S]*?\\end\{table\*\}/);
  assert.deepEqual(files.filter((f) => f.path.startsWith('figures/')).map((f) => f.path),
    ['figures/figure-a.png', 'figures/figure-b.png', 'figures/figure-c.png', 'figures/figure-d.png', 'figures/figure-e.png']);
  const md = X.pandoc(m).find((f) => f.path === 'paper.md').content;
  assert.match(md, /\{#fig:p1 fig-pos="H"\}/);
  assert.match(md, /<div id="fig:p4">\n!\[Before\]\(figures\/figure-d\.png\)\{#fig:p4-a width=49%\}\n!\[After\]\(figures\/figure-e\.png\)\{#fig:p4-b width=49%\}\n\nBoth\n<\/div>/);
  const html = X.html(m);
  assert.match(html, /<figure id="fig-p3" class="wrap-right" style="--w:33%">/);
  assert.match(html, /<figure id="fig-p4" class="multi" style="--w:100%"><div class="panels"><div class="panel"><img[^>]+><div class="subcap"><b>\(a\)<\/b> Before<\/div>/);
  assert.match(html, /<figure class="table span" id="tab-t1">/);
  const doc = X.docx(m).find((f) => f.path === 'word/document.xml').content;
  assert.match(doc, /Figure 4\. <\/w:t><\/w:r><w:bookmarkEnd w:id="\d+"\/><w:r><w:t xml:space="preserve">Both<\/w:t><\/w:r><w:r><w:t xml:space="preserve"> <\/w:t><\/w:r><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">\(a\) <\/w:t>/);
});
