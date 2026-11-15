// AULA F99 Pro protocol constants and pure byte helpers.
// See docs/PROTOCOL.md for where every number comes from.

export const WIRED_FILTER = { vendorId: 0x258a, productId: 0x010c, usagePage: 0xff00, usage: 0x01 };
export const WIRELESS_FILTER = { vendorId: 0x3554, productId: 0xfa09, usagePage: 0xff02, usage: 0x02 };

export const PAGE_LEN = 128;
export const HEADER = 8;
export const REPORT_LEN = 520; // report id + 7 header bytes + 512 data
export const CHUNK = 512;
export const WIRELESS_LEN = 20;
export const MATRIX_LEN = 512; // 128 keys x 4 bytes
export const MACRO_MAX = 0x2800;
export const RGB_SLOTS = 126;
export const RGB_LEN = RGB_SLOTS * 3;
export const LAYERS = ['Base', 'Fn 1', 'Fn 2', 'Tap'];

// Wired command codes (feature report id 6).
export const CMD = {
  SET_MATRIX: 0x03, SET_PAGE: 0x04, SET_MACRO: 0x05, SET_RGB: 0x06, RESET: 0x11,
  GET_INFO: 0x82, GET_MATRIX: 0x83, GET_PAGE: 0x84, GET_MACRO: 0x85, GET_RGB: 0x86, GET_POWER: 0x87,
};
// 2.4G command codes (report id 0x13).
export const RF = { IDENTITY: 0x05, SET_PAGE: 0x04, GET_MATRIX: 0x41, GET_RGB: 0x42, GET_PAGE: 0x44, GET_BATTERY: 0x4a };

// Config page offsets.
export const OFF = {
  CUSTOM: 0x09, EFFECT: 0x0a, SLEEP: 0x18, MODE: 0x1a, SPIN: 0x38, TABLE: 0x3a, CUSTOM_BRIGHT: 0x75,
};
export const BRIGHT_MAX = 9;
export const SPEED_MAX = 4;
export const EFFECT_CUSTOM = 19;

// Effect ids are the vendor's menu order (LedOptN), which is what byte 0x0A stores.
export const EFFECTS = [
  { id: 1, name: 'Static' }, { id: 2, name: 'Breathing' }, { id: 3, name: 'Spectrum' },
  { id: 4, name: 'Reactive' }, { id: 5, name: 'Rain' }, { id: 6, name: 'Rainbow Wheel' },
  { id: 7, name: 'Ripple' }, { id: 8, name: 'Starlight' }, { id: 9, name: 'Snow Trail' },
  { id: 10, name: 'Flow' }, { id: 11, name: 'Drift' }, { id: 12, name: 'Shadow' },
  { id: 13, name: 'Sine Wave' }, { id: 14, name: 'Scanner' }, { id: 15, name: 'Pinwheel' },
  { id: 16, name: 'Waterfall' }, { id: 17, name: 'Bloom' }, { id: 18, name: 'Vortex' },
  { id: 19, name: 'Custom' }, { id: 0, name: 'Off' },
];
export const effectName = (id) => EFFECTS.find((e) => e.id === id)?.name ?? `Effect ${id}`;

export const COLORS = [
  { name: 'Red', hex: '#ff3b30' }, { name: 'Green', hex: '#34c759' }, { name: 'Blue', hex: '#0a84ff' },
  { name: 'Yellow', hex: '#ffd60a' }, { name: 'Magenta', hex: '#ff2d92' }, { name: 'Cyan', hex: '#32d5f5' },
  { name: 'White', hex: '#f2f5fa' }, { name: 'Random', hex: null },
];

// Sleep timer: the firmware only accepts these nine values.
export const SLEEP = [
  { seconds: 60, hw: 2 }, { seconds: 90, hw: 3 }, { seconds: 120, hw: 4 }, { seconds: 180, hw: 6 },
  { seconds: 240, hw: 8 }, { seconds: 300, hw: 10 }, { seconds: 600, hw: 20 }, { seconds: 900, hw: 30 },
  { seconds: 1200, hw: 40 },
];

export const KNOB_IDX = 108;
export const KNOB_FACTORY = [0x07, 0x00, 0x00, 0x1d];

