# 真机只读盘点报告（2026-11-27 10:38–10:45）

- 设备：M332BF（REDMI K90 Ultra，product warsaw），序列号 52059658，mDNS `adb-52059658-wzxgz4._adb-tls-connect._tcp`，连接 `192.168.3.20:35595`
- 性质：**全程只读**，零点击、零游戏操作、零消费；仅 `adb pull` 一个脚本文件、`exec-out screencap` 直拉一张截图、`shell ls/cat/tail/stat/grep` 只读查询。未在手机侧落任何图片，未触碰 192.168.3.16。
- 本机证据目录：`_shot/`
  - `phone-main-2026-11-27.js`（手机脚本拉取副本，183153 字节）
  - `readonly-inventory-20261127-1038.png`（当前屏幕截图，1280×2772）

---

## 一、手机脚本版本核对

### 预期
手机 `/sdcard/脚本/auto-sgs/_main.js` 应与本地 HEAD `15899e7` 的 `build/bundle.js` 一致（含军情修复 `2a61005`、小乔后备模板、邮件轮询）。

### 实际
**逐字节一致，手机版即 HEAD 产物，部署一致性问题解除。**

| 项 | 手机 `_main.js` | 本地 `build/bundle.js` |
|---|---|---|
| MD5 | `e467404b8c23ac8a97e5bba93878c8eb` | `e467404b8c23ac8a97e5bba93878c8eb` |
| 大小 | 183153 字节 | 183153 字节 |
| 手机侧修改时间 | 2026-11-26 21:12:45 | — |

三项功能在手机文件中的代码位置（拉取副本行号）：

1. **军情入口/奖励弹窗修复（2a61005）**：`junqing` 模块 L1433–1593；入口消失按「今日已完成」处理 L1516–1523；「恭喜获得」浮层等待与点空白关闭 L1530–1545；邮件侧奖励浮层宽区域兜底 L1037–1038、L1233。
2. **小乔后备模板**：`ENTRY_FALLBACK = "xiaoqiao/xiaoqiao_entry.png"`、阈值 0.9，注释明确「仅作为高分后备，不放宽主模板阈值，也不允许全屏匹配」L1167–1170。
3. **邮件增强轮询**：`_waitClaimEvidence` 轮询 5 秒、每 500ms 取帧（`EVIDENCE_WAIT_MS=5000` / `EVIDENCE_POLL_MS=500`）L1028–1063；空状态 6 个正则（含「暂无可领取的附件/邮件」「无可领取」）L1027。

### 证据
- `_shot/phone-main-2026-11-27.js`（MD5 同上）
- 本机 `git log`：HEAD `15899e7 docs: record blocked junqing end-to-end verification`，其上即 `2a61005 fix: recognize junqing entry shift and reward overlay`

### 复现
`adb -s <mDNS> pull /sdcard/脚本/auto-sgs/_main.js _shot/phone-main-2026-11-27.js` 后两边 `Get-FileHash -Algorithm MD5` 比对。

---

## 二、当前画面状态

### 预期
确认前台是否为游戏、昨晚遗留的「恭喜获得」弹窗是否还在、是否在主城。

### 实际
- 前台是**系统设置「无线调试」页**（`com.android.settings/.SubSettings`），非游戏。截图可见设备名 REDMI K90 Ultra、`192.168.3.20:35595`、已配对设备中 `admin@JAVA` 显示「当前已连接」。
- 游戏包名 `com.sanguosha.mjz.mi`：**进程不存在**（`ps -A` 无记录），仅存于最近任务列表第 7 位。游戏已被彻底划掉/回收，不在后台存活。
- 因此「恭喜获得」弹窗与主城状态**均无法观察、也不存在了**——进程都不在，昨晚的弹窗随进程死亡自然消失。这不算验证通过，只是阻塞场景不再保留；军情全链路验收仍需等入口刷新后重跑。
- AutoJs6（`org.autojs.autojs6`）进程存活，但脚本引擎已停（见第四节）。

