/* =========================== NEO POCKET =========================== */
/* The window.neo doorway, implemented for Android and iOS. Reads and    */
/* writes the same plain files as desktop NEO, in a NEO Library folder:  */
/* Android: Documents/NEO Library, shared with the Mac via Syncthing.    */
/* iOS: the app's own folder — inside iCloud Drive when the writer has  */
/* it on (so desktop NEO can point at the same folder), else On My iPad. */
/* Desktop-only powers (email, import) stub out                          */
/* quietly; writing never does.                                          */

(function () {
  const FS = () => window.Capacitor.Plugins.Filesystem;
  const DIR = 'DOCUMENTS';
  const ROOT = 'NEO Library';
  const isIOS = () => !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios');

  // iOS: HOME is the library folder as a file:// URL, found by the little
  // LibraryHome plugin (ios/App/App/LibraryHome.swift); CLOUD says whether
  // that folder lives in iCloud Drive. Android leaves both alone.
  let HOME = null;
  let CLOUD = false;
  const libraryHome = () => (window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin('LibraryHome') : window.Capacitor.Plugins.LibraryHome);
  const ready = (async () => {
    if (!isIOS()) return;
    try {
      const r = await libraryHome().locate();
      HOME = String(r.path).replace(/\/+$/, '');
      CLOUD = !!r.cloud;
      // first launch on a new iPad: the whole library is still in the cloud
      if (CLOUD) await libraryHome().fetch({ wait: 20000 });
    } catch (err) {
      showErrorDetail('Could not find the library folder: ' + (err && err.message || err) +
        '\nplugins the page can see: ' + Object.keys((window.Capacitor && window.Capacitor.Plugins) || {}).join(', '));
    }
  })();

  // library-relative path -> the Filesystem plugin's idea of where that is
  const p = (...parts) => parts.join('/');
  function at(rel) {
    if (HOME) return { path: rel ? HOME + '/' + rel.split('/').map(encodeURIComponent).join('/') : HOME };
    return { path: rel ? ROOT + '/' + rel : ROOT, directory: DIR };
  }

  // iCloud delivers other devices' files as placeholders until asked;
  // ask before reading anything a Mac might have written.
  async function fetchCloud(rel, wait) {
    if (!CLOUD) return;
    try { await libraryHome().fetch({ path: at(rel).path, wait: wait || 8000 }); } catch { /* read anyway */ }
  }

  async function listDir(rel) {
    await ready;
    const ls = await FS().readdir(at(rel));
    return (ls.files || []).map((f) => (f && f.name) || f).filter((n) => !String(n).endsWith('.icloud'));
  }

  async function ensureDir(path) {
    await ready;
    try {
      await FS().mkdir({ ...at(path), recursive: true });
    } catch { /* exists */ }
  }

  async function readText(path) {
    await ready;
    const r = await FS().readFile({ ...at(path), encoding: 'utf8' });
    return r.data;
  }

  async function writeText(path, data) {
    await ready;
    try {
      await FS().writeFile({ ...at(path), data, encoding: 'utf8', recursive: true });
    } catch (err) {
      showErrorDetail('Could not save ' + path + ': ' + (err && err.message || err));
      throw err;
    }
  }

  let permissionHelpShown = false;
  function showPermissionHelp(err) {
    if (permissionHelpShown) return;
    permissionHelpShown = true;
    const bd = document.createElement('div');
    bd.style.cssText = 'position:fixed;inset:0;background:#191919;color:#d6d2c6;z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;padding:40px;text-align:center';
    const why = isIOS()
      ? '<p style="line-height:1.6;margin-top:16px">Pocket couldn\'t open its NEO Library folder. Force-quit and reopen the app; if it keeps happening, check that iCloud Drive is signed in (Settings → your name → iCloud), or turn it off so Pocket keeps books on the iPad itself.</p>'
      : '<p style="line-height:1.6;margin-top:16px">Pocket can see the NEO Library folder but Android is blocking it from reading files that other apps (like Syncthing) created.</p>' +
        '<p style="line-height:1.6;color:#999;margin-top:12px">The switch is not on the app\'s own Permissions page. Open Android Settings, search for <b>All files access</b> (or Apps → Special app access → All files access), turn it on for NEO Pocket, then come back here.</p>';
    bd.innerHTML = '<div style="max-width:420px"><h2 style="letter-spacing:5px">NEO POCKET</h2>' + why +
      '<p style="font:12px/1.5 monospace;color:#777;margin-top:20px;word-break:break-word">' + String(err && err.message || err || '') + '</p></div>';
    document.body.appendChild(bd);
  }

  // On a phone there's no easy way to open the log, so show the error itself.
  // Long-press the box to copy it; tap to dismiss.
  function showErrorDetail(msg) {
    try {
      let box = document.getElementById('pocket-error-detail');
      if (!box) {
        box = document.createElement('pre');
        box.id = 'pocket-error-detail';
        box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;max-height:40vh;overflow:auto;' +
          'margin:0;padding:12px;background:#2a1d1d;color:#e8c9c9;font:12px/1.5 monospace;' +
          'white-space:pre-wrap;word-break:break-word;border-radius:8px;z-index:9998;user-select:text';
        box.addEventListener('click', () => box.remove());
        document.body.appendChild(box);
      }
      box.textContent = String(msg).slice(0, 2000) + '\n\n(tap to dismiss)';
    } catch { /* never let the reporter itself hiccup */ }
  }

  async function readJSONFile(path, fallback) {
    try { return JSON.parse(await readText(path)); } catch { return fallback; }
  }

  async function writeJSONFile(path, data) {
    await writeText(path, JSON.stringify(data, null, 2));
  }

  const bookDir = (bookId) => p(bookId);
  const academicBookId = (bookId) => {
    if (typeof bookId !== 'string' || !bookId || bookId.length > 200 ||
        /[\\/\0-\x1f\x7f:*?"<>|]/.test(bookId) || /[. ]$/.test(bookId)) {
      throw new Error('Invalid book ID');
    }
    return bookId;
  };
  const academicFigureName = (file) => {
    if (typeof file !== 'string' || file.length > 200 ||
        !/^figure-[a-f0-9-]+\.(?:png|jpg|jpeg|svg|pdf)$/i.test(file)) {
      throw new Error('Invalid figure filename');
    }
    return file;
  };
  const unsupportedAcademicPdf = () => {
    const error = new Error('PDF figure previews are desktop-only. Import the PDF in desktop NEO first to create a safe PNG preview for Pocket.');
    error.code = 'ACADEMIC_PDF_UNSUPPORTED';
    return error;
  };
  const ACADEMIC_IMAGE_MIMES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml'
  };
  const ACADEMIC_SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  const ACADEMIC_XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
  const ACADEMIC_ACTIVE_SVG_ELEMENTS = new Set([
    'script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'audio', 'video',
    'animate', 'animatemotion', 'animatetransform', 'set'
  ]);
  const ACADEMIC_MATH_ACTIVE_SVG_ELEMENTS = new Set([
    ...ACADEMIC_ACTIVE_SVG_ELEMENTS, 'style', 'a'
  ]);

  function safeAcademicSvg(source) {
    if (typeof source !== 'string' || source.length > 10 * 1024 * 1024 ||
        /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Invalid or unsafe SVG figure');
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || root.namespaceURI !== ACADEMIC_SVG_NAMESPACE ||
        doc.querySelector('parsererror')) throw new Error('Invalid SVG figure');
    const elements = [root, ...root.querySelectorAll('*')];
    for (const element of elements) {
      const tag = element.localName.toLowerCase();
      if (ACADEMIC_ACTIVE_SVG_ELEMENTS.has(tag)) {
        throw new Error('SVG figures containing active or embedded content are not supported');
      }
      if (tag === 'style' &&
          /@import|expression\s*\(|(?:javascript|data|https?|file):|url\s*\(\s*["']?(?!#)/i.test(element.textContent)) {
        throw new Error('SVG figures cannot contain scripts or external references');
      }
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name === 'xmlns' || name.startsWith('xmlns:')) {
          if ((name === 'xmlns' && value === ACADEMIC_SVG_NAMESPACE) ||
              (name === 'xmlns:xlink' && value === ACADEMIC_XLINK_NAMESPACE)) continue;
          throw new Error('SVG figures cannot declare external namespaces');
        }
        const href = name === 'href' || name.endsWith(':href');
        if (name.startsWith('on') || name === 'src' || name === 'xml:base' ||
            (href && (!value.startsWith('#') || /[\s"'<>]/.test(value))) ||
            /(?:javascript|data|https?|file):|@import|expression\s*\(|url\s*\(\s*["']?(?!#)/i.test(value)) {
          throw new Error('SVG figures cannot contain scripts or external references');
        }
      }
    }
    return new XMLSerializer().serializeToString(root);
  }

  function safeAcademicMathSvg(source) {
    if (typeof source !== 'string' || source.length > 5 * 1024 * 1024 ||
        /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Invalid math SVG');
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || root.namespaceURI !== ACADEMIC_SVG_NAMESPACE ||
        doc.querySelector('parsererror')) throw new Error('MathJax returned invalid SVG markup');
    const elements = [root, ...root.querySelectorAll('*')];
    const urlAttributes = new Set([
      'href', 'xlink:href', 'src', 'style', 'fill', 'stroke', 'filter', 'clip-path',
      'mask', 'marker-start', 'marker-mid', 'marker-end', 'cursor', 'color-profile'
    ]);
    for (const element of elements) {
      if (ACADEMIC_MATH_ACTIVE_SVG_ELEMENTS.has(element.localName.toLowerCase())) {
        throw new Error('MathJax returned active SVG markup');
      }
      if (element.namespaceURI !== ACADEMIC_SVG_NAMESPACE) throw new Error('MathJax returned foreign SVG content');
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name === 'xmlns' || name.startsWith('xmlns:')) {
          if ((name === 'xmlns' && value === ACADEMIC_SVG_NAMESPACE) ||
              (name === 'xmlns:xlink' && value === ACADEMIC_XLINK_NAMESPACE)) continue;
          throw new Error('MathJax returned an unsafe SVG namespace');
        }
        if (name.startsWith('on') || name === 'xml:base') throw new Error('MathJax returned an active SVG attribute');
        if (!urlAttributes.has(name)) continue;
        if (name === 'src') throw new Error('MathJax SVG cannot load external resources');
        if (name === 'href' || name === 'xlink:href') {
          if (!value.startsWith('#') || /[\s"'<>]/.test(value)) throw new Error('MathJax SVG references must be local fragments');
          continue;
        }
        if (/(?:javascript|data|https?|file):|@import|expression\s*\(/i.test(value)) {
          throw new Error('MathJax SVG cannot contain external URLs');
        }
        for (const match of value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
          if (!match[2].startsWith('#') || /[\s"'<>]/.test(match[2])) {
            throw new Error('MathJax SVG references must be local fragments');
          }
        }
      }
    }
    return source;
  }

  function base64EncodeText(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async function verifyAcademicBitmap(file, mime) {
    const bytes = new Uint8Array(await file.slice(0, 24).arrayBuffer());
    if (mime === 'image/png' &&
        (bytes.length < 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte))) {
      throw new Error('Invalid PNG figure image');
    }
    if (mime === 'image/jpeg' &&
        (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)) {
      throw new Error('Invalid JPEG figure image');
    }
  }

  function decodeAcademicImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('Could not decode the selected image'));
          return;
        }
        const scale = Math.min(1, 2400 / image.naturalWidth, 2400 / image.naturalHeight);
        const canvas = document.createElement('canvas');
        let width = Math.max(1, Math.round(image.naturalWidth * scale));
        let height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Image processing is unavailable on this device'));
          return;
        }
        try {
          const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
          let result = null;
          for (let attempt = 0; attempt < 10; attempt++) {
            canvas.width = width;
            canvas.height = height;
            context.drawImage(image, 0, 0, width, height);
            const quality = mime === 'image/jpeg' ? Math.max(0.55, 0.9 - attempt * 0.05) : undefined;
            const dataUrl = canvas.toDataURL(mime, quality);
            const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
            const bytes = Math.floor(base64.length * 3 / 4) - padding;
            result = { dataUrl, mime, bytes, width, height };
            if (bytes <= 5 * 1024 * 1024) {
              resolve(result);
              return;
            }
            width = Math.max(1, Math.floor(width * 0.75));
            height = Math.max(1, Math.floor(height * 0.75));
          }
          reject(new Error('Figure remains too large after optimization'));
        } catch (err) { reject(err); }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode the selected image'));
      };
      image.src = url;
    });
  }

  function pickAcademicImage() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg,application/pdf,.pdf';
      input.hidden = true;
      let settled = false;
      const cleanup = () => {
        input.remove();
        window.removeEventListener('focus', onFocus);
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      const onFocus = () => setTimeout(() => {
        if (!input.files || !input.files.length) finish(resolve, null);
      }, 500);
      input.addEventListener('cancel', () => finish(resolve, null), { once: true });
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) { finish(resolve, null); return; }
        finish(resolve, file);
      }, { once: true });
      window.addEventListener('focus', onFocus, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function importAcademicFigure(bookId) {
    academicBookId(bookId);
    const file = await pickAcademicImage();
    if (!file) return null;
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    const originalMime = ACADEMIC_IMAGE_MIMES[extension] || file.type || '';
    if (originalMime === 'application/pdf' || extension === 'pdf') {
      throw unsupportedAcademicPdf();
    }
    if (!Object.values(ACADEMIC_IMAGE_MIMES).includes(originalMime)) {
      throw new Error('Choose a PNG, JPEG, or SVG figure');
    }
    if (file.size > 20 * 1024 * 1024) throw new Error('Figure images must be smaller than 20 MB');

    let inputFile = new Blob([file], { type: originalMime });
    if (originalMime === 'image/svg+xml') {
      const svg = safeAcademicSvg(await file.text());
      inputFile = new Blob([svg], { type: 'image/svg+xml' });
    } else await verifyAcademicBitmap(file, originalMime);
    const image = await decodeAcademicImage(inputFile);
    const extensionForOutput = image.mime === 'image/jpeg' ? 'jpg' : 'png';
    const uuid = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const name = `figure-${uuid}.${extensionForOutput}`;
    const base64 = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1);
    const path = p(bookId, 'figures', name);
    await ensureDir(p(bookId, 'figures'));
    await FS().writeFile({ ...at(path), data: base64, recursive: true });
    return {
      file: name,
      mime: image.mime,
      dataUrl: image.dataUrl,
      originalName: String(file.name || 'figure'),
      originalMime,
      bytes: image.bytes,
      width: image.width,
      height: image.height
    };
  }

  async function readAcademicFigure(bookId, file) {
    academicBookId(bookId);
    academicFigureName(file);
    const extension = file.split('.').pop().toLowerCase();
    if (extension === 'pdf') throw unsupportedAcademicPdf();
    const mime = ACADEMIC_IMAGE_MIMES[extension];
    if (!mime) throw new Error('Unsupported academic figure format');
    const path = p(bookId, 'figures', file);
    await fetchCloud(path);
    const result = await FS().readFile(at(path));
    const base64 = String(result.data || '').replace(/\s/g, '');
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Invalid figure image data');
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    if (Math.floor(base64.length * 3 / 4) - padding > 5 * 1024 * 1024) throw new Error('Figure image is too large');
    if (mime === 'image/svg+xml') {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const safeSvg = safeAcademicSvg(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (new TextEncoder().encode(safeSvg).length > 5 * 1024 * 1024) throw new Error('SVG figure is too large');
      const safeBase64 = base64EncodeText(safeSvg);
      return `data:${mime};base64,${safeBase64}`;
    }
    const binary = atob(base64);
    if (mime === 'image/png' &&
        (binary.length < 24 || Array.from(binary.slice(0, 8), (c) => c.charCodeAt(0)).join(',') !== '137,80,78,71,13,10,26,10')) {
      throw new Error('Invalid PNG figure image');
    }
    if (mime === 'image/jpeg' &&
        (binary.length < 4 || binary.charCodeAt(0) !== 255 || binary.charCodeAt(1) !== 216 || binary.charCodeAt(2) !== 255)) {
      throw new Error('Invalid JPEG figure image');
    }
    return `data:${mime};base64,${base64}`;
  }

  async function readAcademicPdfBase64(bookId, file) {
    academicBookId(bookId);
    academicFigureName(file);
    if (file.split('.').pop().toLowerCase() !== 'pdf') throw new Error('Invalid original PDF filename');
    const path = p(bookId, 'figures', file);
    await fetchCloud(path);
    const result = await FS().readFile(at(path));
    const base64 = String(result.data || '').replace(/\s/g, '');
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Invalid original PDF data');
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const bytes = Math.floor(base64.length * 3 / 4) - padding;
    if (bytes > 20 * 1024 * 1024) throw new Error('Original PDF is too large');
    const header = atob(base64.slice(0, 12));
    if (!header.startsWith('%PDF-')) throw new Error('Invalid original PDF file');
    return { base64, bytes };
  }

  async function validateAcademicBook(bookId) {
    await fetchCloud(p(bookId, 'book.json'));
    const meta = await readJSONFile(p(bookId, 'book.json'), null);
    if (!meta || meta.id !== bookId) throw new Error('Academic figure book not found');
  }

  function newAcademicFigureFile(extension) {
    const uuid = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `figure-${uuid}.${extension}`;
  }

  async function copyAcademicFigure(sourceBookId, targetBookId, figure) {
    academicBookId(sourceBookId);
    academicBookId(targetBookId);
    if (!figure || typeof figure !== 'object' || Array.isArray(figure)) throw new Error('Invalid academic figure');
    const sourceFile = academicFigureName(figure.file);
    const extension = sourceFile.split('.').pop().toLowerCase();
    const mime = ACADEMIC_IMAGE_MIMES[extension];
    if (!mime || figure.mime && figure.mime !== mime) throw new Error('Invalid academic figure format');
    const sourceOriginalFile = figure.originalFile != null && figure.originalFile !== ''
      ? academicFigureName(figure.originalFile)
      : null;
    if (sourceOriginalFile && sourceOriginalFile.split('.').pop().toLowerCase() !== 'pdf') {
      throw new Error('Invalid original PDF filename');
    }
    if (figure.originalMime && sourceOriginalFile && figure.originalMime !== 'application/pdf') {
      throw new Error('Invalid original PDF MIME type');
    }
    await validateAcademicBook(sourceBookId);
    if (sourceBookId !== targetBookId) await validateAcademicBook(targetBookId);
    const dataUrl = await readAcademicFigure(sourceBookId, sourceFile);
    if (sourceBookId === targetBookId) return { ...figure, dataUrl, mime };

    const originalPdf = sourceOriginalFile
      ? await readAcademicPdfBase64(sourceBookId, sourceOriginalFile)
      : null;
    const targetFile = newAcademicFigureFile(extension);
    const targetOriginalFile = originalPdf ? newAcademicFigureFile('pdf') : undefined;
    const targetDir = p(targetBookId, 'figures');
    await ensureDir(targetDir);
    const imagePath = p(targetDir, targetFile);
    const originalPath = targetOriginalFile ? p(targetDir, targetOriginalFile) : null;
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    try {
      await FS().writeFile({ ...at(imagePath), data, recursive: true });
      if (originalPath) await FS().writeFile({ ...at(originalPath), data: originalPdf.base64, recursive: true });
    } catch (err) {
      if (typeof FS().deleteFile === 'function') {
        try { await FS().deleteFile(at(imagePath)); } catch { /* best-effort cleanup */ }
        if (originalPath) {
          try { await FS().deleteFile(at(originalPath)); } catch { /* best-effort cleanup */ }
        }
      }
      throw err;
    }
    const copied = {
      ...figure,
      file: targetFile,
      mime,
      dataUrl,
      bytes: Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
    };
    if (targetOriginalFile) {
      copied.originalFile = targetOriginalFile;
      copied.originalMime = figure.originalMime || 'application/pdf';
      copied.originalBytes = originalPdf.bytes;
    } else {
      delete copied.originalFile;
      delete copied.originalBytes;
    }
    return copied;
  }

  async function renderAcademicMath(source, format, display) {
    if (typeof source !== 'string' || source.length > 20000) throw new Error('Invalid equation source (maximum 20000 characters)');
    if (!['tex', 'asciimath'].includes(format)) throw new Error('Invalid math format');
    if (typeof display !== 'boolean') throw new Error('Invalid math display mode');
    if (/\\(?:href|url|htmlClass|htmlId|htmlStyle|htmlData|require)\b/i.test(source)) throw new Error('Unsafe TeX command');
    const mathJax = window.MathJax;
    if (!mathJax || !mathJax.startup || !mathJax.startup.promise ||
        typeof mathJax.tex2svgPromise !== 'function' || typeof mathJax.asciimath2svgPromise !== 'function') {
      throw new Error('Math rendering is unavailable in NEO Pocket because its local MathJax runtime is not loaded');
    }
    await mathJax.startup.promise;
    const node = format === 'asciimath'
      ? await mathJax.asciimath2svgPromise(source, { display })
      : await mathJax.tex2svgPromise(source, { display });
    const wrapper = document.createElement('div');
    wrapper.appendChild(node.cloneNode(true));
    const svgNode = wrapper.querySelector('svg');
    if (!svgNode) throw new Error('MathJax did not return an SVG equation');
    return safeAcademicMathSvg(svgNode.outerHTML);
  }

  // The honest access test: reading a file another app created. An app can
  // always touch its OWN files without the big permission — which is exactly
  // how a too-gentle test lies about a half-broken setup.
  async function checkAccess() {
    try {
      await ensureDir('');
      let names = [];
      try { names = await listDir(''); } catch { /* fall through to the write test */ }
      if (names.includes('library.json')) {
        await readText(p('library.json')); // the file that matters, whoever made it
      } else {
        await FS().writeFile({ ...at('.pocket-touch'), data: String(Date.now()), encoding: 'utf8', recursive: true });
        try { await FS().deleteFile(at('.pocket-touch')); } catch { /* fine */ }
      }
      return true;
    } catch (err) {
      showPermissionHelp(err);
      return false;
    }
  }

  function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  window.neo = {
    /* ---------- library ---------- */
    readLibrary: async () => {
      if (!(await checkAccess())) return { authorName: '', penNames: [], firstRunDone: false, shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }] };
      await fetchCloud('library.json', 15000);
      return readJSONFile(p('library.json'), {
        authorName: '', penNames: [], firstRunDone: false, pageTheme: 'night',
        shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
      });
    },
    writeLibrary: async (data) => { await writeJSONFile(p('library.json'), data); return true; },
    libraryPath: async () => {
      // a served URL lets cover art render in the webview
      try {
        await ready;
        if (HOME) return window.Capacitor.convertFileSrc(HOME);
        const u = await FS().getUri({ path: ROOT, directory: DIR });
        return window.Capacitor.convertFileSrc(u.uri);
      } catch { return 'Documents/NEO Library'; }
    },

    /* ---------- books ---------- */
    readBookMeta: async (bookId) => { await fetchCloud(bookId); return readJSONFile(p(bookId, 'book.json'), null); },
    listBooks: async () => {
      const out = [];
      try {
        for (const name of await listDir('')) {
          if (!String(name).startsWith('book-')) continue;
          const m = await readJSONFile(p(name, 'book.json'), null);
          if (m && m.id) out.push({ id: m.id, title: m.title || 'Untitled', author: m.author || '', modified: m.modified || '', kind: m.kind || '' });
        }
      } catch { /* an empty list is honest enough */ }
      return out;
    },
    writeBookMeta: async (bookId, meta) => {
      meta.modified = new Date().toISOString();
      await writeJSONFile(p(bookId, 'book.json'), meta);
      return meta.modified;
    },
    // app.js asks before re-reading a book: on iCloud, pull down whatever the
    // Mac wrote since (a short wait; the shelf must never hang on the network)
    refreshBook: async (bookId) => { await fetchCloud(bookId, 4000); return true; },
    createBook: async (opts) => {
      const seed = (opts && opts.title) ? slugify(opts.title) : '';
      const id = 'book-' + (seed ? seed + '-' : '') + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      const book = {
        id,
        title: (opts && opts.title) || 'Untitled',
        subtitle: '',
        author: (opts && opts.author) || '',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        chapterOrder: [],
        coverSeed: Math.floor(Math.random() * 100000),
        lastPosition: null
      };
      await ensureDir(bookDir(id) + '/chapters');
      await writeJSONFile(p(id, 'book.json'), book);
      await writeText(p(id, 'notes.html'), '');
      await writeText(p(id, 'outline.html'), '');
      await writeJSONFile(p(id, 'darlings.json'), []);
      await writeJSONFile(p(id, 'stickies.json'), []);
      return book;
    },
    // the folder goes; on iOS the Files app keeps it in Recently Deleted
    deleteBook: async (bookId) => {
      try {
        await ready;
        await FS().rmdir({ ...at(bookId), recursive: true });
        return true;
      } catch (err) {
        showErrorDetail('Could not delete ' + bookId + ': ' + (err && err.message || err));
        return false;
      }
    },

    /* ---------- chapters ---------- */
    // {chId: mtime and size}: lets app.js re-read only what changed on disk
    // (the size too: Syncthing and iCloud keep the other device's mtime, and
    // two saves in the same second must not look alike)
    chapterStamps: async (bookId) => {
      const out = {};
      try {
        await ready;
        const ls = await FS().readdir(at(p(bookId, 'chapters')));
        for (const f of ls.files || []) {
          const name = (f && f.name) || String(f);
          if (name.endsWith('.html')) out[name.slice(0, -5)] = ((f && f.mtime) || 0) + ':' + ((f && f.size) || 0);
        }
      } catch { /* no chapters yet */ }
      return out;
    },
    readChapter: async (bookId, chId) => {
      await fetchCloud(p(bookId, 'chapters', chId + '.html'));
      try { return await readText(p(bookId, 'chapters', chId + '.html')); } catch { return ''; }
    },
    writeChapter: async (bookId, chId, html) => {
      await ensureDir(bookDir(bookId) + '/chapters');
      await writeText(p(bookId, 'chapters', chId + '.html'), html);
      return true;
    },
    deleteChapter: async (bookId, chId) => {
      try { await FS().deleteFile(at(p(bookId, 'chapters', chId + '.html'))); } catch { /* fine */ }
      return true;
    },

    /* ---------- notes / outline / json sidecars ---------- */
    readAux: async (bookId, name) => {
      try { return await readText(p(bookId, name + '.html')); } catch { return ''; }
    },
    writeAux: async (bookId, name, html) => { await writeText(p(bookId, name + '.html'), html); return true; },
    readJSON: (bookId, name, fallback) => readJSONFile(p(bookId, name + '.json'), fallback),
    writeJSON: async (bookId, name, data) => { await writeJSONFile(p(bookId, name + '.json'), data); return true; },
    readAcademicFigure,
    writeAcademicBibliography: async (bookId, text) => {
      academicBookId(bookId);
      if (typeof text !== 'string' || text.includes('\0')) throw new Error('Invalid bibliography payload');
      const bytes = new TextEncoder().encode(text).length;
      if (bytes > 20 * 1024 * 1024) throw new Error('Bibliography is too large');
      await writeText(p(bookId, 'bibliography.bib'), text);
      return { file: 'bibliography.bib', bytes };
    },
    importAcademicFigure,
    copyAcademicFigure,
    renderAcademicMath,

    /* ---------- API keys & painting: desktop only ---------- */
    hasSecret: async () => false,
    setSecret: async () => false,
    paintCover: async () => { throw new Error('Cover painting happens on the desktop'); },

    /* ---------- covers: shown if present, managed on the Mac ---------- */
    readCover: async (bookId, fname) => {
      try {
        await ready;
        const r = await FS().readFile(at(p(bookId, fname)));
        const ext = fname.split('.').pop().toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        return { base64: r.data, mime, ext };
      } catch { return null; }
    },
    pickCover: async () => null,
    setCover: async () => null,
    removeCover: async () => true,

    /* ---------- desktop powers, politely absent ---------- */
    // Export: the page builds the file (txt/md/html as text, docx/epub as
    // zip entries); it is written to the app's cache and handed to the
    // system share sheet — AirDrop, Files, Mail, whatever the writer picks.
    exportSave: async ({ format, defaultName, content, zipEntries }) => {
      try {
        const Share = window.Capacitor.Plugins.Share;
        if (!Share) throw new Error('Sharing is not available in this build');
        if (format === 'pdf') { if (typeof toast === 'function') toast('PDF export happens on the desktop — html, docx and epub work here'); return null; }
        const name = (defaultName || 'book') + '.' + format;
        let data;
        let encoding = 'utf8';
        if (zipEntries) {
          if (!window.JSZip) throw new Error('Zip support missing');
          const zip = new window.JSZip();
          // same shape main.js zips on the desktop: [{path, content, base64?, store?}]
          for (const e of zipEntries) {
            zip.file(e.path, e.content, { base64: !!e.base64, compression: e.store ? 'STORE' : 'DEFLATE' });
          }
          data = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
          encoding = undefined; // base64 to the plugin
        } else {
          data = content;
        }
        const w = await FS().writeFile({ path: 'exports/' + name, directory: 'CACHE', data, encoding, recursive: true });
        await Share.share({ title: name, url: w.uri });
        return name;
      } catch (err) {
        if (!/cancel/i.test(String(err && err.message || err))) showErrorDetail('Export failed: ' + (err && err.message || err));
        return null;
      }
    },
    emailDraft: async () => ({ ok: false }),
    importFiles: async () => [],
    importPick: async () => [],
    pathForFile: () => null,
    checkForUpdate: async () => ({ error: true }),
    openRelease: async () => true,
    fullscreenEscape: async () => false,
    fullscreenToggle: async () => true,
    spellCheckWords: async (words) => {
      const out = {};
      for (const w of words) out[w] = true; // no checker: nothing is wrong
      if (!(await spellEnsure())) return out;
      spellCatchUp();
      const r = await spellEngine()({ type: 'check', words });
      return r.ok ? r.result : out;
    },
    spellSuggest: async (word) => {
      if (!(await spellEnsure())) return [];
      const r = await spellEngine()({ type: 'suggest', word });
      return r.ok ? r.result : [];
    },
    spellLearn: async (word) => {
      if (typeof word === 'string' && word) {
        spellAdded.add(word);
        if (spellReady) await spellEngine()({ type: 'add', word });
      }
      return true;
    },
    setSpellLanguage: async (code) => spellEnsure(code),
    appVersion: async () => 'Pocket 0.1.0',
    logError: async (msg) => {
      try {
        let prior = '';
        try { prior = await readText(p('neo-errors.log')); } catch { /* first entry */ }
        const line = `[${new Date().toISOString()}] [pocket] ${msg}\n`;
        await writeText(p('neo-errors.log'), (prior + line).slice(-100000));
      } catch { console.error(msg); }
      showErrorDetail(msg);
    },
    // no menu bar in your pocket: the ⋯ sheet (index.html) sends the same
    // messages the desktop menus do, and the tick marks come back here
    onMenu: (fn) => { window.pocketMenu = fn; },
    poetryState: (on) => { window.pocketState.poetry = !!on; },
    flushState: (on) => { window.pocketState.flush = !!on; },
    typewriterState: (on) => { window.pocketState.typewriter = !!on; }
  };
  window.pocketState = { poetry: false, flush: false, typewriter: false };

  // Interface language: the same locales/ files as the desktop, picked by
  // the device's language (regional file over its base, English beneath).
  // Read synchronously here because app.js reads window.neo.i18n as it loads.
  function loadLocale() {
    const want = String(navigator.language || 'en').replace('_', '-');
    const base = want.split('-')[0];
    const get = (code) => {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', 'locales/' + code + '.json', false);
        x.send();
        if (x.responseText && (x.status === 200 || x.status === 0)) return JSON.parse(x.responseText);
      } catch { /* no such language */ }
      return null;
    };
    const english = get('en') || {};
    if (base === 'en') return { locale: 'en', dict: {}, base: english };
    const baseDict = get(base);
    const regional = want !== base ? get(want) : null;
    if (!baseDict && !regional) return { locale: 'en', dict: {}, base: english };
    return { locale: regional ? want : base, dict: { ...(baseDict || {}), ...(regional || {}) }, base: english };
  }
  try { window.neo.i18n = loadLocale(); } catch { /* English it is */ }

  // Spellcheck: desktop NEO's Hunspell and dictionaries (pocket-spell.js),
  // in a web worker so the page never waits on a dictionary. The language
  // is the library's (library.json syncs it from the desktop), else the
  // interface's when NEO has its dictionary, else US English: the same rule
  // as defaultSpellLanguage() in main.js.
  let spellCodes = null;   // { code: label }, from dict/languages.json
  let spellReady = null;   // { language, ok: Promise<boolean> }
  const spellAdded = new Set(); // the writer's own words, given to the checker
  let engine = null;
  window.pocketSpellLanguages = () => spellCodes || {};
  window.pocketSpellLanguage = () => (spellReady ? spellReady.language : spellCodes ? wantedLanguage(spellCodes) : null);

  async function spellLanguages() {
    if (!spellCodes) {
      try { spellCodes = JSON.parse(await (await fetch('dict/languages.json')).text()); } catch { spellCodes = null; return {}; }
    }
    return spellCodes;
  }
  const lib = () => (typeof library !== 'undefined' && library) || {}; // app.js's library.json
  function wantedLanguage(codes) {
    const chosen = lib().spellLanguage;
    if (codes[chosen]) return chosen;
    const ui = String((window.neo.i18n && window.neo.i18n.locale) || 'en');
    if (codes[ui]) return ui;
    if (ui === 'pt' || ui === 'pt-BR') return 'pt-BR';
    const base = ui.split('-')[0];
    return codes[base] ? base : 'en-US';
  }

  function spellEngine() {
    if (engine) return engine;
    // an older web view without module workers: check on the page instead
    let direct = null;
    let queue = Promise.resolve();
    const onPage = (msg) => (queue = queue.then(async () => {
      if (!direct) direct = await import('./pocket-spell.js');
      return direct.handle(msg);
    }).catch((err) => ({ ok: false, error: String(err && err.message || err) })));
    let worker = null;
    try { worker = new Worker('pocket-spell.js', { type: 'module' }); } catch { worker = null; }
    if (!worker) return (engine = onPage);
    const waiting = new Map();
    let seq = 0;
    let broken = false;
    worker.onmessage = (e) => {
      const w = waiting.get(e.data && e.data.id);
      if (w) { waiting.delete(e.data.id); w.done(e.data); }
    };
    worker.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      broken = true;
      try { worker.terminate(); } catch { /* gone */ }
      for (const w of waiting.values()) onPage(w.msg).then(w.done);
      waiting.clear();
    };
    return (engine = (msg) => broken ? onPage(msg) : new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, { msg, done: resolve });
      worker.postMessage({ ...msg, id });
    }));
  }

  spellLanguages(); // the list is tiny; the ⋯ sheet wants it at hand

  // load the dictionary the writer wants (or the one asked for), once
  async function spellEnsure(code) {
    const codes = await spellLanguages();
    const language = code || wantedLanguage(codes);
    if (!codes[language]) return false;
    if (spellReady && spellReady.language === language) return spellReady.ok;
    const custom = (lib().customWords || []).filter((w) => typeof w === 'string' && w);
    const ready = {
      language,
      ok: spellEngine()({ type: 'load', language, custom }).then((r) => {
        if (!r.ok) window.neo.logError('spell: ' + language + ' did not load: ' + r.error);
        return !!r.ok;
      })
    };
    spellReady = ready;
    spellAdded.clear();
    for (const w of custom) spellAdded.add(w);
    return ready.ok;
  }

  // words learned on another device since the dictionary loaded
  function spellCatchUp() {
    for (const w of lib().customWords || []) {
      if (typeof w !== 'string' || !w || spellAdded.has(w)) continue;
      spellAdded.add(w);
      spellEngine()({ type: 'add', word: w });
    }
  }

  // No right-click on a phone: with spellcheck on, a tap on an underlined
  // word opens the same suggestions (app.js answers the contextmenu event)
  document.addEventListener('click', (e) => {
    const hl = window.CSS && CSS.highlights && CSS.highlights.get('neo-spell');
    if (!hl || !hl.size || !document.caretRangeFromPoint) return;
    if (!e.target.closest || !e.target.closest('.chapter-body, #aux-editor')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!pos) return;
    let hit = false;
    for (const r of hl) {
      try { if (r.isPointInRange(pos.startContainer, pos.startOffset)) { hit = true; break; } } catch { /* stale range */ }
    }
    if (!hit) return;
    e.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }));
  });

  // iOS puts a shortcuts bar (bold, italic, mic, ⌘ hints) above its keyboard;
  // it covers Pocket's own bar, and NEO has its own idea of formatting
  // the keyboard's colour follows the page theme (body.night comes and goes
  // as the writer switches Night and Paper)
  if (isIOS()) {
    const tellKeyboard = () => { try { libraryHome().setKeyboard({ dark: document.body.classList.contains('night') }); } catch { /* fine */ } };
    document.addEventListener('DOMContentLoaded', () => {
      tellKeyboard();
      new MutationObserver(tellKeyboard).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // Android: whatever shows around the page (the camera cutout band on a
  // Samsung, the status bar when a swipe peeks it) takes the page's own
  // color — night, paper or light — instead of the phone's white
  if (!isIOS()) {
    let bars = null;
    try { bars = window.Capacitor.registerPlugin('NeoBars'); } catch { /* older shell */ }
    const tellBars = () => {
      if (!bars) return;
      const bg = (el) => getComputedStyle(el).backgroundColor;
      let c = bg(document.body);
      if (!c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c)) c = bg(document.documentElement);
      bars.set({ color: c }).catch(() => { /* an older APK without the plugin */ });
    };
    document.addEventListener('DOMContentLoaded', () => {
      tellBars();
      // after a theme change, once any color transition has settled
      new MutationObserver(() => { tellBars(); setTimeout(tellBars, 450); })
        .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // The keyboard's height becomes a CSS variable, and Pocket's own bar and
  // panes sit above it (pocket.css). iOS is told nothing about resizing;
  // its own attempts left a black band behind when the keyboard went away.
  // Android shrinks the window for its keyboard by itself, so there the
  // variable stays 0: lifting the page again left a keyboard-sized gap (#142).
  document.addEventListener('DOMContentLoaded', () => {
    if (!isIOS()) return;
    try {
      const K = window.Capacitor.Plugins.Keyboard;
      if (!K) return;
      const setKb = (h) => document.documentElement.style.setProperty('--kb', Math.max(0, h || 0) + 'px');
      K.addListener('keyboardWillShow', (info) => setKb(info && info.keyboardHeight));
      K.addListener('keyboardWillHide', () => setKb(0));
    } catch { /* not on this platform */ }
  });

  // Android's on-screen keyboard follows the hardware: down while a physical
  // keyboard is attached (every editable field gets inputmode="none", which
  // keeps the caret and hardware typing but never summons the soft
  // keyboard), up as usual when there isn't one. Long-press ☰ flips it for
  // the moment; plugging a keyboard in or out goes back to following it.
  // iPadOS already hides its keyboard whenever a hardware one is attached,
  // so there the on-screen keyboard behaves normally unless toggled off.
  const EDITABLE = '[contenteditable], input, textarea';
  let hardwareKeyboard = false;
  let flipped = false; // long-press ☰ until the keyboard situation changes
  try { localStorage.removeItem('pocket-soft-keyboard'); } catch { /* the old always-off setting */ }
  const softKeyboardOn = () => isIOS() ? !flipped : (hardwareKeyboard === flipped);
  function applyKeyboardMode(root) {
    const soft = softKeyboardOn();
    const els = root.matches && root.matches(EDITABLE) ? [root] : [];
    (root.querySelectorAll ? [...els, ...root.querySelectorAll(EDITABLE)] : els).forEach((el) => {
      if (soft) el.removeAttribute('inputmode');
      else el.setAttribute('inputmode', 'none');
      // iOS would otherwise autocorrect, capitalise, underline and suggest
      // its way through a manuscript. The page is the writer's alone.
      if (isIOS()) {
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('spellcheck', 'false');
      }
    });
  }
  window.pocketSoftKeyboardOn = softKeyboardOn;
  window.pocketToggleSoftKeyboard = () => {
    if (isIOS()) return true; // iOS decides for itself: on screen when no keyboard is attached
    flipped = !flipped;
    applyKeyboardMode(document);
    const on = softKeyboardOn();
    // a field already focused takes the change on its next focus
    const el = document.activeElement;
    if (el && el.matches && el.matches(EDITABLE)) { el.blur(); if (on) setTimeout(() => el.focus(), 50); }
    if (typeof toast === 'function') toast(on ? 'On-screen keyboard on' : 'On-screen keyboard off — long-press ☰ to bring it back');
    return on;
  };
  // from MainActivity, when a keyboard is connected or disconnected
  window.pocketHardwareKeyboard = (attached) => {
    if (attached === hardwareKeyboard) return;
    hardwareKeyboard = !!attached;
    flipped = false;
    applyKeyboardMode(document);
    const el = document.activeElement;
    if (!hardwareKeyboard && el && el.matches && el.matches(EDITABLE)) { el.blur(); setTimeout(() => el.focus(), 50); }
  };
  if (!isIOS()) {
    try {
      const bars = window.Capacitor.registerPlugin('NeoBars');
      bars.keyboard().then((r) => window.pocketHardwareKeyboard(!!(r && r.hardware))).catch(() => {});
    } catch { /* older shell */ }
  }
  document.addEventListener('DOMContentLoaded', () => {
    applyKeyboardMode(document);
    new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes.forEach((n) => { if (n.nodeType === 1) applyKeyboardMode(n); });
        if (m.type === 'attributes' && m.target.nodeType === 1) applyKeyboardMode(m.target);
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
  });
  document.addEventListener('focusin', (e) => { if (e.target && e.target.matches && e.target.matches(EDITABLE)) applyKeyboardMode(e.target); }, true);

  // Android's back gesture / Esc lands here (see MainActivity). Returns true
  // when the page handled it, false to let Android background the app.
  window.pocketBack = () => {
    try {
      const nav = document.getElementById('nav-pane');
      if (nav && nav.classList.contains('open')) { nav.classList.remove('open'); return true; }
      const side = document.getElementById('side-pane');
      if (side && side.classList.contains('open')) { side.classList.remove('open'); return true; }
      const modal = document.querySelector('.modal-backdrop:not([hidden])');
      if (modal) { modal.hidden = true; return true; }
      const editor = document.getElementById('editor-view');
      if (editor && !editor.hidden && typeof backToShelf === 'function') { backToShelf(); return true; }
    } catch (err) { console.error(err); }
    return false;
  };
})();
