# 工作台 ↔ 设备 打通方案（WORKBENCH-BRIDGE-SPEC）

- 日期：2026-11-27
- 作者：游戏调研（只设计，不写生产代码）
- **本轮范围（用户已拍板收窄）**：只做**雷电模拟器单端打通**，adb 本地管道（127.0.0.1 各实例端口）+ 多开实例。真机桥接不展开实现，仅第 8 节列已知差异。
- 上游文档：`docs/WORKBENCH-ENGINE-SPEC.md`（下称引擎 spec，尤其第 1 节数据通路、第 2.4 几何保护、D3）、`docs/HANDOFF-2026-11-27.md` 第 4 节、`AGENTS.md`。
- 现状代码依据：`tools/build.py`（RUNNER/LOGBLOCK/HEADER）、`tools/log_server.py`、`bootstrap.js`、`src/config.js`、`src/debugshots.js`、`src/task-status.js`。

---

## 0. 结论先行

1. **传输主干推荐 a) adb 文件管道**：截帧 `exec-out screencap` 上行、配方 `adb push` 下行、控制走现有 `autotask.txt` 3 秒心跳、状态用 `adb pull` 命令式回传。模拟器场景 adb 走 127.0.0.1 本地口，不依赖局域网/防火墙/谷歌服务，设备侧**零新增网络代码**。
2. **工作台保持纯 HTML/JS 双击离线，不加任何 adb/网络能力**；所有桥接逻辑收进一个独立 Node CLI（建议 `tools/bridge.js`），与 `tools/build.js` 同风格。
3. 三条数据流全部走文件，不要常驻服务：电脑端 CLI 按需调用，模拟器侧 AutoJs6 只做本地文件读写，复用现有心跳与日志机制。
4. 多开实例 id 由 adb serial 派生（`emulator-5554` → `ld-5554`），CLI 部署时写 `instance.txt`，状态/截图按实例命名空间隔离。
5. 配方包采用**版本化目录 + current.txt 指针**部署（对引擎 spec D3 的细化调整，理由见 7.2），支持原子切换与一键回退。
6. MVP 验收闭环不含任何点击：`adb 抓帧 → 工作台(或夹具)产出包 → CLI push → 回读哈希一致 → 设备端只读校验脚本通过`。
7. 本方案与 R1（模拟器 OCR 可用性）**完全解耦**：桥接只用 screencap 和文件传输，不需要 OCR；可与 OCR 只读探针并行推进，互不阻塞。

---

## 1. 总体架构

```
┌───────────────────── 电脑（Windows）─────────────────────┐
│  工作台 workbench/（纯 HTML/JS，离线，零网络零 adb）        │
│      │ 导入 PNG / 导出 recipe-package（目录包）             │
│      ▼                                                     │
│  桥接工作区 _bridge/（CLI 管理，gitignore）                 │
│      │  ▲ pull：日志/状态/调试图                            │
│      ▼  │ screencap：截帧                                  │
│  tools/bridge.js（Node CLI，封装 adb.exe）                 │
└──────┬───────────────────────────────────▲────────────────┘
       │ adb over 127.0.0.1:<实例 adb 口>   │
       ▼ push / exec-out / shell           │ pull
┌────────────────────── 雷电模拟器（每实例独立 VM/存储）──────┐
│  /sdcard/Download/autosgs-logs/                            │
│    recipes/pkg-<ts>/（manifest+recipe+assets，只读资源）    │
│    recipes/current.txt（指针）  instance.txt（实例 id）     │
│    autotask.txt（现有控制令牌，3s 心跳）                    │
│    run.log、task-status-<id>.json、screenshots/<id>/       │
│  AutoJs6：现引擎 bundle 与未来配方引擎 bundle 并存          │
└────────────────────────────────────────────────────────────┘
```

