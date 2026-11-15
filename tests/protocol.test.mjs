// Run with: node --test tests/
// Exercises the real WiredLink framing and the Keyboard session against the simulated device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoDevice } from '../js/hid/demo.js';
import { Keyboard } from '../js/hid/device.js';
import { buildBank, parseBank } from '../js/hid/macro.js';
import {
  KNOB_FACTORY, KNOB_IDX, OFF, RGB_SLOTS, colorsFromPlanes, decodeRecord, planesFromColors, unhex,
} from '../js/hid/protocol.js';
import { WiredLink, WirelessLink, openLink } from '../js/hid/transport.js';

async function connect() {
  const dev = new DemoDevice();
  const link = await openLink([dev]);
  assert.ok(link instanceof WiredLink);
  const kb = new Keyboard();
  await kb.attach(link, { demo: true });
  return { kb, dev, link };
}

test('wired frame layout matches the protocol', () => {
  const link = new WiredLink(new DemoDevice());
  const f = link.frame(0x83, 2, 3, 1, 0x0200, null);
  assert.equal(f.length, 519); // report id travels separately
  assert.deepEqual([...f.subarray(0, 7)], [0x83, 2, 0, 3, 1, 0x00, 0x02]);
});

test('2.4G packet carries length nibble and checksum', () => {
  const p = WirelessLink.packet(0x04, 1, Uint8Array.from([1, 2, 3]), 10, 2);
  assert.equal(p.length, 20);
  assert.deepEqual([...p.subarray(0, 8)], [0x13, 0x04, 10, 2, 0x13, 1, 2, 3]);
  assert.equal(p[19], [...p.subarray(0, 19)].reduce((a, b) => a + b, 0) & 0xff);
});

test('connect reads identity, battery and lighting', async () => {
  const { kb } = await connect();
  assert.equal(kb.state.connected, true);
  assert.equal(kb.state.mode, 'wired');
  assert.equal(kb.state.model, 'AULA F99 Pro');
  assert.equal(kb.state.battery, 87);
  assert.equal(kb.state.charging, true);
  assert.equal(kb.state.effect, 3);
});

test('lighting edits land in the right bytes', async () => {
  const { kb, dev } = await connect();
  await kb.setEffect(5);
  await kb.setBrightness(6);
  await kb.setSpeed(2);
  await kb.setColor(4);
  const at = OFF.TABLE + 4 * 2; // slot = menu position - 1
  assert.equal(dev.page[OFF.EFFECT], 5);
  assert.equal(dev.page[at], 6);
  assert.equal(dev.page[at + 1], (2 << 4) | 4);
  await kb.setEffect(19);
  assert.equal(dev.page[OFF.CUSTOM], 1);
  await kb.setBrightness(3);
  assert.equal(dev.page[OFF.CUSTOM_BRIGHT], 3);
  await kb.setEffect(0);
  assert.deepEqual([dev.page[OFF.CUSTOM], dev.page[OFF.EFFECT]], [0, 0]);
  await kb.setSleep(600);
  assert.equal(dev.page[OFF.SLEEP], 20);
});

test('a rejected write is reported, not swallowed', async () => {
  const { kb, dev } = await connect();
  await assert.rejects(kb.patch((p) => { p[OFF.SLEEP] = 99; }), /did not accept/);
  assert.equal(dev.page[OFF.SLEEP], 10);
});

test('remap one key and the knob', async () => {
  const { kb, dev } = await connect();
  await kb.setRecord(0, 9, [0, 0x01, 0, 0x06]); // A -> Ctrl+C
  const layers = await kb.readLayers();
  assert.equal(layers.length, 4);
  assert.equal(decodeRecord(layers[0].subarray(36, 40)).label, 'Ctrl + C');
  assert.deepEqual([...dev.layers[0].subarray(KNOB_IDX * 4, KNOB_IDX * 4 + 4)], KNOB_FACTORY);
  assert.deepEqual([...layers[0].subarray(508)], [0, 0, 0x5a, 0xa5]);
});

test('per-key colour uses three planes', async () => {
  const { kb, dev } = await connect();
  const colors = Array.from({ length: RGB_SLOTS }, (_, i) => [i, 255 - i, 7]);
  await kb.writeColors(planesFromColors(colors));
  assert.equal(dev.rgb[5], 5);
  assert.equal(dev.rgb[RGB_SLOTS + 5], 250);
  assert.equal(dev.rgb[RGB_SLOTS * 2 + 5], 7);
  assert.deepEqual(colorsFromPlanes(await kb.readColors())[5], [5, 250, 7]);
});

test('macro bank round-trips, including multi-packet reads', async () => {
  const macros = [
    { name: 'Hi', steps: [{ usage: 0x0b, delay: 20, press: true, kind: 0 }, { usage: 0x0b, delay: 70000, press: false, kind: 0 }] },
    { name: 'Second', steps: [{ usage: 0xe1, delay: 0, press: true, kind: 0 }] },
  ];
  assert.deepEqual(parseBank(buildBank(macros)), macros);
  assert.deepEqual(parseBank(buildBank([])), []);
  const { kb } = await connect();
  assert.equal((await kb.readMacros())[0].name, 'Hello');
  await kb.saveMacros(macros);
  assert.deepEqual(await kb.readMacros(), macros);
  await kb.saveMacros([]);
  assert.deepEqual(await kb.readMacros(), []);
});

test('snapshot, change, restore, factory reset', async () => {
  const { kb, dev } = await connect();
  const snap = await kb.snapshot();
  assert.equal(unhex(snap.macros).length, 10240);
  await kb.setRecord(1, 20, [0, 0, 0, 0x04]);
  await kb.setEffect(7);
  const { done, skipped } = await kb.restore(snap);
  assert.deepEqual(skipped, []);
  assert.equal(done.length, 7);
  assert.equal(dev.page[OFF.EFFECT], 3);
  assert.equal(dev.layers[1][83], 0);
  await kb.setEffect(9);
  await kb.factoryReset();
  assert.equal(kb.state.effect, 3);
});

test('firmware mode is detected and cleared', async () => {
  const { kb, dev } = await connect();
  const good = kb.page.slice();
  dev.page[OFF.MODE] = 1;
  dev.page[OFF.EFFECT] = 0;
  await kb.pollPage();
  assert.equal(kb.state.firmwareMode, true);
  await kb.exitFirmwareMode(good);
  assert.deepEqual([dev.page[OFF.MODE], dev.page[OFF.EFFECT]], [0, 3]);
});
