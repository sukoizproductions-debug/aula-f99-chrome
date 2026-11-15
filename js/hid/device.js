// High-level keyboard session: one link, one cached config page, serialised access.
// Every write is read back and checked; if the keyboard did not take it, the old
// value is restored and an error is thrown instead of pretending it worked.
import {
  AulaError, BRIGHT_MAX, EFFECT_CUSTOM, MACRO_MAX, MATRIX_LEN, OFF, PAGE_LEN, RGB_LEN, SLEEP, SPEED_MAX,
  clamp, colorsFromPlanes, hex, lightingFromPage, pageOk, planesFromColors, sameBytes, sleep, slotOffset, unhex,
} from './protocol.js';
import { buildBank, parseBank } from './macro.js';


export class Keyboard extends EventTarget {
  link = null;
  page = null;
  demo = false;
  lastWrite = 0; // when we last wrote the config page (ms)
  lastTalk = 0; // when we last exchanged anything with the keyboard
  fails = 0;
  busy = 0;
  #chain = Promise.resolve();
  state = {
    connected: false, mode: 'none', model: 'AULA F99 Pro', battery: -1, charging: false, powerFlag: 0,
    effect: 1, custom: false, brightness: 0, speed: 0, color: 7, sleep: 10, firmwareMode: false,
  };

  get wired() { return this.link?.kind === 'wired'; }
  get connected() { return this.state.connected; }