设计要点：
- **游戏不主动拉起**（群内硬约束）：CLI 只有文件操作与 screencap，不发 `am start`，不碰 `com.sanguosha.mjz.mi`。
- **screencap 是 SurfaceFlinger 层只读抓取**：不需要 AutoJs6 截图权限、不需要 MediaProjection 授权、不影响游戏前台，模拟器实测能直接拿到 Cocos 横屏实帧 960×540。这是采帧链路比 AutoJs6 内 `captureScreen` 更轻的关键，适合用户手动进主城后批量采帧。
- 设备侧不引入任何 HTTP 服务/监听端口；现有 8099 拉模式保持 `pc.txt` 可选的遗留状态，不进主干。

---

## 2. 三条数据流

### 2.1 截帧上行（设备 → 电脑 → 工作台）

**链路**：`adb exec-out screencap -p` → Node 以 **buffer 二进制**接收 → 写 PNG 到桥接工作区 → 工作台用现有"批量导入截图"功能导入。

| 项 | 设计 |
|---|---|
| 方向 | 设备 → 电脑（只读） |
| 载体 | `adb -s <serial> exec-out screencap -p`，stdout 二进制重定向到文件 |
| 格式 | PNG（无损，便于模板裁剪与像素级核对；不用 jpg） |
| 触发 | **MVP 手动单抓**：`bridge.js shot --serial emulator-5554 --tag 主城-邮件入口`；定时抓仅作 CLI 可选增强 `--watch 2000`（电脑侧轮询循环，设备侧无常驻），默认间隔 ≥2s，避免高频抓取拖慢游戏（R-B4） |
| 落盘 | `_bridge/<instanceId>/frames/<会话时间戳>/<序号>_<tag>.png` + 同目录 `frames-manifest.json`（serial、instanceId、时间戳、PNG 头读出的宽高、方向） |
| 工作台导入 | 工作台自身不调 adb。MVP：用户在工作台选 PNG 导入（沿用 `app.js` framesInput 多文件导入）；P1 工作台双端化后再做"导入桥接帧文件夹"，读 manifest 自动带 profile 与帧几何 |
| 几何校验 | CLI 读 PNG 文件头校验宽=960、高=540 且横屏；不符则在 manifest 标 `geometryMismatch` 并告警退出码非 0，与引擎 spec 2.4 的精确尺寸 fail-closed 对齐 |

注意（Windows 坑，R-B1）：严禁用 PowerShell 文本重定向接 screencap，编码/CRLF 转换会损坏 PNG；CLI 必须用 Node `child_process.execFile` 以 `encoding:'buffer'` 接收，且用 execFile 数组参数不经 shell。

### 2.2 配方下行（电脑 → 设备 → AutoJs6 加载）

**链路**：工作台导出目录包 → CLI 本地校验 → push 到版本化暂存目录 → 回读哈希 → 原子改指针 → 引擎任务启动时按指针加载校验。

分步（字段级 schema、哈希清单、退出码与清理算法的精确契约见 [`docs/RECIPE-PACKAGE-CONTRACT.md`](RECIPE-PACKAGE-CONTRACT.md)，本节为流程概述）：
1. **本地预校验**（push 前）：按契约第 4.2-A 节执行，schema 标识与 `schemaVersion`、manifest 内 sha256 与实际文件一致、含当前 profile（`emu-ld-960x540`）且被请求场景均为 `bound`、引用完整性（引擎 spec 0.3.5）、付费红线。不过则拒绝部署（退出码 3），零设备写入。
2. **push 暂存**：整包推到 `recipes/.staging-<ts>/`，只写 `recipes/` 子树，manifest 最后 push。
3. **回读校验**：设备侧 `adb shell sha256sum` 逐文件算哈希与 manifest 比对（已实测可用，见 R-B2 关闭记录，作为主路径，省去 pull 往返）；PC 侧 pull 回临时目录重算 sha256 作为兜底，两条路任一不符即拒绝切指针（退出码 5）。manifest 自身哈希按契约 2.3-4 单独回读比对。
4. **原子生效**：同文件系统 `mv` 暂存目录为版本目录 `recipes/pkg-<ts>/`（契约 1.2），再 tmp+rename 原子写 `recipes/current.txt`（单行=版本目录名）与 `instance.txt`，写后回读正则校验。引擎永远经指针读包，不在运行目录上原地覆盖。
5. **加载与热更新契约**（引擎实现时遵守，本 spec 先冻结契约）：
   - 引擎每次接到任务令牌、启动场景前读 `current.txt` 指向的包，按引擎 spec 1.4 与契约第 4.4 节做全套加载校验（版本、profile 几何、sha256、引用），失败则拒绝执行并落 failed 状态。
   - 不做文件监听式热更新；运行中不换包。需要主动重读时由控制令牌 `recipe:reload` 触发（见 2.4），语义等同现网 `reload`（build.py:215）。
   - 回退 = 把 `current.txt` 写回上一合法版本目录名（契约 4.3，无合法上一版本则失败退出，不自动选最新），旧包按契约第 5 节保留最近 3 个。
