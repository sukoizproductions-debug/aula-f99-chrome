// WebHID transports. Two links with one shape:
//   WiredLink    - 520-byte feature reports, report id 6
//   WirelessLink - 20-byte reports through the 2.4G receiver, report id 0x13 (read-mostly)
import {
  AulaError, CHUNK, CMD, HEADER, MACRO_MAX, MATRIX_LEN, PAGE_LEN, REPORT_LEN, RF, RGB_LEN,
  WIRED_FILTER, WIRELESS_FILTER, WIRELESS_LEN, pageOk, sleep,
} from './protocol.js';

const WIRED_ID = 6;
const RF_ID = 0x13;

function featureBytes(device, reportId) {
  for (const col of device.collections ?? []) {
    for (const rep of col.featureReports ?? []) {
      if (rep.reportId !== reportId) continue;
      const bits = (rep.items ?? []).reduce((n, it) => n + (it.reportSize ?? 0) * (it.reportCount ?? 0), 0);
      if (bits > 0) return Math.ceil(bits / 8);
    }
  }
  return REPORT_LEN - 1;
}

export class WiredLink {
  kind = 'wired';
  canWrite = true;

  constructor(device) {
    this.device = device;
    this.payloadLen = featureBytes(device, WIRED_ID); // bytes after the report id
    // Pauses the firmware needs around each report.
    this.gap = { pre: 15, readWait: 30, post: 50 };
  }

  async close() {
    try { if (this.device.opened) await this.device.close(); } catch { /* already gone */ }
  }

  frame(code, param, total, index, length, chunk) {
    const buf = new Uint8Array(this.payloadLen); // buf[n] is frame byte n+1
    buf[0] = code;
    buf[1] = param;
    buf[3] = total;
    buf[4] = index;
    buf[5] = length & 0xff;
    buf[6] = (length >> 8) & 0xff;
    if (chunk) buf.set(chunk, HEADER - 1);
    return buf;
  }

  async send(buf) {
    let last;
    for (let i = 0; i < 3; i++) {
      try { await this.device.sendFeatureReport(WIRED_ID, buf); return; } catch (e) { last = e; await sleep(70); }
    }
    throw new AulaError(`Could not send to the keyboard (${last?.message ?? 'unknown error'})`);
  }

  async receive(code) {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        const view = await this.device.receiveFeatureReport(WIRED_ID);
        const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        // Chrome includes the report id as byte 0; tolerate a backend that strips it.
        if (raw.length >= HEADER && raw[0] === WIRED_ID && raw[1] === code) return raw;
        if (raw.length >= HEADER - 1 && raw[0] === code) {
          const full = new Uint8Array(raw.length + 1);
          full[0] = WIRED_ID;
          full.set(raw, 1);
          return full;
        }
        last = new AulaError('The keyboard answered a different command');
      } catch (e) { last = e; }
      await sleep(70);
    }
    throw new AulaError(`Could not read from the keyboard (${last?.message ?? 'no reply'})`);
  }

  async read(code, param, length) {
    const total = Math.max(1, Math.ceil(length / CHUNK));
    const out = new Uint8Array(length);
    let at = 0;
    for (let i = 0; i < total && at < length; i++) {
      const want = Math.min(CHUNK, length - i * CHUNK);
      await sleep(this.gap.pre);
      await this.send(this.frame(code, param, total, i, want));
      await sleep(this.gap.readWait);
      const rep = await this.receive(code);
      let got = rep[6] | (rep[7] << 8);
      if (got === 0 || got > want || got > rep.length - HEADER) got = Math.min(want, rep.length - HEADER);
      out.set(rep.subarray(HEADER, HEADER + got), at);
      at += got;
    }
    return out;
  }

  async write(code, param, data, gap = this.gap) {
    const total = Math.max(1, Math.ceil(data.length / CHUNK));
    for (let i = 0; i < total; i++) {
      const chunk = data.subarray(i * CHUNK, (i + 1) * CHUNK);
      if (gap.pre) await sleep(gap.pre);
      await this.send(this.frame(code, param, total, i, chunk.length, chunk));
      if (gap.post) await sleep(gap.post);
    }
  }

  identity() { return this.read(CMD.GET_INFO, 1, 6); }
  async power() { const d = await this.read(CMD.GET_POWER, 2, 2); return { percent: d[0], flag: d[1] }; }
  async readPage() {
    const page = await this.read(CMD.GET_PAGE, 0, PAGE_LEN);
    if (!pageOk(page)) throw new AulaError('Config page failed its check');
    return page;
  }
  writePage(page) {
    if (!pageOk(page)) throw new AulaError('Config page is missing its 5A A5 marker');
    return this.write(CMD.SET_PAGE, 0, page);
  }
  readMatrix(layer) { return this.read(CMD.GET_MATRIX, layer & 3, MATRIX_LEN); }
  writeMatrix(layer, data) {
    if (data.length !== MATRIX_LEN) throw new AulaError(`A key layer must be ${MATRIX_LEN} bytes`);
    return this.write(CMD.SET_MATRIX, layer & 3, data);
  }
  readRgb() { return this.read(CMD.GET_RGB, 0, RGB_LEN); }
  writeRgb(planes) { return this.write(CMD.SET_RGB, 0, planes); }
  readMacros(length = MACRO_MAX) { return this.read(CMD.GET_MACRO, 0, length); }
  writeMacros(blob) {
    if (blob.length > MACRO_MAX) throw new AulaError('Macro bank is too large');
    return this.write(CMD.SET_MACRO, 0, blob);
  }
  reset() { return this.write(CMD.RESET, 0, new Uint8Array(0)); }
}

