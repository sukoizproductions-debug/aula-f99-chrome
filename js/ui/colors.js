// Per-key colour page: paint the 99 lit keys, keep a palette, save whole layouts as profiles.
import { EFFECT_CUSTOM, RGB_LEN, RGB_SLOTS, hex, sameBytes, unhex } from '../hid/protocol.js';
import { createBoard } from './board.js';
import { card, clear, h, hexToRgb, icon, promptDialog, rgbToHex, segmented } from './dom.js';

export default {
  id: 'colors',
  title: 'Colours',
  icon: 'colors',
  planes: null, // working copy
  saved: null, // what the keyboard holds
  tool: 'paint',
  color: '#0a84ff',

  mount(root, app) {
    const { prefs } = app;
    this.app = app;
    this.board = createBoard({ onStroke: (idx) => this.stroke(idx) });

    this.banner = h('div', { class: 'banner' });
    this.picker = h('input', { type: 'color', class: 'color-input', value: this.color, oninput: () => this.setColor(this.picker.value) });
    this.hexBox = h('input', {
      class: 'input mono', type: 'text', value: this.color, maxLength: 7, size: 8,
      onchange: () => { if (/^#?[0-9a-f]{6}$/i.test(this.hexBox.value)) this.setColor(`#${this.hexBox.value.replace('#', '')}`); else this.hexBox.value = this.color; },
    });
    this.palette = h('div', { class: 'swatches' });
    this.tools = segmented([
      { value: 'paint', label: 'Paint' }, { value: 'erase', label: 'Erase' },
      { value: 'pick', label: 'Pick', title: 'Click a key to copy its colour' },
    ], this.tool, (v) => { this.tool = v; });

    this.status = h('span', { class: 'muted small' });
    this.applyBtn = h('button', { class: 'btn primary', text: 'Apply to keyboard', onclick: () => this.apply() });
    this.revertBtn = h('button', { class: 'btn', text: 'Revert', onclick: () => { this.planes = this.saved.slice(); this.paintAll(); this.sync(); } });

    this.profiles = h('select', { class: 'input' });
    const saveProfile = async () => {
      const name = await promptDialog({ title: 'Save colour profile', label: 'Name', value: `Profile ${prefs.get('profiles').length + 1}` });
      if (!name) return;
      prefs.set('profiles', [...prefs.get('profiles').filter((p) => p.name !== name), { name, rgb: hex(this.planes) }]);
      this.renderProfiles(name);
    };
    const loadProfile = () => {
      const p = prefs.get('profiles').find((x) => x.name === this.profiles.value);
      if (!p) return;
      this.planes = unhex(p.rgb);
      this.paintAll();
      this.changed();
    };
    const deleteProfile = () => {
      prefs.set('profiles', prefs.get('profiles').filter((p) => p.name !== this.profiles.value));
      this.renderProfiles();
    };

    root.append(
      this.banner,
      card(null, null, this.board.el),
      h('div', { class: 'grid-2' },
        card('Brush', 'Click a key, or drag across several.',
          h('div', { class: 'row' }, this.tools, this.picker, this.hexBox),
          this.palette,
          h('p', { class: 'muted small', text: 'Right-click a swatch to remove it from your palette.' }),
          h('div', { class: 'row' },
            h('button', { class: 'btn', text: 'Fill all keys', onclick: () => this.fill(hexToRgb(this.color)) }),
            h('button', { class: 'btn', text: 'Clear all', onclick: () => this.fill([0, 0, 0]) }))),
        card('Profiles', 'Whole-keyboard colour layouts, saved in this browser.',
          h('div', { class: 'row' }, this.profiles,
            h('button', { class: 'btn', text: 'Load', onclick: loadProfile }),
            h('button', { class: 'btn', 'aria-label': 'Delete profile', onclick: deleteProfile }, icon('trash', 16))),
          h('button', { class: 'btn', onclick: saveProfile }, icon('plus', 16), 'Save current as profile'),
          h('div', { class: 'row end' }, this.status, this.revertBtn, this.applyBtn))),
    );
    this.renderPalette();
    this.renderProfiles();
  },

  renderPalette() {
    const { prefs } = this.app;
    clear(this.palette);
    for (const c of prefs.get('palette')) {
      this.palette.append(h('button', {
        type: 'button', class: `swatch ${c.toLowerCase() === this.color.toLowerCase() ? 'on' : ''}`, title: c,
        style: { background: c }, onclick: () => this.setColor(c),
        oncontextmenu: (e) => { e.preventDefault(); prefs.set('palette', prefs.get('palette').filter((x) => x !== c)); this.renderPalette(); },
      }));
    }
    this.palette.append(h('button', {
      type: 'button', class: 'swatch add', title: 'Add the current colour to your palette',
      onclick: () => { if (!prefs.get('palette').includes(this.color)) prefs.set('palette', [...prefs.get('palette'), this.color]); this.renderPalette(); },
    }, icon('plus', 14)));
  },

  renderProfiles(select) {
    const list = this.app.prefs.get('profiles');
    clear(this.profiles);
    if (!list.length) this.profiles.append(h('option', { text: 'No profiles yet', value: '' }));
    for (const p of list) this.profiles.append(h('option', { text: p.name, value: p.name, selected: p.name === select }));
    this.profiles.disabled = !list.length;
  },

  setColor(c) {
    this.color = c.toLowerCase();
    this.picker.value = this.color;
    this.hexBox.value = this.color;
    if (this.tool !== 'paint') { this.tool = 'paint'; this.tools.set('paint'); }
    this.renderPalette();
  },

  get(idx) { return [this.planes[idx], this.planes[RGB_SLOTS + idx], this.planes[RGB_SLOTS * 2 + idx]]; },
  put(idx, [r, g, b]) {
    this.planes[idx] = r; this.planes[RGB_SLOTS + idx] = g; this.planes[RGB_SLOTS * 2 + idx] = b;
    this.board.set(idx, { color: [r, g, b] });
  },
  paintAll() { this.board.each((k) => this.board.set(k.idx, { color: this.get(k.idx) })); },

  editable() { return this.planes && this.app.kb.wired; },

  stroke(idx) {
    if (!this.editable()) return;
    if (this.tool === 'pick') { this.setColor(rgbToHex(this.get(idx))); return; }
    this.put(idx, this.tool === 'erase' ? [0, 0, 0] : hexToRgb(this.color));
    this.changed();
  },
  fill(rgb) {
    if (!this.editable()) return;
    this.board.each((k) => this.put(k.idx, rgb));
    this.changed();
  },

  changed() {
    this.sync();
    clearTimeout(this.timer);
    if (this.app.prefs.get('autoApplyColors')) this.timer = setTimeout(() => this.apply(), 450);
  },

  async apply() {
    clearTimeout(this.timer);
    if (!this.planes || sameBytes(this.planes, this.saved)) return;
    const sending = this.planes.slice();
    this.status.textContent = 'Saving…';
    const ok = await this.app.run(() => this.app.kb.writeColors(sending));
    if (ok !== false) this.saved = sending;
    this.sync();
  },

  async show(app) {
    if (!this.planes || app.cache.colors === null) {
      const planes = await app.run(() => app.kb.readColors());
      if (!planes || planes.length < RGB_LEN) return;
      app.cache.colors = true;
      this.saved = planes.slice();
      this.planes = planes.slice();
      this.paintAll();
    }
    this.sync();
  },

  sync() {
    const { kb, prefs } = this.app;
    const dirty = this.planes && this.saved && !sameBytes(this.planes, this.saved);
    const auto = prefs.get('autoApplyColors');
    this.applyBtn.hidden = auto;
    this.applyBtn.disabled = !dirty;
    this.revertBtn.disabled = !dirty;
    this.revertBtn.hidden = auto;
    this.status.textContent = !this.planes ? '' : dirty ? (auto ? 'Saving…' : 'Unsaved changes') : 'Saved on the keyboard';
    this.board.el.classList.toggle('readonly', !this.editable());

    clear(this.banner);
    this.banner.hidden = false;
    if (!kb.wired) {
      this.banner.append(h('span', { text: 'Connected over 2.4G: you can see the colours, but changing them needs the USB cable.' }));
    } else if (!(kb.state.custom && kb.state.effect === EFFECT_CUSTOM)) {
      this.banner.append(
        h('span', { text: 'These colours only show while the effect is set to Custom.' }),
        h('button', { class: 'btn small', text: 'Switch to Custom', onclick: () => this.app.run(() => kb.setEffect(EFFECT_CUSTOM)) }));
    } else {
      this.banner.hidden = true;
    }
  },

  update() { if (this.board) this.sync(); },
  reset() { this.planes = null; this.saved = null; },
};