6. **多开部署**：每个模拟器实例是独立 VM、独立 `/sdcard`，逻辑共享同一源包、物理上逐实例 push 一份；`bridge.js deploy --all` 对 `adb devices` 发现的每个 emulator 串行部署并各自回读校验。

### 2.3 状态回传（设备 → 电脑，给人看）

约束：不要求电脑常驻服务（真机未来同样适用），工作台不做实时显示。采用**命令式 pull**。

| 数据 | 设备侧位置（沿用现网） | 回传方式 | 电脑侧落点 |
|---|---|---|---|
| 结构化日志 | `run.log` / `run.log.1`（LOGBLOCK 现有 1MB 轮转） | `bridge.js logs --serial ...` 单次 pull；`--follow` 用 PC 侧轮询 pull（首选）或 `adb shell tail -f`（toybox tail 已实测齐备，见 R-B2 关闭记录，可直接启用） | `_bridge/<id>/logs/` |
| 任务状态 | `task-status-<instanceId>.json`（引擎 spec 1.5 实例隔离版；现网为 `task-status.json`） | `bridge.js status --watch` 轮询 pull 并在终端格式化打印 | `_bridge/<id>/status/` |
| 日常结果 | `daily-last-result-<instanceId>.json` | 同上，随 status 一起拉 | `_bridge/<id>/status/` |
| 调试图 | `screenshots/<instanceId>/dbg_*.png`（debugshots 现有命名白名单+轮转 20 张，实例子目录为引擎待实现项） | `bridge.js shots --pull [--clean-local]`，只 pull 不删设备文件 | `_bridge/<id>/shots/` |

人工查看方式（推荐次序）：
1. MVP：CLI pull 后打开 `_bridge/<id>/` 文件夹看原始文件，终端打印 status 摘要。
2. 后续可选：CLI 增加 `report` 子命令，把 status/result JSON 生成**静态 HTML 报告**（本地文件、无网络、无服务），作为人工查阅入口。
3. 明确**不做**：工作台内嵌实时状态、常驻 HTTP 服务、WebSocket 推送。

现网 `sgs.pushLog/pushShot`（build.py LOGBLOCK）与 8099 服务保留原样：`pc.txt` 不存在时整套 HTTP 默认关闭（config.js:5 已验证），模拟器桥接不依赖它；用户若手动写 pc.txt，旧回传仍可用，两条路互不干扰。

### 2.4 控制令牌（电脑 → 设备，复用 autotask.txt）

现网机制（build.py 的 RUNNER 心跳块，`__TASKFILE` 轮询逻辑）：adb 写 `/sdcard/Download/autosgs-logs/autotask.txt`，AutoJs6 每 3 秒心跳自取，忙时文件留盘天然排队，互斥看 `isBusy()`。配方引擎沿用同一文件，用**独立命名空间**避免与现引擎任务名冲突：

