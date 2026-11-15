# AULA F99 Pro protocol notes

An English version of the notes from [xx12ek/aula-f99-pro-hub](https://github.com/xx12ek/aula-f99-pro-hub) (original: [PROTOCOL.zh.md](PROTOCOL.zh.md)), with WebHID specifics added. The hardware findings are theirs.

Confidence marks:

- ✅ **Tested** on a real keyboard by the original project
- ⚠️ **Inferred** from evidence, not independently checked
- ❓ **Unknown**
- 🌐 **WebHID**: how this port does it; not yet confirmed on hardware unless stated

## 1. Devices

| Link | VID | PID | Collection | Transport |
|---|---|---|---|---|
| Wired | `0x258A` | `0x010C` | usage page `0xFF00`, usage `0x01` | feature reports, **report id 6** |
| 2.4G | `0x3554` | `0xFA09` | usage page `0xFF02`, usage `0x02` | interrupt reports, **report id 0x13** |

✅ The wired keyboard exposes several `0xFF00` collections and only one works. It is the one that answers `0x82` (identity), and its feature report is 520 bytes.

✅ While the cable is plugged in, the 2.4G receiver answers nothing. Try wired first, then wireless.

🌐 `navigator.hid.requestDevice()` is called with both filters above. Each candidate `HIDDevice` with a `0xFF00` collection is opened and probed with `0x82`; the first that answers is used.

## 2. Wired protocol

### Frame (520 bytes)

```
[0]     report id = 6
[1]     command
[2]     parameter
[3]     0
[4]     total packets
[5]     packet index
[6..7]  payload length, little-endian
[8..]   payload (up to 512 bytes)
```

✅ Reads need two pauses: wait 15 ms, send the request, wait 30 ms, then fetch the feature report. Without them the reply is empty or stale. Writes: wait 15 ms, send, wait 50 ms.

🌐 `sendFeatureReport(6, data)` takes the 519 bytes after the report id. `receiveFeatureReport(6)` in Chrome returns the report id as byte 0; the code accepts a reply with or without it.

### Commands

| Code | Name | Notes |
|---|---|---|
| `0x82` | GET_INFO | parameter `1`; last byte `0x58` = F99 Pro ✅ |
| `0x87` | GET_POWER | parameter `2`; returns `[percent, flags]` ✅ |
| `0x84` / `0x04` | GET / SET config page | 128 bytes ✅ |
| `0x83` / `0x03` | GET / SET key matrix | parameter = layer 0–3; 512 bytes = 128 keys × 4 ✅ |
| `0x86` / `0x06` | GET / SET per-key colour | 378 bytes ✅ |
| `0x85` / `0x05` | GET / SET macro memory | 10240 bytes ✅ |
| `0x11` | RESET | factory reset ✅ |

### Power flags

```
byte 0 = percent (0–100)
byte 1 = flags: 0x10 set = on USB power, 0x01 = has a battery
```

✅ Test `flags & 0x10` for charging. `flags != 0` is wrong: bit 0 is set on battery too.

## 3. 2.4G protocol

### Frame (20 bytes)

```
[0]      report id = 0x13
[1]      command
[2]      total packets
[3]      packet index
[4]      (operation << 4) | data length      operation 0 = read, 1 = write
[5..18]  data (up to 14 bytes)
[19]     checksum = sum(bytes 0..18) & 0xFF
```

✅ 14 data bytes per packet; longer data is split. A reply with bit 7 set in the command byte is a refusal.

🌐 Sent with `sendReport(0x13, 19 bytes)`; replies arrive as `inputreport` events.

### Commands

| Code | Name | Notes |
|---|---|---|
| `0x05` | identity | returns `03 00 00 00 01 58 …` ✅ |
| `0x4A` | battery | `[percent, flags]` ✅ |
| `0x44` / `0x04` | read / write config page | ✅ |
| `0x41` | read key matrix | base layer only, **504 bytes** (126 keys) ✅ |
| `0x42` | read per-key colour | 378 bytes ✅ |
| `0x43`, `0x49` | ? | return 512 zero bytes and 490 bytes of what looks like code ❓ |

✅ **Nothing else can be written over 2.4G.** 24 matrix-write and 18 colour-write command combinations were tried; the data read back never changed. Remapping, per-key colour and macros need the cable.

## 4. Config page (128 bytes)

Ends with `5A A5` at `0x7E`/`0x7F`. ✅

| Offset | Meaning |
|---|---|
| `0x09` | custom-colour flag (1 = use the per-key table) ✅ |
| `0x0A` | current effect (0 = off) ✅ |
| `0x18` | sleep timer value ✅ |
| `0x1A` | **firmware-mode flag** (1 = the keyboard is in its own knob mode) ✅ |
| `0x38` | knob rotation counter ✅ |
| `0x3A` | start of the effect table, 2 bytes per slot ✅ |
| `0x75` | brightness used in custom mode ✅ |

### Effect slots (from `0x3A`)

Each slot is `[brightness, (speed << 4) | colour]`.

- Slot index = **effect number − 1**, where the effect number is the vendor's menu order (the value in `0x0A`), not the hardware effect id. ✅
- Brightness 0–9, speed 0–4. The firmware stores larger values but does not use them. ✅
- Colour 0–6 = red, green, blue, yellow, magenta, cyan, white; 7 = random. ✅

### Sleep timer

```
seconds: 60  90  120  180  240  300  600  900  1200
value:   2   3   4    6    8    10   20   30   40
```

✅ Only these nine values are accepted.

### Firmware mode (`0x1A`)

✅ Holding the knob for about two seconds makes the firmware set `0x1A` to 1. From then on the knob only changes the backlight, no knob input reaches the computer, and the firmware swaps in its own lighting. The keyboard never leaves this mode by itself.

Recovery: write the page back with `0x1A = 0`.

🌐 This port re-reads the page every few seconds while its tab is open and focused, clears the flag, and puts bytes `0x09`/`0x0A` back to what they were before. It does not poll in the background by default: every read keeps the keyboard busy for a moment, which the original project found can drop a keystroke while typing and keeps a wireless keyboard awake.

## 5. Key matrix records (4 bytes per key)

| `b0` | Type | Other bytes |
|---|---|---|
| `0x00` | key / shortcut / modifier | `b1` = modifier mask, `b3` = HID usage |
| `0x01` | common command | `b1` = command number 1–13 (10 is unused) |
| `0x02` | consumer (media) key | `(b2 << 8) | b3` = usage |
| `0x03` | macro | `[3][mode][trigger][slot − 1]`; this port writes `03 01 01 n` |
| `0x05` | mouse | `b1` = button mask (1 left, 2 right, 4 middle) |
| `0x07` | built-in function | `b3` = function code |
| `0x08` | built-in lighting function | `(b1, b2, b3)` triple |
| `0x0D` | Fn key placeholder | not remappable |

Modifier mask (`b0 = 0`): ✅

```
0x01 Ctrl   0x02 Shift   0x04 Alt   0x08 Win   0x10 R Ctrl   0x20 R Shift   0x40 R Alt
```

Built-in functions (`b0 = 7`):

```
0x01 lock Win      0x04 factory reset   0x05/06/07 Bluetooth 1/2/3   0x08 2.4G
0x0A game mode     0x0C show battery    0x18 Windows   0x19 Android  0x1A macOS   0x1B Linux
0x1D knob / mode key
```

✅ Each layer ends with `00 00 5A A5`, leaving 127 usable slots (0–126).

✅ The knob is slot 108 on the base layer, factory value `07 00 00 1D`. The record is writable. Media-key bindings on it are confirmed by other projects; other bindings are accepted but ⚠️ untested.

⚠️ The keyboard's HID descriptor declares usages `0x04`–`0x70`, so F22–F24 cannot be sent.

## 6. Per-key colour

✅ The table is **three planes**, not interleaved RGB:

```
data[0 * 126 + slot] = R
data[1 * 126 + slot] = G
data[2 * 126 + slot] = B
```

378 bytes in all. Interleaving scrambles every colour.

✅ The slot number is the matrix key number.

✅ The colours only show when **both** `0x09 = 1` and `0x0A = 19` are set in the config page.

🌐 Do not stream this table. Tested on hardware with this port: writing it about 20 times a second stopped the keyboard sending key presses, and the LEDs did not change until the writes stopped. The keyboard cannot scan keys while it is taking a 520-byte feature report.

## 7. Macro memory

- 10240 bytes (`0x2800`), wired only (`0x85` / `0x05`). ✅
- Layout the vendor driver writes, and this port follows:

```
memory = [ per macro: u16 offset, u16 length ] + records
record = [ u8 name length in bytes ][ UTF-16LE name, up to 30 characters ][ steps × 4 bytes ]
step   = b0: bits 0–3 delay high nibble, bits 4–6 type, bit 7 = key down
         b1, b2: rest of the 20-bit delay
         b3: HID usage (modifiers are 0xE0–0xE7)
```

- ⚠️ The delay unit is believed to be milliseconds; whether it applies before or after the step is not confirmed.
- ❓ A factory-fresh keyboard returns what looks like 8051 machine code at the start of this area.

## 8. Open questions

- ❓ 2.4G commands `0x43` and `0x49`.
- ❓ Config page bytes `0x11`–`0x13`, `0x16`, `0x17`, `0x1C`, `0x1E`, `0x1F`.
- ❓ Where key debounce is stored.
- ⚠️ Extra mouse functions under `b0 = 5` (forward, back, wheel): the sub-codes are not mapped.
