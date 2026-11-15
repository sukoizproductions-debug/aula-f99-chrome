// What a key can be bound to, grouped the way the picker shows it.
// Every entry is { label, rec } where rec is the 4-byte matrix record to write.
import { COMMANDS, CONSUMER, MOD_BITS, MOUSE, OEM7, OEM8, USAGE_NAMES, usageName } from '../hid/protocol.js';

const key = (usage) => ({ label: usageName(usage), rec: [0, 0, 0, usage] });
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const KEYBOARD = [
  ...range(0x04, 0x27), // letters, digits
  0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x39, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38,
  ...range(0x3a, 0x45), // F1-F12
  0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x52, 0x51, 0x50, 0x4f, 0x65,
].map(key);

const NUMPAD = [0x53, 0x54, 0x55, 0x56, 0x57, 0x58, ...range(0x59, 0x63)].map(key);
// The keyboard's HID descriptor stops at F21; F22-F24 cannot be sent.
const EXTRA_F = range(0x68, 0x70).map(key);

const MODIFIERS = MOD_BITS.map((m) => ({ label: m.name === 'Win' ? 'Win' : m.name, rec: [0, m.bit, 0, 0] }));

const combo = (mods, usage, what) => ({
  label: `${MOD_BITS.filter((m) => mods & m.bit).map((m) => m.name).join('+')}+${USAGE_NAMES[usage]}`,
  hint: what,
  rec: [0, mods, 0, usage],
});
const SHORTCUTS = [
  combo(0x01, 0x06, 'Copy'), combo(0x01, 0x19, 'Paste'), combo(0x01, 0x1b, 'Cut'), combo(0x01, 0x1d, 'Undo'),
  combo(0x01, 0x1c, 'Redo'), combo(0x01, 0x04, 'Select all'), combo(0x01, 0x16, 'Save'), combo(0x01, 0x09, 'Find'),
  combo(0x01, 0x13, 'Print'), combo(0x01, 0x17, 'New tab'), combo(0x01, 0x1a, 'Close tab'),
  combo(0x03, 0x17, 'Reopen tab'), combo(0x04, 0x2b, 'Switch window'), combo(0x04, 0x3d, 'Close window'),
  combo(0x08, 0x08, 'File Explorer'), combo(0x08, 0x07, 'Show desktop'), combo(0x08, 0x0f, 'Lock screen'),
  combo(0x08, 0x15, 'Run'), combo(0x0a, 0x16, 'Screenshot'), combo(0x03, 0x29, 'Task Manager'),
];

const MEDIA_ORDER = [
  0x00cd, 0x00b7, 0x00b6, 0x00b5, 0x00e9, 0x00ea, 0x00e2, 0x006f, 0x0070,
  0x018a, 0x0192, 0x0194, 0x0197, 0x019c, 0x0196, 0x0223, 0x0221, 0x0227, 0x0224, 0x0225,
];
const MEDIA = MEDIA_ORDER.map((u) => ({ label: CONSUMER[u], rec: [2, 0, u >> 8, u & 0xff] }));

const MOUSE_ITEMS = Object.entries(MOUSE).map(([mask, label]) => ({ label, rec: [5, Number(mask), 0, 0] }));
const COMMAND_ITEMS = Object.entries(COMMANDS).map(([n, label]) => ({ label, rec: [1, Number(n), 0, 0] }));

const BUILTIN = [
  ...Object.entries(OEM8).map(([k, label]) => ({ label, rec: [8, ...k.split(',').map(Number)] })),
  ...Object.entries(OEM7)
    .filter(([code]) => Number(code) !== 0x1d) // the knob marker belongs to the knob only
    .map(([code, label]) => ({ label, rec: [7, 0, 0, Number(code)] })),
];

export const CATALOG = [
  { id: 'keys', name: 'Keyboard', items: KEYBOARD },
  { id: 'numpad', name: 'Numpad & F13+', items: [...NUMPAD, ...EXTRA_F] },
  { id: 'mods', name: 'Modifiers', items: MODIFIERS },
  { id: 'shortcuts', name: 'Shortcuts', items: SHORTCUTS },
  { id: 'media', name: 'Media & apps', items: MEDIA },
  { id: 'mouse', name: 'Mouse', items: MOUSE_ITEMS },
  { id: 'commands', name: 'Commands', items: COMMAND_ITEMS, note: 'Run by the keyboard itself, aimed at Windows.' },
  { id: 'builtin', name: 'Keyboard functions', items: BUILTIN, note: 'Handled inside the keyboard; nothing is sent to the computer.' },
];

// The functions other projects have confirmed the knob record accepts.
export const KNOB_CHOICES = [
  { label: 'Factory default', hint: 'Volume, press to mute, hold to switch mode', rec: [0x07, 0, 0, 0x1d] },
  { label: 'Play / Pause', rec: [2, 0, 0x00, 0xcd] },
  { label: 'Mute', rec: [2, 0, 0x00, 0xe2] },
  { label: 'Next track', rec: [2, 0, 0x00, 0xb5] },
  { label: 'Previous track', rec: [2, 0, 0x00, 0xb6] },
  { label: 'Stop', rec: [2, 0, 0x00, 0xb7] },
  { label: 'Volume +', rec: [2, 0, 0x00, 0xe9] },
  { label: 'Volume −', rec: [2, 0, 0x00, 0xea] },
];
