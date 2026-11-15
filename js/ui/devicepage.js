// Device page: status, sleep timer, firmware mode, backup / restore, factory reset, raw tools.
import { OFF, SLEEP, hex, unhex } from '../hid/protocol.js';
import { restorePoints } from '../prefs.js';
import { add, card, clear, confirmDialog, download, h, pickFile } from './dom.js';

const fmtSleep = (s) => (s < 120 ? `${s} seconds` : `${s / 60} minutes`);
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default {
  id: 'device',
  title: 'Device',
  icon: 'device',

  mount(root, app) {
    this.app = app;
    const { kb } = app;
    this.facts = h('dl', { class: 'facts' });
    this.sleep = h('select', { class: 'input', onchange: () => app.run(() => kb.setSleep(Number(this.sleep.value)), 'Sleep timer saved') },
      SLEEP.map((s) => h('option', { value: s.seconds, text: fmtSleep(s.seconds) })));
    this.mode = h('div');
    this.points = h('div', { class: 'points' });
    this.backupNote = h('p', { class: 'muted small' });
    this.resetBtn = h('button', { class: 'btn danger', text: 'Factory reset…', onclick: () => this.factoryReset() });
    this.raw = h('textarea', { class: 'input mono raw', rows: 6, spellcheck: false });
    this.advanced = card('Advanced', 'Raw config page (128 bytes). Writing nonsense here can leave the lighting in a strange state; a factory reset undoes it.',
      this.raw,
      h('div', { class: 'row' },
        h('button', { class: 'btn', text: 'Read', onclick: () => this.readRaw() }),
        h('button', { class: 'btn', text: 'Write', onclick: () => this.writeRaw() })),
      this.diag = h('p', { class: 'muted small mono' }));

    root.append(
      h('div', { class: 'grid-2' },
        card('This keyboard', null, this.facts),
        card('Sleep', 'How long the keyboard waits before it sleeps on battery.',
          h('label', { class: 'field' }, h('span', { text: 'Sleep after' }), this.sleep))),
      card('Knob mode', null, this.mode),
      card('Backup and restore', 'A backup holds all four key layers, macros, lighting and per-key colours.',
        h('div', { class: 'row' },
          h('button', { class: 'btn', text: 'Export to file', onclick: () => this.exportFile() }),
          h('button', { class: 'btn', text: 'Import from file…', onclick: () => this.importFile() }),
          h('button', { class: 'btn', text: 'Save restore point', onclick: () => this.savePoint('Manual') })),
        this.backupNote,
        h('h3', { text: 'Restore points' }), this.points),
      card('Factory reset', 'Clears every remap, macro and lighting change on the keyboard.', this.resetBtn),
      this.advanced,
    );
  },

  show() { this.update(); this.renderPoints(); },

  update() {
    const { kb, prefs } = this.app;
    const s = kb.state;
    const rows = [
      ['Model', s.model + (kb.demo ? ' (demo)' : '')],
      ['Connection', kb.demo ? 'Simulated keyboard' : s.mode === 'wired' ? 'USB cable' : s.mode === 'wireless' ? '2.4G receiver' : 'Not connected'],
      ['Battery', s.battery < 0 ? 'Unknown' : `${s.battery}%${s.charging ? ', on USB power' : ''}`],
      ['Can change', s.mode === 'wired' ? 'Everything' : 'Lighting and sleep only (plug in the cable for the rest)'],
    ];
    clear(this.facts).append(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
    if (document.activeElement !== this.sleep) {
      const row = SLEEP.find((x) => x.hw === s.sleep);
      if (row) this.sleep.value = row.seconds;
    }
    add(clear(this.mode),
      h('p', { text: s.firmwareMode
        ? 'The keyboard is in its own knob mode: the knob only changes the backlight and sends nothing to the computer.'
        : 'Normal. Holding the knob for two seconds switches the keyboard into its own mode, where the knob only changes the backlight. The keyboard never leaves that mode by itself.' }),
      h('p', { class: 'muted small', text: prefs.get('guard')
        ? 'While this page is open and in front, it checks every few seconds and switches the keyboard back for you. Change this in Preferences.'
        : 'Automatic recovery is off in Preferences.' }),
      s.firmwareMode && h('button', { class: 'btn primary', text: 'Switch back now', onclick: () => this.app.run(() => kb.exitFirmwareMode(this.app.lastGoodPage), 'Back to normal') }));
    this.backupNote.textContent = kb.wired ? '' : 'Over 2.4G only lighting and sleep can be restored, and a backup holds less.';
    this.resetBtn.disabled = !kb.wired;
    this.advanced.hidden = !prefs.get('advanced');
    if (kb.page) this.diag.textContent = `power flag 0x${s.powerFlag.toString(16).padStart(2, '0')} · knob counter ${kb.page[OFF.SPIN]} · mode flag ${kb.page[OFF.MODE]}`;
  },

  renderPoints() {
    const list = restorePoints.list();
    clear(this.points);
    if (!list.length) this.points.append(h('p', { class: 'muted small', text: 'None yet. One is saved automatically the first time you connect by cable.' }));
    for (const p of list) {
      this.points.append(h('div', { class: 'point' },
        h('div', { class: 'grow' }, h('strong', { text: fmtDate(p.snapshot.at) }),
          h('span', { class: 'muted small', text: ` · ${p.label} · ${p.snapshot.link === 'wired' ? 'full' : 'lighting only'}` })),
        h('button', { class: 'btn small', text: 'Restore', onclick: () => this.restore(p.snapshot, `the restore point from ${fmtDate(p.snapshot.at)}`) }),
        h('button', { class: 'btn small', text: 'Delete', onclick: () => { restorePoints.remove(p.id); this.renderPoints(); } })));
    }
  },

  async savePoint(label) {
    const snap = await this.app.run(() => this.app.kb.snapshot());
    if (!snap) return;
    if (restorePoints.add(snap, label)) this.app.toast('Restore point saved');
    else this.app.toast('Could not save: this browser’s storage is full or blocked', 'error');
    this.renderPoints();
  },

  async exportFile() {
    const snap = await this.app.run(() => this.app.kb.snapshot());
    if (!snap) return;
    download(`aula-f99-pro-${snap.at.slice(0, 10)}.json`, JSON.stringify(snap, null, 1));
  },

  async importFile() {
    const text = await pickFile();
    if (!text) return;
    let snap;
    try { snap = JSON.parse(text); } catch { this.app.toast('That file is not valid JSON', 'error'); return; }
    if (!snap || (!snap.matrix && !snap.page && !snap.rgb && !snap.macros)) { this.app.toast('That file is not a keyboard backup', 'error'); return; }
    await this.restore(snap, 'this file');
  },

  async restore(snap, what) {
    const ok = await confirmDialog({
      title: 'Restore the keyboard?',
      body: `Everything on the keyboard will be replaced with ${what}. A restore point of the current state is saved first.`,
      confirm: 'Restore',
    });
    if (!ok) return;
    const before = await this.app.run(() => this.app.kb.snapshot());
    if (before) restorePoints.add(before, 'Before restore');
    const res = await this.app.run(() => this.app.kb.restore(snap));
    if (!res) return;
    this.app.invalidate();
    this.renderPoints();
    if (res.skipped.length) this.app.toast(`Restored ${res.done.length} part(s). Skipped: ${res.skipped.join('; ')}`, 'error', 9000);
    else this.app.toast('Keyboard restored');
  },

  async factoryReset() {
    const ok = await confirmDialog({
      title: 'Factory reset the keyboard?',
      body: 'All remaps, macros, lighting settings and per-key colours go back to how the keyboard shipped. A restore point is saved first so you can undo this.',
      confirm: 'Factory reset', danger: true,
    });
    if (!ok) return;
    const before = await this.app.run(() => this.app.kb.snapshot());
    if (before) restorePoints.add(before, 'Before factory reset');
    const done = await this.app.run(() => this.app.kb.factoryReset(), 'Keyboard reset to factory settings');
    if (done !== false) this.app.invalidate();
    this.renderPoints();
  },

  async readRaw() {
    const page = await this.app.run(() => this.app.kb.readRawPage());
    if (page) this.raw.value = hex(page, ' ').replace(/((?:\w\w ){16})/g, '$1\n').trim();
  },
  async writeRaw() {
    let bytes;
    try { bytes = unhex(this.raw.value); } catch (e) { this.app.toast(e.message, 'error'); return; }
    const res = await this.app.run(async () => ({ match: await this.app.kb.writeRawPage(bytes) }));
    if (!res) return;
    if (res.match) this.app.toast('Config page written and verified');
    else this.app.toast('Written, but the keyboard kept some values of its own. Read it back to see.', 'error');
  },
};
