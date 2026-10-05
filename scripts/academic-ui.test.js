'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test: nodeTest, afterEach } = require('node:test');
const { parseHTML } = require('linkedom');
const ui = require('../academic/academic-ui.js');

const harnesses = new Set();

function test(name, callback) {
  nodeTest(name, { timeout: 5000 }, callback);
}

afterEach(() => {
  for (const harness of harnesses) {
    for (const backdrop of harness.document.querySelectorAll('.academic-dialog')) {
      const event = new harness.window.Event('keydown', { bubbles: true });
      event.key = 'Escape';
      backdrop.dispatchEvent(event);
    }
  }
  harnesses.clear();
});

function makeHarness() {
  const { document, window } = parseHTML('<html><body><button id="before">Before</button></body></html>');
  let activeElement = document.getElementById('before');
  Object.defineProperty(document, 'activeElement', {
    configurable: true,
    get: () => activeElement
  });
  const createElement = document.createElement.bind(document);
  document.createElement = (tagName, options) => {
    const element = createElement(tagName, options);
    element.focus = () => { activeElement = element; };
    return element;
  };
  document.body.focus = () => { activeElement = document.body; };
  activeElement.focus = () => { activeElement = document.getElementById('before'); };
  const reports = [];
  let book = { id: 'book-1' };
  const api = ui.create({
    document,
    getBook: () => book,
    translate: (key, vars) => vars
      ? key.replace(/\{(\w+)\}/g, (_, name) => vars[name])
      : key,
    report: (error) => reports.push(error),
    uniqueId: (prefix) => `${prefix}-test`
  });
  const harness = {
    api,
    document,
    window,
    reports,
    get book() { return book; },
    set book(value) { book = value; }
  };
  harnesses.add(harness);
  return harness;
}

function openDialog(harness, ...args) {
  const promise = harness.api.dialog(...args);
  promise.catch(() => {});
  return promise;
}

function submit(form) {
  const event = new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event;
}

test('UMD build exports NeoAcademicUI without requiring a browser document at load time', () => {
  const context = vm.createContext({});
  const source = fs.readFileSync(path.join(__dirname, '..', 'academic/academic-ui.js'), 'utf8');
  vm.runInContext(source, context);
  assert.equal(typeof context.NeoAcademicUI.create, 'function');
  assert.equal(typeof ui.create, 'function');
});

test('dialog builds translated fields, preserves values and enhances before display', async () => {
  const harness = makeHarness();
  let enhanced = false;
  const promise = openDialog(harness, 'Add item', [
    { key: 'name', label: 'Name', required: true, value: 'Ada' },
    { key: 'enabled', label: 'Enabled', type: 'checkbox', value: true },
    {
      key: 'tags',
      label: 'Tags',
      options: [{ value: 'one', label: 'First' }, { value: 'two', label: 'Second' }],
      multiple: true
    }
  ], {
    submit: 'Apply',
    enhance(form, controls) {
      enhanced = true;
      assert.equal(form.getAttribute('role'), 'dialog');
      assert.equal(controls.get('name').input.dataset.field, 'name');
    }
  });
  assert.equal(enhanced, true);
  const form = harness.document.querySelector('.academic-dialog form');
  assert.equal(form.getAttribute('aria-modal'), 'true');
  assert.equal(form.querySelector('h2').textContent, 'Add item');
  assert.equal(form.getAttribute('aria-labelledby'), 'academic-dialog-test');
  assert.equal(form.querySelector('[data-field="name"]').value, 'Ada');
  assert.equal(form.querySelector('[data-field="enabled"]').checked, true);
  assert.equal(form.querySelector('.btn-gold').textContent, 'Apply');
  const select = form.querySelector('[data-field="tags"]');
  select.options[1].selected = true;
  submit(form);
  assert.deepEqual(await promise, { name: 'Ada', enabled: true, tags: ['two'] });
  assert.equal(harness.document.querySelector('.academic-dialog'), null);
});

