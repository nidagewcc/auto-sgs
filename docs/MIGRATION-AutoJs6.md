# 三国杀名将传 · AutoJs6 迁移与真机运维手册

> 从 AutoX.js v6 迁到 **AutoJs6 v6.8.0**。本文所有结论均已真机实测，不写推测项。
> 最后更新：2026-11-25（三个日常任务全部跑通后的状态）

---

## 一、当前状态

| 任务 | id | 真机耗时 | 结果 |
|---|---|---|---|
| 玩家信息读取 | `playerinfo` | 7s | 7 字段全对 |
| 邮件全部领取 | `mail` | 13s | 入口→领取→关窗→回主城 |
| 主城小乔·一键日常 | `xiaoqiao` | 19s | 头像→日常页→开启→执行完成→关面板→回主城 |

共验证 **3 个账号 / 3 个区**（Y528如雷贯耳、Y841杯水车薪、Y529巍然耸立），全部 120 级。

游戏包名 `com.sanguosha.mjz.mi`，Activity `org.cocos2dx.lua.AppActivity`（Cocos2dx 渲染，**没有原生控件**）。

---

## 二、环境

| 项 | 值 |
|---|---|
| 电脑 | Windows 11 / pwsh 7.6.4 |
| 仓库 | `D:\develops\auto-sgs`，remote `https://github.com/nidagewcc/auto-sgs.git` |
| 手机 | Redmi `M332BF`，product `warsaw`，Android 17 / SDK 37 |
| 分辨率 | 物理 1280x2772；游戏横屏后逻辑画布 **2772x1280** |
| adb | `D:\develops\tools\platform-tools\adb.exe`（37.0.3，独立安装） |
| node | sandbox 自带 node，`tools/build.js` 用 |
| git | `D:\Program Files\Git\cmd\git.exe` 2.45.1 |
| AutoJs6 | `org.autojs.autojs6` 6.8.0（versionCode 6640） |

**本机没有 python**（只有空壳 `py.exe`），所以构建走 node 版 `tools/build.js`，它会解析 `tools/build.py` 里的常量字符串生成同一份 bundle。

---

## 三、依赖与插件

AutoJs6 v6.8.0 起，OCR / OpenCV / 条码等能力改成**独立插件**，必须单独安装并在「插件」页打开开关。

| 插件 | 包名 | 是否必需 | 说明 |
|---|---|---|---|
| ML Kit OCR (Chinese) | `io.github.supermonster003.autojs6.plugin.mlkitocr` 1.0.4 | **必需** | 不装则 `ocr()` 报「未找到可用插件变体」 |
| OpenCV | `io.github.supermonster003.autojs6.plugin.opencv` 1.1.5 | 非必需 | `images.clip/findImage/findColor` 不启用也能用 |

本机副本：`D:\develops\install\mlkit-ocr.apk`、`opencv.apk`、`autojs6-v6.8.0-arm64-v8a.apk`。

手机直连 GitHub 下插件会超时，绕法是电脑下载 APK → `adb push` → `pm install`。

装完后 AutoJs6 会显示「启用失败」，真正要做的是点条目右侧**开关**，弹「AutoJs6 想要打开 X」时选**始终允许**。

---

## 四、首次配置（换机 / 重置后按序做一遍）

### 4.1 手机侧开关（小米必开）

- 「USB 安装」——不开会 `INSTALL_FAILED_USER_RESTRICTED`
- 「USB 调试（安全设置）」——不开 `settings put` 直接被拒

### 4.2 adb 服务

用独立 platform-tools。EasyClick 自带的 `C:\Users\admin\.config\easyclick\ecbin\adb.exe` 会占 5037，导致 `adb pair` 报 `unknown host service`。先清干净：

```powershell
Get-Process adb -ErrorAction SilentlyContinue | Stop-Process -Force
& "D:\develops\tools\platform-tools\adb.exe" kill-server
& "D:\develops\tools\platform-tools\adb.exe" start-server
```

### 4.3 无损授权（关键，写错字符会被系统整条丢弃）

```powershell
& $adb shell settings put secure enabled_accessibility_services "org.autojs.autojs6/org.autojs.autojs.core.accessibility.AccessibilityServiceUsher:com.miui.carlink/com.carwith.common.accessibility.FocusAccessibilityService"
& $adb shell settings put secure accessibility_enabled 1
```

真实组件是 `org.autojs.autojs6/org.autojs.autojs.core.accessibility.AccessibilityServiceUsher`（中间是 `autojs.core`，**不是** `autojs6.core`）。类名对不上时系统静默丢弃整条命令，表现是 `currentPackage()` 恒返回空串。

验证：`adb shell dumpsys accessibility | findstr AutoJs6`，应出现 `Service[label=AutoJs6]` 处于 Bound。

### 4.4 装脚本与模板

```powershell
& $adb shell mkdir -p /sdcard/脚本/auto-sgs/res
& $adb push build\bundle.js /sdcard/脚本/auto-sgs/_main.js
& $adb push res\img /sdcard/脚本/auto-sgs/res/
```

