"""页面守护：一个线程同时干「检测长按」和「把键盘拉出固件模式」。

为什么要合并
------------
原来有两个独立线程都在轮询同一张 128 字节配置页：

    knob_mode  每 0.40 秒一次  -> 150 次/分   看到 0x1A==1 就切槽
    mode_guard 每 2.0 秒一次   ->  30 次/分   看到 0x1A==1 就清回 0

两个问题：

1. **它们是抢的。** 谁先读到 0x1A==1 谁说了算 —— 如果 mode_guard 先清掉，
   knob_mode 就再也看不到这次翻转，长按切槽偶尔失灵。这是真 bug，不是概率问题。

2. **读页很贵。** 实测单次 63 ms（其中 45 ms 是我们自己的两个 sleep，
   剩下约 18 ms 是设备真在处理 520 字节特性报告）。180 次/分意味着
   **每秒有 19% 的时间占着 HID 通道**，而且是独占的 —— 设备处理特性报告时
   顾不过来扫描按键矩阵，表现就是「偶尔少打一个字」。
   2.4G 下每次往返还要唤醒键盘，电池掉得更快。

合并之后一个线程一次读页干两件事，次数减到 1/3，竞态也没了。

第三条更关键：**用户打字时不碰设备**
------------------------------------
`GetLastInputInfo()` 能拿到「距上次键鼠输入多少毫秒」，不用装钩子。
最近 IDLE_MS 毫秒内有输入就跳过这一轮 —— 打字的时候一次 HID 交互都不发，
少字问题从根上消失。用户停手后才继续轮询。
"""

from __future__ import annotations

import ctypes
import threading
import time
from ctypes import wintypes as wt

from .aula import AulaError

# ── 配置页偏移 ──────────────────────────────────────────────────
PAGE_CUSTOM = 0x09          # 自定义灯效标志（0/1）
PAGE_EFFECT = 0x0A          # 当前灯效编号（0 = 灯效关，19 = 自定义）
PAGE_MODE = 0x1A            # 固件专属模式标记：只有固件自己会改
PAGE_SPIN = 0x38            # 旋钮旋转计数器（诊断用）
PAGE_TABLE = 0x3A           # 灯效槽表起点
PAGE_LEN = 128
EFFECT_STRIDE = 2
EFFECT_CUSTOM = 19
TAIL = (0x5A, 0xA5)         # 尾标记，用来判断读回是否完整

# ── 节奏 ────────────────────────────────────────────────────────
#
# 能耗模型（实测）：有线读一次配置页 = 1 个 520 字节特性报告往返（63ms）；
# 2.4G 读一次 = **10 个射频包**（128 字节 / 每包 14 字节），每次都要唤醒键盘
# 的射频前端。所以 2.4G 才是费电的地方，策略必须分开。
#
# 旧实现在 2.4G 下是 180 次/分 = 1800 包/分，等于让键盘射频几乎不休息。
# 循环唤醒间隔：只调 GetLastInputInfo，不碰 HID（成本≈0）。
# 必须明显小于各通道的读页间隔，否则会「计时混叠」——
# 正好等于 WIRED_INTERVAL 时，读页耗时 63ms 让 elapsed 差一点点不到 1.0，
# 判定成「还没到时候」，实际退化成每 2 秒读一次（我踩过，见 tmp/pw_trace.txt）。
LOOP_TICK = 0.25
WIRED_INTERVAL = 1.0        # 有线读页间隔（长按检测最坏延迟 = 这个值）
WIRELESS_INTERVAL = 2.5     # 2.4G 读页间隔（每次 10 个射频包，别太勤）
IDLE_MS = 450               # 最近这么久内有输入就跳过本轮（打字保护）
IDLE_MS_AFTER_WRITE = 1200  # 刚写完配置页要更保守，避开固件重载灯效的瞬间
# 用户离开电脑这么久之后，**连读页都不读**：
#   ① 键盘才能真的按 SleepTime 进休眠（任何 HID 包都会重置它的空闲计时）；
#   ② 人不在跟前，不可能长按旋钮，检测毫无意义。
# 循环仍然每秒跑一次，但只调 GetLastInputInfo（纯内存调用），发现人回来了
# 就立刻恢复常规节奏 —— 最坏延迟 1 秒。
AWAY_MS = 60000
SELF_WRITE_GUARD = 1.5      # 自己写完多久内的变化不算长按
DEBOUNCE = 2.0              # 一次长按只算一次
RESCUE_COOLDOWN = 3.0       # 两次清 0x1A 之间至少隔这么久，防止来回写
DRAIN_MAX = 16              # 每次最多排空多少条通知包（只用于诊断计数）

