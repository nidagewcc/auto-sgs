# 配方驱动执行引擎 重实现方案（WORKBENCH-ENGINE-SPEC）

- 日期：2026-11-27
- 作者：游戏调研（只调研与写 spec，不改 `src/`、不写生产代码）
- 范围：把离线「配方工作台」`workbench/` 的场景/截帧/识别物/流程说明，变成 AutoJs6 端可执行的新引擎（下称**配方引擎**），与现有 `src/` 硬编码引擎（下称**现引擎**）**双端并行、可回退**。
- 配套阅读：`workbench/README.md`、`workbench/app.js`（v3 schema）、`docs/WORKBENCH-DESIGN-V6.md`、`docs/HANDOFF-2026-11-27.md`、`AGENTS.md`、`src/tasks/*`、`src/vision.js`、`src/daily.js`、`src/daily-recovery.js`、`src/task-status.js`、`src/debugshots.js`。
- 标注约定：每节先给**【推荐】**结论；无定论处用 **【待拍板】** 或 **【风险/未验证】** 显式标出，不藏结论。

---

## 第 0 节 双端总纲（用户硬约束，最高优先级）

### 0.1 约束原文与含义

1. 配方体系必须**同时**支持两条执行端：
   - **真机端**：游戏坐标 2772×1280，长宽比 2.1656（20:9 长屏），现引擎 `src/` 继续生产可用。
   - **模拟器端**：雷电 540×960 配置，游戏横屏帧实测 960×540，长宽比 1.7778（16:9），新配方引擎落地目标。
2. 两端长宽比不同，**禁止跨端复用坐标**；参考图（模板素材）按端**分别采集**，不得把一端模板缩放到另一端直接用（拉伸变形 + 渲染缩放差异会让匹配分数失真）。
3. 同一逻辑场景的标注按 **device profile 分组管理**。
4. 真机现有引擎与模板资产**完整保留**，新引擎并行、可回退，不做"替换式重写"。
5. 多开模拟器（同分辨率 960×540）属于**同一个 profile**，共享同一套配方；多开差异只在运行时实例层面，不进配方。

### 0.2 关键事实（来自代码，不是假设）

- 现工作台画布写死 `W=2772,H=1280`（`workbench/app.js:4`），所有标注坐标按此逻辑坐标存储；导入异比例图片时 `ctx.drawImage(image,0,0,2772,1280)` 直接拉伸（`app.js:34`）。这是模拟器端标注会变形的根因，必须在数据模型里正面解决（见第 2 节）。
- 现引擎 `vision._normalize()`（`src/vision.js:120`）已经把真机 MediaProjection 的竖屏 letterbox 帧还原成 2772×1280 游戏坐标；真机端所有 ROI/模板都建立在这个还原后的坐标系上。这条真机链路**不动**。
- 模拟器端横屏帧已是 960×540、无黑边（群内实测），**不需要也不应该**再做 letterbox 还原；它的原生坐标系就是 960×540。
- 工作台现有识别物四类：`point / roi / template / text`；步骤六类：`tap / waitImage / waitText / waitMs / swipe / snapshot`（`app.js:47`）。新模型在此基础上扩展，不推翻。
- 现引擎模板从脚本目录 `res/img/<name>.png` 读取并缓存（`vision.loadTpl`，`vision.js:291`），模板文件名硬编码在各任务常量里（如 `mail.ENTRY="daily_task/youjian.png"`）。

### 0.3 【推荐】数据模型：一个逻辑场景 + 按 profile 分组的绑定层

在两个候选里——(A) 同一逻辑场景挂两套按 device profile 分组的标注；(B) 两个完全独立的场景——**推荐 A**。

理由：
- 流程说明（大白话意图）、分支条件语义、步骤骨架、安全/消费声明是**端无关**的，复制成两个独立场景后，改一处流程要同步两处，必然漂移（这正是现引擎五个任务各自硬编码、无法统一维护的同类问题）。
- 真正端相关的只有三类东西：**坐标/ROI 数值、模板图像素材、阈值（可随端微调）**。把这三类隔离进 profile 绑定层，端无关部分单点维护。
- B 方案只在"两端流程本质不同"时才划算；本项目同一玩法两端 UI 布局一致、仅分辨率/比例不同，A 的内聚度更高，也满足"标注按 profile 分组、禁止跨端复用坐标"的硬约束。

#### 0.3.1 顶层结构（工作台工程级，导出/落盘的单位）

```jsonc
{
  "schema": "sgs-workbench/recipe-package",
  "schemaVersion": 1,              // 包格式版本，引擎据此做兼容/拒绝
  "exportedAt": "2026-11-27T22:00:00+08:00",
  "profiles": [
    { "id": "device-real-2772x1280", "label": "真机 2772×1280",
      "frame": { "width": 2772, "height": 1280 }, "ratio": 2.1656 },
    { "id": "emu-ld-960x540", "label": "雷电模拟器 960×540",
      "frame": { "width": 960, "height": 540 }, "ratio": 1.7778 }
  ],
  "scenes": [ /* 每个逻辑场景一个，见 0.3.2 */ ]
}
```

`profile.id` 是稳定机器标识；`frame.width/height` 是该端**游戏帧原生尺寸**，引擎运行时拿实际帧尺寸与之比对（见第 2 节）。**多开模拟器共用 `emu-ld-960x540` 一个 id**——profile 由帧几何决定，不由设备序列号决定。

#### 0.3.2 场景结构（端无关外壳 + per-profile 绑定）

```jsonc
{
  "id": "mail",                       // 逻辑场景稳定 id（端无关）
  "name": "邮件全部领取",
  "section": "daily",                // daily / dunhuang / event
  "schedule": "daily",               // daily=每天一次 / repeat=可重复
  "order": 10,
  "entry": { "from": "home", "desc": "主城起始" },
  "onFail": "abort",                 // abort / skipAndLog
  "description": "在主城打开邮件，点全部领取，核对奖励或空状态后关闭回城。", // 大白话
  "consumes": {                      // 第 5 节安全模型消费声明（端无关）
    "stamina": false, "energy": false, "sycee": false, "fodder": false,
    "jadeOrPay": false
  },
  "profiles": {
    "device-real-2772x1280": { "status": "bound", "compiledSteps": "steps-real.json#..." },
    "emu-ld-960x540":        { "status": "draft" }   // bound / draft / missing
  },
  "frames": [ /* 截帧按 profile 分组，见 0.3.3 */ ],
  "elements": [ /* 识别物逻辑定义（端无关），坐标/素材进 binding，见 0.3.4 */ ],
  "steps": [ /* 端无关步骤骨架（DSL 编译产物），引用 element 逻辑 id，不写裸坐标 */ ],
  "branches": [ { "id": "b1", "name": "无可领取", "conditionElementId": "el_empty", "steps": [] } ]
}
```

