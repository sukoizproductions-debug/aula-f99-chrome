// User preferences and saved items. Everything lives in this browser's localStorage;
// nothing is sent anywhere.
const KEY = 'aula-hub:prefs';
const POINTS_KEY = 'aula-hub:restore-points';
const MAX_POINTS = 5;

export const ACCENTS = ['#4f6ef7', '#7c4dff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#64748b'];

export const DEFAULTS = {
  theme: 'system', // system | light | dark
  accent: ACCENTS[0],
  density: 'comfortable', // comfortable | compact
  sidebar: 'full', // full | icons
  startPage: 'lighting',
  boardSize: 'fit', // fit | medium | small
  keyLabels: 'binding', // binding | legend
  motion: true,
  autoApplyColors: true,
  guard: true, // pull the keyboard out of firmware mode automatically
  guardBackground: false, // keep checking while this window is not focused
  batteryPoll: 60, // seconds, 0 = off
  autoSnapshot: true, // save a restore point on first wired connect of a session
  autoReconnect: true,
  advanced: false,
  presets: [], // [{ name, effect, brightness, speed, color }]
  palette: ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#32d5f5', '#0a84ff', '#7c4dff', '#ff2d92', '#ffffff'],
  profiles: [], // [{ name, rgb: hex planes }]
  audioStyle: 'balanced',
  audioGain: 1,
};

const listeners = new Set();
let data = load();

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
}

export const prefs = {
  get: (k) => data[k],
  all: () => ({ ...data }),
  set(k, v) {
    data[k] = v;
    save();
    listeners.forEach((fn) => fn(k, v));
  },
  reset() {
    // Keep the things the user made; reset only the settings.
    const keep = { presets: data.presets, palette: data.palette, profiles: data.profiles };
    data = { ...DEFAULTS, ...keep };
    save();
    listeners.forEach((fn) => fn(null));
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

// ---- restore points: full keyboard snapshots, newest first ----
export const restorePoints = {
  list() {
    try { return JSON.parse(localStorage.getItem(POINTS_KEY) || '[]'); } catch { return []; }
  },
  add(snapshot, label) {
    const points = [{ id: Date.now().toString(36), label, snapshot }, ...this.list()].slice(0, MAX_POINTS);
    try { localStorage.setItem(POINTS_KEY, JSON.stringify(points)); return true; } catch { return false; }
  },
  remove(id) {
    localStorage.setItem(POINTS_KEY, JSON.stringify(this.list().filter((p) => p.id !== id)));
  },
};

export function applyAppearance() {
  const root = document.documentElement;
  const dark = data.theme === 'dark' || (data.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.density = data.density;
  root.dataset.sidebar = data.sidebar;
  root.dataset.board = data.boardSize;
  root.dataset.motion = data.motion ? 'on' : 'off';
  root.style.setProperty('--accent', data.accent);
}
