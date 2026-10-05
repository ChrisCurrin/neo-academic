(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoAcademicUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(dependencies) {
    const { document, getBook, translate, report } = dependencies || {};
    if (!document || typeof document.createElement !== 'function' || !document.body) {
      throw new TypeError('NeoAcademicUI.create requires a document with a body.');
    }
    if (typeof getBook !== 'function') throw new TypeError('NeoAcademicUI.create requires getBook().');
    if (typeof translate !== 'function') throw new TypeError('NeoAcademicUI.create requires translate().');
    if (typeof report !== 'function') throw new TypeError('NeoAcademicUI.create requires report().');

    let idSequence = 0;
    const uniqueId = typeof dependencies.uniqueId === 'function'
      ? dependencies.uniqueId
      : (prefix) => {
        const crypto = document.defaultView && document.defaultView.crypto;
        const suffix = crypto && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${(++idSequence).toString(36)}`;
        return `${prefix}-${suffix}`;
      };
    const tr = (key, vars) => String(translate(key, vars));

    function action(work) {
      if (typeof work !== 'function') throw new TypeError('action(work) requires a function.');
      return (...args) => Promise.resolve()
        .then(() => work(...args))
        .catch((error) => {
          try {
            report(error);
          } catch (_) {
            // Preserve the original failure if reporting itself also fails.
          }
          throw error;
        });
    }

    function eventAction(work) {
      const run = action(work);
      return (...args) => {
        // action has reported this failure; DOM handlers have no promise consumer.
        run(...args).catch(() => {});
      };
    }

    function button(label, work) {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = tr(label);
      const run = eventAction(work);
      element.addEventListener('click', run);
      return element;
    }

    function readValues(controls) {
      const values = {};
      controls.forEach(({ field, input }, key) => {
        if (field.multiple) {
          const selectedOptions = input.selectedOptions || Array.from(input.options).filter((option) => option.selected);
          values[key] = Array.from(selectedOptions, (option) => option.value);
        } else if (field.type === 'checkbox') {
          values[key] = input.checked;
        } else {
          values[key] = input.value;
        }
      });
      return values;
    }

    function validateRequired(controls, values) {
      controls.forEach(({ field }, key) => {
        if (!field.required) return;
        const value = values[key];
        const missing = Array.isArray(value)
          ? value.length === 0
          : field.type === 'checkbox'
            ? !value
            : String(value).trim() === '';
        if (missing) throw new Error(tr('Please complete the required fields.'));
      });
    }

    function dialog(title, fields, options = {}) {
      if (!Array.isArray(fields)) throw new TypeError('dialog fields must be an array.');
      if (!options || typeof options !== 'object') throw new TypeError('dialog options must be an object.');
      if (options.validate != null && typeof options.validate !== 'function') {
        throw new TypeError('dialog options.validate must be a function.');
      }
      if (options.enhance != null && typeof options.enhance !== 'function') {
        throw new TypeError('dialog options.enhance must be a function.');
      }

      const owner = getBook();
      return new Promise((resolve, reject) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop academic-dialog';
        const form = document.createElement('form');
        form.className = 'modal';
        form.setAttribute('role', 'dialog');
        form.setAttribute('aria-modal', 'true');
        const heading = document.createElement('h2');
        heading.id = uniqueId('academic-dialog');
        heading.textContent = tr(title);
        form.setAttribute('aria-labelledby', heading.id);
        form.appendChild(heading);

        const controls = new Map();
        fields.forEach((field) => {
          if (!field || typeof field !== 'object' || !field.key || !field.label) {
            throw new TypeError('Each dialog field requires a key and label.');
          }
          if (controls.has(field.key)) throw new TypeError(`Duplicate dialog field key: ${field.key}`);
          if (field.options != null && !Array.isArray(field.options)) {
            throw new TypeError(`Dialog field "${field.key}" options must be an array.`);
          }

          const label = document.createElement('label');
          label.textContent = tr(field.label);
          const input = document.createElement(
            field.type === 'textarea' ? 'textarea' : field.options ? 'select' : 'input'
          );
          if (field.options) {
            field.options.forEach((option) => {
              const item = document.createElement('option');
              item.value = option.value;
              item.textContent = tr(option.label);
              input.appendChild(item);
            });
            if (field.multiple) {
              input.multiple = true;
              input.size = Math.min(8, field.options.length);
            }
          } else if (field.type !== 'textarea') {
            input.type = field.type || 'text';
          }
          if (field.type === 'textarea') input.rows = field.rows || 5;
          if (field.required) input.required = true;
          if (field.min != null) input.min = String(field.min);
          if (field.max != null) input.max = String(field.max);
          if (field.type === 'checkbox') input.checked = !!field.value;
          else if (field.options) {
            const requested = field.multiple
              ? new Set((Array.isArray(field.value) ? field.value : []).map(String))
              : new Set([String(field.value == null ? field.options[0] && field.options[0].value || '' : field.value)]);
            Array.from(input.options).forEach((option) => {
              option.selected = requested.has(option.value);
            });
          } else {
            input.value = field.value == null ? '' : String(field.value);
          }
          input.dataset.field = field.key;
          label.appendChild(input);
          form.appendChild(label);
          controls.set(field.key, { field, input });
        });

        const error = document.createElement('p');
        error.className = 'academic-form-error';
        error.setAttribute('role', 'alert');
        form.appendChild(error);
        if (options.enhance) options.enhance(form, controls);

        const buttons = document.createElement('div');
        buttons.className = 'academic-dialog-actions';
        const cancel = button('Cancel', () => finish(null));
        const save = document.createElement('button');
        save.type = 'submit';
        save.className = 'btn-gold';
        save.textContent = tr(options.submit || 'Save');
        buttons.append(cancel, save);
        form.appendChild(buttons);
        backdrop.appendChild(form);

        const previousFocus = document.activeElement;
        let finished = false;
        function finish(value) {
          if (finished) return;
          finished = true;
          backdrop.remove();
          if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
            previousFocus.focus({ preventScroll: true });
          }
          if (owner !== getBook()) {
            reject(new Error(tr('The open book changed. Try the action again.')));
            return;
          }
          resolve(value);
        }

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          error.textContent = '';
          const values = readValues(controls);
          try {
            validateRequired(controls, values);
            if (options.validate) options.validate(values);
            finish(values);
          } catch (validationError) {
            error.textContent = String(validationError && validationError.message || validationError);
          }
        });
        form.addEventListener('input', () => { error.textContent = ''; });
        form.addEventListener('change', () => { error.textContent = ''; });
        backdrop.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            finish(null);
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = Array.from(form.querySelectorAll('input, textarea, select, button'))
            .filter((element) => !element.disabled);
          if (!focusable.length) return;
          const index = focusable.indexOf(document.activeElement);
          event.preventDefault();
          const next = index < 0
            ? (event.shiftKey ? focusable.length - 1 : 0)
            : (index + (event.shiftKey ? focusable.length - 1 : 1)) % focusable.length;
          focusable[next].focus();
        });

        document.body.appendChild(backdrop);
        const first = form.querySelector('input, textarea, select');
        (first || cancel).focus();
      });
    }

    return { dialog, button, action, eventAction };
  }

  return { create };
});
