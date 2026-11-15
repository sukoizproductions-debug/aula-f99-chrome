// Audio-reactive lighting: capture sound in the browser, analyse it, repaint the
// per-key colour table many times a second. Wired only (2.4G cannot write colours).
import { PHYSICAL_ORDER } from './data/keymap.js';
import { AulaError, EFFECT_CUSTOM, RGB_LEN, RGB_SLOTS } from './hid/protocol.js';

// [low, mid, high] band weights, smoothing (higher = calmer), gain, frames per second.
export const STYLES = [
  { id: 'gentle', name: 'Gentle', w: [1.2, 0.85, 0.4], smooth: 0.78, gain: 0.78, fps: 16 },
  { id: 'rock', name: 'Rock', w: [0.9, 1.0, 1.5], smooth: 0.18, gain: 1.05, fps: 30 },
  { id: 'balanced', name: 'Balanced', w: [1.0, 1.0, 1.0], smooth: 0.45, gain: 0.92, fps: 22 },
  { id: 'vocal', name: 'Vocal', w: [0.5, 1.6, 0.55], smooth: 0.35, gain: 0.95, fps: 24 },
  { id: 'stream', name: 'Stream', w: [1.1, 0.9, 0.6], smooth: 0.66, gain: 0.82, fps: 14 },
  { id: 'bloom', name: 'Bloom', w: [1.1, 1.1, 1.2], smooth: 0.22, gain: 1.1, fps: 30 },
  { id: 'pearls', name: 'Pearls', w: [0.7, 1.1, 1.6], smooth: 0.1, gain: 1.0, fps: 30 },
  { id: 'moonlight', name: 'Moonlight', w: [1.35, 1.0, 0.8], smooth: 0.16, gain: 1.05, fps: 28 },
  { id: 'cascade', name: 'Cascade', w: [1.25, 1.05, 0.95], smooth: 0.3, gain: 1.0, fps: 26 },
  { id: 'drizzle', name: 'Drizzle', w: [0.85, 1.15, 0.75], smooth: 0.55, gain: 0.88, fps: 20 },
];

const RMS_FLOOR = 0.003;
const RMS_SPAN = 0.09;

function hsv(hDeg, s, v) {
  const c = v * s;
  const hp = (((hDeg % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

export class Visualizer {
  running = false;
  level = 0;
  style = STYLES[2];
  gain = 1;
  onFrame = null; // (colorsByIdx: Map, level) for the on-screen preview
  onStop = null;

  constructor(kb) { this.kb = kb; }

  setStyle(id) { this.style = STYLES.find((s) => s.id === id) ?? STYLES[2]; }

  // source: 'share' (tab or system audio via the screen-share picker) or 'mic'.
  // Must be called from a click: the browser shows a permission prompt.
  async start(source) {
    if (this.running) return;
    if (!this.kb.wired) throw new AulaError('Audio-reactive lighting needs the USB cable');
    let stream;
    if (source === 'mic') {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } else {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 16, height: 16, frameRate: 1 }, audio: true,
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        throw new AulaError('No audio was shared. Pick a tab or screen and tick "Also share audio".');
      }
    }
    this.stream = stream;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);
    stream.getAudioTracks()[0].addEventListener('ended', () => this.stop());

    // Remember what to put back when we stop.
    this.before = { planes: (await this.kb.readColors()).slice(), effect: this.kb.state.effect };
    if (this.kb.state.effect !== EFFECT_CUSTOM || !this.kb.state.custom) await this.kb.setEffect(EFFECT_CUSTOM);

    this.time = new Float32Array(this.analyser.fftSize);
    this.freq = new Float32Array(this.analyser.frequencyBinCount);
    this.prev = new Float32Array(PHYSICAL_ORDER.length * 3);
    this.running = true;
    this.pending = false;
    this.loop();
  }

  loop() {
    if (!this.running) return;
    const started = performance.now();
    const planes = this.frame();
    if (!this.pending) {
      this.pending = true;
      this.kb.writeColorsFast(planes).catch((e) => { this.error = e; this.stop(); }).finally(() => { this.pending = false; });
    }
    const wait = Math.max(4, 1000 / this.style.fps - (performance.now() - started));
    this.timer = setTimeout(() => this.loop(), wait);
  }

  frame() {
    const { analyser, time, freq, style, prev } = this;
    analyser.getFloatTimeDomainData(time);
    analyser.getFloatFrequencyData(freq);
    let sq = 0;
    for (let i = 0; i < time.length; i++) sq += time[i] * time[i];
    const rms = Math.sqrt(sq / time.length);
    const level = Math.max(0, Math.min(1, ((rms - RMS_FLOOR) / RMS_SPAN) * this.gain));
    this.level = level;

    const hzPerBin = this.ctx.sampleRate / analyser.fftSize;
    const band = (lo, hi) => {
      let sum = 0, n = 0;
      for (let i = Math.max(1, Math.floor(lo / hzPerBin)); i < Math.min(freq.length, Math.ceil(hi / hzPerBin)); i++) {
        sum += 10 ** (freq[i] / 20);
        n++;
      }
      return n ? sum / n : 0;
    };
    const low = band(30, 250) * style.w[0];
    const mid = band(250, 2000) * style.w[1];
    const high = band(2000, 12000) * style.w[2];
    const total = low + mid + high;
    const tilt = total > 1e-9 ? (high - low) / total : 0; // -1 bassy .. 1 bright
    const now = performance.now() / 1000;
    const baseHue = 265 + tilt * 95 + now * 26;
    const sat = Math.max(0.3, Math.min(1, 0.55 + Math.abs(tilt) * 0.35));
    const wobble = 3 + (total > 1e-9 ? high / total : 0) * 9;

    const count = PHYSICAL_ORDER.length;
    const planes = new Uint8Array(RGB_LEN);
    const preview = this.onFrame ? new Map() : null;
    for (let i = 0; i < count; i++) {
      const phase = (i / (count - 1)) * Math.PI * 2;
      const wob = 0.62 + 0.38 * Math.sin(phase * 1.2 - now * wobble);
      const val = Math.max(0, Math.min(1, level * wob * style.gain));
      const rgb = hsv(baseHue + phase * 22, sat, val);
      const slot = PHYSICAL_ORDER[i];
      const out = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        prev[i * 3 + c] = prev[i * 3 + c] * style.smooth + rgb[c] * (1 - style.smooth);
        out[c] = Math.round(Math.max(0, Math.min(1, prev[i * 3 + c])) * 255);
        if (slot < RGB_SLOTS) planes[c * RGB_SLOTS + slot] = out[c];
      }
      preview?.set(slot, out);
    }
    this.onFrame?.(preview, level);
    return planes;
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.level = 0;
    // Put the user's colours and effect back; ignore errors if the keyboard is gone.
    try {
      if (this.before && this.kb.wired) {
        await this.kb.writeColors(this.before.planes);
        if (this.before.effect !== EFFECT_CUSTOM) await this.kb.setEffect(this.before.effect);
      }
    } catch { /* unplugged mid-song */ }
    this.onStop?.(this.error);
    this.error = null;
  }
}
