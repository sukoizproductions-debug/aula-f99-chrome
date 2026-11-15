// A simulated F99 Pro that speaks the real wired protocol at the feature-report level.
// The demo mode and the tests drive the same WiredLink code a real keyboard does.
import { KEYS } from '../data/keymap.js';
import {
  CHUNK, CMD, KNOB_FACTORY, KNOB_IDX, MACRO_MAX, MATRIX_LEN, OFF, PAGE_LEN, RGB_LEN, RGB_SLOTS, SLEEP,
  WIRED_FILTER, defaultRecord, pageOk,
} from './protocol.js';
import { buildBank } from './macro.js';

const idxOf = (label) => KEYS.find((k) => k.label === label)?.idx;

function factoryPage() {
  const p = new Uint8Array(PAGE_LEN);
  p[OFF.EFFECT] = 3;
  p[OFF.SLEEP] = 10;
  p[OFF.CUSTOM_BRIGHT] = 9;
  const bright = [9, 7, 9, 5, 7, 9, 7, 4, 5, 9, 7, 9, 7, 5, 9, 7, 9, 7, 9];
  for (let i = 0; i < 19; i++) {
    p[OFF.TABLE + i * 2] = bright[i];
    p[OFF.TABLE + i * 2 + 1] = (3 << 4) | 7;
  }
  p[PAGE_LEN - 2] = 0x5a;
  p[PAGE_LEN - 1] = 0xa5;
  return p;
}

function factoryLayers() {
  const layers = [0, 1, 2, 3].map(() => new Uint8Array(MATRIX_LEN));
  const put = (layer, idx, rec) => { if (idx !== undefined) layers[layer].set(rec, idx * 4); };
  for (const k of KEYS) put(0, k.idx, defaultRecord(k.vk));
  put(0, KNOB_IDX, KNOB_FACTORY);
  // A plausible Fn layer: media on the F row, radios on the number row, lighting on the arrows.
  const fn = {
    F1: [2, 0, 0x01, 0x94], F2: [2, 0, 0x01, 0x8a], F3: [2, 0, 0x02, 0x23], F4: [2, 0, 0x01, 0x92],
    F5: [2, 0, 0x00, 0xb6], F6: [2, 0, 0x00, 0xcd], F7: [2, 0, 0x00, 0xb5], F8: [2, 0, 0x00, 0xb7],
    F9: [2, 0, 0x00, 0xe2], F10: [2, 0, 0x00, 0xea], F11: [2, 0, 0x00, 0xe9], F12: [7, 0, 0, 0x0c],
    1: [7, 0, 0, 0x05], 2: [7, 0, 0, 0x06], 3: [7, 0, 0, 0x07], 4: [7, 0, 0, 0x08],
    '↑': [8, 3, 1, 0], '↓': [8, 3, 2, 0], '←': [8, 4, 2, 0], '→': [8, 4, 1, 0],
    '\\': [8, 2, 0, 0], Win: [7, 0, 0, 0x01], Fn: [0x0d, 0, 0, 0],
  };
  for (const [label, rec] of Object.entries(fn)) put(1, idxOf(label), rec);
  for (const l of layers) l.set([0, 0, 0x5a, 0xa5], MATRIX_LEN - 4);
  return layers;
}

function factoryRgb() {
  const p = new Uint8Array(RGB_LEN);
  const paint = (label, [r, g, b]) => {
    const i = idxOf(label);
    if (i === undefined) return;
    p[i] = r; p[RGB_SLOTS + i] = g; p[RGB_SLOTS * 2 + i] = b;
  };
  paint('Esc', [255, 60, 60]);
  for (const k of ['W', 'A', 'S', 'D']) paint(k, [60, 140, 255]);
  for (const k of ['↑', '↓', '←', '→']) paint(k, [255, 190, 40]);
  return p;
}

function factoryMacros() {
  const bank = new Uint8Array(MACRO_MAX);
  bank.set(buildBank([{
    name: 'Hello',
    steps: [0x0b, 0x08, 0x0f, 0x0f, 0x12].flatMap((usage) => [
      { usage, delay: 20, press: true }, { usage, delay: 20, press: false },
    ]),
  }]));
  return bank;
}

export class DemoDevice {
  vendorId = WIRED_FILTER.vendorId;
  productId = WIRED_FILTER.productId;
  productName = 'AULA F99 Pro (demo)';
  opened = false;
  collections = [{
    usagePage: WIRED_FILTER.usagePage,
    usage: WIRED_FILTER.usage,
    featureReports: [{ reportId: 6, items: [{ reportSize: 8, reportCount: 519 }] }],
  }];
  #reply = new Uint8Array(520);

  constructor() { this.factory(); }

  factory() {
    this.page = factoryPage();
    this.layers = factoryLayers();
    this.rgb = factoryRgb();
    this.macros = factoryMacros();
    this.battery = 87;
  }

  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener() {}
  removeEventListener() {}

  source(code, param) {
    switch (code) {
      case CMD.GET_INFO: return Uint8Array.from([3, 0, 0, 0, 1, 0x58]);
      case CMD.GET_POWER: return Uint8Array.from([this.battery, 0x10]);
      case CMD.GET_PAGE: return this.page;
      case CMD.GET_MATRIX: return this.layers[param & 3];
      case CMD.GET_RGB: return this.rgb;
      case CMD.GET_MACRO: return this.macros;
      default: return new Uint8Array(0);
    }
  }

  async sendFeatureReport(id, data) {
    if (!this.opened) throw new Error('Device is closed');
    const b = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length);
    const [code, param, , , index] = b;
    const len = b[5] | (b[6] << 8);
    const body = b.subarray(7, 7 + len);
    const at = index * CHUNK;
    if (code & 0x80) {
      const src = this.source(code, param).subarray(at, at + len);
      const r = new Uint8Array(520);
      r.set([id, code, param, 0, b[3], index, src.length & 0xff, src.length >> 8]);
      r.set(src, 8);
      this.#reply = r;
      return;
    }
    switch (code) {
      case CMD.SET_PAGE: {
        const next = this.page.slice();
        next.set(body, at);
        // Like the firmware: ignore a page without its marker or with an invalid sleep value.
        if (pageOk(next) && SLEEP.some((s) => s.hw === next[OFF.SLEEP])) this.page = next;
        break;
      }
      case CMD.SET_MATRIX: this.layers[param & 3].set(body, at); break;
      case CMD.SET_RGB: this.rgb.set(body, at); break;
      case CMD.SET_MACRO: this.macros.set(body, at); break;
      case CMD.RESET: this.factory(); break;
      default: break;
    }
  }

  async receiveFeatureReport() {
    if (!this.opened) throw new Error('Device is closed');
    return new DataView(this.#reply.buffer.slice(0));
  }
}