# 固件整页重载时会把灯效换成 0 或 19（新旧固件都见过），两个都认。
MODE_EDGES = (0, EFFECT_CUSTOM)

_user32 = ctypes.WinDLL("user32", use_last_error=True)
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wt.UINT), ("dwTime", wt.DWORD)]


# 注意 GetTickCount 在 kernel32 里，不在 user32。这两个原型必须显式声明：
# 不声明时 ctypes 会把返回值当 32 位有符号 int，GetTickCount64 会被截断。
_user32.GetLastInputInfo.argtypes = [ctypes.POINTER(_LASTINPUTINFO)]
_user32.GetLastInputInfo.restype = wt.BOOL
_kernel32.GetTickCount64.argtypes = []
_kernel32.GetTickCount64.restype = ctypes.c_ulonglong


def idle_ms() -> int:
    """距上一次键鼠输入多少毫秒。取不到就返回一个很大的数（当作空闲）。"""
    try:
        info = _LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(info)
        if not _user32.GetLastInputInfo(ctypes.byref(info)):
            return 1 << 30
        # GetTickCount64 不会回绕；截到 32 位与 dwTime 同量纲后无符号相减。
        now = int(_kernel32.GetTickCount64()) & 0xFFFFFFFF
        return (now - int(info.dwTime)) & 0xFFFFFFFF
    except Exception:                                  # noqa: BLE001
        return 1 << 30