  emit(type = 'change', detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // Run fn alone: HID exchanges must never interleave.
  lock(fn) {
    const run = async () => {
      this.busy++;
      this.emit('busy');
      try { return await fn(); } finally {
        this.busy--;
        this.lastTalk = Date.now();
        this.emit('busy');
      }
    };
    const p = this.#chain.then(run);
    this.#chain = p.catch(() => {});
    return p;
  }

  need() {
    if (!this.link) throw new AulaError('No keyboard connected');
    return this.link;
  }
  needWired(what) {
    const link = this.need();
    if (link.kind !== 'wired') throw new AulaError(`${what} needs the USB cable. Over 2.4G the keyboard only accepts lighting changes.`);
    return link;
  }

  async attach(link, { demo = false } = {}) {
    await this.detach();
    this.link = link;
    this.demo = demo;
    this.fails = 0;
    try { await this.refresh(true); } catch (e) {
      await this.detach();
      throw e;
    }
  }

  async detach() {
    const link = this.link;
    this.link = null;
    this.page = null;
    if (link) await link.close();
    const was = this.state.connected;
    Object.assign(this.state, { connected: false, mode: 'none', battery: -1, charging: false, firmwareMode: false });
    if (was) this.emit('change');
  }

  applyPage(page) {
    this.page = page;
    Object.assign(this.state, lightingFromPage(page));
  }

  async readPageRetry(tries = 4, gap = 120) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { return await this.need().readPage(); } catch (e) { last = e; if (i < tries - 1) await sleep(gap); }
    }
    throw last;
  }

  // Battery every call; identity + config page when `full`.
  refresh(full = false) {
    return this.lock(async () => {
      const link = this.need();
      try {
        const { percent, flag } = await link.power();
        if (full || !this.page) {
          const info = await link.identity();
          this.state.model = info[5] === 0x58 ? 'AULA F99 Pro' : 'AULA F99 series';
          this.applyPage(await this.readPageRetry());
        }
        if (percent >= 0 && percent <= 100) this.state.battery = percent;
        this.state.charging = Boolean(flag & 0x10); // bit 4 only: bit 0 just means "has a battery"
        this.state.powerFlag = flag;
        this.state.connected = true;
        this.state.mode = link.kind;
        this.fails = 0;
      } catch (e) {
        this.fails++;
        throw e;
      } finally { this.emit('change'); }
      return this.state;
    });
  }

  // Re-read the config page (the knob and Fn shortcuts change it behind our back).
  pollPage() {
    return this.lock(async () => {
      const before = this.page;
      this.applyPage(await this.need().readPage());
      if (!before || !sameBytes(before, this.page)) this.emit('change');
      return this.page;
    });
  }

  // ---- config page edits ----
  async #patch(fn) {
    const link = this.need();
    const page = (await this.readPageRetry()).slice();
    fn(page);
    await link.writePage(page);
    this.lastWrite = Date.now();
    await sleep(50);
    const back = await this.readPageRetry();
    if (!sameBytes(back, page)) throw new AulaError('The keyboard did not accept the change');
    this.applyPage(back);
    this.emit('change');
  }
  patch(fn) { return this.lock(() => this.#patch(fn)); }

  // Drag preview: no read, no verify. Follow with the checked setter on release.
  preview(fn) {
    return this.lock(async () => {
      const link = this.need();
      const page = (this.page ?? await link.readPage()).slice();
      fn(page);
      await link.writePage(page);
      this.lastWrite = Date.now();
      this.applyPage(page);
    });
  }

  static #bright(level) {
    const v = clamp(Math.round(level), 0, BRIGHT_MAX);
    return (p) => {
      if (p[OFF.CUSTOM] === 1) p[OFF.CUSTOM_BRIGHT] = v;
      else p[slotOffset(p[OFF.EFFECT])] = v;
    };
  }
  static #speed(level) {
    const v = clamp(Math.round(level), 0, SPEED_MAX);
    return (p) => { const at = slotOffset(p[OFF.EFFECT]) + 1; p[at] = (v << 4) | (p[at] & 0x0f); };
  }

  setEffect(id) {
    const n = clamp(id | 0, 0, EFFECT_CUSTOM);
    return this.patch((p) => {
      // Per-key colours only show with the custom flag set as well as effect 19.
      p[OFF.CUSTOM] = n === EFFECT_CUSTOM ? 1 : 0;
      p[OFF.EFFECT] = n;
    });
  }
  setBrightness(level, { preview = false } = {}) {
    return preview ? this.preview(Keyboard.#bright(level)) : this.patch(Keyboard.#bright(level));
  }
  setSpeed(level, { preview = false } = {}) {
    return preview ? this.preview(Keyboard.#speed(level)) : this.patch(Keyboard.#speed(level));
  }
  setColor(idx) {
    const v = clamp(idx | 0, 0, 7);
    return this.patch((p) => { const at = slotOffset(p[OFF.EFFECT]) + 1; p[at] = (p[at] & 0xf0) | v; });
  }
  setLighting({ effect, brightness, speed, color }) {
    return this.patch((p) => {
      if (effect !== undefined) {
        p[OFF.CUSTOM] = effect === EFFECT_CUSTOM ? 1 : 0;
        p[OFF.EFFECT] = clamp(effect | 0, 0, EFFECT_CUSTOM);
      }
      if (brightness !== undefined) Keyboard.#bright(brightness)(p);
      if (p[OFF.CUSTOM] !== 1 && p[OFF.EFFECT] !== 0) {
        if (speed !== undefined) Keyboard.#speed(speed)(p);
        if (color !== undefined) { const at = slotOffset(p[OFF.EFFECT]) + 1; p[at] = (p[at] & 0xf0) | clamp(color | 0, 0, 7); }
      }
    });
  }
  setSleep(seconds) {
    const row = SLEEP.find((s) => s.seconds === Number(seconds));
    if (!row) throw new AulaError('The keyboard only accepts its nine built-in sleep times');
    return this.patch((p) => { p[OFF.SLEEP] = row.hw; });
  }
  // Leave the firmware's own knob mode; optionally put the lighting back as it was.
  exitFirmwareMode(restoreFrom) {
    return this.patch((p) => {
      p[OFF.MODE] = 0;
      if (restoreFrom) { p[OFF.CUSTOM] = restoreFrom[OFF.CUSTOM]; p[OFF.EFFECT] = restoreFrom[OFF.EFFECT]; }
    });
  }

  readRawPage() { return this.lock(() => this.readPageRetry()); }
  writeRawPage(bytes) {
    if (bytes.length !== PAGE_LEN) throw new AulaError(`The config page is ${PAGE_LEN} bytes; got ${bytes.length}`);
    if (!pageOk(bytes)) throw new AulaError('The config page must end in 5A A5');
    return this.lock(async () => {
      await this.need().writePage(bytes);
      this.lastWrite = Date.now();
      await sleep(400);
      const back = await this.readPageRetry();
      this.applyPage(back);
      this.emit('change');
      return sameBytes(back, bytes);
    });
  }

  // ---- key layers ----
  readLayers() {
    return this.lock(async () => {
      const link = this.need();
      const out = [];
      for (let l = 0; l < (link.kind === 'wired' ? 4 : 1); l++) out.push(await link.readMatrix(l));
      return out;
    });
  }

  async #writeLayer(link, layer, data) {
    const old = await link.readMatrix(layer);
    if (sameBytes(old, data)) return data;
    await link.writeMatrix(layer, data);
    await sleep(100);
    const back = await link.readMatrix(layer);
    if (!sameBytes(back, data)) {
      try { await link.writeMatrix(layer, old); } catch { /* best effort */ }
      throw new AulaError('The keyboard did not accept the key change; the previous layout was restored');
    }
    return back;
  }
  writeLayer(layer, data) {
    if (data.length !== MATRIX_LEN) throw new AulaError(`A key layer must be ${MATRIX_LEN} bytes`);
    return this.lock(() => this.#writeLayer(this.needWired('Remapping'), layer, data));
  }
  // records: Map or array of [keyIndex, [b0,b1,b2,b3]]
  setRecords(layer, records) {
    return this.lock(async () => {
      const link = this.needWired('Remapping');
      const next = (await link.readMatrix(layer)).slice();
      for (const [idx, rec] of records) next.set(rec, idx * 4);
      return this.#writeLayer(link, layer, next);
    });
  }
  setRecord(layer, idx, rec) { return this.setRecords(layer, [[idx, rec]]); }

  // ---- per-key colour (planes: R x126, G x126, B x126) ----
  readColors() { return this.lock(() => this.need().readRgb()); }
  writeColors(planes) {
    return this.lock(async () => {
      const link = this.needWired('Per-key colour');
      const old = await link.readRgb();
      await link.writeRgb(planes);
      await sleep(80);
      const back = await link.readRgb();
      if (!sameBytes(back, planes)) {
        try { await link.writeRgb(old); } catch { /* best effort */ }
        throw new AulaError('The keyboard did not accept the colours; the previous ones were restored');
      }
    });
  }

  // ---- macros ----
  readMacros() {
    return this.lock(async () => parseBank(await this.needWired('Reading macros').readMacros()));
  }
  saveMacros(macros) {
    const blob = buildBank(macros);
    return this.lock(async () => {
      const link = this.needWired('Writing macros');
      const old = await link.readMacros();
      await link.writeMacros(blob);
      await sleep(100);
      const back = await link.readMacros(blob.length);
      if (!sameBytes(back, blob)) {
        try { await link.writeMacros(old); } catch { /* best effort */ }
        throw new AulaError('The keyboard did not accept the macros; the previous ones were restored');
      }
    });
  }

  // ---- whole-keyboard snapshot / restore ----
  snapshot() {
    return this.lock(async () => {
      const link = this.need();
      const snap = {
        app: 'aula-hub-web', version: 2, at: new Date().toISOString(), model: this.state.model,
        link: link.kind, matrix: {},
      };
      for (let l = 0; l < (link.kind === 'wired' ? 4 : 1); l++) snap.matrix[l] = hex(await link.readMatrix(l));
      snap.page = hex(await this.readPageRetry());
      snap.rgb = hex(await link.readRgb());
      if (link.kind === 'wired') snap.macros = hex(await link.readMacros());
      return snap;
    });
  }

  // Accepts our snapshots and the JSON the original desktop app exported.
  restore(snap, { parts = ['matrix', 'page', 'rgb', 'macros'] } = {}) {
    return this.lock(async () => {
      const link = this.need();
      const wired = link.kind === 'wired';
      const done = [];
      const skipped = [];
      const attempt = async (label, wiredOnly, fn) => {
        if (wiredOnly && !wired) { skipped.push(`${label} (needs the USB cable)`); return; }
        try { await fn(); done.push(label); } catch (e) { skipped.push(`${label} (${e.message})`); }
      };
      if (parts.includes('matrix')) {
        for (const [key, raw] of Object.entries(snap.matrix ?? {}).sort()) {
          await attempt(`Layer ${Number(key) + 1}`, true, () => this.#writeLayer(link, Number(key), unhex(raw)));
        }
      }
      if (parts.includes('page') && snap.page) {
        await attempt('Lighting and sleep', false, async () => {
          const page = unhex(snap.page);
          if (page.length !== PAGE_LEN || !pageOk(page)) throw new AulaError('not a valid config page');
          page[OFF.MODE] = 0; // never restore the keyboard into firmware mode
          await link.writePage(page);
          this.lastWrite = Date.now();
          await sleep(120);
          this.applyPage(await this.readPageRetry());
        });
      }
      if (parts.includes('rgb') && snap.rgb) {
        await attempt('Per-key colours', true, async () => {
          const planes = typeof snap.rgb === 'string' ? unhex(snap.rgb) : planesFromColors(snap.rgb);
          if (planes.length !== RGB_LEN) throw new AulaError('colour table has the wrong size');
          await link.writeRgb(planes);
        });
      }
      if (parts.includes('macros') && snap.macros) {
        await attempt('Macros', true, async () => {
          const blob = unhex(snap.macros);
          if (blob.length > MACRO_MAX) throw new AulaError('macro bank is too large');
          await link.writeMacros(blob);
        });
      }
      this.emit('change');
      return { done, skipped };
    });
  }

  factoryReset() {
    return this.lock(async () => {
      await this.needWired('Factory reset').reset();
      await sleep(1200);
      this.applyPage(await this.readPageRetry(6, 250));
      this.emit('change');
    });
  }
}

export { colorsFromPlanes, planesFromColors };