test('dialog surfaces required and custom validation errors without closing', async () => {
  const harness = makeHarness();
  const promise = openDialog(harness, 'Validate', [
    { key: 'name', label: 'Name', required: true }
  ], {
    validate(values) {
      if (values.name !== 'accepted') throw new Error('Name was rejected');
    }
  });
  const form = harness.document.querySelector('.academic-dialog form');
  submit(form);
  assert.equal(form.querySelector('[role="alert"]').textContent, 'Please complete the required fields.');
  assert.ok(harness.document.querySelector('.academic-dialog'));
  form.querySelector('[data-field="name"]').value = 'other';
  submit(form);
  assert.equal(form.querySelector('[role="alert"]').textContent, 'Name was rejected');
  form.querySelector('[data-field="name"]').value = 'accepted';
  submit(form);
  assert.deepEqual(await promise, { name: 'accepted' });
});

test('cancel, Escape and Tab focus management close and restore focus', async () => {
  const harness = makeHarness();
  const before = harness.document.getElementById('before');
  const cancelled = openDialog(harness, 'Cancel', [{ key: 'value', label: 'Value' }]);
  const form = harness.document.querySelector('.academic-dialog form');
  const cancel = Array.from(form.querySelectorAll('button')).find((button) => button.textContent === 'Cancel');
  const keyEvent = new harness.window.Event('keydown', { bubbles: true, cancelable: true });
  keyEvent.key = 'Tab';
  harness.document.querySelector('.academic-dialog').dispatchEvent(keyEvent);
  assert.equal(keyEvent.defaultPrevented, true);
  assert.equal(harness.document.activeElement, form.querySelectorAll('button')[0]);
  form.querySelector('input').focus();
  const backwards = new harness.window.Event('keydown', { bubbles: true, cancelable: true });
  backwards.key = 'Tab';
  backwards.shiftKey = true;
  harness.document.querySelector('.academic-dialog').dispatchEvent(backwards);
  assert.equal(harness.document.activeElement, form.querySelectorAll('button')[1]);
  const forwards = new harness.window.Event('keydown', { bubbles: true, cancelable: true });
  forwards.key = 'Tab';
  harness.document.querySelector('.academic-dialog').dispatchEvent(forwards);
  assert.equal(harness.document.activeElement, form.querySelector('input'));
  cancel.dispatchEvent(new harness.window.Event('click', { bubbles: true }));
  assert.equal(await cancelled, null);
  assert.equal(harness.document.activeElement, before);

  const escaped = openDialog(harness, 'Escape', [{ key: 'value', label: 'Value' }]);
  const backdrop = harness.document.querySelector('.academic-dialog');
  const escapeEvent = new harness.window.Event('keydown', { bubbles: true, cancelable: true });
  escapeEvent.key = 'Escape';
  backdrop.dispatchEvent(escapeEvent);
  assert.equal(escapeEvent.defaultPrevented, false);
  assert.equal(await escaped, null);
});

test('dialog rejects if its owning book changes before it closes', async () => {
  const harness = makeHarness();
  const promise = openDialog(harness, 'Change book', []);
  harness.book = { id: 'book-2' };
  const backdrop = harness.document.querySelector('.academic-dialog');
  const event = new harness.window.Event('keydown', { bubbles: true });
  event.key = 'Escape';
  backdrop.dispatchEvent(event);
  await assert.rejects(promise, /open book changed/i);
});

test('action reports and rejects both synchronous and asynchronous failures', async () => {
  const harness = makeHarness();
  const failure = new Error('operation failed');
  await assert.rejects(harness.api.action(() => { throw failure; })(), failure);
  assert.deepEqual(harness.reports, [failure]);

  const asyncFailure = new Error('async failure');
  await assert.rejects(harness.api.action(() => Promise.reject(asyncFailure))(), asyncFailure);
  assert.deepEqual(harness.reports, [failure, asyncFailure]);
});

test('eventAction and button consume only already-reported event-handler failures', async () => {
  const harness = makeHarness();
  const eventFailure = new Error('event action failed');
  const handler = harness.api.eventAction(() => Promise.reject(eventFailure));
  assert.equal(handler(), undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.reports, [eventFailure]);

  const buttonFailure = new Error('button action failed');
  const button = harness.api.button('Run', () => Promise.reject(buttonFailure));
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.on('unhandledRejection', onUnhandled);
  try {
    assert.equal(button.textContent, 'Run');
    button.dispatchEvent(new harness.window.Event('click', { bubbles: true }));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.equal(unhandled, false);
  assert.deepEqual(harness.reports, [eventFailure, buttonFailure]);
});
