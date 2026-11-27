# 主城只读确认记录（2026-11-27 10:50）

- 设备：M332BF，mDNS `adb-52059658-wzxgz4._adb-tls-connect._tcp`，全程零点击零消费
- 探针脚本：`tools/probe-junqing-entry-20261127.py`（一次性，仅安全区域匹配，无全屏兜底）
- 证据：
  - `_shot/home-check-20261127-1050.png`（exec-out 直拉，2772×1280，手机侧无落图）
  - `_shot/home-check-20261127-1050-match.png`（匹配标注图）

## 预期
用户手动进入游戏主城后，确认：(1) 前台是游戏且为严格主城无遮挡；(2) 紧急军情入口是否在屏；(3) AutoJs6 引擎仍停。

## 实际

### 1. 前台与主城判定：通过
- 前台 `com.sanguosha.mjz.mi/org.cocos2dx.lua.AppActivity`（cocos 游戏 Activity）。
- 横屏 2772×1280；底部主城导航栏完整（阵容/武将/…/征战），左上玩家横幅、左下系统聊天窗均在；无任何弹窗、暗色遮罩、军情面板或「恭喜获得」。判定为**严格主城**。
- 当前账号显示玩家名「黄天当道」（贵族6），与昨晚 run.log 中的「血域魔神」不同，疑似已切换账号/区服，后续复测以当前账号为准。

### 2. 紧急军情入口：不在屏上
- 模板 `res/img/special_event/jinjijunqing.png`（66×71），安全区域 `[650,800,1800,1180]`，`TM_CCOEFF_NORMED`。
- 本次最佳匹配 **0.3613**，中心 (1423,864)，标注图确认落在武将脚下地面，属误中；生产阈值为 0.8（见 `_main.js` L1448、L1498）。
- 同区域历史对照（同模板同 ROI），分数呈二值分布：

| 截图 | 得分 | 中心 | 入口实际 |
|---|---|---|---|
| junqing-skipped-home.png | 0.9838 | (1257,1001) | 有（与 JUNQING-VERIFICATION.md L9 记录一致） |
| xiaoqiao-final-home.png | 0.9719 | (1257,1001) | 有 |
| account3-home.png | 0.3397 | (1121,1001) | 无 |
| daily-rerun-home.png | 0.3962 | (1121,1027) | 无 |
| xiaoqiao-home-after-daily.png | 0.3116 | (815,1043) | 无 |
| **home-check-20261127-1050.png** | **0.3613** | (1423,864) | **无** |

- 有/无两带间隔约 0.57，本次 0.3613 完全落在无入口带（0.31–0.40），阴性结论可靠，非阈值边界情形。

### 3. AutoJs6 引擎：仍停止
- run.log 两次 `stat`（间隔 5 秒）均为 82845 字节、mtime 1795700078（2026-11-26 21:34），无新写入；未启动任何脚本。

## 复现
1. `adb -s <mDNS> shell dumpsys window | grep mCurrentFocus`
2. `adb -s <mDNS> exec-out screencap -p > _shot/home-check-20261127-1050.png`
3. `python tools/probe-junqing-entry-20261127.py`

## 结论与后续
- 主城画面合格，可作为后续验收的干净起点；军情入口当前未刷新，**不发起挑战、不耗体力**，等入口刷新后再跑完整链路。
- 下一步仍需用户在 AutoJs6 前台重启 `_main.js`（引擎已停约 13 小时），重启步骤由 Chief 下达。
