# 新部署版启动核验记录（2026-11-27 11:02–11:06）

- 设备：M332BF，mDNS `adb-52059658-wzxgz4._adb-tls-connect._tcp`，全程只读，未点游戏、未操作 AutoJs6 UI
- 部署版本：`_main.js` MD5 `17dca1ad0434697c66ba4bebda562a65`（184063 字节，含 b61cbf7、b8505c1）
- 证据：
  - `_shot/engine-start-check-20261127-1102.png`（exec-out 直拉全屏，手机侧无落图）
  - `_shot/crop-right-edge-20261127-1102.png`、`_shot/crop-left-edge-20261127-1102.png`、`_shot/crop-statusbar-20261127-1102.png`（局部裁剪）
  - logcat GlobalConsole 与 `dumpsys window windows` 输出（本记录转写）

## 预期
用户手动在 AutoJs6 前台启动新版 `_main.js` 后：截图权限拿到（验证三次重试逻辑的实际表现）、悬浮球唯一、状态条正常、无重复悬浮窗/异常弹窗、调试目录无非规范写入。

## 实际

### 1. 引擎与截图权限：第 1 次申请即成功，未触发重试
- 新会话 11:00:44 启动（run.log「=== 悬浮面板启动 11:00:44 ===」），run.log 由 82845→83330 字节持续增长，心跳已到 100 次（logcat 11:05:50 同步出现），引擎健康存活。
- 新版结构化日志（logcat，GlobalConsole 标签）：
  `11-27 11:00:45.878 D GlobalConsole: [vision] 申请截图 land=true 第1次 结果=true`
- 即 **attempt=1 即 capOk=true**：未进第 2/3 次重试，未触发「截图权限未授予，请把 AutoJs6 切到前台」toast（代码 bundle L316-320 仅在首次失败时才 toast），也没有「申请3次均失败」报错。
- 日志路由说明：`init()` 内用的是 AutoJs 原生 `log()`（L314），只进控制台/logcat；`sgs.log.i/w/e`（L74-76）才同时写 run.log。所以 run.log 里只看到「自动点掉截图授权框 成功 / 截图权限 true」摘要，结构化「第N次」行在 logcat，两者一致不矛盾。
- 前台现为游戏 `com.sanguosha.mjz.mi/org.cocos2dx.lua.AppActivity`（用户已按要求切回主城）；AutoJs6 退到后台不影响已授予的截图权限。

### 2. 悬浮窗：恰好 1 球 + 1 状态条，无重复
`dumpsys window windows` 中带本项目标签的独立窗口仅 2 个（grep 计数 12 是同一窗口在多段落重复列出）：
- `auto-sgs:ball`：Window{14ab3ee}，contentSize 256×256（含内边距，黑底金色「三」横线圆钮），全屏截图右缘可见，仅此一个
- `auto-sgs:status`：Window{4d4bcaa}，contentSize 143×715，半透明竖条，alpha 0.7
- 无 `auto-sgs:panel/dock/results/daily-settings` 窗口，无未注册的旧版无标签「三」字球；visible windows 列表中同一对窗口 ID 各出现一次。

### 3. 状态条内容：显示的是昨晚最后一条任务结果，非新任务
- 状态条文字「失败·投递-junqing · 17秒 / Error: 点击一键挑战后界面异常，面板未保持」，与 task-status.json 最近一条历史（21:08，durationMs 17042）逐字对应，是持久化「上次结果」展示。
- task-status.json mtime 仍为 11-26 21:08、`active: null`，证明本次启动后**没有跑任何任务**，无新消费。

### 4. 调试目录：无非规范写入
- screenshots/ 仍为 18 张，最新仍为昨晚 21:24 的 connection_check，启动过程未产生新截图
- 根目录无新增文件；daily-plan.json / daily-last-result.json / task-status.json 均未被改动；仅 run.log 追加心跳
- 屏幕无系统异常弹窗，唯一浮层是本项目自己的状态条

## 复现
1. `adb -s <mDNS> shell tail -n 15 /sdcard/Download/autosgs-logs/run.log`
2. `adb -s <mDNS> logcat -d -b all | grep 申请截图`
3. `adb -s <mDNS> shell dumpsys window windows | grep -oE 'auto-sgs:[a-z-]+' | sort | uniq -c`
4. `adb -s <mDNS> exec-out screencap -p > _shot/engine-start-check-<时间>.png`

## 结论
新版启动核验通过：权限首次即中、重试/toast 分支未触发（逻辑已在代码与日志格式上就位，失败路径待下次前台时序复现才能实测）、悬浮窗唯一、引擎心跳正常、零任务零消费。可作为后续军情入口刷新后全链路验收的干净运行基线。