要点：
- `steps` 里**禁止出现裸数字坐标**，只能引用 `elements[].id`；端差异被完全吸收到 binding。这样同一份 steps 骨架两端复用，又不违反"禁止跨端复用坐标"。
- `profiles.<id>.status` 让工作台和引擎都能一眼看出某端是否已完成标注/编译：`missing`（没标）→ 引擎拒绝在该端执行；`draft`（标了未编译/未验证）→ 默认不执行；`bound`（已编译通过）→ 可执行。

#### 0.3.3 截帧分组

```jsonc
"frames": [
  { "id": "f_real_1", "profile": "device-real-2772x1280", "order": 10,
    "name": "主城-邮件入口", "note": "", "width": 2772, "height": 1280,
    "dataUrl": "data:image/png;base64,..." },
  { "id": "f_emu_1",  "profile": "emu-ld-960x540", "order": 10,
    "name": "主城-邮件入口", "note": "", "width": 960, "height": 540,
    "dataUrl": "data:image/png;base64,..." }
]
```

帧自带 `profile` 与原生 `width/height`。工作台导入图片时按当前激活 profile 归档，并校验图片实际宽高比是否与该 profile 相符（不符则警告，见第 2 节）。

#### 0.3.4 识别物：逻辑定义 + per-profile 绑定

```jsonc
"elements": [
  {
    "id": "el_mail_entry",            // 端无关逻辑 id（替代现 ref 的随机 id，语义化）
    "label": "邮件入口",
    "kind": "template",               // point / roi / template / text
    "frameGroup": "主城-邮件入口",     // 两端对应帧的人类对应关系（同名分组）
    "text": "",                       // kind=text 时的期望文字（端无关）
    "bindings": {
      "device-real-2772x1280": {
        "frameId": "f_real_1",
        "rect": [60, 150, 520, 400],          // 真机原生坐标
        "template": { "asset": "daily_task/youjian.png", "threshold": 0.8,
                      "source": "res-img-import", "sha256": "..." }
      },
      "emu-ld-960x540": {
        "frameId": "f_emu_1",
        "rect": [21, 63, 180, 169],           // 模拟器原生坐标，独立标注，非缩放得来
        "template": { "asset": "emu/daily_task/youjian.png", "threshold": 0.82,
                      "source": "crop-from-frame", "sha256": "..." }
      }
    }
  }
]
```

- `point` 类型 binding 存 `{x,y}`；`roi/template` 存 `rect:[x1,y1,x2,y2]`；`text` 存 `rect + text`。
- 模板 `asset` 路径**按 profile 分目录**（真机沿用 `res/img/...`，模拟器新增 `res-emu/img/...` 或包内 `assets/<profile>/...`，见第 1 节【待拍板 D3】），从物理上杜绝跨端拿错模板。
- `threshold` 放进 binding，允许同识别物两端阈值不同（模拟器渲染/缩放可能需要单独调阈值，参考现网 0.72~0.9 的实测区间，见 `config.js:48`、`mail.js:20`）。
- `sha256` 用于落盘后校验素材未损坏/未被替换。

#### 0.3.5 引用完整性校验（工作台 + 引擎双侧）

- 每个 element 的每个 `bound` profile 都必须有 binding；缺 binding 的 profile 上，该 element 解析失败。
- steps/branches 引用的 `elementId` 必须存在；`kind` 必须与步骤用法匹配（点击只能引用 point/template，等待文字只能引用 text）。
- binding 内所有坐标必须落在该 profile 的 `frame.width/height` 内，越界即校验失败（替代现 `app.js:36` 的 `num()` 夹取，改成**报错**而非静默夹取）。
- 模板 asset 的 sha256 必须能在包内找到对应文件。
- 任一条不过：工作台禁止导出 `bound` 包；引擎加载直接拒绝并报具体缺失项（fail-closed）。

### 0.4 工作台如何切换/标识当前编辑端（防误用）

- 顶部新增**当前编辑端切换器**（真机 2772×1280 / 模拟器 960×540），强视觉标识：不同端用不同主题色 + 常驻徽标（如"模拟器端 960×540"），避免在错误端标了坐标却以为是另一端。
- 画布尺寸、坐标读数、导入帧、标注一律跟随当前激活端；切换端时只显示该端 binding，端无关字段（名称、流程说明、消费声明）以共享态展示并标注"两端共用"。
- 在 A 端选中某识别物时，提供"在 B 端定位对应帧"的跳转（靠 `frameGroup` 同名），但**只跳转、不复制坐标**；B 端必须重新取点/框选。
- 导出包内嵌每个 profile 的完整度报告（`bound/draft/missing` 计数），引擎只执行 `bound` 的端。

### 0.5 真机现有资产如何纳入新模型不丢失

- **代码与模板零改动保留**：`src/` 与 `res/img/` 维持现状，现引擎照常 `node tools/build.js` 出 `build/bundle.js` 部署真机。
- 真机模板资产通过一条**一次性只读导入映射**进配方：把 `src/tasks/*.js` 里的常量（ENTRY/REGION/THRESHOLD 等）和 `res/img/` 文件，半自动生成 `device-real-2772x1280` profile 的 binding 草稿（工具只读 `src/`，不回写）。
  - 映射对照（以 mail 为例）：`ENTRY + ENTRY_REGION` → template 元素 binding；`CLAIM_REGION` 等 → 对应元素；`EMPTY_PATTERNS` → text 元素的期望文字（正则需在 DSL 里表达，见 3.4）。
  - 导入产物状态默认 `draft`，需人工在工作台核对后才置 `bound`；这一步不要求真机重新采帧，但建议后续用真机截帧补 `frames`。
- 现引擎的硬编码 ROI 因此成为新模型真机端 binding 的**数据来源而非运行依赖**：即使将来配方引擎成熟，现引擎仍可独立运行，互不删除。

