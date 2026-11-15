// App shell: connection, navigation, background checks.
import { DemoDevice } from './hid/demo.js';
import { Keyboard } from './hid/device.js';
import { OFF, WIRED_FILTER, WIRELESS_FILTER } from './hid/protocol.js';
import { WiredLink, grantedLink, hidSupported, openLink } from './hid/transport.js';
import { applyAppearance, prefs, restorePoints } from './prefs.js';
import colors from './ui/colors.js';
import devicePage from './ui/devicepage.js';
import { add, clear, h, icon, toast } from './ui/dom.js';
import keys from './ui/keys.js';
import lighting from './ui/lighting.js';
import macros from './ui/macros.js';
import prefsPage from './ui/prefspage.js';

const kb = new Keyboard();
const pages = [lighting, colors, keys, macros, devicePage, prefsPage];

const app = {
  kb,
  prefs,
  pages,
  page: null,
  cache: { layers: null, macros: null, colors: null },
  lastGoodPage: null, // config page from before the keyboard entered firmware mode
  toast,
  // Run a keyboard action; show its error instead of throwing. Returns false on failure.
  async run(fn, okMessage) {
    try {
      const result = await fn();
      if (okMessage) toast(okMessage, 'ok');
      return result;
    } catch (e) {
      if (e?.name !== 'NotAllowedError' || !/permission|dismiss|denied/i.test(e.message)) {
        toast(e?.message || String(e), 'error');
      }
      if (kb.link && !kb.demo && kb.link.device.opened === false) lost('The keyboard was disconnected');
      return false;
    }
  },
  // Forget what we read from the keyboard (after restore, reset, reconnect).
  invalidate(redraw = true) {
    this.cache = { layers: null, macros: null, colors: null };
    for (const p of pages) p.reset?.();
    if (redraw && kb.connected) navigate(this.page, true);
  },
};

// ---------- shell ----------
const nav = h('nav', { class: 'nav', 'aria-label': 'Sections' });
const title = h('h1');
const status = h('div', { class: 'status' });
const content = h('main', { class: 'content' });
const landing = h('div', { class: 'landing' });
const mounted = new Map();

document.getElementById('app').append(
  h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, h('img', { src: 'assets/duck.svg', alt: '', width: 28, height: 28 }), h('span', { text: 'Aula in Chrome' })),
    nav,
    h('div', { class: 'sidebar-foot' },
      h('a', { href: 'https://github.com/sukoizproductions-debug/aula-f99-chrome', target: '_blank', rel: 'noopener', text: 'Source' }),
      h('span', { text: 'Unofficial. Not affiliated with AULA.' }))),
  h('div', { class: 'main' }, h('header', { class: 'topbar' }, title, status), content),
);

for (const p of pages) {
  nav.append(h('button', {
    type: 'button', class: 'nav-item', data: { id: p.id }, title: p.title, onclick: () => navigate(p.id),
  }, icon(p.icon, 19), h('span', { text: p.title })));
}

function navigate(id, force = false) {
  const page = pages.find((p) => p.id === id) ?? pages[0];
  if (app.page === page.id && !force && mounted.has(page.id) && !mounted.get(page.id).hidden) return;
  app.page = page.id;
  if (location.hash.slice(1) !== page.id) history.replaceState(null, '', `#${page.id}`);
  title.textContent = page.title;
  for (const b of nav.children) b.classList.toggle('on', b.dataset.id === page.id);
  const needsDevice = page.needsDevice !== false;
  const showLanding = needsDevice && !kb.connected;
  landing.hidden = !showLanding;
  for (const el of mounted.values()) el.hidden = true;
  if (showLanding) { title.textContent = 'Connect'; return; }
  let el = mounted.get(page.id);
  if (!el) {
    el = h('div', { class: 'page', data: { page: page.id } });
    content.append(el);
    mounted.set(page.id, el);
    page.mount(el, app);
  }
  el.hidden = false;
  Promise.resolve(page.show?.(app)).then(() => page.update?.(app));
}

