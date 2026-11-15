// Lighting page: effect, brightness, speed, colour, saved presets.
import { BRIGHT_MAX, COLORS, EFFECTS, SPEED_MAX, effectName } from '../hid/protocol.js';
import { card, clear, h, icon, promptDialog } from './dom.js';

// Send only the newest value while a previous one is still on the wire.
function latestOnly(fn) {
  let running = false;
  let next = null;
  return async (v) => {
    next = v;
    if (running) return;
    running = true;
    while (next !== null) {
      const x = next;
      next = null;
      try { await fn(x); } catch { /* the release handler reports errors */ }
    }
    running = false;
  };
}

function slider(label, max, onPreview, onCommit) {
  const value = h('span', { class: 'slider-value' });
  const input = h('input', { type: 'range', min: 0, max, step: 1, value: 0 });
  const preview = latestOnly(onPreview);
  let dragging = false;
  input.addEventListener('input', () => { dragging = true; value.textContent = input.value; preview(Number(input.value)); });
  input.addEventListener('change', () => { dragging = false; onCommit(Number(input.value)); });
  const el = h('div', { class: 'slider' }, h('div', { class: 'slider-head' }, h('span', { text: label }), value), input);
  return {
    el,
    sync(v, disabled) {
      input.disabled = disabled;
      el.classList.toggle('disabled', disabled);
      if (dragging) return;
      input.value = v;
      value.textContent = disabled ? '–' : String(v);
    },
  };
}

export default {
  id: 'lighting',
  title: 'Lighting',
  icon: 'light',

  mount(root, app) {
    const { kb, prefs } = app;

    // ---- effects ----
    this.effects = h('div', { class: 'effect-grid' }, EFFECTS.map((e) => h('button', {
      type: 'button', class: 'effect', data: { id: String(e.id) },
      onclick: () => app.run(() => kb.setEffect(e.id)),
    }, h('span', { class: 'effect-no', text: e.id ? String(e.id).padStart(2, '0') : '—' }), h('span', { text: e.name }))));

    // ---- controls ----
    this.bright = slider('Brightness', BRIGHT_MAX,
      (v) => kb.setBrightness(v, { preview: true }), (v) => app.run(() => kb.setBrightness(v)));
    this.speed = slider('Speed', SPEED_MAX,
      (v) => kb.setSpeed(v, { preview: true }), (v) => app.run(() => kb.setSpeed(v)));
    this.swatches = h('div', { class: 'swatches' }, COLORS.map((c, i) => h('button', {
      type: 'button', class: `swatch ${c.hex ? '' : 'random'}`, title: c.name, 'aria-label': c.name,
      style: c.hex ? { background: c.hex } : null, data: { i: String(i) },
      onclick: () => app.run(() => kb.setColor(i)),
    })));
    this.colorNote = h('p', { class: 'muted small' });

    // ---- presets ----
    this.presets = h('div', { class: 'chips' });
    const savePreset = async () => {
      const s = kb.state;
      const name = await promptDialog({ title: 'Save lighting preset', label: 'Name', value: effectName(s.effect) });
      if (!name) return;
      prefs.set('presets', [...prefs.get('presets'), {
        name, effect: s.effect, brightness: s.brightness, speed: s.speed, color: s.color,
      }]);
      this.renderPresets(app);
    };

    root.append(
      card('Effect', 'Applies straight away and is stored on the keyboard.', this.effects),
      h('div', { class: 'grid-2' },
        card('Adjust', null, this.bright.el, this.speed.el,
          h('div', { class: 'field' }, h('span', { text: 'Colour' }), this.swatches, this.colorNote)),
        card('Presets', 'Your own one-click combinations, saved in this browser.',
          this.presets,
          h('button', { class: 'btn', onclick: savePreset }, icon('plus', 16), 'Save current as preset'))),
    );
    this.renderPresets(app);
  },

  renderPresets(app) {
    const { kb, prefs } = app;
    const list = prefs.get('presets');
    clear(this.presets);
    if (!list.length) this.presets.append(h('p', { class: 'muted small', text: 'No presets yet.' }));
    list.forEach((p, i) => this.presets.append(h('span', { class: 'chip' },
      h('button', {
        type: 'button', class: 'chip-main', text: p.name,
        title: `${effectName(p.effect)} · brightness ${p.brightness} · speed ${p.speed}`,
        onclick: () => app.run(() => kb.setLighting(p), `Applied “${p.name}”`),
      }),
      h('button', {
        type: 'button', class: 'chip-x', 'aria-label': `Delete ${p.name}`,
        onclick: () => { prefs.set('presets', list.filter((_, j) => j !== i)); this.renderPresets(app); },
      }, icon('close', 13)))));
  },

  update(app) {
    const s = app.kb.state;
    const off = s.effect === 0;
    for (const b of this.effects.children) b.classList.toggle('on', Number(b.dataset.id) === s.effect);
    this.bright.sync(s.brightness, off);
    this.speed.sync(s.speed, off || s.custom);
    const fixed = off || s.custom;
    for (const b of this.swatches.children) {
      b.disabled = fixed;
      b.classList.toggle('on', !fixed && Number(b.dataset.i) === s.color);
    }
    this.colorNote.textContent = s.custom
      ? 'Custom uses the per-key colours from the Colours page.'
      : off ? 'Lighting is off.' : 'Some effects ignore the colour and always cycle.';
  },
};