### 0.6 两套执行端并存与回退

- 两套引擎在 AutoJs6 端以**不同入口脚本/不同 bundle** 并存：现引擎 bundle（`_main.js` 现状）与配方引擎 bundle（新文件名，如 `_recipe_main.js`），通过现有 `autotask.txt` 任务令牌区分投递（见 5.4）。
- 回退路径：配方引擎任何阶段出问题，把投递令牌切回现引擎任务名即可，无需卸载/覆盖；两套 bundle 可同时驻留设备。
- 真机端在配方引擎未达 `bound+验证通过` 前，**始终走现引擎**；配方引擎先在模拟器端跑通，再反向接真机 profile。

---

## 第 1 节 数据通路：工作台 → 落盘 → AutoJs6 加载

### 1.1 现状与差距

- 现工作台数据只在浏览器 localStorage（key `auto-sgs-workbench-v3`，`app.js:4`），"导出 JSON"仅导出**当前单个场景**（`app.js:86`），图片以 data URL 内嵌；换机要逐场景导出，不随 git 同步。
- 没有任何真机/模拟器对接、没有模板裁剪落盘、没有版本化包格式。

### 1.2 【推荐】导出物：版本化配方包（recipe-package）

工作台"导出"产出一个**工程级包**（区别于现在的单场景 JSON），两种载体：

- **单文件 JSON 包**：模板素材仍以 data URL 内嵌（与现状一致，便于双击工作台之间传），适合小批量/试点。
- **目录包（推荐用于真机部署）**：`recipe.json`（不含图片 base64，只引用相对路径）+ `assets/<profile>/...` 模板文件，避免单文件过大、便于 sha256 校验和多开共享。

目录包布局（设备侧）：

```
/sdcard/Download/autosgs-logs/recipes/
  ├── manifest.json                 # 包清单：schemaVersion、profiles、场景列表、各文件 sha256
  ├── recipe.json                   # 场景/元素/步骤（引用 asset 相对路径，不含 base64）
  └── assets/
      ├── device-real-2772x1280/daily_task/youjian.png
      └── emu-ld-960x540/daily_task/youjian.png
```

沿用现有 autosgs-logs 根目录，符合 `AGENTS.md` 的目录约束与 `.nomedia` 隐藏要求。

> **精确契约（冻结）**：manifest.json 完整字段、`files:[{path,sha256,bytes}]` 哈希清单形态、路径白名单、manifest 自校验方式、与 recipe.json 的交叉校验，统一以 [`docs/RECIPE-PACKAGE-CONTRACT.md`](RECIPE-PACKAGE-CONTRACT.md) 第 2 节为单一事实源；本节与 1.4 的加载校验是其概述，字段以契约为准，不另立格式。

### 1.3 落盘方式（保持工作台零网络/双击可开）

- 工作台本身**不加网络、不加 ADB 能力**（守住 V6 约束：纯 HTML/原生 JS、双击 index.html 可开）。它只负责导出文件到电脑下载目录。
- 新增一个**独立 Node CLI 部署工具**（放 `tools/`，与 `tools/build.js` 同风格，不进工作台页面）：
  - `node tools/recipe-deploy.js --serial emulator-5554 --pkg ./recipe-pkg` 负责 push 到 1.2 的设备目录、写 `.nomedia`、回读校验 sha256。
  - 部署工具只写 `autosgs-logs/recipes/` 固定目录，路径做 canonical 校验（复用 `task-status.js:29`/`debugshots.js:13` 的 `getCanonicalPath` 防护思路），禁止任意路径写入。

### 1.4 AutoJs6 加载与导入校验（fail-closed）

配方引擎启动时：

1. 读 `manifest.json` → 校验 `schema` 标识与 `schemaVersion`。
   - 支持 N 与 N-1：N-1 走内置升级函数（参考现 `upgradeScene`，`app.js:12` 的迁移模式）；高于引擎支持版本 → **拒绝加载并报错**，不尝试猜测。
2. 校验 `profiles` 含当前运行端 id；当前端几何（实际帧宽高）必须与 profile.frame 一致（容差见第 2 节），否则拒绝执行。
3. 逐文件算 sha256 对 manifest；任一不符 → 拒绝整个包（不执行任何场景），报错列出损坏文件。
4. 跑 0.3.5 全部引用完整性校验；当前端有任何 `missing/draft` 绑定的被请求场景 → 拒绝该场景。
5. 校验通过后加载到内存只读结构；运行期不再改配方，结果/状态另写文件。

### 1.5 多开共享方式

- 配方包是**静态只读资源**，多开模拟器实例共享同一份 `recipes/`（同 profile id、同帧几何）。push 一次，所有实例读同一目录。
- 运行时**状态隔离**：任务状态、结果、调试图按实例加后缀分文件，避免多开互踩。复用 `task-status.js` 的文件锁（ReentrantLock）思路，文件名带实例标识：
  - 状态：`task-status-<instanceId>.json`；结果：`daily-last-result-<instanceId>.json`；截图目录分子目录 `screenshots/<instanceId>/`（仍受 debugshots 的命名白名单与轮转约束）。
- **【待拍板 D3 子项】** 多开实例 id 的来源：建议由部署/启动时写入一个 `instance.txt`（AutoJs6 读取），而不是在配方里固化。

---

## 第 2 节 坐标系决策

### 2.1 两个候选

- 候选一：识别物**按帧原生尺寸标注**，引擎不做统一线性变换，运行时直接用该 profile 的原生坐标。
- 候选二：引擎在运行时做一次**统一线性变换**，把所有端归一到一个标准画布（如 2772×1280），配方只存标准坐标。

### 2.2 【推荐】候选一：原生尺寸标注、零运行时变换

理由：

1. **两端比例不同（2.1656 vs 1.7778），不存在无变形的统一线性变换**。把 960×540 拉到 2772×1280 在 X、Y 方向缩放系数不同（约 2.8875 vs 2.3704），任何"归一到标准画布"都是非线性拉伸，等同于重蹈现工作台 `drawImage` 拉伸的覆辙，只是从标注期挪到运行期，更难排查。
2. 用户已**明确否决 vision 层缩放/模板映射兼容方案**（群内结论），要求按工作台配方模式重实现、不维护固定坐标硬编码适配。候选二本质仍是 vision 层映射，违背该决策。
3. 模拟器帧 960×540 本身就是干净的原生游戏帧（无黑边、无需 `_normalize`），直接用原生坐标链路最短、最少隐式行为，符合 fail-closed 可审计要求。
4. 真机端现状已经是"还原到 2772×1280 原生游戏坐标"，候选一对真机端零改动、零回归风险。

