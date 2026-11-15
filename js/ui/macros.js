// Macros page: edit the keyboard's on-board macro bank (10 KB, wired only).
import { bankSize, DELAY_MAX, NAME_MAX } from '../hid/macro.js';
import { MACRO_MAX, USAGE_NAMES, usageFromCode, usageName } from '../hid/protocol.js';
import { add, card, clear, confirmDialog, h, icon, toggle } from './dom.js';

const USAGES = Object.keys(USAGE_NAMES).map(Number).sort((a, b) => a - b);
const clone = (macros) => macros.map((m) => ({ name: m.name, steps: m.steps.map((s) => ({ ...s })) }));

export default {
  id: 'macros',
  title: 'Macros',
  icon: 'macros',
  macros: null, // working copy
  saved: '[]',
  sel: 0,
  recording: false,
  realTiming: true,

  mount(root, app) {
    this.app = app;
    this.banner = h('div', { class: 'banner' });
    this.list = h('div', { class: 'macro-list' });
    this.editor = h('div', { class: 'macro-editor' });
    this.meter = h('div', { class: 'meter' }, h('div', { class: 'meter-fill' }));
    this.usage = h('span', { class: 'muted small' });
    this.saveBtn = h('button', { class: 'btn primary', text: 'Save to keyboard', onclick: () => this.save() });
    this.discardBtn = h('button', { class: 'btn', text: 'Discard changes', onclick: () => { this.macros = JSON.parse(this.saved); this.render(); } });
    root.append(
      this.banner,
      h('div', { class: 'macro-layout' },
        card('Macros', 'Stored on the keyboard itself.', this.list,
          h('button', { class: 'btn', onclick: () => this.add() }, icon('plus', 16), 'New macro')),
        card(null, null, this.editor)),
      card(null, null, h('div', { class: 'row between' },
        h('div', { class: 'grow' }, this.meter, this.usage),
        h('div', { class: 'row' }, this.discardBtn, this.saveBtn))),
    );
    window.addEventListener('keydown', (e) => this.capture(e), true);
    window.addEventListener('keyup', (e) => this.capture(e), true);
  },

  async show(app) {
    this.banner.hidden = app.kb.wired;
    this.banner.textContent = 'Connected over 2.4G: macros can only be read and written over the USB cable.';
    if (!app.kb.wired) { this.macros = null; this.render(); return; }
    if (!this.macros || app.cache.macros === null) {
      const macros = await app.run(() => app.kb.readMacros());
      if (!macros) return;
      app.cache.macros = macros;
      this.macros = clone(macros);
      this.saved = JSON.stringify(this.macros);
      this.sel = 0;
    }
    this.render();
  },

  dirty() { return this.macros && JSON.stringify(this.macros) !== this.saved; },

  render() {
    clear(this.list);
    clear(this.editor);
    const ms = this.macros;
    if (!ms) { this.editor.append(h('p', { class: 'muted', text: 'Plug in the USB cable to edit macros.' })); this.footer(); return; }
    if (!ms.length) this.list.append(h('p', { class: 'muted small', text: 'No macros yet.' }));
    ms.forEach((m, i) => this.list.append(h('button', {
      type: 'button', class: `macro-item ${i === this.sel ? 'on' : ''}`, onclick: () => { this.stopRecording(); this.sel = i; this.render(); },
    }, h('span', { class: 'macro-no', text: String(i + 1) }), h('span', { class: 'grow', text: m.name || 'Untitled' }),
    h('small', { class: 'muted', text: `${m.steps.length} step${m.steps.length === 1 ? '' : 's'}` }))));

    const m = ms[this.sel];
    if (!m) {
      this.editor.append(h('p', { class: 'muted', text: 'Create a macro, then bind it to a key on the Keys page.' }));
      this.footer();
      return;
    }
    const name = h('input', {
      class: 'input', type: 'text', value: m.name, maxLength: NAME_MAX, placeholder: 'Macro name',
      oninput: () => { m.name = name.value; this.footer(); },
      onchange: () => this.render(),
    });
    const keyPick = h('select', { class: 'input' }, USAGES.map((u) => h('option', { value: u, text: usageName(u) })));
    const steps = h('div', { class: 'steps' });
    if (!m.steps.length) steps.append(h('p', { class: 'muted small', text: 'No steps. Record some, or add key taps below.' }));
    m.steps.forEach((s, i) => {
      const delay = h('input', {
        class: 'input num', type: 'number', min: 0, max: DELAY_MAX, value: s.delay,
        onchange: () => { s.delay = Math.max(0, Math.min(DELAY_MAX, Number(delay.value) || 0)); this.footer(); },
      });
      const key = h('select', { class: 'input', onchange: () => { s.usage = Number(key.value); this.footer(); } },
        USAGES.map((u) => h('option', { value: u, text: usageName(u), selected: u === s.usage })));
      if (!USAGE_NAMES[s.usage]) key.append(h('option', { value: s.usage, text: usageName(s.usage), selected: true }));
      steps.append(h('div', { class: 'step' },
        h('span', { class: 'step-no muted', text: String(i + 1) }),
        h('button', {
          type: 'button', class: `btn small dir ${s.press ? 'down' : 'up'}`, text: s.press ? '↓ Press' : '↑ Release',
          onclick: () => { s.press = !s.press; this.render(); },
        }),
        key,
        h('label', { class: 'step-delay' }, delay, h('span', { class: 'muted small', text: 'ms' })),
        h('button', { type: 'button', class: 'btn icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [m.steps[i - 1], m.steps[i]] = [m.steps[i], m.steps[i - 1]]; this.render(); } }, icon('up', 15)),
        h('button', { type: 'button', class: 'btn icon-btn', 'aria-label': 'Move down', disabled: i === m.steps.length - 1, onclick: () => { [m.steps[i + 1], m.steps[i]] = [m.steps[i], m.steps[i + 1]]; this.render(); } }, icon('down', 15)),
        h('button', { type: 'button', class: 'btn icon-btn', 'aria-label': 'Remove step', onclick: () => { m.steps.splice(i, 1); this.render(); } }, icon('close', 15))));
    });

    add(this.editor,
      h('div', { class: 'row between' },
        h('label', { class: 'field grow' }, h('span', { text: `Macro ${this.sel + 1}` }), name),
        h('button', { class: 'btn danger-text', onclick: () => this.remove() }, icon('trash', 16), 'Delete')),
      h('div', { class: 'row' },
        h('button', {
          class: `btn ${this.recording ? 'recording' : 'primary'}`,
          text: this.recording ? 'Stop recording' : 'Record keystrokes',
          onclick: () => { if (this.recording) this.stopRecording(); else this.startRecording(); this.render(); },
        }),
        toggle(this.realTiming, (v) => { this.realTiming = v; }, 'Keep my timing'),
        h('span', { class: 'spacer' }),
        keyPick,
        h('button', {
          class: 'btn', text: 'Add key tap',
          onclick: () => {
            const usage = Number(keyPick.value);
            m.steps.push({ usage, delay: 20, press: true, kind: 0 }, { usage, delay: 20, press: false, kind: 0 });
            this.render();
          },
        })),
      this.recording && h('p', { class: 'banner inline', text: 'Recording: type the sequence now. Every key press and release is captured until you stop.' }),
      steps,
      h('p', { class: 'muted small', text: 'The delay is how long the keyboard waits at that step, in milliseconds.' }),
    );
    this.footer();
  },

  footer() {
    const used = this.macros ? bankSize(this.macros) : 0;
    const over = used > MACRO_MAX;
    this.meter.firstChild.style.width = `${Math.min(100, (used / MACRO_MAX) * 100)}%`;
    this.meter.classList.toggle('over', over);
    this.usage.textContent = `${used.toLocaleString()} of ${MACRO_MAX.toLocaleString()} bytes used${over ? ': too large to save' : ''}`;
    const dirty = this.dirty();
    this.saveBtn.disabled = !dirty || over;
    this.discardBtn.disabled = !dirty;
  },

  add() {
    if (!this.macros) return;
    this.macros.push({ name: `Macro ${this.macros.length + 1}`, steps: [] });
    this.sel = this.macros.length - 1;
    this.render();
  },

  async remove() {
    const later = this.macros.length - 1 - this.sel;
    const ok = await confirmDialog({
      title: `Delete “${this.macros[this.sel].name || 'Untitled'}”?`,
      body: later
        ? `Keys are bound to macros by number. The ${later} macro${later === 1 ? '' : 's'} after this one will move up a slot, so keys bound to them will run a different macro until you rebind them.`
        : 'Keys bound to this macro will do nothing until you rebind them.',
      confirm: 'Delete', danger: true,
    });
    if (!ok) return;
    this.macros.splice(this.sel, 1);
    this.sel = Math.max(0, this.sel - 1);
    this.render();
  },

  startRecording() { this.recording = true; this.lastAt = 0; },
  stopRecording() { this.recording = false; },

  capture(e) {
    if (!this.recording || this.app.page !== 'macros') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const usage = usageFromCode(e.code);
    if (!usage) return;
    const now = performance.now();
    const gap = this.lastAt ? Math.round(now - this.lastAt) : 0;
    this.lastAt = now;
    this.macros[this.sel].steps.push({
      usage, press: e.type === 'keydown', kind: 0,
      delay: this.realTiming ? Math.min(gap, 60000) : 20,
    });
    this.render();
  },

  async save() {
    this.stopRecording();
    const sending = clone(this.macros);
    const ok = await this.app.run(() => this.app.kb.saveMacros(sending), 'Macros saved to the keyboard');
    if (ok === false) return;
    this.saved = JSON.stringify(sending);
    this.app.cache.macros = sending;
    this.render();
  },

  update() {},
  reset() { this.macros = null; this.recording = false; },
};
