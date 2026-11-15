// Small DOM helpers: element builder, toasts, dialogs, file in/out.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'data') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export const clear = (el) => { el.replaceChildren(); return el; };
// Like el.append, but skips false / null so `cond && node` works.
export const add = (el, ...kids) => { el.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false)); return el; };

const ICONS = {
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  colors: '<path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/>',
  keys: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>',
  macros: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  device: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  prefs: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="14" cy="18" r="2"/>',
  usb: '<path d="M12 21V7M12 7l-3 3M12 7l3 3M8 14v-2h0M8 14a2 2 0 1 0 0 .01M16 12h0v3l-4 2"/><circle cx="12" cy="4" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
};
export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return span;
}

let toastHost;
export function toast(message, type = 'info', ms = type === 'error' ? 6000 : 2600) {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast ${type}`, text: message });
  toastHost.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, ms);
}

function dialog({ title, body, actions }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' });
    const done = (value) => { dlg.close(); dlg.remove(); resolve(value); };
    dlg.append(
      h('h3', { text: title }),
      typeof body === 'string' ? h('p', { text: body }) : body,
      h('div', { class: 'dialog-actions' }, actions(done)),
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmDialog({ title, body, confirm = 'Confirm', danger = false }) {
  return dialog({
    title, body,
    actions: (done) => [
      h('button', { class: 'btn', text: 'Cancel', onclick: () => done(false) }),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: confirm, onclick: () => done(true), autofocus: true }),
    ],
  }).then(Boolean);
}

export function promptDialog({ title, label, value = '', confirm = 'Save', maxLength = 40 }) {
  const input = h('input', { class: 'input', type: 'text', value, maxLength });
  return dialog({
    title,
    body: h('label', { class: 'field' }, h('span', { text: label }), input),
    actions: (done) => {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim() || null); });
      setTimeout(() => { input.focus(); input.select(); });
      return [
        h('button', { class: 'btn', text: 'Cancel', onclick: () => done(null) }),
        h('button', { class: 'btn primary', text: confirm, onclick: () => done(input.value.trim() || null) }),
      ];
    },
  });
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', async () => resolve(input.files[0] ? await input.files[0].text() : null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

// Shared building blocks -------------------------------------------------
export function card(title, subtitle, ...body) {
  return h('section', { class: 'card' },
    (title || subtitle) && h('header', { class: 'card-head' },
      h('div', null, title && h('h2', { text: title }), subtitle && h('p', { class: 'muted', text: subtitle }))),
    ...body);
}

export function segmented(options, value, onChange) {
  const el = h('div', { class: 'segmented', role: 'radiogroup' });
  const set = (v) => {
    for (const b of el.children) b.classList.toggle('on', b.dataset.value === String(v));
  };
  for (const o of options) {
    el.append(h('button', {
      type: 'button', text: o.label, title: o.title, data: { value: String(o.value) },
      onclick: () => { set(o.value); onChange(o.value); },
    }));
  }
  set(value);
  el.set = set;
  return el;
}

export function toggle(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  const el = h('label', { class: 'switch' }, input, h('span', { class: 'track' }), label && h('span', { text: label }));
  el.input = input;
  return el;
}

export const hexToRgb = (hexStr) => {
  const n = parseInt(hexStr.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