**这不是逐模板手工映射**：逐模板手工映射指"拿真机坐标逐个乘系数推算模拟器坐标"；本方案是模拟器端**对着模拟器截帧重新取点/框选**，每个坐标都来自该端真实画面，两端 binding 物理隔离、互不推算。

### 2.3 正面回答工作台"固定 2772 逻辑坐标 + 异比例拉伸"矛盾

- 根因：`app.js` 用全局常量 `W=2772,H=1280` 作为唯一画布逻辑尺寸，且 `drawImage` 强制铺满，导致 960×540 帧被拉伸标注。
- 改法（工作台最小改动，详见第 7 节）：
  1. 画布逻辑尺寸**改为跟随当前激活 profile 的 frame 尺寸**（`canvas.width/height` 与坐标换算 `xy()`、`draw()` 都用 `profile.frame.width/height` 取代写死的 W/H）。
  2. 图片按**原生宽高比 1:1 适配显示**（contain，留白边），不再 `drawImage` 铺满；标注坐标 = 图片原生像素坐标，所见即所得。
  3. 导入帧时记录真实 `width/height`，与 profile.frame 比对：一致→直接用；比例不符→弹确认（阻止把竖屏图误导进横屏 profile）。
- 真机 profile 下画布仍是 2772×1280，旧数据（v3）迁移到真机 profile 时坐标语义不变，保证老资产不失效。

### 2.4 运行时几何保护（引擎侧）

- 引擎每帧拿到 `captureScreen` 后先读 `getWidth/getHeight`，与当前 profile.frame 比对：
  - 真机：保留现 `vision._normalize` 链路，输出 2772×1280 后再比对。
  - 模拟器：要求横屏且尺寸等于 960×540（方向/尺寸不符直接停止，不做猜测式旋转或缩放）。
- 容差策略：尺寸必须**精确相等**（同一 profile 锁定分辨率，用户已决定模拟器锁 540×960 不调高）；不一致即 fail-closed 报错并存调试图，不做任何自动缩放。
- 若用户日后改模拟器分辨率，**新建一个 profile**（如 `emu-ld-1280x720`）重新标注，不复用旧 binding——从机制上杜绝跨分辨率误用。

---

## 第 3 节 执行模型：大白话说明 → 可执行步骤

### 3.1 三个候选

- a) 工作台补**最小步骤 DSL**：用户/工具把流程显式编成确定性步骤（现有 steps 六类型扩展而来），引擎只做确定性解释，不含自然语言理解。
- b) 引擎按**约定句式**解释大白话：在 AutoJs6 端解析中文说明，靠句式/关键词映射成动作。
- c) 先 a 后 AI：先用确定性 DSL 跑通，AI 作为工作台侧可选的"说明+标注 → DSL"编译助手，生成物必须过同一套校验和人工确认。

### 3.2 【推荐】c，但明确 AI 只在工作台侧、且全程可被确定性产物替代

结合 V6 的 A 方案（`WORKBENCH-DESIGN-V6.md:29`：steps 数据保留、从用户日常界面退场，未来由 AI/引擎按说明+标注生成）：

- **运行时引擎只执行确定性 DSL，不做 NLP**。理由：
  - AutoJs6/Rhino 端做中文句式解释是非确定性的，无法写桩测试、无法保证 fail-closed，违背"识别不到即停、禁止兜底点击"的安全红线。
  - b 方案把歧义带到设备上，一次句式更新可能改变点击行为，无法审计；现引擎五个任务之所以稳，正因为每个动作都是显式识别+显式坐标。
- **智能性放在工作台离线侧**：AI（或人工）把 `description` + `elements` 编译成 DSL，编译结果落盘、可 diff、可评审、可桩测。引擎永远只认编译后的 DSL。
- a 是 c 的子集和必经阶段：第一期完全人工/半自动编 DSL 即可端到端跑通，不依赖 AI；AI 编译是后续提效期权，且其产物与人工产物走**同一个校验闸门**，不享有特权。

### 3.3 迁移路径（与 V6 A 方案衔接）

1. 工作台保留 steps 数据结构与"高级：手动编辑步骤"折叠区（V6 现状不动），把 steps 升级为下面的 DSL v1。
2. 流程说明 `description` 仍是用户主维护区；DSL 由"生成步骤"按钮（首期可由人工在高级区编辑/半自动导入）产出，工作台做引用完整性与安全校验。
3. AI 编译助手作为后续独立迭代：读 description + 元素库 → 生成 DSL 草稿 → 强制人工确认 + 校验通过才能置 `bound`。未确认前一律 `draft`，引擎不执行。
4. 引擎端只实现 DSL 解释器，确定性、可桩测，永不内嵌语言模型。

### 3.4 DSL v1（在现六类型上扩展，保持端无关、只引用元素 id）

| 步骤类型 | 关键字段 | 语义与失败处理 |
|---|---|---|
| `tap` | `target:{elementId}`（point/template）、`guard:{elementId}` 可选 | 先识别 target，命中点其中心（template 用匹配中心，point 用坐标）；识别不到即失败。**裸 point 点击必须配 guard 断言**（见 4.1），否则校验期拒绝 |
| `waitImage` | `elementId`(template)、`timeoutMs`、`threshold?` | 轮询到模板命中即继续；超时失败 |
| `waitText` | `elementId`(text)、`timeoutMs`、`match:"contains"\|"regex"\|"equals"` | 支持现网正则场景（如 mail 的 `EMPTY_PATTERNS`、zhuxian 的 `次数 N/5`）；超时失败 |
| `waitMs` | `ms` | 纯等待，唯一不需要识别的步骤；不允许用于"代替识别" |
| `swipe` | `from:{elementId|point}`、`to:{...}`、`durationMs` | 滑动；端点优先引用元素，禁止无识别的消费型滑动 |
| `snapshot` | `tag` | 存调试图（走 debugshots），纯证据步骤 |
| `assert`（新增） | `elementId`、`expect:"present"\|"absent"`、`timeoutMs?` | 显式断言，用于"点击后确认弹窗开/关"，把现引擎散落在代码里的判定显式化（如 mail 关窗后确认 CLAIM 消失） |
| `branch`（新增） | `conditionElementId`、`then:步骤[]`、`else:步骤[]?` | 替代现 branches 的弱结构，条件只允许引用已定义元素，确定性选择 |
| `loop`（新增，谨慎） | `maxRounds`、`until:{assert}`、`body:步骤[]` | 表达现 mail 的"最多 2 轮领取"、重试 3 次开面板；**强制上限**，杜绝死循环 |
| `readOcr`（新增） | `elementId`(roi/text)、`parser`、`saveAs` | 对应 playerinfo 的 OCR 取值/投票，parser 复用现 `_parse` 规则（见 4.2） |

