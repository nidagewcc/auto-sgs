# 迁移到 AutoJs6 v6.8.0

> 本文已按真机实测数据回改过。之前的推测项（无障碍服务名、letterbox 判断、横屏画布）全部推翻，以这里为准。

## 改了什么

1. **OCR 双引擎自适应**（`src/vision.js#_ocr`）
   AutoX 用 `gmlkit.ocr(img, "zh")` 返回 `{text}`；AutoJs6 没有 `gmlkit`，改走 `ocr(img)`，返回的是 **字符串数组**，需要 `join("\n")`。运行时自动探测。

2. **findImage 的 region 语义**（`src/vision.js#find`）
   AutoJs6 的 `options.region` 数组按 **`[x, y, w, h]`** 解释，不是 `[left, top, right, bottom]`。传错会报
   `参数 "options.region" 需要是 region within the image 2772 x 1280 类型`，感觉像是越界，其实是宽高被当成右/下边界。
   正确传法：`{ region: [rect[0], rect[1], rect[2]-rect[0], rect[3]-rect[1]] }`。
   降级通路 `clip + 坐标补偏移` 保留，AutoX 上仍走它。

3. **不再无脑把游戏拉前台**（`src/game.js#ensure`）
   `currentPackage()` 在无障碍异常时返回空串（不是 `com.android.systemui`）。空值按「不在游戏」处理，连续 3 次认不出才拉，上限 2 次，每次给 12 秒加载窗口。前台确实是游戏时绝不拉，避免打断加载导致 loading 循环掉线。

4. **新增异常页自愈**（`src/game.js#_recover`）
   掉线弹窗点「重新登录」、公告点「孤知道了」、登录页点「进入游戏」，坐标集中在 `src/config.js#sgs.PAGES`。

5. **主城判定加文字兜底**（`src/vision.js#isHome`）
   模板 0.7 → 全屏 0.55 → 底部「征战」OCR 三级。

6. **PC 地址不再硬编码**（`src/config.js`）
   读 `/sdcard/Download/autosgs-logs/pc.txt`，没有才回落 `192.168.2.250:8099`。连不上会自动停用 HTTP 回传，只写本地文件。

7. **构建不再依赖 python**（`tools/build.js`）
   解析 `build.py` 里的三段常量，输出同一份 `build/bundle.js`。（本机没装 python，只能用这条）

8. **截图授权自动点掉**（`src/vision.js#_autoGrant`）
   这是 AutoX 时期不存在的坑。AutoJs6 每次 `requestScreenCapture` 都会弹系统授权框
   （`com.android.systemui:id/screen_share_permission_dialog`），不点掉脚本截到的全是白色对话框，任何页面都认不出。
   现在申请权限前起一个线程，用无障碍 `text("共享屏幕").findOnce()` 定位并点击，实测可稳定点掉，不再需要人工确认。

9. **Image 复用池**（`src/vision.js#frame`）
   AutoJs6 的 Image 背后是复用缓冲，下一次 `captureScreen` 会让上一张报 `图像资源已被回收`。
   取帧后立刻 `clone()` 脱离池子。

10. **引擎清理**（`tools/build.py` step1）
    `engines.all()` 在 AutoJs6 里直接返回 ScriptEngine，`.getEngine()` 取不到，导致之前的清理永远 `停掉 0 个`、引擎越堆越多互相抢截图。
    改成先试 `getId()`、失败再走 `getEngine().getId()`。

## 真机实测结论（M332BF / Android 17 / SDK 37，物理 1280x2772）

