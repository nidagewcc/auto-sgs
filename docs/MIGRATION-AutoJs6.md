# 迁移到 AutoJs6 v6.8.0

## 改了什么

1. **OCR 双引擎自适应**（`src/vision.js#_ocr`）
   AutoX 用 `gmlkit.ocr`，AutoJs6 没有这个对象，改走 `ocr(img, "zh")`。运行时自动探测，取第一个可用的，返回字符串或 `{text}` 都兼容。

2. **findImage 的 region 双通路**（`src/vision.js#find`）
   先用原生 `region` 参数（AutoJs6 已修好），抛异常才降级成 `clip + 坐标补偏移`（AutoX 的老路）。降级一次后不会再试。

3. **不再无脑把游戏拉前台**（`src/game.js#ensure`、`tools/build.py` step2）
   原来 `currentPackage() != PKG` 就 `launchPackage`，但 `currentPackage()` 经常误报 `com.android.systemui`，结果游戏在后台被拉回来触发 loading、久了掉线。
   现在顺序是：建画布 → 看图（主城/掉线/公告/登录）→ 连续 3 次认不出且前台确实不是游戏，才拉，且全程最多一次。

4. **新增异常页自愈**（`src/game.js#_recover`）
   掉线弹窗点「重新登录」、公告点「孤知道了」、登录页点「进入游戏」，坐标统一放 `src/config.js#sgs.PAGES`。

5. **主城判定加文字兜底**（`src/vision.js#isHome`）
   模板 0.7 → 全屏 0.55 → 底部「征战」OCR 三级。面板打开时那层暗色遮罩不再把判定打死。

6. **PC 地址不再硬编码**（`src/config.js`）
   读 `/sdcard/Download/autosgs-logs/pc.txt`，没有才回落到 `192.168.2.250:8099`。换电脑只改这个文件。

7. **构建不再依赖 python**（`tools/build.js`）
   直接解析 `build.py` 里的三段常量，输出同一份 `build/bundle.js`。

8. **能力探测脚本**（`tools/probe.js`）
   在手机上一键跑，输出画布尺寸、region 是否可用、resize/scale、OCR、floaty、threads 等能力矩阵到 `/sdcard/Download/autosgs-logs/probe.txt`。

## 回家后的验证顺序

```powershell
# 1. 手机连上（无线调试先配对）
adb pair 192.168.2.93:<配对端口> <配对码>
adb connect 192.168.2.93:46849
adb devices

# 2. 取 AutoJs6 的无障碍服务名（别照抄，必须实测）
adb shell dumpsys package org.autojs.autojs6 | findstr /i accessibility

# 3. 构建
node tools\build.js        # 或 python tools\build.py

# 4. 跑能力探测
adb push tools\probe.js /sdcard/脚本/probe.js
adb shell am start -n org.autojs.autojs6/org.autojs.autojs6.ui.main.MainActivity
# 在 AutoJs6 里打开 probe.js 运行，允许截图授权，然后
adb pull /sdcard/Download/autosgs-logs/probe.txt
```

probe.txt 回来之后要确认三件事：

- `requestScreenCapture(false)` 拿到的画布是 **2772x1280** 还是 **1280x2772**。是横屏就说明 letterbox 那套补丁在 AutoJs6 上纯属多余（`_normalize` 会自动跳过，不碍事）。
- `findImage(region=...)` 是 OK 还是 FAIL。OK 就走原生通路。
- `ocr()` 返回的是字符串还是对象。

## 启动序列（AutoJs6 版）

```powershell
$adb = "C:\Users\admin\AppData\Local\Temp\pt-latest\platform-tools\adb.exe"

# 落脚本
& $adb shell mkdir -p /sdcard/脚本/auto-sgs/res
& $adb push build\bundle.js /sdcard/脚本/auto-sgs/_main.js
& $adb push res\img /sdcard/脚本/auto-sgs/res/

# 无障碍（服务名以第 2 步实取为准）
& $adb shell settings put secure enabled_accessibility_services "org.autojs.autojs6/<实取的服务类名>"
& $adb shell settings put secure accessibility_enabled 1

# 起
& $adb shell am start -n org.autojs.autojs6/org.autojs.autojs6.ui.main.MainActivity
```

注意：`am force-stop org.autojs.autoxjs.v6` 那条换成 `org.autojs.autojs6`，但**不要随手 force-stop**——AutoJs6 被停掉后无障碍会一起死，要重新授权。

## 还没解决的

- `xiaoqiao` 的末段（关结果窗 → 回主城）从未在真机跑完过，迁移后仍是第一优先级验证项。
- `mail` 缺「关邮件弹窗回主城」。
- 手机能不能脱离电脑独立跑（不再依赖 8099 的 `/cmd`）没动，仍需要电脑开机。