每个步骤公共字段：`id`、`note`（这一步在干嘛）、`optional`（true 时失败只告警不中断，默认 false）、`onFail`（继承场景或单步覆盖：abort/skipAndLog）、`stopCheck:"before"`（默认每个消费动作前查停止令牌，见 5.4）。

### 3.5 现任务到 DSL 的可表达性核对（证明 DSL 够用，不悬空）

- **mail**：`loop(3)` 内 tap(入口模板)+assert(close 出现) → tap(全部领取) → `loop(2)` 内 tap+waitText(奖励/绿勾/空，branch 三选一) → tap(空白关闭) → assert(领取按钮消失) → assert(主城锚点)。现 `_waitClaimEvidence` 的多证据轮询用 `loop+branch+assert` 表达。
- **playerinfo**：3 次 `readOcr`（不同 frame）+ 投票（投票作为 `readOcr` 的内置 reducer，配置 `samples:3, pick:"vote"`），parser 映射现有 level/power/fraction/text。
- **zhuxian**：tap(征战)→assert(地图 Tab)→tap(建筑)→assert(排行榜)→tap(BOSS)→assert(次数面板)→readOcr(次数)→branch(次数=0 且 allowReset：tap 重置→assert(重置弹窗)→tap 确认)→assert(扫荡关键词)→tap(扫荡)→waitText(战报/体力不足 branch)→关窗×2→loop(3) 返回+assert(isHome)。
- 结论：五个现任务的控制流（重试 loop、多证据 branch、超时等待、失败即抛）都能由 DSL v1 确定性表达，不需要设备端智能。

---

## 第 4 节 四类识别物执行语义与失败处理（统一 fail-closed）

**总原则（落实 AGENTS.md 与群内红线）**：任何需要识别的步骤，识别不到即判定失败 → 按 `onFail` 停止或跳过并**存调试图**；严禁"识别不到就按固定坐标盲点"，严禁无识别兜底的消费点击。每个失败点调 `debugShots.save(frame, tag)`，tag 带场景+步骤+原因。

### 4.1 取点点击（point / tap）

- `point` 绑定存原生 `{x,y}`，但**纯固定坐标点击默认禁止**：`tap` 步骤若 target 是 point，必须在同一步带 `guard`（一个 template/text 断言），引擎先验证 guard 命中才允许点该坐标。
  - 依据：现网所有固定坐标点击都有同屏识别前提（如 zhuxian 点 BOSS 本体前先 `_waitPanel`、junqing 点 CLOSE_X 前面板已确认）。把这个隐式前提提升为显式 guard，校验期就能拦住无前提盲点。
  - 特例：纯 UI 关闭类（如蓝 X、返回箭头）允许 point+guard(面板存在)，guard 仍强制。
- 点击复用现 `vision.tap` 的 4px 随机抖动（`vision.js:394`），避免坐标过于机械。
- 坐标越出 profile 帧范围：加载期校验失败，不进入执行。
- 点击后默认要求一个后续 `assert` 验证帧变化/页面切换（参考 HANDOFF 的"点击四步走：检测定位→裁剪确认→tap→帧差验证"）；DSL 校验对消费型 tap 强制要求配对 assert。

### 4.2 区域 OCR 等待/断言（roi / text / readOcr）

- `roi`/`text` 绑定存原生 `rect`，引擎 `images.clip` 裁剪后送 OCR（复用 `vision.ocrRect`，`vision.js:262`，已处理 AutoJs6 `ocr()` 数组与 gmlkit 差异）。
- 等待：`waitText` 在 timeout 内轮询（默认 600ms 节拍，对齐现 `waitText`），命中即继续，超时失败。
- 断言：`assert present/absent`，用于页面/弹窗状态判定。
- 取值：`readOcr` + parser。parser 规则直接复用 playerinfo 已验证的 `_parse`（`playerinfo.js:117`）：
  - `text`（昵称）、`level`（吃前导位/后缀纠正）、`power`（万亿单位、压重复"万"）、`fraction`（`current/max`）、`int`。
  - 多帧投票作为内置 reducer（`samples + pick:"vote"`，对齐 `_pick`，`playerinfo.js:75`），level 平票取长位等规则随 parser 一起迁移。
- 空白/换行归一化沿用 `replace(/\s+/g,"")` 后再匹配的现网做法。
- **【风险/未验证 R1】** 模拟器 x86 + AutoJs6 v6.8.0 的 OCR 可用性（gmlkit 依赖谷歌服务，模拟器可能没有；AutoJs6 内置 `ocr()` 是否可用、识别率与真机差异）尚未在雷电上验证。试点前必须先做只读 OCR 探针（第 6 节 P2），探针不过则模拟器端文字类任务暂停，不允许用猜的。

### 4.3 参考图模板匹配（template）