### 4.5 起脚本

```powershell
& $adb shell am start -n org.autojs.autojs6/org.autojs.autojs.ui.main.MainActivity
```

**绝对不要 `force-stop org.autojs.autojs6`**：会把无障碍绑定一起清掉，等于把刚开的授权废掉。要换脚本让新脚本的 step1 去停旧引擎（`reload` 投递）。

---

## 五、连接手机（无线，不占 USB 口）

电脑和手机同局域网即可。手机开「无线调试」→ 用配对码配对：

```powershell
& $adb pair 192.168.3.20:35265 348065
& $adb devices    # 出现 192.168.3.20:xxxx 即成功
```

配对成功后 mDNS 会自动重连，后续直接用 `192.168.x.x:port` 当设备序列号。

**注意**：家里是 `192.168.2.x`，单位是 `192.168.3.x`。`src/config.js` 里 `sgs.PC` 只在存在 `/sdcard/Download/autosgs-logs/pc.txt` 时才启用，否则整套 HTTP 回传关闭——换网段不用改代码。

---

## 六、构建与部署

```powershell
$node = "C:\Users\admin\AppData\Local\Doubao\User Data\sandbox_runtime\bases\fa694f517e5995233c80a9a8db5212c2\node\node.exe"
& $node D:\develops\auto-sgs\tools\build.js          # 输出 build/bundle.js
& $node --check D:\develops\auto-sgs\build\bundle.js # 语法检查，必做
& $adb push build\bundle.js /sdcard/脚本/auto-sgs/_main.js
```

改完代码的标准链路只有这四步，**不需要**切前台点运行按钮。

---

## 七、运行工作流（脚本常驻 + 指令投递）

### 7.1 核心原则

**脚本常驻后台，绝不 `am start` 把 AutoJs6 拉前台。**

游戏被压到后台会触发同步 loading，这段时间画面看着还是主城，但点击全被吞，久了直接掉线。症状是「日志说点成功了，实际什么都没发生」。踩过两次。

心跳线程每 3 秒轮询 `/sdcard/Download/autosgs-logs/autotask.txt`，指令全部走这个文件：

| 指令 | 作用 |
|---|---|
| `echo -n playerinfo` / `mail` / `xiaoqiao` | 跑指定任务，游戏全程留前台 |
| `echo -n reload` | 热重载脚本（新引擎起好再 forceStop 自己） |
| `echo -n tap:191,209` | 单步点击固定坐标，点完存一帧 |
| `echo -n shot:名字` | 只存一帧截图 |
| `echo -n ball:hide` / `ball:show` | 收起/展开浮球 |

### 7.2 日志与截图

- 日志：`/sdcard/Download/autosgs-logs/run.log`，`adb shell cat` 直读
- 单步点击截图：`shot_tap_<x>x<y>.png`
- 取大图看：先 `adb pull`，缩到 900 宽存 jpg 再读（原图 2772x1280 PNG 约 3–5MB，超多模态上限）

---

## 八、任务实测结果与坐标表

### 8.1 playerinfo（7s）

主城直接读 7 字段，多帧投票（`level` / `nickname` / `physical` / `energy` 抖过，走 3 帧投票）：

| 字段 | 解析要点 |
|---|---|
| `nickname` | 3 帧投票取多数 |
| `level` | 「20级」「120级」候选取更长后缀 |
| `combat_power` | OCR 会把「1271037万」读成「万万」，先压重复单位再按 亿/万/千 换算 |
| `physical` / `energy` | `a/b` 分数 |
| `sycee` / `jade` | **必须走带单位解析**，超过百万时 UI 缩写为「139万」 |

三个账号实测值：

| 账号区 | nickname | level | combat_power | 体力 | 精力 | 元宝 | 玉石 |
|---|---|---|---|---|---|---|---|
| Y528如雷贯耳 | 血域魔神 | 120 | 12710370000 | 520/100 | 30/30 | 682358 | 18376 |
| Y841杯水车薪 | 产品经理 | 120 | 648420000 | 500/100 | 17/30 | 644456 | 4218 |
| Y529巍然耸立 | 大模型 | 120 | 3496030000 | 827/100 | 18/30 | 1390000 | 18688 |

### 8.2 mail（13s）

流程：点邮件入口 → 等弹窗 → 点「全部领取」（2 轮）→ 每轮盲点下方空白规避「恭喜获得」浮层 → 点关闭 X → 校验回主城。

**「全部领取」按钮不会消失**（没邮件可领时按钮照样在、点了没反应），所以不拿它当成功判据。

### 8.3 xiaoqiao（19s）

流程：点左侧小乔头像 → 「日常功能」Tab → 「开启」→ 每 8s 轮询「执行完成」绿条 → 关面板 → 校验回主城。

收尾有 4 步兜底：奖励浮层点空白 → 旧版结果窗点右上 X → 面板金色 X → **陌生子界面点左上角 (70,70) 返回**（实测能从「全服拍卖」退回主城）。