const WIRED_ONLY = 'needs the USB cable: the 2.4G link is read-only for this';

export class WirelessLink {
  kind = 'wireless';
  canWrite = false;

  constructor(device) {
    this.device = device;
    this.queue = [];
    this.waiter = null;
    this.onReport = (e) => {
      if (e.reportId !== RF_ID) return;
      const body = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      const pkt = new Uint8Array(WIRELESS_LEN);
      pkt[0] = RF_ID;
      pkt.set(body.subarray(0, WIRELESS_LEN - 1), 1);
      this.queue.push(pkt);
      this.waiter?.();
    };
    device.addEventListener('inputreport', this.onReport);
  }

  async close() {
    this.device.removeEventListener('inputreport', this.onReport);
    try { if (this.device.opened) await this.device.close(); } catch { /* already gone */ }
  }

  static packet(cmd, op, data, total, index) {
    const p = new Uint8Array(WIRELESS_LEN);
    p[0] = RF_ID;
    p[1] = cmd;
    p[2] = total;
    p[3] = index;
    p[4] = (op << 4) | data.length;
    p.set(data, 5);
    let sum = 0;
    for (let i = 0; i < 19; i++) sum += p[i];
    p[19] = sum & 0xff;
    return p;
  }

  sendPacket(p) { return this.device.sendReport(RF_ID, p.subarray(1)); }