- **阈值**：存 binding，默认 0.8（对齐 `sgs.THRESHOLD.image`），弱判据可降到 0.72~0.75（如主城锚点 0.72、小乔头像 0.75，均有现网实测依据），但低于 0.7 需在配方里写理由并人工复核；校验期对异常低阈值告警。
- **裁剪来源**：模拟器端模板**只从同 profile 的截帧裁剪**（工作台后续做真实裁剪功能，替代现占位的 `filename` 字段，`app.js:39`）。裁剪时记录来源帧 id 与 rect，保证模板和运行画面同渲染管线、同分辨率。
- **data URL 素材落盘**：工作台导出时，模板 data URL 解码为 png 写到 `assets/<profile>/...`，计算 sha256 入 manifest；引擎按 `vision.loadTpl` 同思路从包目录读取并缓存（缓存键带 profile，防多端串模板）。
- **搜索区域**：模板必须绑定 `rect` 作为受限搜索区（ROI 内 findImage），**禁止全屏兜底匹配**——现网明确记录全屏会误匹配圆头像/同类图标导致乱点（`xiaoqiao.js:12`、`junqing.js:14`）。确需多区域的，用 `regions:[rect1,rect2]` 显式列举（如小乔左右侧带），不允许"全屏"。
- 匹配返回模板**中心**坐标（沿用 `vision.find` 的中心修正，`vision.js:348`，避免点左上角偏半个模板）。
- 命中失败：`waitImage` 超时 / `tap` 找不到 target → fail-closed，存调试图（含当时帧 + 目标模板 + 搜索 rect），不降级为坐标点击。

### 4.4 文字识别（text 元素）

- 工作台 text 元素已具备 `rect + text`（`app.js:82`），DSL 里通过 `match` 区分 contains/regex/equals，覆盖现网正则需求（空邮件 `EMPTY_PATTERNS`、次数 `\d+/5`、战报关键词组）。
- 一个 text 元素可带多个候选关键词（`anyOf:[...]`），对应现网 `RESULT_TITLES`、`REPORT_KEYWORDS` 这种多词判据，任一命中即成立。
- OCR 引擎适配（gmlkit / AutoJs6 ocr）仍由复用的 vision 层承担，配方只声明期望文字与区域，不绑定具体 OCR 实现。

### 4.5 统一失败收敛

- 引擎解释器捕获步骤失败：写结构化日志（场景/步骤/元素 id/阈值/rect/原因）→ `debugShots.save` 存证 → 按 `onFail`：
  - `abort`（默认，消费型任务强制）：抛错终止本场景，触发 daily 级互斥（5.3），不继续后续任务。
  - `skipAndLog`（仅限声明的只读/幂等场景）：标记 skipped 继续，但**不允许用于消费型步骤**。
- `optional:true` 步骤失败只告警；但消费动作（consumes 任一为 true 的场景里的 tap）不允许标 optional 跳过安全断言。
- 所有失败都留证据，杜绝现引擎曾经出现的"静默走完给假成功结论"问题（mail 注释里的反面案例，`mail.js:95`）。

---

## 第 5 节 安全模型

### 5.1 【红线】玉璧/充值：硬停止 + 上报，双保险

落实 AGENTS.md"严禁玉璧消费、充值、付费购买，遇弹窗一律不点、留截图、群里上报"。两道独立保险：

1. **声明层硬门禁**：场景 `consumes.jadeOrPay` 字段**不允许被置 true**（schema 校验直接拒绝）；任何配方都无法声明花钱操作，从数据结构上堵死。
2. **运行时哨兵**：引擎在每个动作前（或在 `frame` 取帧后）跑一组**付费弹窗识别哨兵**，匹配充值/玉璧/付费购买相关文字与模板（复用现 `res/img/daily_task/chongzhi.png`、`chongzhitishitxt.png` 等已有素材做真机端哨兵，模拟器端另行采图）：
   - 命中 → 立即硬停止整个运行（不是跳过单步）、存证、写 task-status 为 failed 并标记 `payBlocked:true`、通过现有日志/结果通道上报。
   - 哨兵独立于业务 DSL，即使 DSL 写错也不会点到付费弹窗。
- **【待拍板 D6】** 哨兵关键词/模板清单的维护责任与初始清单，建议首期由游戏调研基于现有 `chongzhi*` 素材和只读探针整理，用户确认后入配方库。

### 5.2 体力/精力/元宝/粮草：配方显式声明

- 每个场景在 `consumes` 显式声明 `stamina/energy/sycee/fodder`（布尔 + 可选 `note`，如 zhuxian 重置"20 元宝/次，最多 4 次"）。
- 工作台对 `sycee=true` 的场景给显著标识与二次确认；导出包的 manifest 汇总所有消费声明，部署/执行前可见。
- 引擎执行消费型动作前强制 `stopCheck` 与 guard；zhuxian 的 `allowReset` 这类元宝开关迁移为配方参数（默认保守值，沿用现 daily 里 `allowReset:false` 的日常默认，`daily.js:180`），需显式打开才允许元宝重置。
- 与 AGENTS.md 授权一致：这些资源可消耗、耗尽由用户补充，无需逐次请示；但**声明必须显式，不能隐式消费**（现 daily 的 validatePlan 已保证"新增任务默认不选、不自动增加消费"，`daily.js:36`，这套保守默认迁移到配方）。

### 5.3 主城复检、任务互斥

- **主城复检**：复用 `daily-recovery` 的 `ensureHome/strictHome` 思路（`daily-recovery.js:98`）——每个场景开始前与结束后都做正向主城确认（横屏 + 主城锚点 + 体力/精力分数可读 + 无阻塞弹窗，连续 2 帧确认）。配方引擎把"回城 assert"作为场景模板的固定首尾步骤，无法被配方省略。
- **任务互斥**：沿用现 daily 的硬规则——消费型长流程（xiaoqiao/zhuxian 对应物）一旦 failed/unconfirmed，停止后续所有任务，避免交叉执行（`daily.js:224`）。配方引擎的编排层保留这条：场景声明 `exclusive:true` 且结果未确认时，编排终止并置 aborted。
- 恢复器对未知页面"无法确认就停、不盲点"的原则（`daily-recovery.js:199`）原样保留；登录/重登/公告页一律要求人工，不自动点。

### 5.4 停止令牌如何保留

- 复用现有两套机制：
  - `task-status` 的 stopping 状态机（`task-status.js`，begin/step/stopping/finish + ReentrantLock + 中断残留转 unconfirmed）。
  - daily 的 `checkCancelled`（线程中断 + `isCancelled` 回调，`daily.js:75`），在每个步骤边界、尤其消费动作前调用。
- 配方引擎解释器在每个 DSL 步骤入口查停止令牌；收到停止 → 不点当前动作、置 stopping、收尾存证、状态转 stopped/cancelled。
- 多开下状态文件按实例隔离（1.5），停止令牌也按实例 id 投递，互不干扰。

### 5.5 前台与外部 App 防护

