// Macro bank encoding (wired commands 0x05 / 0x85).
//
//   bank   = [ per macro: u16 offset, u16 length ] + records
//   record = [ u8 nameBytes ][ UTF-16LE name ][ steps x 4 bytes ]
//   step   = b0: bits 0-3 delay high nibble, bits 4-6 type, bit 7 = key down
//            b1, b2: delay (20 bits total, milliseconds)
//            b3: HID usage
import { AulaError, MACRO_MAX } from './protocol.js';

export const NAME_MAX = 30;
export const DELAY_MAX = 0xfffff;

export function encodeStep({ usage, delay = 0, press = true, kind = 0 }) {
  const d = Math.max(0, Math.min(DELAY_MAX, Math.round(delay)));
  let b0 = ((d >> 16) & 0x0f) | ((kind & 0x07) << 4);
  if (press && kind < 3) b0 |= 0x80;
  return [b0, (d >> 8) & 0xff, d & 0xff, usage & 0xff];
}

export function decodeStep(b) {
  return {
    kind: (b[0] >> 4) & 0x07,
    delay: ((b[0] & 0x0f) << 16) | (b[1] << 8) | b[2],
    press: Boolean(b[0] & 0x80),
    usage: b[3],
  };
}

function nameBytes(name) {
  const s = String(name ?? '').slice(0, NAME_MAX);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out.push(c & 0xff, c >> 8);
  }
  return out;
}

export function recordSize(macro) {
  return 1 + nameBytes(macro.name).length + macro.steps.length * 4;
}
export function bankSize(macros) {
  return macros.reduce((n, m) => n + 4 + recordSize(m), 0);
}

// macros: [{ name, steps: [{ usage, delay, press }] }] -> Uint8Array
export function buildBank(macros) {
  // An empty directory entry tells the firmware (and parseBank) there are no macros.
  if (!macros.length) return new Uint8Array(4);
  const dir = [];
  const body = [];
  let off = macros.length * 4;
  for (const m of macros) {
    const name = nameBytes(m.name);
    const rec = [name.length, ...name];
    for (const s of m.steps) rec.push(...encodeStep(s));
    dir.push(off & 0xff, off >> 8, rec.length & 0xff, rec.length >> 8);
    body.push(...rec);
    off += rec.length;
  }
  if (off > MACRO_MAX) throw new AulaError(`Macros need ${off} bytes; the keyboard holds ${MACRO_MAX}`);
  return Uint8Array.from([...dir, ...body]);
}

export function parseBank(blob) {
  const out = [];
  let i = 0;
  while (i + 4 <= blob.length) {
    const off = blob[i] | (blob[i + 1] << 8);
    const len = blob[i + 2] | (blob[i + 3] << 8);
    if (off < 4 || len === 0 || off + len > blob.length) break;
    const nlen = blob[off];
    if (nlen > NAME_MAX * 2 || 1 + nlen > len) break;
    let name = '';
    for (let j = 0; j + 1 < nlen; j += 2) name += String.fromCharCode(blob[off + 1 + j] | (blob[off + 2 + j] << 8));
    const steps = [];
    for (let j = off + 1 + nlen; j + 4 <= off + len; j += 4) steps.push(decodeStep(blob.subarray(j, j + 4)));
    out.push({ name, steps });
    i += 4;
    if (i >= blob[0] + (blob[1] << 8)) break; // reached the first record: directory is over
  }
  return out;
}
