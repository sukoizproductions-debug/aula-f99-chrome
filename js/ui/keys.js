// Keys page: four layers, click a key (or the knob), choose what it does.
import { CATALOG, KNOB_CHOICES } from '../data/catalog.js';
import { KEYS, KEY_BY_IDX } from '../data/keymap.js';
import {
  KNOB_FACTORY, KNOB_IDX, LAYERS, decodeRecord, defaultRecord, modBitFromUsage, sameBytes, usageFromCode,
} from '../hid/protocol.js';
import { createBoard } from './board.js';
import { card, clear, confirmDialog, h, segmented } from './dom.js';

const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

export default {
  id: 'keys',
  title: 'Keys',
  icon: 'keys',
  layers: null,
  layer: 0,
  selected: null,
  tab: 'keys',
  query: '',

  mount(root, app) {
    this.app = app;
    this.board = createBoard({ knob: true, onKey: (idx) => this.select(idx) });
    this.banner = h('div', { class: 'banner' });
    this.layerTabs = segmented(LAYERS.map((label, value) => ({ label, value })), this.layer, (v) => {
      this.layer = v;
      if (this.selected === KNOB_IDX && v !== 0) this.selected = null;
      this.render();
    });
    this.inspector = h('div', { class: 'inspector' });
    root.append(
      this.banner,
      card(null, null,
        h('div', { class: 'row between' }, this.layerTabs,
          h('span', { class: 'muted small', text: 'Bindings are stored on the keyboard and work without this page.' })),
        this.board.el),
      card(null, null, this.inspector),
    );
    window.addEventListener('keydown', (e) => this.captureKey(e), true);
    window.addEventListener('keyup', (e) => this.captureKey(e), true);
  },

  async show(app) {
    if (!this.layers || app.cache.layers === null) {
      const layers = await app.run(() => app.kb.readLayers());
      if (!layers) return;
      app.cache.layers = true;
      this.layers = layers;
      if (this.layer >= layers.length) this.layer = 0;
    }
    if (app.kb.wired && app.cache.macros === null) {
      app.cache.macros = (await app.run(() => app.kb.readMacros())) || [];
    }
    this.render();
  },

  rec(idx, layer = this.layer) { return this.layers[layer].subarray(idx * 4, idx * 4 + 4); },
  factory(idx) {
    if (this.layer !== 0) return null;
    return idx === KNOB_IDX ? KNOB_FACTORY : defaultRecord(KEY_BY_IDX.get(idx).vk);
  },

  render() {
    if (!this.layers) return;
    const { kb, prefs } = this.app;
    const wired = kb.wired;
    const showBinding = prefs.get('keyLabels') === 'binding';
    for (const b of this.layerTabs.children) b.disabled = Number(b.dataset.value) >= this.layers.length;
    this.layerTabs.set(this.layer);

    const paint = (idx) => {
      const rec = this.rec(idx);
      const d = decodeRecord(rec);
      const def = this.factory(idx);
      const changed = def ? !same(rec, def) : d.kind !== 'empty';
      const empty = d.kind === 'empty';
      this.board.set(idx, {
        label: showBinding && (this.layer === 0 ? changed : !empty) ? d.label : '',
        changed: this.layer === 0 ? changed : !empty && !showBinding,
        dim: this.layer !== 0 && empty,
        selected: idx === this.selected,
        title: `${idx === KNOB_IDX ? 'Knob' : KEY_BY_IDX.get(idx).label}: ${d.label}`,
      });
    };
    KEYS.forEach((k) => paint(k.idx));
    paint(KNOB_IDX);
    this.board.caps.get(KNOB_IDX).cap.disabled = this.layer !== 0;

    this.banner.hidden = wired;
    this.banner.textContent = wired ? '' : 'Connected over 2.4G: you can see the base layer, but remapping needs the USB cable.';
    this.renderInspector();
  },

  select(idx) {
    this.selected = this.selected === idx ? null : idx;
    this.capturing = false;
    this.tab = idx === KNOB_IDX ? 'knob' : (this.tab === 'knob' ? 'keys' : this.tab);
    this.render();
  },

  groups() {
    const macros = (this.app.cache.macros || []).map((m, i) => ({
      label: `Macro ${i + 1}`, hint: m.name, rec: [3, 1, 1, i],
    }));
    const out = [...CATALOG, {
      id: 'macros', name: 'Macros', items: macros,
      note: macros.length ? 'Create and edit macros on the Macros page.' : 'No macros on the keyboard yet. Create one on the Macros page.',
    }];
    if (this.selected === KNOB_IDX) {
      out.unshift({
        id: 'knob', name: 'Knob', items: KNOB_CHOICES,
        note: 'These are confirmed to work. Other bindings are accepted by the keyboard but untested on the knob. Holding the knob for two seconds always switches the keyboard’s own mode.',
      });
    }
    return out;
  },

  renderInspector() {
    const box = clear(this.inspector);
    const idx = this.selected;
    const wired = this.app.kb.wired;
    if (idx === null) {
      box.append(h('div', { class: 'row between' },
        h('p', { class: 'muted', text: 'Select a key or the knob to change what it does. Changed keys are outlined.' }),
        this.layer === 0 && wired && h('button', { class: 'btn', text: 'Reset base layer', onclick: () => this.resetLayer() })));
      return;
    }
    const name = idx === KNOB_IDX ? 'Knob' : KEY_BY_IDX.get(idx).label;
    const cur = this.rec(idx);
    const def = this.factory(idx);
    box.append(h('div', { class: 'row between' },
      h('div', null,
        h('h2', { text: `${name} · ${LAYERS[this.layer]} layer` }),
        h('p', { class: 'muted', text: `Currently: ${decodeRecord(cur).label}` })),
      wired && h('div', { class: 'row' },
        h('button', {
          class: `btn ${this.capturing ? 'primary' : ''}`,
          text: this.capturing ? 'Press a key or shortcut… (Esc cancels)' : 'Press a key to assign',
          onclick: () => { this.capturing = !this.capturing; this.mods = 0; this.renderInspector(); },
        }),
        def && h('button', { class: 'btn', text: 'Reset to default', disabled: same(cur, def), onclick: () => this.assign(def) }),
        idx !== KNOB_IDX && h('button', { class: 'btn', text: 'Disable', disabled: same(cur, [0, 0, 0, 0]), onclick: () => this.assign([0, 0, 0, 0]) }))));
    if (!wired) return;

    const groups = this.groups();
    if (!groups.some((g) => g.id === this.tab)) this.tab = groups[0].id;
    const search = h('input', {
      class: 'input', type: 'search', placeholder: 'Search every category', value: this.query,
      oninput: () => { this.query = search.value; fill(); },
    });
    const tabs = h('div', { class: 'tabs' }, groups.map((g) => h('button', {
      type: 'button', class: g.id === this.tab ? 'on' : '', text: g.name,
      onclick: () => { this.tab = g.id; this.query = ''; this.renderInspector(); },
    })));
    const grid = h('div', { class: 'options' });
    const note = h('p', { class: 'muted small' });
    const fill = () => {
      const q = this.query.trim().toLowerCase();
      const items = q
        ? groups.flatMap((g) => g.items).filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(q))
        : groups.find((g) => g.id === this.tab).items;
      note.textContent = q ? (items.length ? '' : 'Nothing matches.') : groups.find((g) => g.id === this.tab).note ?? '';
      tabs.classList.toggle('muted-tabs', Boolean(q));
      clear(grid).append(...items.map((it) => h('button', {
        type: 'button', class: `option ${same(it.rec, cur) ? 'on' : ''}`, onclick: () => this.assign(it.rec),
      }, h('span', { text: it.label }), it.hint && h('small', { text: it.hint }))));
    };
    fill();
    box.append(h('div', { class: 'row between' }, tabs, search), note, grid);
  },

  // Assign by pressing: modifiers accumulate, the first other key completes the binding.
  captureKey(e) {
    if (!this.capturing || this.app.page !== 'keys') return;
    e.preventDefault();
    e.stopPropagation();
    const usage = usageFromCode(e.code);
    const bit = modBitFromUsage(usage);
    if (e.type === 'keydown') {
      if (e.repeat) return;
      if (e.code === 'Escape' && !this.mods) { this.capturing = false; this.renderInspector(); return; }
      if (bit) { this.mods |= bit; return; }
      if (!usage) { this.app.toast('That key cannot be sent by this keyboard', 'error'); return; }
      this.capturing = false;
      this.assign([0, this.mods, 0, usage]);
    } else if (bit && this.mods) {
      this.capturing = false;
      this.assign([0, this.mods, 0, 0]); // a modifier on its own
    }
  },

  async assign(rec) {
    const idx = this.selected;
    const layer = this.layer;
    const back = await this.app.run(() => this.app.kb.setRecord(layer, idx, rec), 'Saved to the keyboard');
    if (back) this.layers[layer] = back;
    this.render();
  },

  async resetLayer() {
    const records = KEYS.map((k) => [k.idx, defaultRecord(k.vk)]);
    records.push([KNOB_IDX, KNOB_FACTORY]);
    const cur = this.layers[0];
    const changed = records.filter(([idx, rec]) => !sameBytes(cur.subarray(idx * 4, idx * 4 + 4), rec)).length;
    if (!changed) { this.app.toast('The base layer is already at its defaults'); return; }
    const ok = await confirmDialog({
      title: 'Reset the base layer?',
      body: `${changed} key${changed === 1 ? '' : 's'} will go back to what is printed on the keycap. The Fn and Tap layers are not touched.`,
      confirm: 'Reset', danger: true,
    });
    if (!ok) return;
    const back = await this.app.run(() => this.app.kb.setRecords(0, records), 'Base layer reset');
    if (back) this.layers[0] = back;
    this.render();
  },

  // Bindings never change behind our back, so state events need no redraw here.
  update() {},
  reset() { this.layers = null; this.selected = null; this.capturing = false; },
};