export class AulaError extends Error {}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const hex = (bytes, sep = '') => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(sep);
export function unhex(str) {
  const clean = String(str).replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2) throw new AulaError('Hex string has an odd number of digits');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
export const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export const pageOk = (p) => p && p.length >= PAGE_LEN && p[PAGE_LEN - 2] === 0x5a && p[PAGE_LEN - 1] === 0xa5;

// ---- Per-key colour: three planes (all R, all G, all B), never interleaved ----
export function planesFromColors(colors) {
  const out = new Uint8Array(RGB_LEN);
  for (let i = 0; i < RGB_SLOTS; i++) {
    const [r, g, b] = colors[i] ?? [0, 0, 0];
    out[i] = clamp(r | 0, 0, 255);
    out[RGB_SLOTS + i] = clamp(g | 0, 0, 255);
    out[RGB_SLOTS * 2 + i] = clamp(b | 0, 0, 255);
  }
  return out;
}
export function colorsFromPlanes(planes) {
  if (planes.length < RGB_LEN) throw new AulaError(`Colour table too short (${planes.length} bytes)`);
  const out = [];
  for (let i = 0; i < RGB_SLOTS; i++) out.push([planes[i], planes[RGB_SLOTS + i], planes[RGB_SLOTS * 2 + i]]);
  return out;
}

// ---- Lighting state from the config page ----
export function slotOffset(effect) {
  return clamp((effect || 1) - 1, 0, 18) * 2 + OFF.TABLE;
}
export function lightingFromPage(page) {
  const effect = page[OFF.EFFECT];
  const custom = page[OFF.CUSTOM] === 1;
  const at = slotOffset(effect);
  const out = { effect, custom, sleep: page[OFF.SLEEP], firmwareMode: page[OFF.MODE] === 1 };
  if (custom) {
    out.brightness = Math.min(BRIGHT_MAX, page[OFF.CUSTOM_BRIGHT]);
    out.speed = SPEED_MAX;
    out.color = 7;
  } else {
    out.brightness = Math.min(BRIGHT_MAX, page[at]);
    out.speed = Math.min(SPEED_MAX, page[at + 1] >> 4);
    out.color = page[at + 1] & 0x0f;
  }
  return out;
}

// ---- HID usage names ----
const U = {};
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { U[0x04 + i] = c; });
'1234567890'.split('').forEach((c, i) => { U[0x1e + i] = c; });
Object.assign(U, {
  0x28: 'Enter', 0x29: 'Esc', 0x2a: 'Backspace', 0x2b: 'Tab', 0x2c: 'Space', 0x2d: '-', 0x2e: '=',
  0x2f: '[', 0x30: ']', 0x31: '\\', 0x33: ';', 0x34: "'", 0x35: '`', 0x36: ',', 0x37: '.', 0x38: '/',
  0x39: 'Caps Lock', 0x46: 'PrtSc', 0x47: 'Scroll Lock', 0x48: 'Pause', 0x49: 'Insert', 0x4a: 'Home',
  0x4b: 'PgUp', 0x4c: 'Delete', 0x4d: 'End', 0x4e: 'PgDn', 0x4f: '→', 0x50: '←', 0x51: '↓', 0x52: '↑',
  0x53: 'Num Lock', 0x54: 'Num /', 0x55: 'Num *', 0x56: 'Num -', 0x57: 'Num +', 0x58: 'Num Enter',
  0x62: 'Num 0', 0x63: 'Num .', 0x64: 'ISO \\', 0x65: 'Menu', 0x67: 'Num =',
  0xe0: 'L Ctrl', 0xe1: 'L Shift', 0xe2: 'L Alt', 0xe3: 'L Win',
  0xe4: 'R Ctrl', 0xe5: 'R Shift', 0xe6: 'R Alt', 0xe7: 'R Win',
});
for (let i = 0; i < 12; i++) U[0x3a + i] = `F${i + 1}`;
for (let i = 0; i < 9; i++) U[0x68 + i] = `F${i + 13}`; // descriptor tops out at 0x70 (F21)
for (let i = 0; i < 9; i++) U[0x59 + i] = `Num ${i + 1}`;
export const USAGE_NAMES = U;
export const usageName = (u) => U[u] ?? `Key 0x${u.toString(16).padStart(2, '0')}`;