class PageWatch:
    """盯配置页：抓到固件动作就调 `on_flip()`，并把键盘拉出固件模式。

    用法：
        w = PageWatch(hub, router.cycle_mode)
        w.start()
        ...
        w.stop()
    """

    def __init__(self, hub, on_flip=None):
        self.hub = hub
        self.on_flip = on_flip
        self._stop = threading.Event()
        self._thread = None

        self.enabled = True          # 「长按切槽」总开关（关掉就完全不轮询）
        self.hits = 0                # 抓到几次长按
        self.rescued = 0             # 把键盘从固件模式拉回来几次
        self.samples = 0             # 真正读了几次页
        self.skipped = 0             # 因为「用户正在打字」跳过了几次
        self.absent = 0              # 因为「人不在电脑前」跳过了几次（省电）
        self.packets = 0             # 排空到多少条通知包（诊断）
        self.last_at = 0.0
        self._last_read_at = 0.0     # 上次真读页的时刻（决定「该不该读」）
        self.last_error = ""
        self.last_reason = ""
        self.last_fp = None
        self.mode_raw = 0
        self.spin_raw = 0
        self._last_rescue = 0.0
        self._last_write_seen = 0.0

    # ── 生命周期 ────────────────────────────────────────────────
    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self):
        if self.running:
            return self.status()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="page-watch", daemon=True)
        self._thread.start()
        return self.status()

    def stop(self):
        self._stop.set()
        t = self._thread
        if t is not None and t.is_alive():
            t.join(timeout=2.0)
        self._thread = None

    def status(self) -> dict:
        return {
            "running": self.running,
            "enabled": bool(self.enabled),
            "hits": self.hits,
            "rescued": self.rescued,
            "samples": self.samples,
            "skipped": self.skipped,
            "absent": self.absent,
            "packets": self.packets,
            "lastAt": round(self.last_at, 2),
            "reason": self.last_reason,
            "error": self.last_error,
            "modeRaw": self.mode_raw,
            "spinRaw": self.spin_raw,
        }

    # ── 内部 ────────────────────────────────────────────────────
    def _link(self):
        """能读写配置页的链路。有线与 2.4G 都行（2.4G 走 0x44 / 0x04）。"""
        hub = self.hub
        with hub.lock:
            hub._connect()
            link = hub.link
            if getattr(link, "kind", "") not in ("wired", "wireless"):
                return None
            return link

    def _interval(self) -> float:
        link = getattr(self.hub, "link", None)
        return WIRELESS_INTERVAL if getattr(link, "kind", "") == "wireless" else WIRED_INTERVAL

    def _run(self):
        # 循环本身跑得很密（LOOP_TICK=1s），但绝大多数圈只调 GetLastInputInfo，
        # 不碰 HID。真正读页由 _due() 按通道各自的间隔决定。
        while not self._stop.is_set():
            t0 = time.time()
            try:
                if self.enabled:
                    self._tick()
            except Exception as exc:                   # noqa: BLE001
                # 单次失败不能让线程死掉 —— 静默退出是最难查的 bug
                self.last_error = f"{type(exc).__name__}: {exc}"
            rest = LOOP_TICK - (time.time() - t0)
            if rest > 0:
                self._stop.wait(rest)

    def _due(self) -> bool:
        # 注意：不能拿 last_at 当计时器 —— 那个是长按去抖用的（DEBOUNCE）。
        # 两个语义混在一起会让读页退化成每秒一次，正好破坏省电目的。
        return (time.time() - self._last_read_at) >= self._interval()

    def _tick(self):
        idle = idle_ms()

        # ① 人不在电脑前：连页都不读。
        #    这样键盘才能按自己的 SleepTime 进休眠（任何 HID 包都会重置它的
        #    空闲计时）；而且没人会在这时候长按旋钮，检测毫无意义。
        if idle >= AWAY_MS:
            self.absent += 1
            return

        # ② 用户正在打字 / 刚写完配置页：这一轮什么都不做。
        #    这是「偶尔少打一个字」的根治点 —— 打字期间不碰 HID 特性通道。
        guard = IDLE_MS_AFTER_WRITE if (time.time() - self._last_write_seen) < 2.0 else IDLE_MS
        if idle < guard:
            self.skipped += 1
            return

        # ③ 还没到本通道的读页间隔（2.4G 一次要发 10 个射频包，不能每秒读）
        if not self._due():
            return

        link = self._link()
        if link is None:
            return

        with self.hub.lock:
            page = link.read_page()
            packets = self._drain(link)

        self.samples += 1
        self._last_read_at = time.time()
        self.packets += len(packets)

        if not page or len(page) < PAGE_LEN or (page[-2], page[-1]) != TAIL:
            self.last_error = "配置页读回不完整"
            return

        # 把这次读到的页交给 hub 复用：refresh() 的完整刷新就不必再读一次
        # （2.4G 读一次 = 10 个射频包，省一半以上）。
        self.hub.page = page
        self.hub._page_fresh_at = time.time()
        self.last_error = ""

        fp = self._fingerprint(page)
        if fp is None:
            return
        self.mode_raw = fp[3]
        self.spin_raw = fp[4]

        prev, self.last_fp = self.last_fp, fp
        flip = False
        if prev is not None and prev != fp:
            flip, why = self._looks_like_flip(prev, fp)
            self.last_reason = why
        else:
            why = ""

        if flip:
            # 「自写排除」只对备判据生效。主判据是 0x1A，软件工作流从不写它，
            # 它变了必然是固件干的 —— 此时不能被「刚写过配置页」挡掉，
            # 否则「转一下旋钮再长按」会漏。
            own = getattr(self.hub, "_last_write_at", 0.0)
            if not why.startswith("长按（模式标记") and (time.time() - own) < SELF_WRITE_GUARD:
                self.last_reason = "自写"
                flip = False

        if flip:
            now = time.time()
            if now - self.last_at >= DEBOUNCE:
                self.last_at = now
                self.hits += 1
                cb = self.on_flip
                if callable(cb):
                    try:
                        cb()
                    except Exception as exc:               # noqa: BLE001
                        self.last_error = f"切槽失败：{type(exc).__name__}: {exc}"
            # 切槽之后立即把键盘拉出固件模式（同一个线程，不存在竞态）
            self._rescue(link, page)

        elif page[PAGE_MODE] == 1:
            # 没检测到翻转但标记还是 1（比如软件刚启动时就已经在固件模式里）
            self._rescue(link, page)

    def _rescue(self, link, page: bytes):
        """把 0x1A 清回 0，其余字节一个不动。

        它会由固件自己置 1（用户长按旋钮就进去了），而且自己不会退出来。
        不清掉的话，键盘旋钮会一直只调背光、一个按键都不发给电脑。
        """
        if page[PAGE_MODE] != 1:
            return
        now = time.time()
        if now - self._last_rescue < RESCUE_COOLDOWN:
            return

        fixed = bytearray(page)
        fixed[PAGE_MODE] = 0
        with self.hub.lock:
            link.write_page(bytes(fixed))
            self._last_write_seen = time.time()
            time.sleep(0.10)
            back = link.read_page()

        if back and len(back) > PAGE_MODE and back[PAGE_MODE] == 0:
            self.rescued += 1
            self._last_rescue = time.time()
            self.last_at = time.time()
            self.last_error = ""
            # 让上层下一轮重新读：清掉缓存时间戳，refresh() 就会走完整读页
            self.hub.snap.last_ok = 0.0
            self.hub.last_full = 0.0
            # 自己刚改过页，指纹要同步，否则下一轮会被当成一次翻转
            fp = self._fingerprint(back)
            if fp is not None:
                self.last_fp = fp
        else:
            self.last_error = "写回 0x1A 没被接受"

    def _drain(self, link) -> list:
        """把链路上排队的输入报告读空（只用于诊断计数）。

        只有有线能读到通知包；2.4G 的接收器不推这类包，`read()` 还会等超时，
        所以直接跳过。
        """
        if getattr(link, "kind", "") != "wired":
            return []
        dev = getattr(link, "dev", None)
        if dev is None:
            return []
        out = []
        for _ in range(DRAIN_MAX):
            try:
                data = dev.read(64)
            except Exception:                          # noqa: BLE001
                break
            if not data:
                break
            out.append(bytes(data))
        return out

    @staticmethod
    def _fingerprint(page: bytes):
        """(effect, brightness, speed, mode_flag, spin)。读不懂返回 None。

        注意 `effect == 0` 是**合法值**（灯效关），不能当成读失败丢掉 ——
        这正是更早一版漏掉长按的原因。
        """
        if not page or len(page) <= PAGE_MODE:
            return None
        eff = page[PAGE_EFFECT]
        mode_flag = page[PAGE_MODE]
        spin = page[PAGE_SPIN] if len(page) > PAGE_SPIN else 0
        if eff < 1:
            return (eff, -1, -1, mode_flag, spin)
        slot = (eff - 1) * EFFECT_STRIDE + PAGE_TABLE
        if slot + 1 >= len(page):
            return (eff, -1, -1, mode_flag, spin)
        return (eff, page[slot], (page[slot + 1] >> 4) & 0x0F, mode_flag, spin)

    @staticmethod
    def _looks_like_flip(prev, cur):
        """指纹跳变 → (是不是长按, 理由)。

        主判据：`mode_flag`（配置页 0x1A）变了。这个字节只有固件自己会改，
        软件连改五次灯效它都纹丝不动，所以一旦变化必然是固件状态机动了。

        备判据：灯效变了 且 亮度或速度也变了 且 新旧灯效里有一个落在模式边界
        （0 或 19）—— 给 0x1A 不变化的老固件兜底。
        """
        if prev is None or cur is None:
            return False, "指纹不可用"
        eff_a, br_a, sp_a, m_a, _ = prev
        eff_b, br_b, sp_b, m_b, _ = cur

        if m_a != m_b:
            return True, f"长按（模式标记 {m_a}->{m_b}）"
        if eff_a == eff_b:
            return False, "指纹变了但不涉及模式标记和灯效"
        if br_a == br_b and sp_a == sp_b:
            return False, "只动灯效（手动切灯效）"
        if eff_a not in MODE_EDGES and eff_b not in MODE_EDGES:
            return False, f"灯效 {eff_a}->{eff_b} 不在模式边界"
        return True, f"长按（整页重载 {eff_a}->{eff_b}）"


# ── 模块级单例，方便 Api 取状态 ────────────────────────────────
_single = None


def instance(hub=None, on_flip=None):
    global _single
    if _single is None and hub is not None:
        _single = PageWatch(hub, on_flip)
    return _single


def reset_instance():
    """测试用：丢掉单例，下次 instance() 重新建。"""
    global _single
    _single = None
