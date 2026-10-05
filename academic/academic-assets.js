'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };

function validateName(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' ||
      value.length > 200 || /[\\/\0-\x1f\x7f]/.test(value) || /[. ]$/.test(value) ||
      /[:*?"<>|]/.test(value)) throw new Error('Invalid academic asset path');
  return value;
}
function validateFilename(value) {
  validateName(value);
  if (!/^figure-[a-f0-9-]+\.(?:png|jpg|jpeg|svg|pdf)$/i.test(value)) throw new Error('Invalid academic figure filename');
  return value;
}
function assetPaths(libraryDir, bookId, filename) {
  validateName(bookId);
  const book = path.join(path.resolve(libraryDir), bookId);
  const figures = path.join(book, 'figures');
  return { book, figures, file: filename == null ? null : path.join(figures, validateFilename(filename)) };
}
function assertDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Academic asset directory must not be a symbolic link');
  return stat;
}
function checkPaths(paths, create) {
  assertDirectory(paths.book);
  if (create && !fs.existsSync(paths.figures)) fs.mkdirSync(paths.figures);
  assertDirectory(paths.figures);
}
function validateBibliography(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES || text.includes('\0')) throw new Error('Invalid bibliography payload');
  return text;
}

// A deliberately small static SVG subset. No CSS, URLs, entities, animation,
// references, or foreign content: imported SVG never runs in a BrowserWindow.
function sanitizeSVG(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_INPUT_BYTES) throw new Error('Invalid SVG payload');
  source = source.replace(/^\uFEFF/, '').replace(/^\s*<\?xml\s+[^?]*\?>/, '').trim();
  const tags = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc']);
  const attributes = new Set(['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'd', 'points', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'font-family', 'font-size',
    'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'dx', 'dy', 'rotate', 'version']);
  let position = 0;
  const stack = [];
  let rootSeen = false;
  for (const token of source.matchAll(/<[^>]*>|[^<]+/g)) {
    if (token.index !== position) throw new Error('Malformed SVG');
    position += token[0].length;
    const value = token[0];
    if (!value.startsWith('<')) {
      if (/[<>]/.test(value) || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value) ||
          (!stack.length && value.trim())) throw new Error('Unsafe SVG text');
      continue;
    }
    const closing = /^<\/([A-Za-z]+)\s*>$/.exec(value);
    if (closing) {
      if (stack.pop() !== closing[1]) throw new Error('Malformed SVG nesting');
      continue;
    }
    const open = /^<([A-Za-z]+)((?:\s+[\s\S]*?)?)\s*(\/?)>$/.exec(value);
    if (!open || !tags.has(open[1])) throw new Error('Unsupported or unsafe SVG element');
    if (!stack.length) {
      if (rootSeen || open[1] !== 'svg') throw new Error('Invalid SVG root');
      rootSeen = true;
    } else if (open[1] === 'svg') throw new Error('Nested SVG is unsupported');
    let remainder = open[2];
    const seen = new Set();
    while (remainder.trim()) {
      const attribute = /^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(remainder);
      if (!attribute) throw new Error('Malformed SVG attribute');
      const name = attribute[1], content = attribute[2] == null ? attribute[3] : attribute[2];
      if (!attributes.has(name) || seen.has(name) || /[<>&\\\0-\x1f]/.test(content) ||
          (name === 'xmlns' ? content !== 'http://www.w3.org/2000/svg' : /url\s*\(|(?:https?|data|file|javascript):/i.test(content))) {
        throw new Error('Unsupported or unsafe SVG attribute');
      }
      seen.add(name);
      remainder = remainder.slice(attribute[0].length);
    }
    if (!open[3]) stack.push(open[1]);
  }
  if (position !== source.length || stack.length || !rootSeen) throw new Error('Malformed SVG');
  return source;
}
function verifyBitmap(buffer, mime) {
  if (mime === 'image/png' && (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')) throw new Error('Invalid PNG');
  if (mime === 'image/jpeg' && (buffer.length < 4 || buffer[0] !== 255 || buffer[1] !== 216 || buffer[2] !== 255)) throw new Error('Invalid JPEG');
}
function optimizeBitmap(buffer, mime, nativeImage) {
  verifyBitmap(buffer, mime);
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') throw new Error('Bitmap preview is unavailable');
  let image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error('Unable to decode figure image');
  const size = image.getSize();
  if (!size.width || !size.height) throw new Error('Invalid image dimensions');
  const scale = Math.min(1, MAX_DIMENSION / size.width, MAX_DIMENSION / size.height);
  if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' });
  let result = mime === 'image/jpeg' ? image.toJPEG(85) : image.toPNG();
  for (let attempt = 0; result.length > MAX_IMAGE_BYTES && attempt < 8; attempt++) {
    const current = image.getSize();
    image = image.resize({ width: Math.max(1, Math.floor(current.width * 0.75)), height: Math.max(1, Math.floor(current.height * 0.75)), quality: 'best' });
    result = mime === 'image/jpeg' ? image.toJPEG(80) : image.toPNG();
  }
  if (result.length > MAX_IMAGE_BYTES) throw new Error('Figure remains too large after optimization');
  return { buffer: result, ...image.getSize() };
}
async function importPDF(paths, buffer, originalName, renderer) {
  require('../pdf-render.js').validatePDF(buffer);
  const preview = await renderer(buffer, { maxDimension: MAX_DIMENSION, maxBytes: MAX_IMAGE_BYTES });
  if (!preview || !Buffer.isBuffer(preview.buffer) || preview.buffer.length > MAX_IMAGE_BYTES ||
      !Number.isInteger(preview.width) || !Number.isInteger(preview.height) || preview.width < 1 || preview.height < 1 ||
      preview.width > MAX_DIMENSION || preview.height > MAX_DIMENSION ||
      !Number.isInteger(preview.pageCount) || preview.pageCount < 1) throw new Error('Invalid PDF raster preview');
  verifyBitmap(preview.buffer, 'image/png');
  const token = crypto.randomUUID(), file = `figure-${token}.png`, originalFile = `figure-${token}.pdf`;
  checkPaths(paths, true);
  const originalPath = path.join(paths.figures, originalFile), previewPath = path.join(paths.figures, file);
  let originalWritten = false, previewWritten = false;
  try {
    fs.writeFileSync(originalPath, buffer, { flag: 'wx' }); originalWritten = true;
    fs.writeFileSync(previewPath, preview.buffer, { flag: 'wx' }); previewWritten = true;
  } catch (error) {
    if (originalWritten) fs.unlinkSync(originalPath);
    if (previewWritten) fs.unlinkSync(previewPath);
    throw error;
  }
  return { file, originalFile, originalName, mime: 'image/png', originalMime: 'application/pdf',
    dataUrl: `data:image/png;base64,${preview.buffer.toString('base64')}`, bytes: preview.buffer.length,
    originalBytes: buffer.length, width: preview.width, height: preview.height, previewPage: 1, pageCount: preview.pageCount };
}
function importFigure(libraryDir, bookId, sourcePath, nativeImage, pdfRenderer) {
  const paths = assetPaths(libraryDir, bookId);
  assertDirectory(paths.book);
  if (typeof sourcePath !== 'string' || sourcePath.includes('\0')) throw new Error('Invalid source path');
  const extension = path.extname(sourcePath).toLowerCase(), mime = MIME[extension];
  if (!mime) throw new Error('Unsupported figure format');
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('Figure file is too large or invalid');
  let buffer = fs.readFileSync(sourcePath);
  if (buffer.length > MAX_INPUT_BYTES) throw new Error('Figure file is too large');
  if (mime === 'application/pdf') return importPDF(paths, buffer, path.basename(sourcePath),
    pdfRenderer || require('../pdf-render.js').renderPDF);
  let dimensions = {};
  if (mime === 'image/svg+xml') buffer = Buffer.from(sanitizeSVG(buffer.toString('utf8')), 'utf8');
  else {
    const optimized = optimizeBitmap(buffer, mime, nativeImage);
    buffer = optimized.buffer;
    dimensions = { width: optimized.width, height: optimized.height };
  }
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Figure preview is too large');
  const filename = `figure-${crypto.randomUUID()}${extension === '.jpeg' ? '.jpg' : extension}`;
  checkPaths(paths, true);
  fs.writeFileSync(path.join(paths.figures, filename), buffer, { flag: 'wx' });
  return { file: filename, mime, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    originalName: path.basename(sourcePath), bytes: buffer.length, ...dimensions };
}
function readFigure(libraryDir, bookId, filename) {
  const paths = assetPaths(libraryDir, bookId, filename);
  checkPaths(paths, false);
  const stat = fs.lstatSync(paths.file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_IMAGE_BYTES) throw new Error('Invalid academic figure file');
  const mime = MIME[path.extname(filename).toLowerCase()];
  if (mime === 'application/pdf') throw new Error('PDF preview unavailable');
  let buffer = fs.readFileSync(paths.file);
  if (mime === 'image/svg+xml') buffer = Buffer.from(sanitizeSVG(buffer.toString('utf8')));
  else verifyBitmap(buffer, mime);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}
function directorySnapshot(paths) {
  return { book: assertDirectory(paths.book), figures: assertDirectory(paths.figures) };
}
function checkSnapshot(paths, snapshot) {
  const current = directorySnapshot(paths);
  for (const key of ['book', 'figures']) {
    if (current[key].dev !== snapshot[key].dev || current[key].ino !== snapshot[key].ino) {
      throw new Error('Academic figure directory changed during copying');
    }
  }
}
function readCopySource(paths, filename, maxBytes) {
  const file = path.join(paths.figures, validateFilename(filename));
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error('Invalid academic figure source file');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > maxBytes) throw new Error('Academic figure source changed during copying');
    const buffer = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor), named = fs.lstatSync(file);
    if (buffer.length > maxBytes || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs ||
        opened.ctimeMs !== after.ctimeMs || named.isSymbolicLink() || named.dev !== after.dev || named.ino !== after.ino) {
      throw new Error('Academic figure source changed during copying');
    }
    return buffer;
  } finally { fs.closeSync(descriptor); }
}
function bitmapDimensions(buffer, mime) {
  verifyBitmap(buffer, mime);
  let width, height;
  if (mime === 'image/png') {
    if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid PNG header');
    width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20);
  } else {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset++] !== 255) throw new Error('Invalid JPEG marker');
      while (buffer[offset] === 255) offset++;
      const marker = buffer[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > buffer.length) throw new Error('Invalid JPEG header');
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) throw new Error('Invalid JPEG segment');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw new Error('Invalid JPEG dimensions');
        height = buffer.readUInt16BE(offset + 3); width = buffer.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) throw new Error('Academic figure dimensions exceed safe limits');
  return { width, height };
}
function copyFigure(libraryDir, sourceBookId, targetBookId, figure) {
  const model = require('./academic-objects.js').normalizeFigure({
    ...figure, bytes: undefined, originalBytes: undefined, width: undefined, height: undefined
  });
  const source = assetPaths(libraryDir, sourceBookId, model.file);
  const target = assetPaths(libraryDir, targetBookId);
  assertDirectory(target.book);
  const sourceSnapshot = directorySnapshot(source);
  const targetBookSnapshot = assertDirectory(target.book);
  const mime = MIME[path.extname(model.file).toLowerCase()];
  if (mime === 'application/pdf') throw new Error('PDF figures must reference their PNG preview');
  let buffer = readCopySource(source, model.file, MAX_IMAGE_BYTES), dimensions = {};
  if (mime === 'image/svg+xml') buffer = Buffer.from(sanitizeSVG(buffer.toString('utf8')));
  else dimensions = bitmapDimensions(buffer, mime);
  let original;
  if (model.originalFile) {
    validateFilename(model.originalFile);
    if (path.extname(model.originalFile).toLowerCase() !== '.pdf' || mime !== 'image/png') throw new Error('Invalid original PDF figure file');
    original = readCopySource(source, model.originalFile, MAX_INPUT_BYTES);
    require('../pdf-render.js').validatePDF(original);
  }
  checkSnapshot(source, sourceSnapshot);
  const currentTarget = assertDirectory(target.book);
  if (targetBookSnapshot.dev !== currentTarget.dev || targetBookSnapshot.ino !== currentTarget.ino) throw new Error('Academic figure destination changed during copying');
  const result = { ...model, mime, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, bytes: buffer.length, ...dimensions };
  if (original) {
    result.originalMime = 'application/pdf'; result.originalBytes = original.length; result.previewPage = 1;
    if (Number.isInteger(figure.pageCount) && figure.pageCount > 0) result.pageCount = figure.pageCount;
  }
  if (typeof figure.originalName === 'string') result.originalName = path.basename(figure.originalName);
  if (sourceBookId === targetBookId) return result;
  checkPaths(target, true);
  const destinationSnapshot = directorySnapshot(target);
  const token = crypto.randomUUID();
  result.file = `figure-${token}${path.extname(model.file).toLowerCase()}`;
  if (original) result.originalFile = `figure-${token}.pdf`;
  const written = [];
  try {
    for (const [filename, content] of [[result.file, buffer], ...(original ? [[result.originalFile, original]] : [])]) {
      checkSnapshot(target, destinationSnapshot);
      const destination = path.join(target.figures, filename);
      const descriptor = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      written.push(destination);
      try { fs.writeFileSync(descriptor, content); } finally { fs.closeSync(descriptor); }
      checkSnapshot(target, destinationSnapshot);
    }
  } catch (error) {
    for (const file of written) {
      try { checkSnapshot(target, destinationSnapshot); fs.unlinkSync(file); } catch { /* a changed directory must not be followed during cleanup */ }
    }
    throw error;
  }
  return result;
}
function writeBibliography(libraryDir, bookId, text) {
  validateBibliography(text);
  const paths = assetPaths(libraryDir, bookId);
  assertDirectory(paths.book);
  const filename = path.join(paths.book, 'bibliography.bib');
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Bibliography must be a regular file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Rename a new file rather than truncating an existing hard link or following
  // a destination swapped to a symlink between validation and writing.
  const pending = path.join(paths.book, `.bibliography-${crypto.randomUUID()}.bib`);
  try {
    fs.writeFileSync(pending, text, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(pending, filename);
  } finally {
    if (fs.existsSync(pending)) fs.unlinkSync(pending);
  }
  return { file: 'bibliography.bib', bytes: Buffer.byteLength(text, 'utf8') };
}
module.exports = { MAX_INPUT_BYTES, MAX_IMAGE_BYTES, MAX_DIMENSION, validateName, validateFilename, assetPaths,
  validateBibliography, sanitizeSVG, optimizeBitmap, importFigure, readFigure, copyFigure, writeBibliography };