// KeyboardEvent.code -> HID usage (for recording keys and macros in the browser).
const C = {
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
  BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
  Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48,
  Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e, ArrowRight: 0x4f,
  ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52, NumLock: 0x53, NumpadDivide: 0x54, NumpadMultiply: 0x55,
  NumpadSubtract: 0x56, NumpadAdd: 0x57, NumpadEnter: 0x58, Numpad0: 0x62, NumpadDecimal: 0x63,
  IntlBackslash: 0x64, ContextMenu: 0x65, NumpadEqual: 0x67,
  ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3,
  ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
};
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { C[`Key${c}`] = 0x04 + i; });
'1234567890'.split('').forEach((c, i) => { C[`Digit${c}`] = 0x1e + i; });
for (let i = 0; i < 12; i++) C[`F${i + 1}`] = 0x3a + i;
for (let i = 0; i < 9; i++) C[`F${i + 13}`] = 0x68 + i;
for (let i = 0; i < 9; i++) C[`Numpad${i + 1}`] = 0x59 + i;
export const usageFromCode = (code) => C[code] ?? 0;

// Modifier usage (0xE0..) -> matrix modifier bit. Right Win has no known bit.
export const MOD_BITS = [
  { bit: 0x01, name: 'Ctrl', usage: 0xe0 }, { bit: 0x02, name: 'Shift', usage: 0xe1 },
  { bit: 0x04, name: 'Alt', usage: 0xe2 }, { bit: 0x08, name: 'Win', usage: 0xe3 },
  { bit: 0x10, name: 'R Ctrl', usage: 0xe4 }, { bit: 0x20, name: 'R Shift', usage: 0xe5 },
  { bit: 0x40, name: 'R Alt', usage: 0xe6 },
];
export const modBitFromUsage = (u) => (u === 0xe7 ? 0x08 : MOD_BITS.find((m) => m.usage === u)?.bit ?? 0);
export const modsLabel = (mask) => MOD_BITS.filter((m) => mask & m.bit).map((m) => m.name).join(' + ')
  || `Mod 0x${mask.toString(16)}`;

// ---- Consumer (media) usages ----
export const CONSUMER = {
  0x006f: 'Brightness +', 0x0070: 'Brightness −', 0x00e9: 'Volume +', 0x00ea: 'Volume −', 0x00e2: 'Mute',
  0x00b5: 'Next track', 0x00b6: 'Previous track', 0x00cd: 'Play / Pause', 0x00b7: 'Stop',
  0x00b3: 'Fast forward', 0x00b4: 'Rewind', 0x00b0: 'Play', 0x00b1: 'Pause',
  // The launcher codes below follow the vendor driver's own table.
  0x018a: 'Mail', 0x0192: 'Calculator', 0x0194: 'My Computer', 0x0196: 'Media player',
  0x0197: 'Browser', 0x019c: 'Favourites', 0x0221: 'Search', 0x0223: 'Browser home',
  0x0224: 'Browser back', 0x0225: 'Browser forward', 0x0226: 'Browser stop', 0x0227: 'Browser refresh',
};
export const consumerName = (u) => CONSUMER[u] ?? `Media 0x${u.toString(16).padStart(4, '0')}`;

// "Common commands" the firmware runs itself (matrix b0 = 1). #10 does not exist.
export const COMMANDS = {
  1: 'Close window', 2: 'Lock computer', 3: 'Run…', 4: 'Show desktop', 5: 'Zoom in', 6: 'Zoom out',
  7: 'Task Manager', 8: 'Undo', 9: 'Save', 11: 'Lock Win key', 12: 'Lock keyboard', 13: 'Reset keyboard',
};
export const MOUSE = { 0x01: 'Left click', 0x02: 'Right click', 0x04: 'Middle click' };