| 项 | 结论 |
|---|---|
| `requestScreenCapture(true)` | 画布 **2772x1280**（横屏），方向参数有效 |
| `images.resize` | 签名是 `(img, [w, h], interp)`，传两个数字会报「参数 size 需要是 Array 类型」 |
| `findImage(region=[x,y,w,h])` | 可用 |
| `gmlkit.ocr` | 不存在 |
| `ocr(img)` | 返回 string[]，可用（需装 ML Kit OCR 插件并启用） |
| `currentPackage()` | 无障碍连上时正常；未连上返回空串 |
| `auto.state` | 是 object 不是函数，别照 AutoX 的写法调用 |
| `shell()` | 无 root，`dumpsys`/`pidof` 一律 code=1，别指望它判断前台 |
| `images.save` / 旧帧 | 会报「图像资源已被回收」，取帧后必须 clone |

## 环境依赖（换机 / 重置后重新做一遍）

1. **AutoJs6 插件**：v6.8.0 起 OCR / OpenCV / 条码等改为独立插件，必须在「插件」页安装并**打开开关**。
   - ML Kit OCR 插件**必需**（不装则 `ocr` 报「未找到可用插件变体」）
   - OpenCV 插件**非必需**（`images.clip/scale/findImage/findColor` 不启用也能用）
   - 手机直连 GitHub 下载插件会超时，绕法是电脑下 APK → `adb push` → `pm install`
   - 装完 AutoJs6 会显示「启用失败」，真正要做的是点条目右侧开关，弹「AutoJs6 想要打开 X」时选**始终允许**
2. **小米必须手动开的开关**：「USB 安装」（否则 `INSTALL_FAILED_USER_RESTRICTED`）、「USB 调试（安全设置）」（否则 `settings put` 被拒）
3. **adb**：用独立 platform-tools。EasyClick 自带的 adb 会占 5037 端口，导致 `adb pair` 报 `unknown host service`

## 启动序列（AutoJs6 版）

```powershell
$adb = "D:\develops\tools\platform-tools\adb.exe"

# 落脚本
& $adb shell mkdir -p /sdcard/脚本/auto-sgs/res
& $adb push build\bundle.js /sdcard/脚本/auto-sgs/_main.js
& $adb push res\img /sdcard/脚本/auto-sgs/res/

# 无障碍（类名实测，写错一个字符系统会整条丢弃）
& $adb shell settings put secure enabled_accessibility_services "org.autojs.autojs6/org.autojs.autojs.core.accessibility.AccessibilityServiceUsher"
& $adb shell settings put secure accessibility_enabled 1

# 起
& $adb shell am start -n org.autojs.autojs6/org.autojs.autojs.ui.main.MainActivity
```

**不要 force-stop AutoJs6**：会把无障碍绑定一起清掉，等于把刚开的授权废掉，还得再开一遍。要换脚本就让新脚本的 step1 去停旧引擎。

## 无人值守调试技巧

在手机写 `/sdcard/Download/autosgs-logs/autotask.txt`，内容写任务 id（`playerinfo` / `mail` / `xiaoqiao`），
脚本启动后会读它自动跑一次并删除该文件。日志写在 `/sdcard/Download/autosgs-logs/run.log`，`adb shell cat` 直接看，不依赖电脑端 8099。

## 点不掉的系统弹框怎么处理

`uiautomator dump` 能 dump 到 `com.android.systemui` 的窗口（含 `screen_share_permission_dialog`），
所以先 dump 拿真实 `bounds` 再 `input tap`。**别按截图目测坐标**——截图是缩放过的，偏差会落在按钮外面（踩过坑，偏了 135px 就点不动）。
共享屏幕按钮实测 `[1481,931][2642,1094]`，中心 (2061,1012)。

## 还没解决的

- `xiaoqiao` 的末段（关结果窗 → 回主城）从未在真机跑完过。
- `mail` 缺「关邮件弹窗回主城」。
- `playerinfo` 的 `combat_power` 会多拼一个单位（`1271037万万`），是「数值+万」再补「万」的模板问题，待改。
- 手机脱离电脑独立跑（不依赖 8099 的 `/cmd`）仍需要写 `pc.txt` 或彻底去掉心跳里的 HTTP 拉取。