| 令牌 | 语义 |
|---|---|
| `recipe:<sceneId>` | 配方引擎执行指定场景（如 `recipe:playerinfo`） |
| `recipe:stop` | 请求停止（映射引擎 spec 5.4 停止令牌） |
| `recipe:reload` | 重读 current.txt 指向的包 |
| `recipe:check` | 只跑只读加载校验（MVP Gate2 用，见第 6 节） |

规则：
- 现引擎 bundle 与配方引擎 bundle（引擎 spec 0.6 的 `_recipe_main.js`）**任一时刻只允许一个常驻**，沿用 `lifecycle.stopOtherEngines()` 互斥；两个引擎对不属于自己命名空间的令牌直接忽略并记日志，杜绝同一文件被两边误取。
- 裸 `tap:x,y`、`shot:x` 等现网令牌维持现引擎专属，配方引擎不实现裸坐标点击令牌（与 fail-closed 红线一致）。

---

## 3. 传输选型取舍

| 方案 | 模拟器适配 | 多开 | 设备侧改动 | 电脑侧依赖 | 离线/网络 | 主要短板 | 结论 |
|---|---|---|---|---|---|---|---|
| **a) adb 文件管道（push/pull + autotask 心跳）** | 原生，127.0.0.1 本地口，实测可达 | serial 天然区分 | 零新增网络代码，复用文件+心跳 | 仅 Node CLI 包 adb.exe | 不依赖局域网/外网/谷歌服务 | 真机无线 adb 需配对（本轮不做）；Windows 二进制流要 buffer 处理 | **推荐，主干** |
| b) AutoJs6 HTTP 服务/局域网轮询 | 可用但冗余 | 要自己管端口/实例 | 新增 HTTP 服务端与鉴权 | 防火墙/固定 IP/常驻服务 | 依赖局域网连通 | 开放端口安全面、真机要求电脑常开（违背约束） | 不采纳 |
| c) VSCode（AutoJs6）插件 | 调试方便 | 弱 | 插件生态 | 绑定 IDE | 依赖插件连接 | 不是工程化数据管道：无 sha256/原子部署/多开/校验体系 | 仅作开发调试便利，不承担桥接 |
| d) 8099 log_server + bootstrap 旧模式 | 可用 | 无多开模型 | 现网已存在 | 必须常开 Python 服务、硬编码 PC IP（bootstrap.js:5 遗留 192.168.2.250） | 断网即停 | 现网代码已自行降级为 adb+autotask（config.js:5 注释） | 保留为 pc.txt 可选遗留，不进主干 |

推荐组合：**a 全包**；d 维持现状不动；b、c 不引入。

---

## 4. 多开实例与实例 id

### 4.1 端口与发现

- 雷电实例控制台口 5554/5556/5558…，对应 adb 口 5555/5557/5559…，adb serial 表现为 `emulator-5554`、`emulator-5556`（群内已验证首实例 emulator-5554）。
- 发现入口统一是 `adb devices -l`，CLI 过滤 `emulator-*`；**不硬编码 5554**——实例启动顺序变化会改端口映射（R-B3）。
- `bridge.js instances` 输出：serial、派生 instanceId、连接状态、一次 screencap 探得的帧几何。

### 4.2 【推荐 B2】实例 id 规则

- 由 serial 确定性派生：`emulator-5554` → `ld-5554`（取控制台口，正则 `^emulator-(\d+)$`），同机重启稳定、无需人工命名。
- 可选友好名映射：`tools/bridge-instances.json`（本地配置，不进配方包）把 serial 映射到别名（如 `ld-5554=大号`、`ld-5556=小号`），仅用于 CLI 展示与日志目录。
- CLI 部署时把 instanceId 写入设备 `/sdcard/Download/autosgs-logs/instance.txt`（单行、ASCII、受控字符 `^[a-z0-9-]+$`）；引擎启动读它做状态文件命名空间（引擎 spec 1.5 的悬空子项，此处明确**责任方=CLI**）。
- profile id 与 instance id 是两层：同分辨率实例共享配方 profile `emu-ld-960x540`；instance id 只隔离运行时状态，不进配方数据。