// Built-in keyboard functions (matrix b0 = 7): handled by the firmware, never sent to the PC.
export const OEM7 = {
  0x01: 'Lock Win key', 0x04: 'Factory reset', 0x05: 'Bluetooth 1', 0x06: 'Bluetooth 2', 0x07: 'Bluetooth 3',
  0x08: '2.4G wireless', 0x0a: 'Game mode', 0x0c: 'Show battery', 0x18: 'Windows mode', 0x19: 'Android mode',
  0x1a: 'macOS mode', 0x1b: 'Linux mode', 0x1d: 'Knob / mode key',
};
// Built-in lighting functions (matrix b0 = 8), keyed by "b1,b2,b3".
export const OEM8 = {
  '2,0,0': 'Next effect', '2,0,2': 'Effect direction', '3,1,0': 'Backlight +', '3,2,0': 'Backlight −',
  '4,1,0': 'Effect speed +', '4,2,0': 'Effect speed −', '4,0,2': 'Reset effect speed',
};

// Decode one 4-byte matrix record into something a person can read.
export function decodeRecord(rec) {
  const [b0, b1, b2, b3] = rec;
  if (b0 === 0 && b1 === 0 && b2 === 0x5a && b3 === 0xa5) return { kind: 'sentinel', label: '' };
  if (b0 === 0) {
    if (b3 && b1) return { kind: 'combo', label: `${modsLabel(b1)} + ${usageName(b3)}` };
    if (b3) return { kind: 'key', label: usageName(b3), usage: b3 };
    if (b1) return { kind: 'mod', label: modsLabel(b1) };
    return { kind: 'empty', label: 'None' };
  }
  if (b0 === 1) return { kind: 'cmd', label: COMMANDS[b1] ?? `Command #${b1}` };
  if (b0 === 2) return { kind: 'media', label: consumerName((b2 << 8) | b3) };
  if (b0 === 3) return { kind: 'macro', label: `Macro ${b3 + 1}`, slot: b3 + 1 };
  if (b0 === 5) return { kind: 'mouse', label: MOUSE[b1] ?? `Mouse 0x${b1.toString(16)}` };
  if (b0 === 7) return { kind: 'fn', label: OEM7[b3] ?? `Built-in 7-${b3.toString(16)}` };
  if (b0 === 8) return { kind: 'fn', label: OEM8[`${b1},${b2},${b3}`] ?? `Built-in 8-${b1}-${b2}-${b3}` };
  if (b0 === 0x0d) return { kind: 'fnkey', label: 'Fn' };
  return { kind: 'raw', label: hex(rec, ' ') };
}

// ---- Factory default for the base layer, derived from each key's printed legend ----
const VK = {
  27: 0x29, 192: 0x35, 189: 0x2d, 187: 0x2e, 8: 0x2a, 9: 0x2b, 219: 0x2f, 221: 0x30, 220: 0x31, 20: 0x39,
  186: 0x33, 222: 0x34, 13: 0x28, 32: 0x2c, 188: 0x36, 190: 0x37, 191: 0x38, 37: 0x50, 38: 0x52, 39: 0x4f,
  40: 0x51, 46: 0x4c, 36: 0x4a, 33: 0x4b, 34: 0x4e, 145: 0x47, 144: 0x53, 96: 0x62, 111: 0x54, 106: 0x55,
  109: 0x56, 107: 0x57, 110: 0x63, 253: 0x58, 48: 0x27,
};
const VK_MOD = { 160: 0x02, 161: 0x20, 162: 0x01, 91: 0x08, 164: 0x04, 165: 0x40 };
export function defaultRecord(vk) {
  if (vk === 250) return [0x0d, 0, 0, 0]; // Fn
  if (vk === 153) return [0x02, 0, 0x01, 0x92]; // Calculator
  if (VK_MOD[vk]) return [0, VK_MOD[vk], 0, 0];
  let usage = VK[vk];
  if (!usage && vk >= 65 && vk <= 90) usage = 0x04 + (vk - 65);
  if (!usage && vk >= 49 && vk <= 57) usage = 0x1e + (vk - 49);
  if (!usage && vk >= 112 && vk <= 123) usage = 0x3a + (vk - 112);
  if (!usage && vk >= 97 && vk <= 105) usage = 0x59 + (vk - 97);
  return [0, 0, 0, usage || 0];
}