  nextPacket(ms) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiter = null; resolve(null); }, ms);
      this.waiter = () => { clearTimeout(timer); this.waiter = null; resolve(this.queue.shift()); };
    });
  }

  async read(cmd, timeout = 1800) {
    this.queue.length = 0;
    await this.sendPacket(WirelessLink.packet(cmd, 0, new Uint8Array(0), 1, 0));
    const deadline = Date.now() + timeout;
    const chunks = new Map();
    let total = 0;
    while (Date.now() < deadline) {
      const r = await this.nextPacket(Math.max(1, deadline - Date.now()));
      if (!r) break;
      let sum = 0;
      for (let i = 0; i < 19; i++) sum += r[i];
      if ((r[1] & 0x7f) !== (cmd & 0x7f) || r[19] !== (sum & 0xff)) continue;
      if (r[1] & 0x80) throw new AulaError('The keyboard refused that read');
      total = r[2] || total;
      chunks.set(r[3], r.slice(5, 5 + (r[4] & 0x0f)));
      if (total && chunks.size === total) break;
    }
    if (!chunks.size) throw new AulaError('No reply over 2.4G. The keyboard may be asleep: press a key and retry.');
    const parts = [...chunks.keys()].sort((a, b) => a - b).map((k) => chunks.get(k));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  async write(cmd, data) {
    this.queue.length = 0;
    const total = Math.max(1, Math.ceil(data.length / 14));
    for (let i = 0; i < total; i++) {
      await this.sendPacket(WirelessLink.packet(cmd, 1, data.subarray(i * 14, (i + 1) * 14), total, i));
      await sleep(20);
    }
    await sleep(50);
  }

  async identity() { return (await this.read(RF.IDENTITY)).subarray(0, 6); }
  async power() {
    const d = await this.read(RF.GET_BATTERY);
    if (d.length < 2) throw new AulaError('Battery reply was too short');
    return { percent: d[0], flag: d[1] };
  }
  async readPage() {
    const page = (await this.read(RF.GET_PAGE)).subarray(0, PAGE_LEN);
    if (!pageOk(page)) throw new AulaError('Config page failed its check');
    return page;
  }
  writePage(page) {
    if (!pageOk(page)) throw new AulaError('Config page is missing its 5A A5 marker');
    return this.write(RF.SET_PAGE, page);
  }
  // Only the base layer, and only its first 126 keys, are readable over 2.4G.
  async readMatrix(layer) {
    if (layer !== 0) throw new AulaError(`Reading layer ${layer} ${WIRED_ONLY}`);
    const out = new Uint8Array(MATRIX_LEN);
    out.set((await this.read(RF.GET_MATRIX)).subarray(0, MATRIX_LEN));
    return out;
  }
  async readRgb() {
    const d = await this.read(RF.GET_RGB);
    if (d.length < RGB_LEN) throw new AulaError(`Colour table too short (${d.length} bytes)`);
    return d.subarray(0, RGB_LEN);
  }
  writeMatrix() { throw new AulaError(`Remapping ${WIRED_ONLY}`); }
  writeRgb() { throw new AulaError(`Per-key colour ${WIRED_ONLY}`); }
  readMacros() { throw new AulaError(`Reading macros ${WIRED_ONLY}`); }
  writeMacros() { throw new AulaError(`Writing macros ${WIRED_ONLY}`); }
  reset() { throw new AulaError(`Factory reset ${WIRED_ONLY}`); }
}

export const hidSupported = () => typeof navigator !== 'undefined' && 'hid' in navigator;

const hasPage = (d, page) => (d.collections ?? []).some((c) => c.usagePage === page);
const isWired = (d) => d.vendorId === WIRED_FILTER.vendorId && d.productId === WIRED_FILTER.productId;
const isWireless = (d) => d.vendorId === WIRELESS_FILTER.vendorId && d.productId === WIRELESS_FILTER.productId;

// Turn a list of granted HIDDevices into a working link. The cable wins: while it is
// plugged in, the keyboard ignores the receiver completely.
export async function openLink(devices) {
  for (const d of devices.filter((x) => isWired(x) && hasPage(x, WIRED_FILTER.usagePage))) {
    const link = new WiredLink(d);
    try {
      if (!d.opened) await d.open();
      await link.identity(); // several 0xFF00 collections exist; only the data one answers
      return link;
    } catch { await link.close(); }
  }
  for (const d of devices.filter((x) => isWireless(x) && hasPage(x, WIRELESS_FILTER.usagePage))) {
    try {
      if (!d.opened) await d.open();
      return new WirelessLink(d);
    } catch { /* try the next interface */ }
  }
  return null;
}

// Must be called from a user gesture (a click).
export async function requestLink() {
  const picked = await navigator.hid.requestDevice({ filters: [WIRED_FILTER, WIRELESS_FILTER] });
  if (!picked.length) return null;
  return openLink(picked);
}

// Devices the user already allowed on an earlier visit.
export async function grantedLink() {
  const devices = await navigator.hid.getDevices();
  return devices.length ? openLink(devices) : null;
}
