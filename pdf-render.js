'use strict';

const path = require('path');
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
let runtime;

async function loadRuntime() {
  if (!runtime) {
    runtime = (async () => {
      const canvas = require('@napi-rs/canvas');
      // PDF.js uses these geometry types even with a custom Node canvas factory.
      for (const name of ['DOMMatrix', 'Path2D', 'ImageData']) {
        if (!globalThis[name]) globalThis[name] = canvas[name];
      }
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      return { canvas, pdfjs };
    })();
    runtime.catch(() => { runtime = null; });
  }
  return runtime;
}
function validatePDF(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_INPUT_BYTES || buffer.length < 8 ||
      !/^%PDF-\d\.\d/.test(buffer.subarray(0, 8).toString('ascii'))) throw new Error('Invalid PDF figure (maximum 20 MB)');
}
async function renderPDF(buffer, options = {}) {
  validatePDF(buffer);
  const maxDimension = options.maxDimension == null ? MAX_DIMENSION : options.maxDimension;
  const maxBytes = options.maxBytes == null ? MAX_PREVIEW_BYTES : options.maxBytes;
  if (!Number.isInteger(maxDimension) || maxDimension < 1 || maxDimension > MAX_DIMENSION ||
      !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PREVIEW_BYTES) throw new Error('Invalid PDF preview limits');
  const { canvas, pdfjs } = await loadRuntime();
  function boundedCanvas(width, height) {
    width = Math.ceil(width); height = Math.ceil(height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 ||
        width > MAX_DIMENSION || height > MAX_DIMENSION) throw new Error('PDF canvas dimensions exceed safe limits');
    return canvas.createCanvas(width, height);
  }
  class CanvasFactory {
    create(width, height) {
      const result = boundedCanvas(width, height);
      return { canvas: result, context: result.getContext('2d') };
    }
    reset(target, width, height) {
      const result = this.create(width, height);
      target.canvas = result.canvas; target.context = result.context;
    }
    destroy(target) {
      if (target.canvas) { target.canvas.width = 1; target.canvas.height = 1; }
      target.canvas = null; target.context = null;
    }
  }
  const packageDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    CanvasFactory,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    stopAtErrors: true,
    disableAutoFetch: true,
    disableStream: true,
    standardFontDataUrl: path.join(packageDir, 'standard_fonts') + path.sep,
    cMapUrl: path.join(packageDir, 'cmaps') + path.sep,
    cMapPacked: true
  });
  let page, renderTask, output;
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      if (renderTask) renderTask.cancel();
      reject(new Error('PDF preview rendering timed out'));
    }, 30000);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const document = await loadingTask.promise;
      if (!Number.isInteger(document.numPages) || document.numPages < 1) throw new Error('PDF has no pages');
      page = await document.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) throw new Error('Invalid PDF page dimensions');
      const scale = Math.min(2, maxDimension / viewport.width, maxDimension / viewport.height);
      const scaled = page.getViewport({ scale });
      output = boundedCanvas(Math.max(1, Math.floor(scaled.width)), Math.max(1, Math.floor(scaled.height)));
      renderTask = page.render({
        canvasContext: output.getContext('2d'),
        viewport: scaled,
        annotationMode: pdfjs.AnnotationMode.DISABLE,
        background: 'rgb(255,255,255)'
      });
      await renderTask.promise;
      let preview = output.toBuffer('image/png');
      for (let attempt = 0; preview.length > maxBytes && attempt < 8; attempt++) {
        const smaller = boundedCanvas(Math.max(1, Math.floor(output.width * 0.75)), Math.max(1, Math.floor(output.height * 0.75)));
        smaller.getContext('2d').drawImage(output, 0, 0, smaller.width, smaller.height);
        output.width = 1; output.height = 1;
        output = smaller;
        preview = output.toBuffer('image/png');
      }
      if (preview.length > maxBytes) throw new Error('PDF preview remains too large after optimization');
      return { buffer: preview, width: output.width, height: output.height, pageCount: document.numPages, previewPage: 1 };
    })()]);
  } catch (error) {
    throw new Error(`Unable to render PDF first-page preview: ${error.message}`);
  } finally {
    clearTimeout(timeout);
    if (page) page.cleanup();
    if (output) { output.width = 1; output.height = 1; }
    await loadingTask.destroy();
  }
}
module.exports = { renderPDF, validatePDF };