function renderStatus() {
  const s = kb.state;
  clear(status);
  status.classList.toggle('busy', kb.busy > 0);
  if (!s.connected) {
    status.append(h('span', { class: 'pill off' }, h('i', { class: 'dot' }), 'Not connected'));
    return;
  }
  const label = kb.demo ? 'Demo keyboard' : s.mode === 'wired' ? 'USB cable' : '2.4G wireless';
  add(status,
    h('span', { class: 'spinner', title: 'Talking to the keyboard' }),
    s.firmwareMode && h('span', { class: 'pill warn', text: 'Knob mode' }),
    h('span', { class: 'pill' }, h('i', { class: 'dot' }), label),
    s.battery >= 0 && h('span', { class: 'battery', title: s.charging ? 'On USB power' : 'On battery' },
      h('span', { class: 'battery-shell' }, h('span', { class: `battery-fill ${s.battery <= 15 && !s.charging ? 'low' : ''}`, style: { width: `${s.battery}%` } })),
      `${s.battery}%${s.charging ? ' ⚡' : ''}`),
    h('button', { class: 'btn small', text: 'Disconnect', onclick: () => disconnect() }),
  );
}

function renderLanding() {
  const supported = hidSupported();
  add(clear(landing),
    h('div', { class: 'hero' },
      h('img', { src: 'assets/duck.svg', alt: '', width: 72, height: 72 }),
      h('h2', { text: 'Your AULA F99 Pro, from the browser' }),
      h('p', { class: 'lead', text: 'Lighting, per-key colours, remapping, macros and battery level. No driver to install: this page talks straight to the keyboard over WebHID, and nothing leaves your computer.' }),
      h('div', { class: 'row center' },
        h('button', { class: 'btn primary large', disabled: !supported, onclick: () => connect() }, 'Connect keyboard'),
        h('button', { class: 'btn large', onclick: () => startDemo() }, 'Try the demo')),
      !supported && h('p', { class: 'banner inline', text: window.isSecureContext
        ? 'This browser does not support WebHID. Open this page in Chrome, Edge or Opera on a computer.'
        : 'WebHID only works on secure pages. Open this site over https:// (or http://localhost).' }),
      supported && h('p', { class: 'muted small', text: 'Chrome will show a list: choose “AULA F99 Pro” when using the cable, or the 2.4G receiver when wireless.' })),
    h('div', { class: 'facts-grid' },
      fact('USB cable', 'Everything: lighting, per-key colour, remapping, macros, backup.'),
      fact('2.4G receiver', 'Battery and lighting. The wireless link cannot write keys, colours or macros.'),
      fact('Stays on the keyboard', 'Remaps, macros and lighting are stored in the keyboard and keep working with this page closed.')),
  );
}
const fact = (head, body) => h('div', { class: 'fact' }, h('strong', { text: head }), h('p', { class: 'muted', text: body }));

// ---------- connection ----------
async function attach(link, { demo = false, quiet = false } = {}) {
  try {
    await kb.attach(link, { demo });
  } catch (e) {
    if (!quiet) toast(`Could not talk to the keyboard: ${e.message}`, 'error');
    return false;
  }
  app.lastGoodPage = kb.page && kb.page[OFF.MODE] === 0 ? kb.page.slice() : null;
  app.invalidate(false);
  const wanted = location.hash.slice(1);
  navigate(pages.some((p) => p.id === wanted) ? wanted : prefs.get('startPage'), true);
  if (!quiet) toast(demo ? 'Demo keyboard connected: nothing here touches a real device' : `Connected over ${kb.wired ? 'USB' : '2.4G'}`, 'ok');
  autoSnapshot();
  return true;
}

async function connect() {
  let picked;
  try {
    picked = await navigator.hid.requestDevice({ filters: [WIRED_FILTER, WIRELESS_FILTER] });
  } catch (e) { toast(e.message, 'error'); return; }
  if (!picked.length) return; // chooser dismissed
  const link = await openLink(picked);
  if (!link) {
    toast('That device did not answer. Press a key to wake the keyboard, check the cable or the 2.4G switch, and try again.', 'error');
    return;
  }
  await attach(link);
}