### 8.4 游戏内坐标表（横屏 2772x1280）

| 位置 | 坐标 | 备注 |
|---|---|---|
| 左上玩家头像 | **(110, 95)** | 点头像进「玩家信息」页 |
| 玩家信息页「切换账号」 | (800, 1160) | |
| 「你要退出这个账号吗？」确认 | (1586, 865) | 左边是「取消」 |
| 公告「孤知道了」 | (1432, 1051) | |
| 登录页协议勾选框 | **(952, 947)** | 不勾则「进入游戏」无响应 |
| 登录页「进入游戏」 | (1324, 1043) | |
| 登录页「点击选服」 | (1617, 861) | 进游戏后才会弹出「选择服务器」 |
| 区服列表 左列第 1 行 | (1263, 508) | Y529巍然耸立 |
| 区服列表 右列第 1 行 | (1971, 308) | Y841杯水车薪 |
| 右侧「三」菜单 | (2581, 683) | 六宫格圆盘总被浮球抢触摸，需先 `ball:hide` |
| 左侧小乔头像 | (38, 485) | 被屏幕边缘裁掉一半，用固定坐标 |
| 邮件窗关闭 X | (2359, 203) | |
| 「全部领取」 | (770, 1062) | |
| 「再玩一会」（退出游戏确认框） | (1678, 1046) | |
| 「日常功能」Tab 兜底 | (1900, 940) | 图识别失败时用 |
| 「开启」按钮 | (1900, 940) | |

---

## 九、踩坑清单（症状 → 原因 → 修法）

| 症状 | 原因 | 修法 |
|---|---|---|
| `currentPackage()` 恒为空串 | 无障碍组件名写错一个字符，系统静默丢弃整条 settings | 用 `autojs.core` 不是 `autojs6.core` |
| 每改一次代码授权就没了 | `force-stop org.autojs.autojs6` 连带清掉无障碍绑定 | 改代码走 `reload` 投递，不重启 |
| 截到的全是白色对话框 | 每次 `requestScreenCapture` 弹系统共享屏幕授权框 | `_autoGrant` 起线程用无障碍点「共享屏幕」，实测稳定 |
| `参数 options.region 需要是 region within...` | AutoJs6 的 region 是 `[x,y,w,h]`，不是 `[l,t,r,b]` | 传 `[rect[0], rect[1], w, h]` |
| `图像资源已被回收` | AutoJs6 Image 背后是复用池 | 取帧后立刻 `clone()` |
| 引擎越堆越多抢截图 | `engines.all()` 直接返回 ScriptEngine，`.getEngine()` 取不到 | 先试 `getId()`，失败再 `getEngine().getId()` |
| 日志说点成功、实际没反应 | `find` 返回模板左上角，点偏半个模板尺寸 | `find` 统一返回模板中心 |
| 「找不到 close 图标」= 已关闭（误报） | 模板匹不上时 `hasImage` 恒 false | 判据换成「弹窗内容是否还在」 |
| 从后台回前台点击全被吞 | 游戏同步 loading 期 | `ensure` 识别到主城后再等 4s 复检 |
| `输入 tap` 对游戏无效 | Cocos 层不响应 adb input | 只用 AutoJs6 无障碍 `click()`/`clickPointAt()` |
| `uiautomator dump` 拿不到游戏控件 | Cocos2dx 无原生控件，dump 只返回 systemui | 只能截图 + 模板/OCR |
| 浮球挡住右侧按钮 | 浮球 frame `[2576,616][2752,792]`，`surfaceInsets 40` 外扩触摸区 | `ball:hide` |
| 按返回键弹出「确认退出游戏？」 | 游戏把 BACK 绑到退出确认 | 别用 keyevent 4，点左上角返回 |
| `Servant looper is unavailable` | reload 后旧引擎残留线程仍在截屏 | 重载后先跑一次 `shot` 自检 |

---

## 十、遗留问题

1. **手机脱离电脑独立跑**：心跳里 `/cmd` 那一支依赖 `pc.txt`，没有该文件时整段跳过。要完全脱机需确认定时自启与日志落盘。
2. **`xiaoqiao` 的成功判据仍偏弱**：靠「执行完成」绿条颜色 + 面板关闭，中间某步被 loading 吞掉时不会重试该步，整轮会报错重来。
3. **`reload` 的残留线程**：偶发 `Servant looper is unavailable after runtime recycling`，目前靠「重载后先 shot 自检」规避，未从根上解掉。
4. **坐标全是硬编码**：分辨率一变全废。长期应改为模板匹配 + OCR 定位，`find` 已返回中心，具备改造基础。
5. **`mail` 的「恭喜获得」浮层不识别**：改为盲点空白规避，功能上够用，但无法确认「这一轮到底领到了什么」。
6. **选区服坐标依赖列表顺序**：账号的区服位置变了就点错，需要 OCR 读「Y841」这类区服名来定位。
