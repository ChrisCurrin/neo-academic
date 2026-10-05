// NEO — a paper's ways out
//
// Each builder takes the paper as a plain model (made from the page by
// paperModel in paper/paper.js) and returns what export:save writes:
//
//   latex(model)   → zip entries: paper.tex, references.bib, figures/, README
//                    (pdflatex + bibtex, natbib: what Overleaf and journals take)
//   pandoc(model)  → zip entries: paper.md (Pandoc Markdown, pandoc-crossref
//                    labels), references.bib, the citation style, figures/
//   html(model)    → one self-contained page (also what the PDF is printed from)
//   docx(model)    → zip entries for a Word document
//
// The model:
//   { title, subtitle, authors: [{ name, affiliations: [n], email, orcid, corresponding }],
//     affiliations: [text], abstract: [runs], keywords: [text], numbered, double, font,
//     style: { id, title, numeric, xml }, references: [CSL JSON], bibtex,
//     bibliography: { entries: [{ id, html }], hanging, numeric },
//     blocks: [ { type: 'heading', level, num, id, runs } | { type: 'para', runs, flush }
//             | { type: 'equation', id, num, tex, svg, png }
//             | { type: 'figure', id, num, caption: runs, name, base64, mime, png, width, alt, w, h }
//             | { type: 'table', id, num, caption: runs, header, rows: [[runs]] } ] }
//   runs: [ { text, b, i, u, s, sup, sub } | { cite: [{ id, locator, label, prefix, suffix }], narrative, html }
//         | { xref, kind, num, label } | { math, svg, png } ]
// png is { base64, w, h } (pixels at 2x) where a picture had to be drawn for Word.

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports && !root.document) module.exports = api;
  else root.NeoPaperExport = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const Journals = () => root.NeoJournals || (typeof require === 'function' ? require('./journals.js') : null);
  const Omml = () => root.NeoOmml || (typeof require === 'function' ? require('./omml.js') : null);
  // CSS lengths (in, mm, pt) as Word's twentieths of a point
  const twips = (v) => {
    const m = /^([\d.]+)(in|mm|cm|pt)?$/.exec(String(v).trim());
    if (!m) return 1440;
    return Math.round(+m[1] * ({ in: 1440, mm: 56.6929, cm: 566.929, pt: 20 }[m[2] || 'in']));
  };
  // a journal's page in Word: size and margins (CSS shorthand, top right bottom left)
  function wordPage(j) {
    const sizes = { letter: [12240, 15840], a4: [11906, 16838] };
    let [w, h] = sizes.letter;
    if (j) {
      const p = String(j.page).toLowerCase();
      if (sizes[p]) [w, h] = sizes[p];
      else { const d = p.split(/\s+/).map(twips); if (d.length === 2) [w, h] = d; }
    }
    const mg = (j ? String(j.margin) : '1in').split(/\s+/).map(twips);
    const [top, right = top, bottom = top, left = right] = mg;
    return { w, h, top, right, bottom, left };
  }
  // the first face in a journal's stack that Word is sure to have
  const WORD_FONTS = ['Times New Roman', 'Georgia', 'Arial', 'Helvetica', 'Palatino', 'Cambria', 'Calibri'];
  const wordFont = (stack) => String(stack || '').split(',').map((f) => f.replace(/["']/g, '').trim()).find((f) => WORD_FONTS.includes(f)) || 'Times New Roman';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // markup gone, entities read (citeproc writes &#38; &#60; and friends)
  const plain = (html) => String(html).replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');
  const runsText = (runs) => (runs || []).map((r) => (r.text !== undefined ? r.text : r.cite ? plain(r.html || '') : r.xref ? r.label : r.math !== undefined ? r.math : '')).join('');
  // our ids (fig-ab12) as the labels each tool expects (fig:ab12)
  const crossId = (id) => { const m = /^(fig|tab|eq|sec)-(.+)$/.exec(id || ''); return m ? (m[1] === 'tab' ? 'tbl' : m[1]) + ':' + m[2] : id; };
  const figName = (b) => 'figures/' + (b.png && b.mime === 'image/svg+xml' ? b.name.replace(/\.svg$/, '.png') : b.name);
  // a figure's pictures: one, or one per panel
  const pictures = (b) => (b.panels && b.panels.length ? b.panels : [b]);
  const pictureFiles = (m) => m.blocks.filter((b) => b.type === 'figure').flatMap(pictures).filter((p) => p.base64)
    .map((p) => ({ path: figName(p), content: p.png && p.mime === 'image/svg+xml' ? p.png.base64 : p.base64, base64: true }));
  const panelLetter = (i) => String.fromCharCode(97 + i);
  // LaTeX's float placement: [htbp] unless the writer chose; figure* takes no [H] or [h]
  const floatOpt = (b) => (b.place && !(b.span && /[Hh]/.test(b.place)) ? `[${b.place}]` : b.span ? '[tp]' : '[htbp]');

  // ---------------------------------------------------------------------
  // LaTeX
  // ---------------------------------------------------------------------
  const TEX_ESC = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', $: '\\$', '&': '\\&', '#': '\\#', '%': '\\%', _: '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '\u00a0': '~' };
  const texEsc = (s) => String(s).replace(/[\\{}$&#%_~^\u00a0]/g, (c) => TEX_ESC[c]);

  function texRuns(runs) {
    return (runs || []).map((r) => {
      if (r.text !== undefined) {
        // a line break inside a caption or a cell: LaTeX takes a space there
        let s = texEsc(r.text.replace(/\s*\n\s*/g, ' '));
        if (r.sup) s = `\\textsuperscript{${s}}`;
        if (r.sub) s = `\\textsubscript{${s}}`;
        if (r.u) s = `\\underline{${s}}`;
        if (r.i) s = `\\emph{${s}}`;
        if (r.b) s = `\\textbf{${s}}`;
        return s;
      }
      if (r.math !== undefined) return `\\(${r.math}\\)`;
      if (r.xref) {
        const label = crossId(r.xref);
        if (r.kind === 'eq') return `Equation~\\eqref{${label}}`;
        const word = { fig: 'Figure', tbl: 'Table', sec: 'Section' }[r.kind] || '';
        return r.kind ? `${word}~\\ref{${label}}` : texEsc(r.label || '');
      }
      if (r.cite) return texCite(r);
      return '';
    }).join('');
  }
  function texCite(r) {
    const items = r.cite;
    const keys = items.map((x) => x.id).join(',');
    const loc = (x) => (x.locator ? (x.label && x.label !== 'page' ? x.label + '~' : (/[–-]/.test(x.locator) ? 'pp.~' : 'p.~')) + texEsc(x.locator) : '') + (x.suffix ? (x.locator ? ', ' : '') + texEsc(x.suffix) : '');
    if (r.narrative) return items.map((x) => `\\citet${opt(x.prefix && texEsc(x.prefix), loc(x))}{${x.id}}`).join('; ');
    // one optional note before and after the whole group is all \citep takes
    const inner = items.slice(1, -1).some((x) => x.prefix || x.locator || x.suffix) || (items.length > 1 && (items[0].locator || items[0].suffix || items[items.length - 1].prefix));
    if (!inner) return `\\citep${opt(items[0].prefix && texEsc(items[0].prefix), loc(items[items.length - 1]))}{${keys}}`;
    return '(' + items.map((x) => `\\citealp${opt(x.prefix && texEsc(x.prefix), loc(x))}{${x.id}}`).join('; ') + ')';
  }
  const opt = (pre, post) => (pre ? `[${pre}][${post || ''}]` : post ? `[${post}]` : '');

  function latex(m) {
    const numeric = m.style && m.style.numeric;
    const L = (m.journal && m.journal.latex) || { cls: 'article', opts: '11pt' };
    const cls = L.cls;
    const used = (test) => m.blocks.some(test);
    const panels = used((b) => b.type === 'figure' && b.panels && b.panels.length > 1);
    const pinned = used((b) => (b.type === 'figure' || b.type === 'table') && b.place === 'H');
    const wrapped = used((b) => b.type === 'figure' && b.wrap);
    const article = cls === 'article';
    const opts = [L.opts, cls === 'elsarticle' && !numeric ? 'authoryear' : ''].filter(Boolean).join(',');
    // the classes that bring natbib (and acmart, hyperref) with them
    const ownNatbib = ['acmart', 'elsarticle', 'revtex4-2'].includes(cls);
    const lines = [];
    lines.push(`% Written in NEO${m.journal ? ` for ${m.journal.name}` : ''}. Compile with pdflatex and bibtex (Overleaf does both).`,
      '% The citations are natbib\'s (\\citep, \\citet), so a journal\'s .bst sets them in its style.',
      `\\documentclass${opts ? `[${opts}]` : ''}{${cls}}`,
      '\\usepackage[utf8]{inputenc}', '\\usepackage[T1]{fontenc}',
      ...(article ? ['\\usepackage{lmodern}'] : []),
      // acmart brings its own maths fonts and symbols
      cls === 'acmart' ? '\\usepackage{amsmath}' : '\\usepackage{amsmath,amssymb}', '\\usepackage{graphicx}', '\\usepackage{booktabs}',
      ...(article ? ['\\usepackage{authblk}', L.textwidth ? `\\usepackage[textwidth=${L.textwidth},top=1in,bottom=1in]{geometry}` : '\\usepackage[margin=1in]{geometry}',
        '\\usepackage[skip=6pt]{caption}', '\\captionsetup[table]{position=top}'] : []),
      ...(panels ? ['\\usepackage{subcaption}'] : []),
      ...(pinned ? ['\\usepackage{float}'] : []),
      ...(wrapped ? ['\\usepackage{wrapfig}'] : []),
      ...(ownNatbib ? [] : [numeric || !article ? '\\usepackage[numbers,square,sort&compress]{natbib}' : '\\usepackage[round]{natbib}']),
      ...(m.double && article ? ['\\usepackage{setspace}', '\\doublespacing'] : []),
      ...(cls === 'acmart' ? ['\\settopmatter{printacmref=false}', '\\setcopyright{none}', '\\renewcommand\\footnotetextcopyrightpermission[1]{}'] : ['\\usepackage[hidelinks]{hyperref}']),
      '');
    const title = `\\title{${texEsc(m.title || '')}${m.subtitle ? (article ? `\\\\[0.4em]\\large ${texEsc(m.subtitle)}` : `: ${texEsc(m.subtitle)}`) : ''}}`;
    const abstract = m.abstract && m.abstract.length ? ['\\begin{abstract}', m.abstract.map(texRuns).join('\n\n'), '\\end{abstract}'] : [];
    const kw = (m.keywords || []).map(texEsc);
    const affil = (a) => (a.affiliations || []).map((n) => texEsc(m.affiliations[n]));
    // each class takes its authors, affiliations and keywords its own way
    if (cls === 'IEEEtran') {
      lines.push(title, '\\author{' + m.authors.map((a) => `\\IEEEauthorblockN{${texEsc(a.name)}}\\IEEEauthorblockA{${[...affil(a).map((f) => `\\textit{${f}}`), a.email ? texEsc(a.email) : ''].filter(Boolean).join(' \\\\ ')}}`).join('\n\\and\n') + '}',
        '', '\\begin{document}', '\\maketitle', ...abstract, ...(kw.length ? ['\\begin{IEEEkeywords}', kw.join(', '), '\\end{IEEEkeywords}'] : []), '');
    } else if (cls === 'acmart') {
      lines.push(title);
      for (const a of m.authors) {
        lines.push(`\\author{${texEsc(a.name)}}`);
        for (const f of affil(a).length ? affil(a) : ['']) lines.push(`\\affiliation{\\institution{${f}}\\country{}}`);
        if (a.email) lines.push(`\\email{${texEsc(a.email)}}`);
        if (a.orcid) lines.push(`\\orcid{${a.orcid}}`);
      }
      lines.push('', '\\begin{document}', ...abstract, ...(kw.length ? [`\\keywords{${kw.join(', ')}}`] : []), '\\maketitle', '');
    } else if (cls === 'llncs') {
      lines.push(title, '\\author{' + m.authors.map((a) => `${texEsc(a.name)}${a.affiliations.length ? `\\inst{${a.affiliations.map((n) => n + 1).join(',')}}` : ''}${a.orcid ? `\\orcidID{${a.orcid}}` : ''}`).join(' \\and ') + '}',
        '\\authorrunning{' + texEsc(m.authors.length > 2 ? m.authors[0].name + ' et al.' : m.authors.map((a) => a.name).join(' and ')) + '}',
        '\\institute{' + (m.affiliations.map((f) => texEsc(f)).join(' \\and ') || ' ') + '}',
        '', '\\begin{document}', '\\maketitle',
        ...(abstract.length ? [abstract[0], abstract[1], ...(kw.length ? [`\\keywords{${kw.join(' \\and ')}}`] : []), abstract[2]] : []), '');
    } else if (cls === 'elsarticle') {
      lines.push('', '\\begin{document}', '\\begin{frontmatter}', title);
      for (const a of m.authors) lines.push(`\\author[${a.affiliations.map((n) => 'a' + (n + 1)).join(',') || 'a0'}]{${texEsc(a.name)}}${a.email ? `\\ead{${texEsc(a.email)}}` : ''}`);
      m.affiliations.forEach((f, i) => lines.push(`\\affiliation[a${i + 1}]{organization={${texEsc(f)}}}`));
      lines.push(...abstract, ...(kw.length ? ['\\begin{keyword}', kw.join(' \\sep '), '\\end{keyword}'] : []), '\\end{frontmatter}', '');
    } else if (cls === 'revtex4-2') {
      lines.push('', '\\begin{document}', title);
      for (const a of m.authors) {
        lines.push(`\\author{${texEsc(a.name)}}`);
        if (a.email) lines.push(`\\email{${texEsc(a.email)}}`);
        for (const f of affil(a)) lines.push(`\\affiliation{${f}}`);
      }
      lines.push('', ...abstract, '\\maketitle', '');
    } else {
      lines.push(title);
      m.authors.forEach((a) => {
        const marks = (a.affiliations || []).map((n) => n + 1).join(',');
        const extra = [a.corresponding && a.email ? `\\thanks{Correspondence: \\href{mailto:${a.email}}{${texEsc(a.email)}}}` : '',
          a.orcid ? `\\thanks{ORCID: \\href{https://orcid.org/${a.orcid}}{${a.orcid}}}` : ''].join('');
        lines.push(`\\author${marks ? `[${marks}]` : ''}{${texEsc(a.name)}${extra}}`);
      });
      m.affiliations.forEach((f, i) => lines.push(`\\affil[${i + 1}]{${texEsc(f)}}`));
      lines.push('\\date{}', '', '\\begin{document}', '\\maketitle', '', ...abstract, '');
      if (kw.length) lines.push(`\\noindent\\textbf{Keywords:} ${kw.join(', ')}`, '');
    }
    const star = m.numbered === false ? '*' : '';
    for (const b of m.blocks) {
      if (b.type === 'heading') {
        const cmd = ['section', 'subsection', 'subsubsection'][b.level - 1];
        lines.push(`\\${cmd}${star}{${texRuns(b.runs)}}\\label{${crossId(b.id)}}`, '');
      } else if (b.type === 'para') {
        const text = texRuns(b.runs).trim();
        if (text) lines.push((b.flush ? '\\noindent ' : '') + text, '');
      } else if (b.type === 'equation') {
        // align, gather and multline are environments of their own: as written, labeled inside
        const env = /^\s*\\begin\{(align|gather|multline|flalign|alignat)\*?\}[\s\S]*\\end\{\1\*?\}\s*$/.exec(b.tex);
        if (env) lines.push(b.tex.trim().replace(/\\end\{(\w+\*?)\}\s*$/, `\\label{${crossId(b.id)}}\n\\end{$1}`), '');
        else {
          const tex = /\\\\/.test(b.tex) && !/\\begin\{/.test(b.tex) ? `\\begin{split}\n${b.tex}\n\\end{split}` : b.tex;
          lines.push('\\begin{equation}', tex, `\\label{${crossId(b.id)}}`, '\\end{equation}', '');
        }
      } else if (b.type === 'figure') {
        const share = b.width ? b.width / 100 : 1;
        const pics = pictures(b);
        // wrapped: the text runs beside it (wrapfig); otherwise a float,
        // across both columns as figure*
        const env = b.wrap ? 'wrapfigure' : b.span ? 'figure*' : 'figure';
        lines.push(b.wrap ? `\\begin{wrapfigure}{${b.wrap === 'left' ? 'l' : 'r'}}{${share.toFixed(2)}\\linewidth}` : `\\begin{${env}}${floatOpt(b)}`, '\\centering');
        const inner = b.wrap ? 1 : share;
        if (pics.length > 1) {
          const each = ((inner * 0.96) / pics.length).toFixed(2);
          pics.forEach((p, i) => {
            lines.push(`\\begin{subfigure}[t]{${each}\\linewidth}`, '\\centering', `\\includegraphics[width=\\linewidth]{${figName(p)}}`,
              `\\caption{${texRuns(p.sub)}}`, `\\label{${crossId(b.id)}-${panelLetter(i)}}`, '\\end{subfigure}' + (i < pics.length - 1 ? '\\hfill' : ''));
          });
        } else {
          lines.push(`\\includegraphics[width=${inner === 1 ? '' : inner.toFixed(2)}\\linewidth]{${figName(b)}}`);
        }
        lines.push(`\\caption{${texRuns(b.caption)}}`, `\\label{${crossId(b.id)}}`, `\\end{${env}}`, '');
      } else if (b.type === 'table') {
        const cols = Math.max(1, ...b.rows.map((r) => r.length));
        lines.push(`\\begin{${b.span ? 'table*' : 'table'}}${floatOpt(b)}`, '\\centering', `\\caption{${texRuns(b.caption)}}`, `\\label{${crossId(b.id)}}`,
          `\\begin{tabular}{${'l'.repeat(cols)}}`, '\\toprule');
        b.rows.forEach((r, i) => {
          const cells = [];
          for (let k = 0; k < cols; k++) cells.push(texRuns(r[k] || []));
          lines.push(cells.join(' & ') + ' \\\\');
          if (i === 0 && b.header) lines.push('\\midrule');
        });
        lines.push('\\bottomrule', '\\end{tabular}', `\\end{${b.span ? 'table*' : 'table'}}`, '');
      }
    }
    const bst = L.bst !== undefined ? L.bst : numeric ? 'unsrtnat' : 'plainnat';
    const style = cls === 'elsarticle' ? (numeric ? 'elsarticle-num' : 'elsarticle-harv') : bst;
    lines.push(...(style ? [`\\bibliographystyle{${style}}`] : []), '\\bibliography{references}', '', '\\end{document}', '');
    const entries = [
      { path: 'paper.tex', content: lines.join('\n') },
      { path: 'references.bib', content: m.bibtex || '' },
      { path: 'README.txt', content: readme('latex', m) }
    ];
    entries.push(...pictureFiles(m));
    return entries;
  }

  // ---------------------------------------------------------------------
  // Pandoc Markdown (with pandoc-crossref's labels)
  // ---------------------------------------------------------------------
  const mdEsc = (s) => String(s).replace(/([\\`*_[\]#<>|$@])/g, '\\$1');
  function mdRuns(runs) {
    return (runs || []).map((r) => {
      if (r.text !== undefined) {
        let s = mdEsc(r.text);
        if (!s.trim()) return s;
        const lead = /^\s*/.exec(s)[0];
        const trail = /\s*$/.exec(s)[0];
        s = s.trim();
        if (r.sup) s = `^${s.replace(/ /g, '\\ ')}^`;
        if (r.sub) s = `~${s.replace(/ /g, '\\ ')}~`;
        if (r.s) s = `~~${s}~~`;
        if (r.u) s = `[${s}]{.underline}`;
        if (r.i) s = `*${s}*`;
        if (r.b) s = `**${s}**`;
        return lead + s + trail;
      }
      if (r.math !== undefined) return `$${r.math}$`;
      if (r.xref) return r.kind ? '@' + crossId(r.xref) : mdEsc(r.label || '');
      if (r.cite) {
        const one = (x) => [x.prefix, '@' + x.id + (x.locator || x.suffix ? ',' : ''), x.locator ? (x.label && x.label !== 'page' ? x.label + ' ' : 'p. ') + x.locator : '', x.suffix].filter(Boolean).join(' ');
        if (r.narrative) return r.cite.map((x) => '@' + x.id + (x.locator ? ` [${(x.label && x.label !== 'page' ? x.label + ' ' : 'p. ') + x.locator}]` : '')).join('; ');
        return '[' + r.cite.map(one).join('; ') + ']';
      }
      return '';
    }).join('');
  }
  const yamlStr = (s) => JSON.stringify(String(s));
  function pandoc(m) {
    const y = ['---', `title: ${yamlStr(m.title || '')}`];
    if (m.subtitle) y.push(`subtitle: ${yamlStr(m.subtitle)}`);
    if (m.authors.length) {
      y.push('author:');
      for (const a of m.authors) {
        y.push(`  - name: ${yamlStr(a.name)}`);
        if ((a.affiliations || []).length) y.push(`    affiliation: ${yamlStr(a.affiliations.map((n) => m.affiliations[n]).join('; '))}`);
        if (a.email) y.push(`    email: ${yamlStr(a.email)}`);
        if (a.orcid) y.push(`    orcid: ${yamlStr(a.orcid)}`);
        if (a.corresponding) y.push('    corresponding: true');
      }
    }
    if (m.abstract && m.abstract.length) {
      y.push('abstract: |');
      m.abstract.forEach((p, i) => { if (i) y.push('  '); y.push('  ' + mdRuns(p).replace(/\n/g, '\n  ')); });
    }
    if (m.keywords && m.keywords.length) y.push(`keywords: [${m.keywords.map(yamlStr).join(', ')}]`);
    y.push('bibliography: references.bib');
    if (m.style && m.style.xml) y.push(`csl: ${m.style.id || 'style'}.csl`);
    y.push('link-citations: true');
    if (m.numbered !== false) y.push('numberSections: true', 'number-sections: true');
    if (m.double) y.push('linestretch: 2');
    y.push('---', '');
    const out = [y.join('\n')];
    for (const b of m.blocks) {
      if (b.type === 'heading') out.push(`${'#'.repeat(b.level)} ${mdRuns(b.runs).trim()} {#${crossId(b.id)}}`);
      else if (b.type === 'para') { const s = mdRuns(b.runs).trim(); if (s) out.push(s); }
      else if (b.type === 'equation') out.push(`$$\n${b.tex}\n$$ {#${crossId(b.id)}}`);
      else if (b.type === 'figure') {
        // fig-pos is Quarto's placement (and Pandoc's LaTeX writer reads it too)
        const attrs = `${b.width ? ` width=${b.width}%` : ''}${b.place ? ` fig-pos="${b.place}"` : ''}`;
        if (pictures(b).length > 1) {
          // pandoc-crossref's subfigures: the panels, then the caption, in one div
          const each = Math.floor((b.width || 100) / pictures(b).length) - 1;
          out.push(`<div id="${crossId(b.id)}">\n` + pictures(b).map((p, i) => `![${mdRuns(p.sub).trim()}](${figName(p)}){#${crossId(b.id)}-${panelLetter(i)} width=${each}%}`).join('\n')
            + `\n\n${mdRuns(b.caption).trim()}\n</div>`);
        } else out.push(`![${mdRuns(b.caption).trim()}](${figName(b)}){#${crossId(b.id)}${attrs}}`);
      }
      else if (b.type === 'table') {
        const cols = Math.max(1, ...b.rows.map((r) => r.length));
        const cell = (r, k) => mdRuns(r[k] || []).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
        const rows = b.header ? b.rows : [new Array(cols).fill([]), ...b.rows];
        const lines = rows.map((r) => '| ' + Array.from({ length: cols }, (_, k) => cell(r, k)).join(' | ') + ' |');
        lines.splice(1, 0, '|' + ' --- |'.repeat(cols));
        out.push(lines.join('\n') + `\n\n: ${mdRuns(b.caption).trim()} {#${crossId(b.id)}}`);
      }
    }
    out.push('# References {.unnumbered}', '', '::: {#refs}\n:::');
    const entries = [
      { path: 'paper.md', content: out.join('\n\n') + '\n' },
      { path: 'references.bib', content: m.bibtex || '' },
      { path: 'README.txt', content: readme('pandoc', m) }
    ];
    if (m.style && m.style.xml) entries.push({ path: (m.style.id || 'style') + '.csl', content: m.style.xml });
    entries.push(...pictureFiles(m));
    return entries;
  }

  function readme(kind, m) {
    if (kind === 'latex') {
      return `${m.title || 'Paper'} — LaTeX, written in NEO

paper.tex          the paper
references.bib     the references it cites, keyed as in NEO
figures/           the figures

Upload the folder (or this zip) to Overleaf and it compiles as it is. On your
own machine: pdflatex paper, bibtex paper, pdflatex paper, pdflatex paper.

Citations use natbib (\\citep, \\citet), so a journal's .bst file sets them in
its style: change \\bibliographystyle{...} near the end of paper.tex. To use a
journal's own template, keep everything between \\begin{document} and
\\end{document} and swap the top for theirs.
`;
    }
    return `${m.title || 'Paper'} — Markdown for Pandoc, written in NEO

paper.md           the paper, in Pandoc's Markdown
references.bib     the references it cites, keyed as in NEO
${m.style && m.style.xml ? `${m.style.id || 'style'}.csl`.padEnd(19) + 'the citation style the paper uses in NEO\n' : ''}figures/           the figures

Figures, tables, equations and sections are labeled for pandoc-crossref.
With pandoc and pandoc-crossref installed:

  pandoc paper.md -F pandoc-crossref --citeproc -o paper.docx
  pandoc paper.md -F pandoc-crossref --citeproc -o paper.pdf
  pandoc paper.md -F pandoc-crossref --natbib -s -o paper.tex

Quarto reads the same file (rename it paper.qmd).
`;
  }

  // ---------------------------------------------------------------------
  // HTML (and the PDF printed from it)
  // ---------------------------------------------------------------------
  function htmlRuns(runs, ids = true) {
    return (runs || []).map((r) => {
      if (r.text !== undefined) {
        let s = esc(r.text);
        if (r.sup) s = `<sup>${s}</sup>`;
        if (r.sub) s = `<sub>${s}</sub>`;
        if (r.s) s = `<s>${s}</s>`;
        if (r.u) s = `<u>${s}</u>`;
        if (r.i) s = `<i>${s}</i>`;
        if (r.b) s = `<b>${s}</b>`;
        return s;
      }
      if (r.math !== undefined) return `<span class="math">${r.svg || esc(r.math)}</span>`;
      if (r.xref) return ids && r.kind ? `<a class="xref" href="#${esc(r.xref)}">${esc(r.label)}</a>` : esc(r.label || '');
      if (r.cite) return `<span class="cite">${ids && r.cite.length === 1 ? `<a href="#ref-${esc(r.cite[0].id)}">${r.html || ''}</a>` : r.html || ''}</span>`;
      return '';
    }).join('');
  }
  // print: for the PDF. src(pic): where a picture is (a data: URL unless
  // given). bodyOnly: the page's body, for EPUB.
  function html(m, { print = false, src = null, bodyOnly = false } = {}) {
    const font = m.font || 'Georgia, "Times New Roman", serif';
    // a journal sets the page, the numbers and the words of the captions
    const j = m.journal || null;
    const J = j ? Journals() : null;
    const num = (b) => (m.numbered === false ? '' : j ? J.headingNumber(j, b.num, b.level) : b.num);
    const figWord = j ? j.captions.figure : 'Figure';
    const tabWord = j ? j.captions.table : 'Table';
    const sep = j ? j.captions.sep : '.';
    const body = [];
    body.push(`<header><h1 class="title">${esc(m.title || '')}</h1>`);
    if (m.subtitle) body.push(`<p class="subtitle">${esc(m.subtitle)}</p>`);
    if (m.authors.length) {
      const many = m.affiliations.length > 1;
      body.push('<p class="authors">' + m.authors.map((a) => `<span class="author">${esc(a.name)}${many && a.affiliations.length ? `<sup>${a.affiliations.map((n) => n + 1).join(',')}</sup>` : ''}${a.corresponding ? '<sup>*</sup>' : ''}${a.orcid ? ` <a class="orcid" href="https://orcid.org/${esc(a.orcid)}" title="ORCID ${esc(a.orcid)}">iD</a>` : ''}</span>`).join(', ') + '</p>');
      if (m.affiliations.length) body.push('<div class="affils">' + m.affiliations.map((f, i) => `<div>${many ? `<sup>${i + 1}</sup> ` : ''}${esc(f)}</div>`).join('') + '</div>');
      const corr = m.authors.find((a) => a.corresponding && a.email);
      if (corr) body.push(`<div class="affils">* Correspondence: <a href="mailto:${esc(corr.email)}">${esc(corr.email)}</a></div>`);
    }
    body.push('</header>');
    if (m.abstract && m.abstract.length) body.push(`<section class="abstract"><h2>Abstract</h2>${m.abstract.map((p) => `<p>${htmlRuns(p)}</p>`).join('')}</section>`);
    if (m.keywords && m.keywords.length && (!j || j.keywords)) body.push(`<p class="keywords"><b>${esc(j ? j.keywords : 'Keywords')}${j && j.abstract === 'inline' ? '—' : ':'}</b> ${m.keywords.map(esc).join(', ')}</p>`);
    body.push('<main>');
    for (const b of m.blocks) {
      if (b.type === 'heading') body.push(`<h${b.level + 1} id="${esc(b.id)}">${num(b) ? `<span class="num">${esc(num(b))}</span> ` : ''}${htmlRuns(b.runs)}</h${b.level + 1}>`);
      else if (b.type === 'para') { const s = htmlRuns(b.runs); if (runsText(b.runs).trim() || /<(img|svg)/.test(s)) body.push(`<p${b.flush ? ' class="flush"' : ''}>${s}</p>`); }
      else if (b.type === 'equation') body.push(`<div class="eq" id="${esc(b.id)}"><span class="eq-body">${b.svg || esc(b.tex)}</span><span class="eq-num">(${esc(b.num)})</span></div>`);
      else if (b.type === 'figure') {
        const img = (p) => (p.base64 ? `<img src="${src ? esc(src(p)) : `data:${p.mime};base64,${p.base64}`}" alt="${esc(p.alt || '')}">` : '');
        const pics = pictures(b);
        const inner = pics.length > 1
          ? `<div class="panels">${pics.map((p, i) => `<div class="panel">${img(p)}<div class="subcap"><b>(${panelLetter(i)})</b> ${htmlRuns(p.sub)}</div></div>`).join('')}</div>`
          : img(b);
        const cls = [b.wrap ? 'wrap-' + b.wrap : '', b.span ? 'span' : '', pics.length > 1 ? 'multi' : ''].filter(Boolean).join(' ');
        body.push(`<figure id="${esc(b.id)}"${cls ? ` class="${cls}"` : ''}${b.width ? ` style="--w:${b.width}%"` : ''}>${inner}<figcaption><b>${esc(figWord)} ${esc(b.num)}${esc(sep)}</b> ${htmlRuns(b.caption)}</figcaption></figure>`);
      }
      else if (b.type === 'table') {
        const rows = b.rows.map((r, i) => `<tr>${r.map((c) => (i === 0 && b.header ? `<th>${htmlRuns(c)}</th>` : `<td>${htmlRuns(c)}</td>`)).join('')}</tr>`);
        const head = b.header && rows.length ? `<thead>${rows.shift()}</thead>` : '';
        body.push(`<figure class="table${b.span ? ' span' : ''}" id="${esc(b.id)}"><figcaption><b>${esc(tabWord)} ${tabWord === 'TABLE' && j && j.headings.numbering === 'roman' ? esc(J.headingNumber({ headings: { numbering: 'roman' } }, b.num, 1)).replace(/\.$/, '') : esc(b.num)}${esc(sep)}</b> ${htmlRuns(b.caption)}</figcaption><table>${head}<tbody>${rows.join('')}</tbody></table></figure>`);
      }
    }
    // in two columns the reference list runs on in them
    const twoCol = j && j.columns > 1;
    if (!twoCol) body.push('</main>');
    const bib = m.bibliography;
    if (bib && bib.entries.length) {
      body.push(`<section class="references${bib.hanging ? ' hanging' : ''}${bib.numeric ? ' numeric' : ''}"><h2>References</h2>`
        + bib.entries.map((e) => `<div class="entry" id="ref-${esc(e.id)}">${e.html}</div>`).join('') + '</section>');
    }
    if (twoCol) body.push('</main>');
    const css = `
@page { margin: 2.5cm 2.5cm; }
html { -webkit-print-color-adjust: exact; }
body { font-family: ${font}; font-size: ${print ? '11pt' : '18px'}; line-height: ${m.double ? 2 : 1.5}; color: #111; max-width: ${print ? 'none' : '42em'}; margin: ${print ? '0' : '3em auto'}; padding: 0 ${print ? '0' : '1em'}; }
header { text-align: center; margin-bottom: 2em; }
h1.title { font-size: 1.7em; line-height: 1.25; margin: 0 0 .3em; }
.subtitle { font-style: italic; margin: 0 0 .8em; }
.authors { margin: .6em 0 .3em; }
.affils { font-size: .85em; color: #333; }
.orcid { font-size: .7em; color: #a6ce39; font-weight: bold; text-decoration: none; }
.abstract { margin: 1.5em 2.5em 1em; font-size: .95em; }
.abstract h2 { font-size: 1em; text-align: center; margin: 0 0 .4em; }
.abstract p { text-indent: 0; margin: 0 0 .5em; }
.keywords { margin: 0 2.5em 2em; font-size: .95em; text-indent: 0; }
h2, h3, h4 { line-height: 1.3; margin: 1.6em 0 .5em; break-after: avoid; }
h2 { font-size: 1.25em; } h3 { font-size: 1.08em; } h4 { font-size: 1em; font-style: italic; }
h2 .num, h3 .num, h4 .num { margin-right: .4em; }
p { margin: 0; text-indent: 1.5em; text-align: ${print ? 'justify' : 'left'}; hyphens: auto; }
h2 + p, h3 + p, h4 + p, figure + p, .eq + p, p.flush { text-indent: 0; }
header p, p.keywords { text-indent: 0; text-align: center; }
p.keywords { text-align: left; }
a { color: inherit; text-decoration: none; }
.math svg { vertical-align: middle; }
.eq { display: flex; align-items: center; justify-content: center; position: relative; margin: .8em 0; break-inside: avoid; }
.eq-num { position: absolute; right: 0; }
figure { margin: 1.5em auto; text-align: center; break-inside: avoid; }
figure img { width: var(--w, 100%); max-width: 100%; height: auto; }
figure.wrap-left, figure.wrap-right { width: var(--w, 50%); margin: .3em 0 .6em; }
figure.wrap-left { float: left; margin-right: 1.4em; } figure.wrap-right { float: right; margin-left: 1.4em; }
figure.wrap-left img, figure.wrap-right img { width: 100%; }
figure.multi { width: var(--w, 100%); }
figure .panels { display: flex; gap: 3%; align-items: flex-start; }
figure .panel { flex: 1 1 0; min-width: 0; }
figure .panel img { width: 100%; }
figure .subcap { font-size: .85em; margin-top: .3em; }
figure.span, figure.table.span { column-span: all; }
figcaption { text-align: left; font-size: .9em; margin-top: .5em; line-height: 1.4; }
figure.table figcaption { margin: 0 0 .5em; }
table { border-collapse: collapse; margin: 0 auto; font-size: .9em; border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; }
th { border-bottom: 1px solid #000; font-weight: bold; }
th, td { padding: .25em .7em; text-align: left; vertical-align: top; }
.references h2 { margin-top: 2em; }
.references .entry { margin: 0 0 .5em; font-size: .95em; line-height: 1.4; }
.references.hanging .entry { padding-left: 2em; text-indent: -2em; }
.references.numeric .csl-entry { display: flex; gap: .6em; }
.references .csl-left-margin { min-width: 2.2em; }
.references .csl-right-inline { flex: 1; }`;
    if (bodyOnly) return body.join('\n');
    const style = j ? J.css(j, { double: m.double }) : css;
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(m.title || 'Paper')}</title><style>${style}</style></head>
<body>
${body.join('\n')}
</body></html>
`;
  }

  // ---------------------------------------------------------------------
  // One Markdown file: the references in its front matter (Pandoc reads them
  // there), the pictures in it as data URLs. Opens anywhere; pandoc
  // --citeproc sets it in full.
  // ---------------------------------------------------------------------
  function markdown(m) {
    const files = pandoc({ ...m, style: { ...m.style, xml: '' } });
    let md = files.find((f) => f.path === 'paper.md').content;
    const refs = (m.references || []).map((r) => '  - ' + JSON.stringify(r)).join('\n');
    md = md.replace('bibliography: references.bib\n', refs ? `references:\n${refs}\n` : '');
    for (const p of m.blocks.filter((b) => b.type === 'figure').flatMap(pictures)) {
      if (!p.base64) continue;
      const data = p.png && p.mime === 'image/svg+xml' ? `data:image/png;base64,${p.png.base64}` : `data:${p.mime};base64,${p.base64}`;
      md = md.split('](' + figName(p) + ')').join('](' + data + ')');
    }
    return md;
  }

  // ---------------------------------------------------------------------
  // Plain text: the words, the citations as set, maths as TeX
  // ---------------------------------------------------------------------
  function wrap(s, width = 78) {
    const out = [];
    for (const para of String(s).split('\n')) {
      let line = '';
      for (const word of para.split(/ +/)) {
        if (line && (line + ' ' + word).length > width) { out.push(line); line = word; } else line = line ? line + ' ' + word : word;
      }
      out.push(line);
    }
    return out.join('\n');
  }
  function textRuns(runs) {
    return (runs || []).map((r) => (r.text !== undefined ? r.text : r.cite ? plain(r.html || '') : r.xref ? r.label : r.math !== undefined ? `$${r.math}$` : '')).join('');
  }
  function text(m) {
    const j = m.journal || null;
    const J = j ? Journals() : null;
    const out = [];
    out.push(m.title || '');
    if (m.subtitle) out.push(m.subtitle);
    out.push('');
    if (m.authors.length) {
      const many = m.affiliations.length > 1;
      out.push(m.authors.map((a) => a.name + (many && a.affiliations.length ? ' [' + a.affiliations.map((n) => n + 1).join(',') + ']' : '') + (a.corresponding ? '*' : '')).join(', '));
      m.affiliations.forEach((f, i) => out.push((many ? `[${i + 1}] ` : '') + f));
      const corr = m.authors.find((a) => a.corresponding && a.email);
      if (corr) out.push('* ' + corr.email);
      out.push('');
    }
    if (m.abstract && m.abstract.length) out.push('ABSTRACT', '', ...m.abstract.map((p) => wrap(textRuns(p)) + '\n'));
    if (m.keywords && m.keywords.length) out.push('Keywords: ' + m.keywords.join(', '), '');
    const num = (b) => (m.numbered === false ? '' : j ? J.headingNumber(j, b.num, b.level) : b.num);
    for (const b of m.blocks) {
      if (b.type === 'heading') { const h = (num(b) ? num(b) + ' ' : '') + textRuns(b.runs); out.push('', h, (b.level === 1 ? '=' : '-').repeat(Math.min(78, h.length)), ''); }
      else if (b.type === 'para') { const s = textRuns(b.runs).trim(); if (s) out.push(wrap(s), ''); }
      else if (b.type === 'equation') out.push(`    ${b.tex.replace(/\n/g, '\n    ')}    (${b.num})`, '');
      else if (b.type === 'figure') {
        const subs = pictures(b).length > 1 ? ' ' + pictures(b).map((p, i) => `(${panelLetter(i)}) ${textRuns(p.sub)}`).join(' ') : '';
        out.push(wrap(`[Figure ${b.num}: ${textRuns(b.caption)}${subs}]`), '');
      } else if (b.type === 'table') {
        out.push(wrap(`Table ${b.num}. ${textRuns(b.caption)}`), '');
        const cells = b.rows.map((r) => r.map((c) => textRuns(c).replace(/\s+/g, ' ').trim()));
        const widths = [];
        for (const r of cells) r.forEach((c, k) => { widths[k] = Math.max(widths[k] || 0, c.length); });
        cells.forEach((r, i) => {
          out.push(r.map((c, k) => c.padEnd(widths[k])).join('  ').trimEnd());
          if (i === 0 && b.header) out.push(widths.map((w) => '-'.repeat(w)).join('  '));
        });
        out.push('');
      }
    }
    const bib = m.bibliography;
    if (bib && bib.entries.length) {
      out.push('', 'REFERENCES', '');
      for (const e of bib.entries) out.push(wrap(plain(e.html.replace(/<div class="csl-left-margin">([\s\S]*?)<\/div>/, '$1 ')).replace(/\s+/g, ' ').trim()), '');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // ---------------------------------------------------------------------
  // EPUB 3: the paper as one reflowing page, its pictures beside it
  // ---------------------------------------------------------------------
  function epub(m, { uuid = 'urn:neo:' + Date.now().toString(36), modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z') } = {}) {
    const pics = m.blocks.filter((b) => b.type === 'figure').flatMap(pictures).filter((p) => p.base64);
    const imgPath = (p) => 'images/' + (p.png && p.mime === 'image/svg+xml' ? p.name.replace(/\.svg$/, '.png') : p.name);
    // XHTML: every element closed, no HTML-only entities
    const xhtml = (s) => s.replace(/<(img|br|hr|col|input|meta|link)\b([^>]*?)\/?>/g, '<$1$2/>').replace(/&nbsp;/g, '&#160;');
    const body = xhtml(html({ ...m, journal: null }, { src: imgPath, bodyOnly: true }));
    const title = esc(m.title || 'Paper');
    const css = `body { font-family: serif; line-height: 1.5; margin: 0 1em; }
header { text-align: center; margin: 2em 0 1.5em; } h1.title { font-size: 1.5em; margin: 0 0 .4em; }
.subtitle { font-style: italic; } .authors { margin: .5em 0 .2em; } .affils { font-size: .85em; }
.abstract { margin: 1em 0; } .abstract h2 { font-size: 1em; } .abstract p { text-indent: 0; }
.keywords { text-indent: 0; font-size: .9em; }
h2 { font-size: 1.2em; margin: 1.6em 0 .5em; } h3 { font-size: 1.05em; margin: 1.2em 0 .4em; } h4 { font-size: 1em; font-style: italic; }
p { margin: 0; text-indent: 1.2em; } h2 + p, h3 + p, h4 + p, figure + p, div.eq + p { text-indent: 0; }
.eq { text-align: center; margin: .8em 0; } .eq-num { float: right; }
figure { margin: 1.2em 0; text-align: center; } figure img { max-width: 100%; }
figure .panels { display: flex; gap: 3%; } figure .panel { flex: 1; } figure .panel img { width: 100%; }
figcaption, .subcap { text-align: left; font-size: .9em; }
table { border-collapse: collapse; margin: 0 auto; border-top: 1px solid; border-bottom: 1px solid; font-size: .9em; }
th { border-bottom: 1px solid; } th, td { padding: .2em .5em; text-align: left; }
.references .entry { margin-bottom: .5em; font-size: .9em; }
a { color: inherit; text-decoration: none; }`;
    const page = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body></html>`;
    const heads = m.blocks.filter((b) => b.type === 'heading' && b.level === 1);
    const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${title}</title></head>
<body><nav epub:type="toc" id="toc"><h1>${title}</h1><ol>
<li><a href="paper.xhtml">${title}</a></li>
${heads.map((h) => `<li><a href="paper.xhtml#${esc(h.id)}">${esc(runsText(h.runs))}</a></li>`).join('\n')}
</ol></nav></body></html>`;
    const mime = (p) => (p.png && p.mime === 'image/svg+xml' ? 'image/png' : p.mime);
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${esc(uuid)}</dc:identifier>
<dc:title>${title}</dc:title>
${m.authors.map((a) => `<dc:creator>${esc(a.name)}</dc:creator>`).join('\n')}
<dc:language>en</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="paper" href="paper.xhtml" media-type="application/xhtml+xml"${/<svg/.test(body) ? ' properties="svg"' : ''}/>
<item id="css" href="style.css" media-type="text/css"/>
${[...new Map(pics.map((p) => [imgPath(p), p])).values()].map((p, i) => `<item id="img${i}" href="${esc(imgPath(p))}" media-type="${mime(p)}"/>`).join('\n')}
</manifest>
<spine><itemref idref="paper"/></spine>
</package>`;
    const entries = [
      { path: 'mimetype', content: 'application/epub+zip', store: true },
      { path: 'META-INF/container.xml', content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>` },
      { path: 'OEBPS/content.opf', content: opf },
      { path: 'OEBPS/nav.xhtml', content: nav },
      { path: 'OEBPS/paper.xhtml', content: page },
      { path: 'OEBPS/style.css', content: css }
    ];
    const seen = new Set();
    for (const p of pics) {
      if (seen.has(imgPath(p))) continue;
      seen.add(imgPath(p));
      entries.push({ path: 'OEBPS/' + imgPath(p), content: p.png && p.mime === 'image/svg+xml' ? p.png.base64 : p.base64, base64: true });
    }
    return entries;
  }

  // ---------------------------------------------------------------------
  // Word (.docx)
  // ---------------------------------------------------------------------
  const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const EMU = 9525; // per pixel at 96 dpi

  // citeproc's HTML (a citation, a reference) as Word runs
  function htmlToRuns(h) {
    const runs = [];
    const fmt = { i: 0, b: 0, sup: 0, sub: 0 };
    String(h).replace(/<div class="csl-left-margin">([\s\S]*?)<\/div>/g, '$1\t').split(/(<[^>]+>)/).forEach((part) => {
      const tag = /^<(\/?)(\w+)/.exec(part);
      if (tag) {
        const name = tag[2].toLowerCase();
        const k = name === 'em' ? 'i' : name === 'strong' ? 'b' : name;
        if (k in fmt) fmt[k] += tag[1] ? -1 : 1;
        if (k === 'span' && /font-style:\s*italic/.test(part)) fmt.i += 1;
        return;
      }
      if (part) runs.push({ text: plain(part), i: fmt.i > 0, b: fmt.b > 0, sup: fmt.sup > 0, sub: fmt.sub > 0 });
    });
    return runs;
  }

  function docx(m) {
    const j = m.journal || null;
    const J = j ? Journals() : null;
    const page = wordPage(j);
    const figWord = j ? j.captions.figure : 'Figure';
    const tabWord = j ? j.captions.table : 'Table';
    const capSep = j ? j.captions.sep : '.';
    const hnum = (b) => (m.numbered === false ? '' : j ? J.headingNumber(j, b.num, b.level) : b.num);
    // the width text runs in (a column's, in two): for equation tabs and pictures
    const cols = j ? j.columns : 1;
    const gap = cols > 1 ? twips(j.gap || '0.25in') : 0;
    const textW = Math.round((page.w - page.left - page.right - gap * (cols - 1)) / cols);
    const textPx = textW / 15;
    const media = [];
    const rels = [];
    const addImage = (base64, ext) => {
      const n = media.length + 1;
      const name = `image${n}.${ext}`;
      media.push({ path: 'word/media/' + name, content: base64, base64: true });
      const rid = 'rIdImg' + n;
      rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
      return rid;
    };
    let pic = 0;
    const drawing = (rid, w, h, alt, offset = 0) => {
      pic++;
      const cx = Math.round(w * EMU);
      const cy = Math.round(h * EMU);
      return `<w:r>${offset ? `<w:rPr><w:position w:val="${Math.round(offset)}"/></w:rPr>` : ''}<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pic}" name="Picture ${pic}" descr="${xml(alt || '')}"/>`
        + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
        + `<pic:nvPicPr><pic:cNvPr id="${pic}" name="Picture ${pic}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
        + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    };
    const run = (r) => {
      const pr = [r.b && '<w:b/>', r.i && '<w:i/>', r.u && '<w:u w:val="single"/>', r.s && '<w:strike/>', r.sup && '<w:vertAlign w:val="superscript"/>', r.sub && '<w:vertAlign w:val="subscript"/>'].filter(Boolean).join('');
      return String(r.text).split('\t').map((piece, i) => `${i ? '<w:r><w:tab/></w:r>' : ''}${piece ? `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(piece)}</w:t></w:r>` : ''}`).join('');
    };
    // bookmarks let a cross-reference jump to its figure in Word
    const runsXml = (runs) => (runs || []).map((r) => {
      if (r.text !== undefined) return run(r);
      if (r.cite) return htmlToRuns(r.html || '').map(run).join('');
      if (r.xref) return r.kind ? `<w:hyperlink w:anchor="${xml(bm(r.xref))}">${run({ text: r.label })}</w:hyperlink>` : run({ text: r.label || '' });
      if (r.math !== undefined) {
        // an equation Word can edit; a picture of it only when it can't be one
        const omml = r.mml ? Omml().fromMathml(r.mml) : null;
        if (omml) return omml;
        if (r.png) return drawing(addImage(r.png.base64, 'png'), r.png.w / 2, r.png.h / 2, r.math, -(r.png.depth || 0) * 1.5);
        return run({ text: r.math, i: true });
      }
      return '';
    }).join('');
    const bm = (id) => '_' + String(id).replace(/[^\w]/g, '_');
    let bmId = 0;
    const mark = (id, inner) => { bmId++; return `<w:bookmarkStart w:id="${bmId}" w:name="${xml(bm(id))}"/>${inner}<w:bookmarkEnd w:id="${bmId}"/>`; };
    const para = (style, inner, extra = '') => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${inner}</w:p>`;
    const body = [];
    body.push(para('Title', run({ text: m.title || '' })));
    if (m.subtitle) body.push(para('Subtitle', run({ text: m.subtitle })));
    if (m.authors.length) {
      const many = m.affiliations.length > 1;
      body.push(para('Authors', m.authors.map((a, i) => (i ? run({ text: ', ' }) : '') + run({ text: a.name })
        + (many && a.affiliations.length ? run({ text: a.affiliations.map((n) => n + 1).join(','), sup: true }) : '')
        + (a.corresponding ? run({ text: '*', sup: true }) : '')).join('')));
      m.affiliations.forEach((f, i) => body.push(para('Affiliation', (many ? run({ text: String(i + 1), sup: true }) + run({ text: ' ' }) : '') + run({ text: f }))));
      const corr = m.authors.find((a) => a.corresponding && a.email);
      if (corr) body.push(para('Affiliation', run({ text: '* Correspondence: ' + corr.email })));
      const orcids = m.authors.filter((a) => a.orcid);
      if (orcids.length) body.push(para('Affiliation', run({ text: 'ORCID: ' + orcids.map((a) => `${a.name} ${a.orcid}`).join('; ') })));
    }
    if (m.abstract && m.abstract.length) {
      body.push(para('AbstractHeading', run({ text: 'Abstract' })));
      for (const p of m.abstract) body.push(para('Abstract', runsXml(p)));
    }
    if (m.keywords && m.keywords.length && (!j || j.keywords)) body.push(para('Keywords', run({ text: (j ? j.keywords : 'Keywords') + ': ', b: true }) + run({ text: m.keywords.join(', ') })));
    const sect = (cols, last) => `<w:sectPr>${last ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : ''}<w:type w:val="continuous"/><w:pgSz w:w="${page.w}" w:h="${page.h}"/><w:pgMar w:top="${page.top}" w:right="${page.right}" w:bottom="${page.bottom}" w:left="${page.left}" w:header="567" w:footer="567" w:gutter="0"/>${last ? '<w:pgNumType w:start="1"/>' : ''}<w:cols w:num="${cols}" w:space="${twips(j && j.gap ? j.gap : '0.25in')}"/></w:sectPr>`;
    // two columns: the title, authors and abstract span the page, the paper runs in columns
    if (j && j.columns > 1) body.push(`<w:p><w:pPr>${sect(1, false)}</w:pPr></w:p>`);
    let afterBlock = true;
    for (const b of m.blocks) {
      if (b.type === 'heading') {
        body.push(para('Heading' + b.level, mark(b.id, (hnum(b) ? run({ text: hnum(b) + '\t' }) : '') + runsXml((j && j.headings.upper && b.level === 1) ? b.runs.map((r) => (r.text !== undefined ? { ...r, text: r.text.toUpperCase() } : r)) : b.runs))));
        afterBlock = true;
      } else if (b.type === 'para') {
        if (!runsText(b.runs).trim() && !b.runs.some((r) => r.math !== undefined)) continue;
        body.push(para(afterBlock || b.flush ? 'FirstParagraph' : 'BodyText', runsXml(b.runs)));
        afterBlock = false;
      } else if (b.type === 'equation') {
        const omml = b.mml ? Omml().fromMathml(b.mml) : null;
        if (omml) {
          // a display equation with its number: Word's usual way, a row of three
          // borderless cells (room, the equation as a display, the number), so
          // the equation is set full size and centred and the number sits right
          const side = Math.round(textW * 0.12);
          const cell = (w, inner, jc) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="EquationCell"/><w:jc w:val="${jc}"/></w:pPr>${inner}</w:p></w:tc>`;
          body.push(`<w:tbl><w:tblPr><w:tblW w:w="${textW}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>`
            + `<w:tblGrid><w:gridCol w:w="${side}"/><w:gridCol w:w="${textW - 2 * side}"/><w:gridCol w:w="${side}"/></w:tblGrid><w:tr>`
            + cell(side, '', 'left')
            + cell(textW - 2 * side, mark(b.id, `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${omml}</m:oMathPara>`), 'center')
            + cell(side, run({ text: `(${b.num})` }), 'right')
            + '</w:tr></w:tbl>');
        } else {
          const pic = b.png ? drawing(addImage(b.png.base64, 'png'), b.png.w / 2, b.png.h / 2, b.tex) : run({ text: b.tex, i: true });
          body.push(para('Equation', mark(b.id, `<w:r><w:tab/></w:r>${pic}<w:r><w:tab/></w:r>${run({ text: `(${b.num})` })}`)));
        }
        afterBlock = true;
      } else if (b.type === 'figure') {
        const pics = pictures(b);
        const room = ((b.span && cols > 1 ? textPx * cols : textPx) * (b.width ? b.width / 100 : 1)) / pics.length - (pics.length > 1 ? 8 : 0);
        const art = pics.map((p) => {
          const src = p.png || (p.base64 && p.mime !== 'image/svg+xml' ? { base64: p.base64, w: p.w, h: p.h } : null);
          if (!src) return '';
          const w = Math.min(room, src.w || room);
          const h = src.w ? (src.h || src.w) * (w / src.w) : w * 0.6;
          const ext = p.png ? 'png' : p.mime === 'image/jpeg' ? 'jpeg' : p.mime.split('/')[1];
          return drawing(addImage(src.base64, ext), w, h, p.alt);
        }).filter(Boolean);
        if (art.length) body.push(para('Figure', art.join(run({ text: '  ' }))));
        const subs = pics.length > 1 ? pics.map((p, i) => run({ text: `(${panelLetter(i)}) `, b: true }) + runsXml(p.sub) + run({ text: ' ' })).join('') : '';
        body.push(para('Caption', mark(b.id, run({ text: `${figWord} ${b.num}${capSep} `, b: true })) + runsXml(b.caption) + (subs ? run({ text: ' ' }) + subs : '')));
        afterBlock = true;
      } else if (b.type === 'table') {
        const tnum = tabWord === 'TABLE' && j && j.headings.numbering === 'roman' ? J.headingNumber(j, b.num, 1).replace(/\.$/, '') : b.num;
        body.push(para('TableCaption', mark(b.id, run({ text: `${tabWord} ${tnum}${capSep} `, b: true })) + runsXml(b.caption)));
        const cols = Math.max(1, ...b.rows.map((r) => r.length));
        const rows = b.rows.map((r, i) => {
          const head = i === 0 && b.header;
          const last = i === b.rows.length - 1;
          const borders = `<w:tcBorders>${i === 0 ? '<w:top w:val="single" w:sz="12" w:color="000000"/>' : ''}${head ? '<w:bottom w:val="single" w:sz="6" w:color="000000"/>' : last ? '<w:bottom w:val="single" w:sz="12" w:color="000000"/>' : ''}</w:tcBorders>`;
          const cells = Array.from({ length: cols }, (_, k) => `<w:tc><w:tcPr>${borders}</w:tcPr>${para('TableText', runsXml((r[k] || []).map((x) => (head && x.text !== undefined ? { ...x, b: true } : x))))}</w:tc>`);
          return `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`;
        });
        body.push(`<w:tbl><w:tblPr><w:tblW w:w="${cols > 3 ? 5000 : 3500}" w:type="pct"/><w:jc w:val="center"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>${rows.join('')}</w:tbl>`);
        body.push(para('FirstParagraph', ''));
        afterBlock = true;
      }
    }
    const bib = m.bibliography;
    if (bib && bib.entries.length) {
      body.push(para('Heading1', run({ text: 'References' })));
      for (const e of bib.entries) body.push(para(bib.numeric ? 'BibliographyNumbered' : 'Bibliography', mark('ref-' + e.id, htmlToRuns(e.html).map(run).join(''))));
    }
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
<w:body>${body.join('\n')}${sect(j ? j.columns : 1, true)}</w:body></w:document>`;
    const font = j ? wordFont(j.font) : (m.font || 'Times New Roman').split(',')[0].replace(/["']/g, '').trim() || 'Times New Roman';
    const line = m.double ? 480 : j ? Math.round(240 * j.leading) : 360;
    const size = j ? Math.round(parseFloat(j.size) * 2) : 24;
    const style = (id, name, ppr, rpr, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${extra}<w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${xml(font)}" w:hAnsi="${xml(font)}" w:cs="${xml(font)}" w:eastAsia="${xml(font)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
${style('Normal', 'Normal', '', '', '<w:qFormat/>')}
${style('BodyText', 'Body Text', '<w:ind w:firstLine="360"/>', '', '<w:basedOn w:val="Normal"/><w:qFormat/>')}
${style('FirstParagraph', 'First Paragraph', '<w:ind w:firstLine="0"/>', '', '<w:basedOn w:val="BodyText"/><w:next w:val="BodyText"/><w:qFormat/>')}
${style('Title', 'Title', '<w:jc w:val="center"/><w:spacing w:after="160" w:line="276" w:lineRule="auto"/>', '<w:b/><w:sz w:val="36"/><w:szCs w:val="36"/>', '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>')}
${style('Subtitle', 'Subtitle', '<w:jc w:val="center"/><w:spacing w:after="160"/>', '<w:i/><w:sz w:val="28"/>', '<w:basedOn w:val="Normal"/><w:qFormat/>')}
${style('Authors', 'Authors', '<w:jc w:val="center"/><w:spacing w:before="120" w:after="60"/>', '', '<w:basedOn w:val="Normal"/>')}
${style('Affiliation', 'Affiliation', '<w:jc w:val="center"/><w:spacing w:line="276" w:lineRule="auto"/>', '<w:sz w:val="20"/>', '<w:basedOn w:val="Normal"/>')}
${style('AbstractHeading', 'Abstract Title', '<w:jc w:val="center"/><w:spacing w:before="360" w:after="120"/><w:keepNext/>', '<w:b/>', '<w:basedOn w:val="Normal"/>')}
${style('Abstract', 'Abstract', '<w:ind w:left="720" w:right="720"/><w:spacing w:after="120"/>', '<w:sz w:val="22"/>', '<w:basedOn w:val="Normal"/><w:qFormat/>')}
${style('Keywords', 'Keywords', '<w:ind w:left="720" w:right="720"/><w:spacing w:after="360"/>', '<w:sz w:val="22"/>', '<w:basedOn w:val="Normal"/>')}
${style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/><w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs>', '<w:b/><w:sz w:val="28"/>', '<w:basedOn w:val="Normal"/><w:next w:val="FirstParagraph"/><w:qFormat/>')}
${style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/><w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs>', '<w:b/><w:sz w:val="24"/>', '<w:basedOn w:val="Normal"/><w:next w:val="FirstParagraph"/><w:qFormat/>')}
${style('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/><w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs>', '<w:b/><w:i/>', '<w:basedOn w:val="Normal"/><w:next w:val="FirstParagraph"/><w:qFormat/>')}
${style('Equation', 'Equation', `<w:tabs><w:tab w:val="center" w:pos="${Math.round(textW / 2)}"/><w:tab w:val="right" w:pos="${textW}"/></w:tabs><w:spacing w:before="120" w:after="120"/>`, '')}
${style('EquationCell', 'Equation (numbered)', '<w:spacing w:before="80" w:after="80" w:line="240" w:lineRule="auto"/>', '', '<w:basedOn w:val="Normal"/>')}
${style('Figure', 'Figure', '<w:jc w:val="center"/><w:keepNext/><w:spacing w:before="240" w:line="240" w:lineRule="auto"/>', '')}
${style('Caption', 'caption', '<w:spacing w:before="80" w:after="240" w:line="276" w:lineRule="auto"/>', '<w:sz w:val="20"/>', '<w:basedOn w:val="Normal"/><w:qFormat/>')}
${style('TableCaption', 'Table Caption', '<w:keepNext/><w:spacing w:before="240" w:after="80" w:line="276" w:lineRule="auto"/>', '<w:sz w:val="20"/>', '<w:basedOn w:val="Caption"/>')}
${style('TableText', 'Table Text', '<w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="20"/>', '<w:basedOn w:val="Normal"/>')}
${style('Bibliography', 'Bibliography', '<w:ind w:left="720" w:hanging="720"/><w:spacing w:after="120" w:line="276" w:lineRule="auto"/>', '<w:sz w:val="22"/>', '<w:basedOn w:val="Normal"/>')}
${style('BibliographyNumbered', 'Bibliography (numbered)', '<w:tabs><w:tab w:val="left" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="540"/><w:spacing w:after="120" w:line="276" w:lineRule="auto"/>', '<w:sz w:val="22"/>', '<w:basedOn w:val="Normal"/>')}
${style('Footer', 'footer', '<w:jc w:val="center"/>', '<w:sz w:val="20"/>', '<w:basedOn w:val="Normal"/>')}
</w:styles>`;
    const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
${rels.join('\n')}
</Relationships>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="webp" ContentType="image/webp"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(m.title || '')}</dc:title><dc:creator>${xml(m.authors.map((a) => a.name).join('; '))}</dc:creator><cp:keywords>${xml((m.keywords || []).join(', '))}</cp:keywords>
</cp:coreProperties>`;
    return [
      { path: '[Content_Types].xml', content: types },
      { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>` },
      { path: 'docProps/core.xml', content: core },
      { path: 'word/document.xml', content: doc },
      { path: 'word/styles.xml', content: styles },
      { path: 'word/footer1.xml', content: footer },
      { path: 'word/_rels/document.xml.rels', content: docRels },
      ...media
    ];
  }

  return { latex, pandoc, markdown, text, epub, html, docx, crossId, runsText, htmlToRuns, texEsc };
});