async function reconnect() {
  if (kb.connected || !hidSupported() || !prefs.get('autoReconnect')) return;
  const link = await grantedLink().catch(() => null);
  if (link && !kb.connected) await attach(link, { quiet: true });
  else if (link) await link.close();
}

async function startDemo() {
  const dev = new DemoDevice();
  await dev.open();
  await attach(new WiredLink(dev), { demo: true });
}

async function disconnect() {
  await kb.detach();
  navigate(app.page, true);
}

function lost(message) {
  if (!kb.link) return;
  kb.detach().then(() => navigate(app.page, true));
  toast(message, 'error');
}

// One full backup per browser session, the first time a real keyboard connects by cable.
function autoSnapshot() {
  if (kb.demo || !kb.wired || !prefs.get('autoSnapshot') || sessionStorage.getItem('aula-hub:snapshotted')) return;
  sessionStorage.setItem('aula-hub:snapshotted', '1');
  setTimeout(async () => {
    if (!kb.wired) return;
    try {
      if (restorePoints.add(await kb.snapshot(), 'Automatic')) toast('Restore point saved (Device page)');
    } catch { /* not critical */ }
  }, 1500);
}

// ---------- background checks ----------
let lastInput = 0;
let lastBattery = Date.now();
let checking = false;
for (const type of ['keydown', 'pointerdown']) window.addEventListener(type, () => { lastInput = Date.now(); }, true);

async function tick() {
  if (checking || !kb.connected || kb.busy) return;
  const now = Date.now();
  const inFront = !document.hidden && document.hasFocus();
  checking = true;
  try {
    const every = prefs.get('batteryPoll') * 1000;
    if (every && !document.hidden && now - lastBattery >= every) {
      lastBattery = now;
      await kb.refresh(false);
    }
    // Reading the config page keeps the keyboard busy for a moment, so only do it when it is
    // cheap: this window in front, nobody typing here, nothing written a moment ago.
    const gap = kb.wired ? 2500 : 6000;
    if (prefs.get('guard') && !kb.demo && (inFront || prefs.get('guardBackground'))
      && now - lastInput > 600 && now - kb.lastTalk >= gap && now - kb.lastWrite > 1500) {
      const page = await kb.pollPage();
      if (page[OFF.MODE] === 1) {
        await kb.exitFirmwareMode(app.lastGoodPage);
        toast('The keyboard switched to its own knob mode. Switched it back.', 'ok');
      }
    }
  } catch {
    if (kb.fails >= 3 || kb.link?.device.opened === false) lost('The keyboard stopped responding');
  } finally { checking = false; }
}
setInterval(tick, 1000);

// ---------- wiring ----------
kb.addEventListener('change', () => {
  if (kb.page && kb.page[OFF.MODE] === 0) app.lastGoodPage = kb.page.slice();
  renderStatus();
  if (kb.connected && mounted.has(app.page) && !mounted.get(app.page).hidden) pages.find((p) => p.id === app.page)?.update?.(app);
});
// Toggle a class instead of redrawing the status bar on every exchange.
kb.addEventListener('busy', () => status.classList.toggle('busy', kb.busy > 0));

prefs.on(() => {
  applyAppearance();
  if (kb.connected || app.page === 'prefs') pages.find((p) => p.id === app.page && mounted.has(p.id))?.update?.(app);
  if (app.page === 'keys' && kb.connected) keys.render();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);

if (hidSupported()) {
  navigator.hid.addEventListener('disconnect', (e) => { if (kb.link?.device === e.device) lost('The keyboard was disconnected'); });
  navigator.hid.addEventListener('connect', () => setTimeout(reconnect, 800));
}
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
window.addEventListener('beforeunload', (e) => {
  if (macros.dirty?.()) e.preventDefault();
});

window.aulaHub = app; // handy in the DevTools console: aulaHub.kb.state

applyAppearance();
content.append(landing);
renderLanding();
renderStatus();
navigate(location.hash.slice(1) || prefs.get('startPage'), true);
if (new URLSearchParams(location.search).has('demo')) startDemo();
else reconnect();