---

## 5. 设备侧目录与安全

### 5.1 目录布局（全部在现有 autosgs-logs 根下）

```
/sdcard/Download/autosgs-logs/
├── .nomedia                          # 现有，相册隐藏
├── instance.txt                      # CLI 写入：ld-5554
├── autotask.txt                      # 现有控制令牌
├── run.log / run.log.1               # 现有日志轮转
├── task-status-ld-5554.json          # 状态（实例隔离，引擎待实现）
├── daily-last-result-ld-5554.json    # 结果（实例隔离，引擎待实现）
├── screenshots/ld-5554/dbg_*.png     # 调试图（实例子目录，引擎待实现）
└── recipes/
    ├── .nomedia
    ├── current.txt                   # 指针：pkg-20261127-220000
    ├── pkg-20261127-220000/
    │   ├── manifest.json             # sha256 清单 + profile + 场景列表
    │   ├── recipe.json
    │   └── assets/emu-ld-960x540/...
    ├── pkg-20261127-210000/          # 保留最近 3 个，用于回退
    └── .staging-<ts>/                # 部署暂存，成功后改名；残留由 CLI 清理
```

### 5.2 安全红线（对齐 AGENTS.md 与引擎 spec 第 5 节）

1. **固定目录写入**：CLI 只允许写 `autosgs-logs/recipes/` 子树与 `instance.txt`；instanceId、版本号等所有路径成分做白名单校验（`^[a-z0-9._-]+$`），PC 侧固定拼路径，不接受任意目标路径。
2. **canonical 校验纵深**：PC 侧路径成分白名单为主防线；设备侧 toybox `realpath` 已实测齐备（见 R-B2 关闭记录），部署后对 recipes/ 与 instance.txt 跑一次真实路径核对，双重确认无符号链接/越界。
3. **sha256 双端校验**：PC 端 manifest 哈希 → push → 回读重算比对；引擎加载时再独立校验一次（引擎 spec 1.4）。任一不符整包拒绝。
4. **清理范围与算法**：只清理 `recipes/` 一级下命名白名单内的 `.staging-<ts>` 与超限旧版本目录，保留当前指针包+最近共 3 个 pkg；不删日志、状态、截图，不碰 `recipes/` 外任何路径；禁止通配/递归删除。精确的枚举、保护集合、manifest 清单驱动逐文件 `rm` + 深度逆序 `rmdir` 算法见 [`docs/RECIPE-PACKAGE-CONTRACT.md`](RECIPE-PACKAGE-CONTRACT.md) 第 5 节（冻结），实现侧不得自拟删除逻辑。
5. **.nomedia**：`recipes/` 与截图实例子目录均放置，沿用 debugshots 现有相册隐藏约定。
6. **adb 配置化**：默认 `D:\develops\tools\platform-tools\adb.exe`（HANDOFF 记录），支持环境变量/本地配置覆盖，适配两地开发路径差异（R-B5）。
7. **只读采帧**：screencap 不点击、不输入、不拉前台；CLI 不含任何 input tap/swipe 子命令（现网 `adb input tap` 在 Cocos 层被吞本就无效，HANDOFF 第 4 节已记录）。
8. 设备侧文件原子写沿用现网 tmp+rename 模式（task-status.js:45、daily.js:52 已验证的写法）。

---

## 6. MVP 最小闭环（打通验收，全程零点击）

目标：在配方引擎动工前，先证明管道、包格式、校验契约端到端成立。分两个闸门。

### 6.1 Gate 1：纯管道闭环（不需要任何 AutoJs6 新代码）

