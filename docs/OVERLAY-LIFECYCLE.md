# 悬浮窗重复创建与退出清理

整理及修复：**Codex**，2026-11-26。

## 现象和证据

用户反馈调试截图中存在大量重复的“三”字悬浮球。本次通过授权手机的 `dumpsys window windows` 确认，AutoJs6 当前进程存在 37 个相同尺寸的悬浮球窗口。窗口数不能等同于当前脚本任务数。

旧代码存在两个问题：远程 `ball` 指令先将 `ballView` 置空，再创建窗口，导致旧窗口引用丢失；窗口由 `WindowManager.addView()` 直接挂载，但引擎退出未执行窗口清理。反复重载后旧窗口仍可存活、挡住游戏触摸。

## 修复

- `showBall()` 将创建操作串行投递到 Android 主线程；已有窗口或待创建窗口时复用，重复显示不会增加窗口。
- 所有窗口添加归属标签和窗口标题：`auto-sgs:ball`、`auto-sgs:dock`、`auto-sgs:panel`，并登记到本引擎的窗口列表。新增日常设置面板使用 `auto-sgs:daily-settings`，沿用同一登记、退出清理和遗留回收机制。
- 添加前再次检查当前引用和退出状态，避免 hide/dispose 后排队回调补出新窗口。添加失败后可重试。
- 隐藏时移除窗口；退出通过 `events.on("exit")` 调用 `dispose()`，在主线程同步清理球、圆盘、面板和刷新计时器。两个重载入口在启动新引擎前同样主动清理。
- 清理检查 Java View 身份时兼容不同 Rhino wrapper 对应同一 Java 对象的情况，避免误删本引擎正在使用的窗口。
- 远程 `ball` 指令不再清空引用；`ball:hide` 明确执行隐藏。
- 新增 [引擎生命周期模块](../src/lifecycle.js)：启动、clean、reload 只停止来源为本项目固定 `_main.js` 的其他引擎，保留当前引擎和无关脚本。

## 旧窗口迁移

使用 Android API 29 起公开的 [WindowInspector.getGlobalWindowViews()](https://developer.android.google.cn/reference/android/view/inspector/WindowInspector) 获取本应用进程的窗口根 View，不使用隐藏 API 反射，也不枚举其他应用窗口。

先排除本引擎已登记的窗口。候选必须为 `TYPE_APPLICATION_OVERLAY`，并满足以下之一：

1. 根 View 带本项目明确的窗口归属标签。
2. 兼容旧版本：根 View 本身是 TextView，文字为“三”，宽高均为 54dp，背景是椭圆 GradientDrawable，背景色为本项目空闲或忙碌色，文字颜色与本项目一致。

匹配超过 64 个时不清理任何窗口，保留供检查。旧版特征匹配不是强所有权证明，因此不能删减成只按文字或窗口尺寸判断，也不能匹配某个子节点后移除整个无关窗口。

停止本项目旧引擎后再恢复残留窗口，不强退 AutoJs6，不修改无障碍设置，不清理其他应用的数据或窗口。

## 启动方式

当旧引擎已经停止轮询时，可通过 AutoJs6 v6.8.0 的无界面快捷入口启动指定脚本，不使用 `force-stop`：

```powershell
adb -s 授权设备 shell am start -n org.autojs.autojs6/org.autojs.autojs.external.shortcut.ShortcutActivity -a android.intent.action.MAIN --es path /sdcard/脚本/auto-sgs/_main.js
```

这里的 path 是本地绝对路径，不是 URI；不附带 data、json 或 script。该入口的源码依据为 [ShortcutActivity](https://github.com/SuperMonster003/AutoJs6/blob/v6.8.0/app/src/main/java/org/autojs/autojs/external/shortcut/ShortcutActivity.java) 和 [DirectPathPolicy](https://github.com/SuperMonster003/AutoJs6/blob/v6.8.0/app/src/main/java/org/autojs/autojs/external/shortcut/ScriptShortcutDirectPathPolicy.kt)。无界面不等于所有设备上焦点绝无瞬时变化，仍需观察当前设备表现。

## 验证

- `node tests/overlays.js`：使用模拟 Handler、WindowManager 和引擎，验证重复显示、添加前隐藏、退出、旧窗口回收范围、异常重试及同项目引擎筛选。
- 原有回归、截图保存和清理安全测试继续运行。
- 重建 bundle、语法检查、差异检查。
- 真机操作前备份手机脚本并确认与仓库基线一致；修复前的窗口快照和无障碍设置快照保存在本机 `_shot/`，不入 Git。

## 本次真机结果

授权设备为 Redmi M332BF / Android 17，本次结果：

1. 首次启动日志记录 `清理本项目残留悬浮窗 37 个`；窗口快照确认旧球消失。
2. 发现 AutoJs6 的 `SYSTEM_ALERT_WINDOW` 原为 `deny`，导致新球添加失败；只将这项恢复为 `allow`，没有强退应用或重置无障碍。首次后台请求截图超时，打开 AutoJs6 前台后重新启动，截图授权成功。
3. 新版本正常启动后仅 1 个 `auto-sgs:ball`。
4. 连续 6 次文件投递 `ball:show`，每次窗口 ID 相同、数量为 1。
5. `ball:hide` 后窗口为 0；再次 `ball:show` 后为 1。
6. 文件投递 `reload` 后窗口 ID 更换，最终仍为 1，旧无标签球为 0。
7. 一次性探针只停止来源为本项目 `_main.js` 的引擎，`exit` 回调将球移除，窗口为 0；随后重启恢复为 1。AutoJs6 应用进程保留。
8. 对比操作前后的 `enabled_accessibility_services` 内容一致。

本地 42 项测试通过（悬浮窗/生命周期 14 项，原回归 8 项，截图管理 11 项，归档安全 9 项）；构建、语法检查及差异检查通过。

本次未运行游戏消费任务，也未删除用户文件。手机脚本部署前备份为 `_shot/phone-before-overlay-fix.js`；窗口快照、日志、真机验证 JSON 和一次性探针保存在本机 `_shot/`，不入 Git。
