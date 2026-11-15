// The on-screen keyboard: 99 keys plus the knob, positioned from the vendor layout table.
import { KEYS } from '../data/keymap.js';
import { KNOB_IDX } from '../hid/protocol.js';
import { h } from './dom.js';

const OX = 10, OY = 23, W = 634, H = 198; // crop of the layout table
const PAD_X = 4, PAD_Y = 3; // the table leaves wide gutters; grow each key into them
const KNOB = { x: 588, y: 26, d: 30 };

const pct = (v, total) => `${(v / total) * 100}%`;

// onKey(idx, event) on click; onStroke(idx) while dragging with the button held (painting).
export function createBoard({ onKey, onStroke, knob = false } = {}) {
  const caps = new Map();
  const inner = h('div', { class: 'board-inner', style: { aspectRatio: `${W} / ${H}` } });
  const el = h('div', { class: 'board' }, inner);
  let dragging = false;

  const add = (idx, box, extra = '') => {
    const legend = h('span', { class: 'cap-legend' });
    const label = h('span', { class: 'cap-label' });
    const cap = h('button', {
      type: 'button', class: `cap ${extra}`, data: { idx: String(idx) },
      style: { left: pct(box.x, W), top: pct(box.y, H), width: pct(box.w, W), height: pct(box.h, H) },
    }, legend, label);
    cap.addEventListener('click', (e) => onKey?.(idx, e));
    caps.set(idx, { cap, legend, label });
    inner.append(cap);
  };

  for (const k of KEYS) {
    add(k.idx, { x: k.x - OX - PAD_X, y: k.y - OY - PAD_Y, w: k.w + PAD_X * 2, h: k.h + PAD_Y * 2 });
    caps.get(k.idx).legend.textContent = k.label;
  }
  if (knob) {
    add(KNOB_IDX, { x: KNOB.x - OX, y: KNOB.y - OY, w: KNOB.d, h: KNOB.d }, 'knob');
    caps.get(KNOB_IDX).legend.textContent = 'Knob';
  }
  if (onStroke) {
    // Painting: press on a key, then drag across others. Hit-testing by position works the
    // same for mouse, pen and touch (touch never fires pointerenter on the keys it crosses).
    let last = null;
    const hit = (e) => {
      const cap = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cap');
      if (!cap || !inner.contains(cap) || cap.dataset.idx === last) return;
      last = cap.dataset.idx;
      onStroke(Number(last));
    };
    inner.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      last = null;
      hit(e);
    });
    inner.addEventListener('pointermove', (e) => { if (dragging) hit(e); });
    for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => { dragging = false; });
  }

  return {
    el,
    caps,
    // state: { label, color: [r,g,b] | null, selected, changed, dim, title }
    set(idx, state) {
      const c = caps.get(idx);
      if (!c) return;
      if ('label' in state) c.label.textContent = state.label ?? '';
      if ('title' in state) c.cap.title = state.title ?? '';
      if ('selected' in state) c.cap.classList.toggle('selected', Boolean(state.selected));
      if ('changed' in state) c.cap.classList.toggle('changed', Boolean(state.changed));
      if ('dim' in state) c.cap.classList.toggle('dim', Boolean(state.dim));
      if ('color' in state) {
        const col = state.color;
        if (!col) { c.cap.style.removeProperty('--key'); c.cap.classList.remove('lit', 'bright'); return; }
        c.cap.style.setProperty('--key', `rgb(${col[0]}, ${col[1]}, ${col[2]})`);
        c.cap.classList.add('lit');
        c.cap.classList.toggle('bright', col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11 > 140);
      }
    },
    each(fn) { for (const k of KEYS) fn(k); },
  };
}