| 步骤 | 操作 | 成功判据 | 失败判据 |
|---|---|---|---|
| 1 发现实例 | `bridge.js instances` | 列出 emulator-5554，状态 device，探得帧 960×540 | 无设备/非 960×540，报错并停止 |
| 2 采帧 | 用户手动进主城后 `bridge.js shot --tag home` | PNG 落 `_bridge/ld-5554/frames/...`，PNG 头 960×540，manifest 记录一致 | 文件损坏/尺寸不符/退出码非 0 |
| 3 产出配方包 | 工作台双端化未完成前，用**手工夹具**：最小 recipe-package（一个 scene、一个 point+一个 roi 元素、emu profile、无模板素材亦可），含 manifest 与 sha256 | 本地预校验全过 | schema/哈希/引用任一不过即拒绝 |
| 4 部署 | `bridge.js deploy --serial emulator-5554 --pkg <夹具包>` | 暂存→回读哈希全一致→版本目录生效→current.txt 指向新版本 | 回读哈希不符则指针不改、保留旧包、报错 |
| 5 多开（单实例可跳过，有多开时执行） | `deploy --all` 后逐实例核对 current.txt 与 instance.txt | 每实例独立一份且 id 正确 | 串行/隔离出错即失败 |
| 6 回退 | `bridge.js rollback --serial ...`（契约 4.3） | current.txt 指回上一合法版本，文件未被破坏；prune 按契约第 5 节执行 | 无合法上一版本时退出码 8、不自动选最新；回退后指针/包不一致 |

> 部署/回退的步骤顺序、退出码（0/2~8/10）与 manifest 精确字段统一以 [`docs/RECIPE-PACKAGE-CONTRACT.md`](RECIPE-PACKAGE-CONTRACT.md) 为准。

### 6.2 Gate 2：设备端只读校验脚本（加载契约验证，仍零点击零识别）

- 新增一个**只读 AutoJs6 脚本**（配方引擎加载器的前身，不属任务生产代码）：经 `recipe:check` 令牌或手动运行，只读 `current.txt`、manifest、recipe、assets，执行引擎 spec 1.4 的全套校验：schemaVersion 兼容、当前实例 profile 匹配、现场 screencap 一帧做几何比对（960×540）、全部 sha256、引用完整性与越界检查；结果 JSON 写 run.log 与状态文件。
- **硬约束**：不调用任何 click/swipe、不做 OCR/模板匹配、不拉起游戏、不写 recipes/ 之外文件。
- 成功判据：校验结果 `ok:true`，故意损坏一个 asset / 改错 current.txt / 换入竖屏帧时分别得到明确 `ok:false` 与具体原因（证明 fail-closed 真实生效）。
- B6 已于 2026-11-27 拍板通过：允许该只读校验脚本作为首个上模拟器的 AutoJs6 程序（只做文件/哈希/几何校验，零点击、零 OCR、不消费任何资源），决策记录见第 11 节。

### 6.3 与后续阶段的关系

- Gate 1/2 通过 = 打通验收完成，工作台 P1 双端化与引擎 P3/P4 才有可靠下行通道。
- OCR 探针（引擎 spec P2/R1）与本 MVP 无依赖，可并行；桥接不验证 OCR。
- 真机标注所需的裁黑边流程不在本轮，见第 8 节。

---

## 7. 与引擎 spec（D3）的对齐与调整

### 7.1 完全对齐项

- 目录包形态（manifest + recipe + assets 分文件、sha256）、设备根目录 `autosgs-logs/`、`.nomedia`、多开同 profile 共享配方、状态按实例隔离、加载侧 schema/几何/引用 fail-closed 校验——全部沿用引擎 spec 第 1 节与 0.3.5，不另起格式。
- 单文件 JSON（data URL 内嵌）仅保留为工作台之间的交换格式；**设备侧只接收目录包**。

### 7.2 对 D3 的细化调整（需用户确认，见 B3）

引擎 spec 1.2 描述的是静态 `recipes/` 根布局；本方案为满足"原子部署、运行中不换包、可一键回退"，细化为：