- 复用 `daily-recovery.externalApp()`（`daily-recovery.js:91`）：`currentPackage() !== 游戏包名` 时拒绝任何点击，防止把相册里的游戏截图当成可操作画面。
- 遵守群内约束：**引擎不主动拉起游戏**（不 adb/am start `com.sanguosha.mjz.mi`），由用户手动进到主城；引擎启动先做 isHome 校验，不在主城则退出并提示，不自行导航。

---

## 第 6 节 试点与分期（低风险先行，每阶段可回退）

### 6.1 试点选择：先 playerinfo，再 mail

- **第一试点 playerinfo（玩家信息读取）**：纯只读、零点击、零消费，风险最低；却能一次性验证最关键的模拟器能力——取帧尺寸、OCR 可用性、ROI 裁剪、parser/投票、调试图、数据落盘。
- **第二试点 mail（邮件全部领取）**：有点击但**不耗元宝/体力**（`daily.js:7` 已注明），覆盖模板匹配、tap、多证据 branch、assert、回城，是验证完整动作闭环的最低风险入口。
- 其后按风险递增：junqing（耗体力）→ zhuxian（含元宝重置）→ xiaoqiao（长流程轮询、含元宝买丹，最复杂，最后接）。

### 6.2 阶段划分、交付物与判据

| 阶段 | 内容 | 交付物 | 完成判据（桩测试 + 模拟器只读探针） | 回退路径 |
|---|---|---|---|---|
| **P0 spec 定稿** | 本 spec 评审、待拍板项闭环 | 本文档 + 决策记录 | 用户确认 0~7 节推荐与 D1~D7 | 仅文档，无代码风险 |
| **P1 工作台双端化** | profile 切换器、画布按端原生尺寸/contain 不拉伸、binding 数据模型、v3→新包迁移、导出包+sha256 | workbench 改动（不碰 src/）、check 脚本扩展 | `node workbench/check-v3.js` 全过 + 新增双端校验用例通过；模拟 DOM 验证坐标按 960×540 存储无拉伸 | 工作台保留旧入口，localStorage v3 不删，可回退旧版页面 |
| **P2 模拟器只读探针** | 不点击，只验证取帧 960×540、OCR、模板匹配分数、目录读写 | 探针脚本 + 探针报告（docs/PROBE-*） | 实际帧=960×540；OCR 能读出主城文字（R1 闭环）；模板在 ROI 内可命中且分数合理；recipes 目录读写/sha256 正常 | 纯只读，零副作用，失败即停不影响游戏 |
| **P3 DSL 编译器 + 校验** | 工作台 steps→DSL v1、引用完整性/安全/消费声明校验、bound/draft 状态闸门 | DSL schema、校验器、check 用例 | 桩数据上五个现任务 DSL 均可通过校验；故意制造的跨端坐标/缺失绑定/付费声明全部被拒 | 校验器独立，不通过则不产 bound 包，现引擎不受影响 |
| **P4 引擎解释器（主机桩）** | 在 Node 主机用 mock vision 跑 DSL 解释器，喂截帧图，验证步骤编排/branch/loop/失败收敛，不连设备 | 引擎核心 + mock + 单测 | `tests/` 新增回归：成功路径、识别失败即停并产调试图指令、停止令牌、付费哨兵硬停、loop 上限 | 主机测试不触设备，随时废弃重写 |
| **P5 playerinfo 端到端（模拟器）** | 部署配方包，AutoJs6 实跑只读任务 | 可运行 bundle + 真机/模拟器证据 | 7 字段读取成功（或明确 OCR 缺陷清单）；状态/结果/截图按实例落盘；无任何点击 | 切回不装配方引擎即恢复现状 |
| **P6 mail 端到端（模拟器）** | 第一个带点击的低风险任务闭环 | bundle + 证据 | 模板命中→点击→多证据判定→关窗→主城 assert 全通过；失败注入（遮模板）验证 fail-closed 停且存证 | 停用 mail 配方，该端不跑此场景 |
| **P7+** | junqing/zhuxian/xiaoqiao 按风险递进，再接真机 profile | 各场景配方 + 验证报告 | 每场景独立验收，消费型逐场景用户授权 | 每场景独立开关，回退不影响其他 |

- 每个 P 阶段都遵守 AGENTS.md 构建约定：改了源/运行器才 `node tools/build.js` + `node --check build/bundle.js`，提交前 `node tests/regression.js`。
- **【风险/未验证 R2】** 模拟器封号风险用户已明确接受、无需再提示；但探针与试点仍坚持只读/低风险顺序，不为验证而盲点。
- 紧急军情全链路真机验收仍受"仅约 21:00 出现入口"约束（AGENTS.md），junqing 的真机端到端排在对应时段。

---

## 第 7 节 与现有代码关系：复用、重写、工作台最小改动

### 7.1 可直接复用（不重写，配方引擎调用或移植）

| 现有模块 | 复用内容 | 复用方式 |
|---|---|---|
| `src/vision.js` | 截图权限申请/自动授权 `_autoGrant`、帧缓存与延迟回收 `frame/_retire`、OCR 引擎适配 `_ocr/ocrRect`、模板加载缓存 `loadTpl`、ROI findImage 与中心修正 `find`、点击抖动 `tap`、wait/has 系列 | 真机端原样复用；模拟器端新建 profile 适配（去掉 letterbox `_normalize`，帧直接当原生 960×540），其余识别原语共用 |
| `src/debugshots.js` | 调试图目录防护、`.nomedia`、命名白名单、保留 20 张轮转 | 原样复用，多开按 1.5 加实例子目录 |
| `src/task-status.js` | 状态机、文件锁、原子写（tmp+rename）、中断残留转 unconfirmed | 原样复用，文件名加实例 id |
| `src/daily-recovery.js` | ensureHome/strictHome、externalApp 防护、未知页面不盲点原则 | 思路+大部分逻辑复用；具体页面判据改从配方元素读取而非任务私有常量 |
| `src/daily.js` | 编排顺序、保守默认（新任务不自动消费）、消费型失败即停的互斥、结果归并 `_result/_finish` | 编排骨架复用，任务来源从硬编码 CATALOG 改为配方场景清单 |
| `src/tasks/playerinfo.js` | `_parse` 各 parser、`_pick` 多帧投票 | 迁移为 DSL `readOcr` 的内置 parser/reducer（纯函数，易移植、易单测） |
| `tools/build.js` / `build.py` | bundle 拼装、MODS 单一来源 | 新增配方引擎独立模块清单与独立产物，不改现 bundle 的 MODS |
| `res/img/**` | 真机端全部模板 | 作为真机 profile binding 的素材来源只读导入，物理保留 |

