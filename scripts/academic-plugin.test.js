const pluginFactory = require('../academic/academic-plugin.js');

function createEnv() {
  const book = { id: 'b1', metadata: { academicMode: false, theme: 'latex-plain' } };
  const document = {
    body: { classList: { toggle: () => {} }, dataset: {} },
    addEventListener: () => {}
  };
  const getBook = () => book;
  const translate = (k) => k;
  const report = () => {};
  const model = {
    read: (b) => ({ ...b.metadata, academicMode: b.metadata.academicMode })
  };
  const i18n = {};
  const neo = {
    academicState: () => {},
    logError: () => {}
  };
  const plugin = pluginFactory.createPlugin({
    document,
    getBook,
    translate,
    report,
    model,
    i18n,
    neo
  });
  return { plugin, book };
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

test('plugin.create returns interface', () => {
  const { plugin } = createEnv();
  if (!plugin.init) throw new Error('missing init');
  if (!plugin.toggleMode) throw new Error('missing toggleMode');
  if (!plugin.setMode) throw new Error('missing setMode');
  if (!plugin.getMetadata) throw new Error('missing getMetadata');
  if (!plugin.updateMetadata) throw new Error('missing updateMetadata');
});

test('toggleMode flips academicMode', () => {
  const { plugin, book } = createEnv();
  const first = plugin.toggleMode();
  if (first !== true) throw new Error('expected true');
  if (book.metadata.academicMode !== true) throw new Error('book not updated');
  const second = plugin.toggleMode();
  if (second !== false) throw new Error('expected false');
});

test('setMode updates book', () => {
  const { plugin, book } = createEnv();
  plugin.setMode(true);
  if (book.metadata.academicMode !== true) throw new Error('not set');
  plugin.setMode(false);
  if (book.metadata.academicMode !== false) throw new Error('not cleared');
});

test('updateMetadata merges changes', () => {
  const { plugin, book } = createEnv();
  plugin.updateMetadata({ theme: 'nature', paperType: 'article' });
  if (book.metadata.theme !== 'nature') throw new Error('theme not updated');
  if (book.metadata.paperType !== 'article') throw new Error('paperType not updated');
});

test('isAcademicBook detects academic metadata', () => {
  const { plugin } = createEnv();
  const book = { metadata: { theme: 'latex-plain' } };
  if (!plugin.isAcademicBook(book)) throw new Error('should be academic');
  if (plugin.isAcademicBook({})) throw new Error('should not be academic');
});

console.log('All plugin tests passed');