1. 包部署到**版本化目录** `recipes/pkg-<时间戳>/`，另设 `recipes/current.txt` 指针；引擎经指针加载，不直接读固定目录。
2. 理由：原地覆盖在 push 中途会让引擎读到半包；版本目录+指针把"传输"和"生效"拆成两个阶段，切换是一次 rename，天然原子，且回退只需改指针。
3. 明确 `instance.txt` 的写入责任在 CLI 部署动作（引擎 spec 1.5 留下的子项）。
4. 除上述部署期结构外，包内 schema、字段、校验规则一字不改，引擎 spec 的加载器设计不受影响。

---

## 8. 真机后续扩展（本轮不实现，仅登记已知差异）

1. **连接方式**：真机走无线 adb（mDNS `adb-tls-connect`），换电脑后 RSA 密钥不同需重新配对一次（HANDOFF 第 4 节）；断连重连、配对码人工介入；USB adb 作为兜底。已知未授权设备（192.168.3.16）禁止触碰。
2. **截帧几何差异**：真机 adb screencap 取的是物理竖屏 SurfaceFlinger 帧（带 letterbox 黑边），不像模拟器直接给 960×540 干净横屏；真机标注帧需要独立的裁黑边/归一到 2772×1280 流程（设备端 `vision._normalize` 已有的黑边检测逻辑可作算法参考，但工作台采帧链路要单独设计）。
3. **MediaProjection 依赖**：执行/OCR 链路仍需截图权限与 `_autoGrant` 自动授权（vision.js:47）；桥接采帧虽可用 screencap 绕过，任务运行时绕不开。
4. **非常驻电脑前提**：真机状态回传坚持命令式 pull 与本地文件，不引入要求电脑常开的 HTTP 依赖；8099 维持 pc.txt 可选。
5. **多开不适用**：真机单设备，实例隔离机制只为模拟器设计；双端差异由引擎 spec 的 profile 模型承载。
6. 真机 profile（`device-real-2772x1280`）的包走同一套 manifest/指针/校验契约，仅传输通道与帧预处理不同。

---

## 9. 待拍板项（B1~B6 已于 2026-11-27 全部按推荐拍板，见第 11 节；下表保留为决策溯源）

| 编号 | 决策点 | 推荐（已采纳） | 备选 |
|---|---|---|---|
| B1 | 传输主干 | adb 本地管道全包（截帧/下行/回传/令牌） | 引入 HTTP 或沿用 8099 主干 |
| B2 | 多开实例 id | serial 派生 `ld-<控制台口>` + 可选本地别名映射文件，CLI 写 instance.txt | 人工命名/用雷电 dnplayer 序号 |
| B3 | D3 部署结构调整 | 版本化目录 + current.txt 指针（原子切换/回退） | 固定目录原地覆盖 |
| B4 | 采帧节奏 | MVP 手动单抓；定时 watch 仅 CLI 可选、≥2s、设备无常驻 | 设备侧常驻定时采帧 |
| B5 | 状态查看 | CLI pull + 终端摘要，后续可选静态 HTML 报告；不做实时/常驻服务 | 工作台实时面板/HTTP 推送 |
| B6 | Gate2 只读校验脚本 | 允许作为首个上设备 AutoJs6 程序（只读文件+哈希+几何，无点击无 OCR） | 等引擎一起做，MVP 只验 Gate1 |

## 10. 风险与未验证项