### 7.2 需要新写/重写的部分

1. **配方加载器**：manifest/recipe 解析、schemaVersion 兼容、sha256 校验、profile 几何校验、引用完整性（1.4）。全新。
2. **DSL 解释器**：tap/waitImage/waitText/assert/branch/loop/readOcr/snapshot 的确定性执行 + 失败收敛 + 停止令牌接入（3.4、4.5）。全新，但底层调复用的 vision 原语。
3. **付费哨兵**：独立于 DSL 的运行时硬停识别（5.1）。全新。
4. **模拟器 vision 适配**：profile 化的帧处理（无 `_normalize`、原生 960×540、模板路径按 profile 分目录）。新写薄适配层，不改动真机 `vision.js`。
5. **部署 CLI** `tools/recipe-deploy.js`：push + 校验 + 多开实例 id 写入（1.3、1.5）。全新。
6. **真机资产导入工具**：只读解析 `src/tasks/*.js` 常量 + `res/img` 生成真机 binding 草稿（0.5）。全新，只读不回写 src。

### 7.3 `workbench/` 最小改动清单（守住纯 HTML/JS、零网络、不碰 src/）

按依赖顺序，每项都配 check 脚本用例：

1. **profile 数据模型**：顶层加 `profiles`；scene 加 `profiles 状态/consumes`；frame/element 加 `profile/bindings`；写 v3→新 schema 的迁移函数（老数据落到真机 profile，坐标语义不变）。
2. **画布去拉伸**：`W/H` 常量改为当前 profile.frame；`draw()` 改 contain 等比适配；`xy()` 坐标换算跟随；导入帧校验真实宽高比（2.3）。
3. **端切换器 UI**：顶部切换 + 常驻端徽标 + 按端显示 binding + 跨端定位（只跳不复制）（0.4）。
4. **模板真实裁剪与素材管理**：把现占位 `filename`（`app.js:39`）升级为从当前帧 rect 裁剪出 png/data URL，记录来源帧、sha256、按 profile 分目录（4.3）。
5. **DSL 编辑与校验**：高级区 steps 升级为 DSL v1 编辑器；加引用完整性、越界、guard 配对、消费声明、付费字段拒绝等校验；bound/draft/missing 状态闸门（3.4、0.3.5）。
6. **工程级导出**：从单场景 JSON 升级为 recipe-package（单文件/目录包两种），生成 manifest 与 sha256、profile 完整度报告（1.2）。
7. **check 脚本**：`check-v3.js` 保留并新增双端/迁移/校验/导出断言；模拟 DOM 测试不代替真人点测（沿用 README 约定）。

### 7.4 不做的事（明确边界）

- 不改 `src/` 任何现网生产逻辑、不删 `res/img/`、不动现 `build/bundle.js` 的 MODS 清单。
- 不在工作台加网络/ADB/真实 OCR 调用（保持双击离线可用）；这些能力放独立 CLI 与设备端引擎。
- 不做任何 vision 层跨端坐标缩放/模板映射（用户已否决）。
- 不引入玉璧/充值/付费路径，`jade` 维持只读采集（AGENTS.md）。

---

## 附录 A：待用户拍板决策清单（汇总）

| 编号 | 决策点 | 推荐项 | 备选 | 备注 |
|---|---|---|---|---|
| D1 | 双端数据模型 | 一个逻辑场景 + per-profile 绑定（0.3） | 两个独立场景 | 影响整个 schema，建议最先定 |
| D2 | 大白话→步骤路线 | c：先确定性 DSL，AI 仅工作台侧离线编译且过同一校验（3.2） | a 纯手工 DSL / b 设备端句式解释 | b 有安全与不可测问题，不建议 |
| D3 | 设备侧配方包布局 | 目录包 `recipes/`（manifest+recipe+assets 分文件、sha256）；多开实例 id 走 `instance.txt` | 单文件 JSON（data URL 内嵌） | 试点可先用单文件，量产转目录包 |
| D4 | 模拟器 OCR 引擎 | 先只读探针验证 AutoJs6 内置 `ocr()`，不可用再评估 gmlkit/其他 | 直接上 gmlkit（需谷歌服务） | 依赖 R1 探针结果，先验证再定 |
| D5 | 模板匹配区域策略 | 强制绑定受限 ROI，禁止全屏；多区域显式列举（4.3） | 允许全屏兜底 | 现网有全屏误点反面案例，建议强制 ROI |
| D6 | 付费哨兵初始清单 | 由游戏调研基于现有 `chongzhi*` 素材+只读探针整理，用户确认入库（5.1） | 用户自行提供 | 红线，需用户确认清单 |
| D7 | 试点顺序 | playerinfo（只读）→ mail（低风险点击）→ junqing → zhuxian → xiaoqiao（6.1） | 直接 mail 起步 | playerinfo 能先验证 OCR/R1 |

## 附录 B：风险与未验证项

- **R1（关键）**：雷电 x86 / Android 7.1.2 / AutoJs6 v6.8.0 下 OCR 可用性与识别率未验证；P2 只读探针为硬前置，不过则文字类任务暂停。
- **R2**：模拟器封号风险——用户已接受、不再提示；方案仍按只读→低风险顺序推进。
- **R3**：工作台真实模板裁剪功能现为占位（`app.js` 仅存 filename），P1 需新写裁剪；裁剪 rect 与运行帧必须同 profile 同分辨率，否则模板分数不可比。
- **R4**：真机 `vision._normalize` 依赖竖屏 letterbox 黑边检测；模拟器走独立适配，禁止复用该归一化（无黑边会触发"原样返回"分支，坐标语义不同），需在引擎层按 profile 明确分流。
- **R5**：localStorage 容量受限（README 已提示），双端 data URL 素材会更快撑爆；目录包导出 + 及时备份是缓解，P1 需做容量提示。
- **R6**：两地开发模式下单位电脑可能有未推送草稿；本 spec 仅基于本机已同步代码与 docs，若单位机有更新版工作台/任务，落地前需先合并核对。