### 证据
- `_shot/readonly-inventory-20261127-1038.png`
- `dumpsys window`：`mCurrentFocus=...com.android.settings/.SubSettings`
- `dumpsys activity recents`：游戏在 Recent #7；`ps -A` 无游戏进程

### 复现
`adb -s <mDNS> exec-out screencap -p > _shot/readonly-inventory-20261127-1038.png`（手机侧不留文件）；`dumpsys window | grep mCurrentFocus`。

---

## 三、调试目录现状（`/sdcard/Download/autosgs-logs/`，只看不动）

### 预期
盘点截图数量与命名、run.log 大小、三个状态 JSON 是否存在及时间。

### 实际
- `.nomedia` 存在（根目录与 screenshots/ 各一），相册隔离生效。
- **screenshots/：18 张** `dbg_<时间戳>_1_<标签>.png`，全部符合程序命名规范，最早 17:01、最晚 21:24（`connection_check`）。未超 20 张轮转上限，无未知命名文件，无需清理。
- `run.log`：82845 字节、2121 行，最后写入 **2026-11-26 21:34**；5 秒间隔两次 `stat` 大小/mtime 不变，日志已停止增长。
- 状态文件：
  - `task-status.json`（6539B，21:08）：`active: null`，历史 11 条；最近两条军情为 failed（「点击一键挑战后界面异常，面板未保持」21:08）与 skipped（「未出现可用军情入口」21:03）；最近一次小乔 21:05  success（25.9 秒）。
  - `daily-plan.json`（329B，15:51）：mail ✓、xiaoqiao ✓，playerinfo / junqing / zhuxian 均关闭。
  - `daily-last-result.json`（1236B，20:38）：partial，邮件 success、小乔 failed（「未识别到小乔头像」），已中止。
- 根目录另有历史探查文件（`probe*.txt`、`codex-daily-*`、`s_r5.png`、`s2.txt` 等），均为历史调研遗留，未动。

### 证据
`adb shell ls -la` 输出（本报告采集记录）；手机侧路径同上。

### 复现
`adb -s <mDNS> shell ls -la /sdcard/Download/autosgs-logs/ && ls .../screenshots/`。

---

## 四、盘点中新发现（影响后续验收）

1. **脚本引擎已停约 13 小时**：AutoJs6 应用进程在，但 run.log 从昨晚 21:34 起无心跳、无增长。下次跑任务前需要在 AutoJs6 内重新启动 `_main.js`（悬浮球当前不在屏幕上）。
2. **截图权限超时反复出现，共 9 次**：全部是 `requestScreenCapture` 5 秒超时（`Make sure that the app is in foreground`），即启动脚本时 AutoJs6 不在前台所致，属环境时序问题而非代码缺陷；多数会话随后由「自动点掉截图授权框」恢复（如 17:01 玩家信息任务随后成功读出 7 字段）。但 14:58 那次还伴随 `BadTokenException: permission denied for window type 2038`（悬浮窗权限被拒）。建议码工评估：启动期截图权限失败后的重试/提示是否要加强。
3. **玩家等级 OCR 漏前导位依旧**：17:01 成功的玩家信息任务里 `level = 20 原文=["20级","20级","20级"]`，三帧一致漏前导位（已知遗留项 R 类，投票机制无法纠正一致性误读），再次复现留证。
4. **军情失败现场的调试图齐全**：screenshots 内 `junqing_skipped/failed/current/resume/round2~5` 共 8 张，可作为后续 spec 校准素材，无需重拍。

---

## 五、结论与下一步

- 三项盘点全部完成，**零点击零消费**，未做任何删除/清理/写入手机私人区域的操作。
- 手机脚本版本 = 本地 HEAD，部署一致性已确认；下次部署仍按 AGENTS.md 先备份比对。
- 军情全链路验收的阻塞弹窗已随游戏进程消失，但验收本身**未完成**；需用户重新打开游戏、回主城，待军情入口刷新后由探针按标准流程复测，不硬耗体力。
- 用户正在使用手机，本报告完成后探针暂停一切 adb 操作，恢复信号等群内通知。