- **R-B1（Windows 二进制损坏）**：adb exec-out 的 PNG 必须 Node buffer 接收，PowerShell 文本重定向会破坏图像；CLI 实现时加最小用例（拉一帧后校验 PNG 魔数与宽高）。
- **R-B2（toybox 能力）——已关闭（2026-11-27，emulator-5554 实测）**：雷电 Android 7.1.2 镜像的 `sha256sum`、`realpath`、`tail`、`mv`、`mkdir`、`cat` 均在 `/system/bin`，其中 `sha256sum` 已做功能验证并通过。设备侧哈希加速（2.2 第 3 步主路径）、realpath canonical 核对（5.2 第 2 条）、`tail -f` 日志跟随（2.3）均可直接使用；PC 侧回退方案保留作兜底，不再是前置阻塞项。
- **R-B3（多开端口漂移）**：实例 adb 口随启动顺序变化；一切以 `adb devices` 实测为准，映射文件人工核对，禁止硬编码。
- **R-B4（screencap 负载）**：高频抓取可能拖慢游戏；watch 默认 ≥2s 且只在标注会话使用，日常不跑。
- **R-B5（两地开发）**：adb/雷电安装路径单位机可能不同；路径全部配置化，`tools/bridge-instances.json` 等本地文件不进 git。
- **R-B6（沿用引擎 spec R1）**：OCR 可用性是独立探针，与本桥接无耦合；桥接 MVP 不读字、不识别。
- **R-B7（双引擎共处）**：配方引擎与现引擎共享 autotask.txt，必须靠令牌命名空间 + 单实例常驻互斥（stopOtherEngines）防止指令误取，落地测试要覆盖"错命名空间令牌被忽略"用例。

---

## 11. 决策记录

### 11.1 本方案拍板记录（2026-11-27，用户全部按推荐拍板）

| 编号 | 决策 | 拍板结果 |
|---|---|---|
| B1 | 传输主干 | 采纳：adb 本地管道全包（截帧/下行/回传/令牌），设备侧零新增网络代码；8099/log_server 维持 pc.txt 可选遗留，不进主干；HTTP 服务与 VSCode 插件方案不引入 |
| B2 | 多开实例 id | 采纳：serial 派生 `ld-<控制台口>`（正则 `^emulator-(\d+)$`），CLI 部署写 instance.txt（白名单 `^[a-z0-9-]+$`），别名走不进 git 的 `tools/bridge-instances.json` 本地配置；发现只认 `adb devices`，禁止硬编码端口 |
| B3 | D3 部署结构调整 | 采纳：版本化目录 `recipes/pkg-<时间戳>/` + `current.txt` 指针，暂存→回读校验→同 fs 改名→tmp+rename 原子切指针；一条命令回退，保留最近 3 个包；包内 schema 与引擎 spec 一字不动 |
| B4 | 采帧节奏 | 采纳：MVP 手动单抓；定时 `--watch` 仅作 CLI 可选增强，默认间隔 ≥2s，设备侧无常驻采帧 |
| B5 | 状态查看 | 采纳：CLI 命令式 pull + 终端摘要，后续可选本地静态 HTML 报告；不做工作台实时面板、常驻服务或 WebSocket 推送 |
| B6 | 首个上设备程序 | 采纳并单独确认：允许 Gate2 只读校验脚本作为第一个进模拟器的 AutoJs6 程序，仅做文件/sha256/几何/引用校验，零点击、零 OCR、不拉起游戏、不消费任何资源 |

配套事实（同日验证）：R-B2 关闭——emulator-5554（雷电 Android 7.1.2）上 `sha256sum`/`realpath`/`tail`/`mv`/`mkdir`/`cat` 均在 `/system/bin`，sha256sum 功能验证通过。

执行顺序：代码落地先实现 Gate1 纯管道闭环（电脑侧 `tools/bridge.js`，不写设备脚本），按 spec 6.1 六步在 emulator-5554 实跑并回报证据；Gate2 只读校验脚本另派。

### 11.2 尚未拍板的事项（防止与本节混淆）

- **引擎 spec `docs/WORKBENCH-ENGINE-SPEC.md` 附录 A 的 D1~D7 仍处于待用户拍板状态，本文档任何内容不构成对 D1~D7 的决定**；其中 D3 仅按 B3 做了"设备侧部署结构"层面的细化（版本目录+指针），引擎 spec 的包内 schema、字段与校验规则维持原推荐待审。
- 引擎 spec 的 R1（雷电 x86 / AutoJs6 v6.8.0 OCR 可用性）仍未验证，由独立只读 OCR 探针承担，与本桥接 MVP 解耦并行。
