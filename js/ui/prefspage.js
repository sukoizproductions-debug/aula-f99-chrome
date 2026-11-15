// Preferences page: how the app looks and behaves. Stored in this browser only.
import { ACCENTS } from '../prefs.js';
import { card, confirmDialog, h, segmented, toggle } from './dom.js';

function row(title, help, control) {
  return h('div', { class: 'pref' },
    h('div', { class: 'grow' }, h('strong', { text: title }), help && h('p', { class: 'muted small', text: help })),
    control);
}

export default {
  id: 'prefs',
  title: 'Preferences',
  icon: 'prefs',
  needsDevice: false,

  mount(root, app) {
    this.root = root;
    this.app = app;
    this.build();
  },

  build() {
    const { prefs, pages } = this.app;
    const set = (k) => (v) => prefs.set(k, v);
    const seg = (k, options) => segmented(options, prefs.get(k), set(k));
    const sw = (k) => toggle(prefs.get(k), set(k));

    const accents = h('div', { class: 'swatches' },
      ACCENTS.map((c) => h('button', {
        type: 'button', class: `swatch ${prefs.get('accent') === c ? 'on' : ''}`, style: { background: c }, title: c,
        onclick: () => { prefs.set('accent', c); this.build(); },
      })),
      h('input', { type: 'color', class: 'color-input', value: prefs.get('accent'), title: 'Custom accent', oninput: (e) => prefs.set('accent', e.target.value) }));

    const start = h('select', { class: 'input', onchange: () => prefs.set('startPage', start.value) },
      pages.filter((p) => p.id !== 'prefs').map((p) => h('option', { value: p.id, text: p.title, selected: p.id === prefs.get('startPage') })));
    const battery = h('select', { class: 'input', onchange: () => prefs.set('batteryPoll', Number(battery.value)) },
      [[0, 'Only when I open the page'], [30, 'Every 30 seconds'], [60, 'Every minute'], [300, 'Every 5 minutes']]
        .map(([v, text]) => h('option', { value: v, text, selected: v === prefs.get('batteryPoll') })));

    this.root.replaceChildren(
      card('Appearance', null,
        row('Theme', null, seg('theme', [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }])),
        row('Accent colour', null, accents),
        row('Density', 'Compact fits more on small screens.', seg('density', [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }])),
        row('Sidebar', null, seg('sidebar', [{ value: 'full', label: 'Labels' }, { value: 'icons', label: 'Icons only' }])),
        row('Keyboard size', 'How large the on-screen keyboard is drawn.', seg('boardSize', [{ value: 'fit', label: 'Fill width' }, { value: 'medium', label: 'Medium' }, { value: 'small', label: 'Small' }])),
        row('Animations', null, sw('motion'))),
      card('Behaviour', null,
        row('Open on', 'The page shown after connecting.', start),
        row('Key labels', 'On the Keys page, show what each remapped key does, or only the printed legends with changed keys outlined.',
          seg('keyLabels', [{ value: 'binding', label: 'Bindings' }, { value: 'legend', label: 'Legends' }])),
        row('Apply colours as I paint', 'Off: paint freely, then press Apply.', sw('autoApplyColors')),
        row('Reconnect automatically', 'Reconnect to a keyboard you have already allowed when the page opens or the cable is plugged in.', sw('autoReconnect')),
        row('Check battery', null, battery)),
      card('Safety', null,
        row('Leave firmware knob mode automatically', 'If a long press on the knob puts the keyboard in its own mode, switch it back.', sw('guard')),
        row('…also while this window is in the background', 'Checks can make the keyboard miss a keystroke now and then while you type elsewhere, and keep it awake on 2.4G.', sw('guardBackground')),
        row('Restore point on connect', 'Save a full backup the first time you connect by cable in each browser session.', sw('autoSnapshot')),
        row('Show advanced tools', 'Adds a raw config editor to the Device page.', sw('advanced'))),
      card('Reset', 'Your presets, palette and colour profiles are kept.',
        h('button', {
          class: 'btn', text: 'Reset preferences',
          onclick: async () => {
            if (await confirmDialog({ title: 'Reset preferences?', body: 'All settings on this page go back to their defaults.', confirm: 'Reset' })) { prefs.reset(); this.build(); }
          },
        })),
    );
  },

  update() {},
};
