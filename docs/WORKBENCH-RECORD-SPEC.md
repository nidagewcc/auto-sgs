# 手动采集 → 工作台配方草稿 方案（WORKBENCH-RECORD-SPEC，悬浮球版 v2）

- 日期：2026-11-27（v2 重写；v1 的定时 burst/getevent/PC 守望主线已按用户拍板降级为附录 B/C）
- 作者：游戏调研（只设计，不写生产代码）
- **本轮范围**：雷电模拟器单端（profile `emu-ld-960x540`，帧 960×540）。真机只在第 10 节登记差异，不展开。
- 上游依据：`docs/RECIPE-PACKAGE-CONTRACT.md`（冻结包契约、退出码风格）、`docs/WORKBENCH-BRIDGE-SPEC.md`（adb 管道、autotask 心跳、目录红线）、`src/lifecycle.js`（引擎共存判定）、`src/ui.js`（WindowManager 悬浮窗）、`src/vision.js`（截图权限/自动授权）、`tools/bridge.js`（CLI 风格）。
- 设计来源：用户拍板的"触动精灵式三状态悬浮球"——打开游戏正常玩、全程零对话零干扰，每完成一步点一下球截一张，张数约等于操作步数；场景由 PC 拉起时绑定，失败可整段重录。

---

## 0. 结论先行

1. **主线 = 游戏内常驻三状态悬浮球 + PC 按场景拉起**。球只有「开始 →（每次点球）截图存帧 → 结束」三状态，球上不做场景管理；场景归属在 PC `capture start` 令牌里定死，该会话所有帧自动归入该场景目录。
2. **采集 bundle 完全独立于生产引擎**：独立目录、独立入口、独立 build 产物，不进 `build.py` 的 MODS；只截图，禁止任何游戏点击/OCR/input 注入/拉起游戏/资源消费。
3. 控制走**独立文件** `capture-task.txt`（3 秒轮询、读后删、忙时留盘），保留 `capture:` 令牌命名；不共用 autotask.txt——生产心跳"先删后判"会吃掉采集指令（见 3.1）。另以 `capture-heartbeat.txt` 判引擎存活，离线（>10s）命令直接退出 9。
4. 会话状态机 `recording / closed / failed / discarded`，只有 `closed` 能被 pull 与导入工作台；`retry` 把失败/在录会话整体移动到 `_discard/` 留证据（不物理删除、不混帧），新会话序号从 001 重来。
5. 球失败（root screencap 失败/存储满/心跳异常）显式变红停摆、manifest 标 failed、停止接收点击，**不自行重启**，等 PC 令牌处置。
6. 截图主路径是 root shell `screencap`，不走 MediaProjection，与生产引擎零授权争用。产出的帧是工作台输入物料，不是 recipe-package：不部署、不执行；后续在工作台逐帧手工标识别物（推荐主线，无坐标校准风险）。getevent 触摸坐标采集仅作未来可选增强（附录 C）。

---

## 1. 总体架构

```
PC：tools/bridge.js capture 子命令（adb 管道，零网络代码）
   查 capture-heartbeat.txt 判活 → 生成 rid，写四段令牌 capture-task.txt（单槽）
   → 只轮询 capture-receipts/<rid>.json 回执，15s 超时退出 12
雷电模拟器 AutoJs6：独立采集 bundle（capture/ 源码 + 独立产物，常驻+开机自启）
   3 秒轮询读令牌/刷新心跳 → 校验 rid → 状态机驱动悬浮球 → 点球经 root screencap 落盘
   → 每令牌写回执 capture-receipts/<rid>.json（tmp+rename，留最近 50 个）
   截图：/sdcard/Download/autosgs-logs/capture/<sceneId>/<会话ts>/NNN.png
PC pull（仅 closed）→ _bridge/<instanceId>/capture/<sceneId>/<会话ts>/ → 工作台导入
```

- 设备侧零网络代码、零 HTTP 服务；与桥接 spec 的设备约束一致。
- 全程不与用户对话：用户不需要发"开始/停"，场景拉起由操作者在 PC 一次性完成，之后用户只在游戏里点球。

---

## 2. 悬浮球状态机（设备端核心）

### 2.1 三个可见状态

| 球状态 | 含义 | 球上呈现 | 点击行为 |
|---|---|---|---|
| `idle` 空闲 | 采集 bundle 已启动、无在录会话 | 灰色小球 + "采集" | 忽略（无会话不截图），等待 start 令牌 |
| `recording` 进行中 | 已绑定 sceneId 的会话在录 | 场景名 + 已存帧数（如"邮件 · 003"） | 截当前帧、序号自增、落盘、toast「已存 NNN」 |
| `failed` 失败停摆 | 会话发生不可恢复错误 | 红色球 + 失败原因缩写 | 不截图、不响应，等 PC retry/stop |

### 2.2 状态转移（只由令牌与内部错误驱动，球上无场景操作）

```
idle --capture:<scene>:start --> recording
recording --capture:stop -------> closed（球回 idle）
recording --内部错误------------> failed（球变红，保留现场）
failed --capture:<scene>:retry -> 旧会话移 _discard（discarded）+ 新会话 recording
recording --capture:<scene>:retry（主动作废重录）-> 同上
任何状态 --capture:stop --------> 安全收尾（failed 下 stop 仅封帧/收球，不补救）
```

- 球上**只有截图动作和一个结束小按钮**（结束等价于收到 stop）；不提供场景切换、命名、删除等管理 UI，避免游戏内操作负担与误触。
- 同一实例同一时刻最多一个在录会话；start 到达时若已有 recording 会话，拒绝并回写冲突状态（不自动覆盖，见 5.3）。

### 2.3 悬浮窗实现约束（复用现网经验）

- 本设备 floaty 会 NPE（`src/ui.js:2` 已记录），球用 **Java View + WindowManager 直挂**，`TYPE_APPLICATION_OVERLAY` + `FLAG_NOT_FOCUSABLE`（参考 ui.js `_attachWindow/_lp`），保证不抢游戏触摸焦点。
- 球可拖动但默认贴边、体积小，不遮挡右侧常用按钮；窗口登记进自身 `_views`，退出时统一 removeView。
- 孤儿窗口回收复用 `ui.recoverOrphans` 思路（WindowInspector 枚举全局 overlay 视图），采集 bundle 启动时只回收**自己标记**的窗口（用 tag 区分，不碰生产引擎窗口）。
- 球的所有 UI 操作 post 到主线程执行（ui.js `_onMainSync` 模式）。

---

## 3. 控制令牌（独立文件 capture-task.txt，capture 命名空间）

> 协议版本：**control-protocol v1.1（2026-11-28 加 requestId/回执，见 3.3）**；v1.0（2026-11-27）为无 rid 的三段/两段令牌。v1.1 起引擎只接受带合法 rid 的令牌，旧格式按损坏令牌处理。

### 3.1 为什么不能共用 autotask.txt（拍板依据）

原设计想让采集 bundle 与生产引擎共用 `/sdcard/Download/autosgs-logs/autotask.txt`、靠 `capture:` 前缀过滤。核实现网心跳后该方案不成立：生产引擎在 `tools/build.py:212-214`（常驻心跳，`:210` 先判 `!isBusy()`）以及 `:173-175`（启动冒烟块）都是**先 `files.read` 再无条件 `files.remove`，之后才按内容分发**。两个独立引擎并存时，生产引擎会在识别出 `capture:` 前缀之前就把令牌文件删掉，采集指令被静默吃掉。独立 source 路径只能避免引擎互相 forceStop（见第 7 节），挡不住文件级抢令。

### 3.2 拍板方案：独立控制文件，零生产改动

- 采集 bundle **只轮询自己的** `/sdcard/Download/autosgs-logs/capture-task.txt`，3 秒一次、读后删、忙时留盘排队（与 autotask 同款语义，但文件物理隔离）；**完全不读、不删、不碰 autotask.txt**。
- 生产引擎永远不看 capture-task.txt。命名空间隔离在**文件级**直接成立，无需改生产心跳、无并发投递协议、零回归风险。
- `capture:` 令牌命名保留，仅载体换成新文件。令牌文件同样落在 autosgs-logs 根（受既有目录红线与 `.nomedia` 覆盖），路径成分固定、不接受外部传入。

### 3.3 requestId 与回执协议（v1.1 冻结）

**问题**：单槽下同一命令的延迟旧回执可能被新一次调用误认成本次结果（如连续两次 start）。rid 只解决"回执认亲"，不改变单槽/不排队语义。

**令牌四段格式**：`capture:<sceneToken>:<command>:<rid>`

- `rid` 由 bridge 每次调用生成，规则 `r<13位时间戳><4位小写hex随机>`，正则 `^r\d{13}[0-9a-f]{4}$`（如 `r1732724304017a3f9`）。
- 无场景的命令（stop/list）`sceneToken` 用字面量 `-` 占位，保持四段结构。
- 引擎解析：rid 缺失或不匹配正则 → 按**损坏令牌**处理（不执行、写告警日志、删除该令牌文件），不产生回执。

| 完整令牌（写入 capture-task.txt） | 语义 |
|---|---|
| `capture:<sceneId>:start:<rid>` | 拉起/绑定场景会话，球进入 recording |
| `capture:-:stop:<rid>` | 封帧 closed、球回 idle |
| `capture:<sceneId>:retry:<rid>` | 当前会话移 `_discard/`，同场景起新会话，序号重置 |
| `capture:-:list:<rid>` | 触发一次会话清单回执（不改变状态） |

**回执落盘**：引擎每处理完一条令牌，在固定目录写 `capture-receipts/<rid>.json`（tmp+rename 原子写）：

```jsonc
{
  "rid": "r1732724304017a3f9",
  "token": "capture:mail:start:r1732724304017a3f9", // 原令牌原样回显
  "ok": true,                  // true=成功；false=业务失败，配 error 码
  "error": null,               // 失败时机器可读原因码（对齐 6.1 原因码/退出语义）
  "sessionId": "20261128-001012-k7qx",  // 本次作用会话
  "retry": { "oldSessionId": "...", "newSessionId": "..." }, // 仅 retry 出现，带齐新旧两个
  "state": "recording",        // 处理后会话状态
  "at": "2026-11-28T00:10:12+08:00"
}
```

- bridge 只按自己本次发起的 rid 轮询对应文件 `capture-receipts/<rid>.json`，读到即取走（读取后删除该回执文件）；**绝不读取或匹配其他 rid 文件**，从根上杜绝旧回执误认。
- 轮询超时沿用 15 秒；超时按"回执超时"处理（退出码 12，见第 5 节），不猜测结果、不重复下发（重试是上层显式行为，会生成新 rid）。
- 回执目录保留最近 **50 个**文件：引擎启动 reconcile 时清理，只删本目录内匹配 `^r\d{13}[0-9a-f]{4}\.json$` 的已知命名、超出 50 个的最旧项；不通配、不递归、不碰其他文件。

**单槽语义不变（重要）**：

1. rid 不解决排队，只解决回执归属。槽里已有不同令牌仍按退出码 2 拒绝（见 5.3）。
2. "内容相同但 rid 不同"视为**一次新请求**（确实是一次新调用），引擎不做去重；避免重发由 bridge 上层负责，引擎对每条合法令牌都正常处理并各写各的回执。
3. v1.0 的"同内容幂等"在 v1.1 收敛为：仅当**整份令牌文件逐字节相同（含 rid）**才幂等；rid 不同即不同请求。

规则：
1. 采集 bundle 只认 capture-task.txt；autotask.txt 里的现引擎任务名（mail/xiaoqiao…）、`recipe:*`、`tap:*`、`shot:*` 与采集侧完全无关，两引擎各读各的文件。
2. `sceneId` 必须匹配白名单 `^[a-z0-9_-]{1,64}$`，rid 必须匹配上述正则，任一非法即按损坏令牌忽略并记日志，不建目录（路径注入防护）。
3. "读取即删除"仅作用于采集 bundle 自己的文件；忙时（正在截图/写 manifest）不取令牌，文件留盘天然排队，沿用现网 autotask 已验证的排队行为。
4. 原 R-C3 的双引擎同文件竞争风险随独立文件方案关闭；残余注意点仅为同一采集 bundle 被重复启动时的多消费者问题，由第 7 节单实例约束覆盖。

---

## 4. 设备侧目录与会话清单

### 4.1 目录布局（全部在 autosgs-logs 下，沿用桥接红线）

```
/sdcard/Download/autosgs-logs/
├── capture-task.txt                 # 控制令牌（单槽，引擎读后删），与 autotask.txt 物理隔离
├── capture-heartbeat.txt            # 引擎每 3 秒刷新的 epoch 毫秒，bridge 据此判活
├── capture-receipts/                # v1.1 回执目录，每令牌一个 <rid>.json，保留最近 50 个
│   ├── r1732724304017a3f9.json
│   └── ...
└── capture/
    ├── .nomedia
    └── <sceneId>/
        ├── <sessionTs>/             # 在录/正常会话，sessionTs=YYYYMMDD-HHMMSS-<短随机>
        │   ├── session-manifest.json
        │   ├── 001.png
        │   ├── 002.png
        │   └── ...
        └── _discard/
            └── <sessionTs>/         # 作废/失败隔离会话，结构同上，不删帧
                ├── session-manifest.json
                └── *.png
```

- 两个控制文件与回执目录在 autosgs-logs 根、不在 capture/ 子树内：采集 bundle 是它们的唯一读写者，生产引擎从不访问；文件名固定，不接受外部传入路径。回执文件名就是 rid，天然受 `^r\d{13}[0-9a-f]{4}\.json$` 白名单约束。

- 会话目录名时间戳由设备生成并带短随机后缀，避免同秒冲突；PC 侧不预设目录名。
- 所有写入限定在 `capture/` 子树；sceneId、sessionTs 全部白名单字符，拼路径后过 canonical 校验（契约 5.2 同款 realpath 纵深）。
- `.nomedia` 防止帧进相册（AGENTS.md 约定）。

### 4.2 session-manifest.json 字段（冻结）

```jsonc
{
  "schema": "sgs-workbench/capture-session",
  "schemaVersion": 1,
  "sceneId": "mail",
  "instanceId": "ld-5554",
  "sessionId": "20261127-235012-k7qx",
  "state": "recording",            // recording | closed | failed | discarded
  "frame": { "width": 960, "height": 540 },
  "startedAt": "2026-11-27T23:50:12+08:00",
  "endedAt": null,
  "frameCount": 3,
  "frames": [
    { "seq": 1, "file": "001.png", "savedAt": "2026-11-27T23:50:40+08:00",
      "width": 960, "height": 540, "geometryMismatch": false }
  ],
  "lastError": null,               // failed 时填机器可读原因码
  "discardReason": null            // discarded 时填 failed-retry | user-retry
}
```

- 每次截图成功后**增量重写** manifest（tmp+rename 原子写，沿用 task-status 模式），保证断电/崩溃后清单与盘上帧可对账。
- state 只能按第 2.2 节转移；`discarded` 是终态，`_discard` 内会话不再接受任何令牌。
- 帧文件命名固定三位序号、从 `001.png` 起；retry 的新会话重新从 001 开始，与旧会话物理隔离。

### 4.3 截图与几何校验（主路径 root screencap，不用 MediaProjection）

- **v1 主路径：root shell `screencap -p` 直接写会话目录**。雷电模拟器 root 已确认可用（su 可用），点球后采集 bundle 经 root shell 调 `screencap -p <会话目录>/NNN.png`，SurfaceFlinger 层只读抓帧，与桥接 CLI 的 `exec-out screencap` 同源同几何（960×540 横屏实帧）。
- **为何不用 MediaProjection**：同一个 AutoJs6 进程内重复 `requestScreenCapture` 会与生产引擎 vision 的投影授权互相干扰/顶掉；root screencap 完全绕开投影，不争用授权、不需要"共享屏幕"弹窗、不需要 `_autoGrant`，采集与生产引擎的截图链路彻底解耦。
- 【实现约束】root screencap 在该 Android 7.1.2 镜像若实测有坑（黑帧、方向错、写盘失败），**停下来上报，不得悄悄切回投影方案**；投影只作为本文档登记的备选，v1 不实现。
- 每帧写盘后回读 PNG 文件头校验魔数与 IHDR 尺寸：横屏且 960×540 才计数；不符该帧不计数、标 `geometryMismatch`，连续不符触发 failed（原因码 `geometry`），与引擎 spec 2.4 的精确几何 fail-closed 对齐。
- 帧直接以 PNG 存盘（不用 jpg，便于后续像素级模板裁剪）；不做任何 OCR、模板匹配、点击。
- 备选（仅登记，v1 不实现）：MediaProjection + `vision._autoGrant` 自动授权思路（vision.js:12-74），仅在未来出现无 root 环境时单独立项评估。

---

## 5. PC 端 bridge.js capture 子命令

沿用现有 CLI 风格（显式 `--serial`、idFor 派生、数字退出码、路径白名单）。退出码在契约 4.1 基础上扩展 capture 段：

| 码 | capture 场景含义 |
|---|---|
| 0 | 成功（含 rid 回执匹配成功） |
| 2 | 参数/用法错误（sceneId/rid 非法、缺 serial）；**令牌槽冲突：capture-task.txt 已存在且令牌不同，拒绝覆盖**；损坏令牌（rid 缺失/格式错） |
| 4 | 设备不可达/几何不符 |
| 8 | 会话状态冲突（如对 closed 会话 retry、无在录会话却 stop、已有 recording 又 start） |
| 9 | **采集引擎离线**：心跳超时（>10s 未刷新 capture-heartbeat.txt），不写任何令牌，提示手动启动 |
| 10 | 安全中止：canonical 越界/符号链接/未知条目 |
| 11 | 拉取被拒：目标会话非 closed（recording/failed/discarded） |
| 12 | **回执超时（v1.1）**：15s 内未读到本次 rid 的 `capture-receipts/<rid>.json`；不猜测结果、不自动重发 |

### 5.1 命令定义（写令牌前一律先查心跳，见 5.4；v1.1 全程带 rid/回执）

每个写令牌的子命令（start/stop/retry/list）执行顺序固定：**生成 rid → 查心跳 → 查令牌槽 → 写四段令牌 → 按 rid 轮询回执**；心跳离线直接退出 9，不产生任何文件写入。rid 每次调用新生成（`r<13位时间戳><4位hex>`），不复用。

1. `capture start --serial <s> --scene <id>`
   - 校验 sceneId 白名单；生成 rid；查心跳（离线退出 9）；按 5.3 单槽规则写 `capture:<id>:start:<rid>`；只轮询 `capture-receipts/<rid>.json`（15s，超时退出 12），读到取走并校验回执 ok 与 state=recording，回显 sessionId。
2. `capture stop --serial <s>`
   - 生成 rid；查心跳；按单槽规则写 `capture:-:stop:<rid>`；按 rid 等回执确认 state=closed，回显帧清单与帧数。stop 语义上永远需要可用槽位：引擎一接受令牌立即删文件，忙闲状态只写在 session-manifest 而不占用令牌文件。
3. `capture retry --serial <s> --scene <id>`（bridge 编排的确定性序列，不做成设备侧复合指令）
   - 生成 rid；查心跳 → 读当前会话 manifest 确认其处于 recording/failed（否则退出 8）→ 按单槽规则写 `capture:<id>:retry:<rid>`。设备侧收到后把当前会话整体 `mv` 到 `_discard/<sessionId>/`（同文件系统移动，不逐文件复制、不删除），manifest 置 discarded 写 discardReason，再建全新会话（新 sessionId、序号 001 起）。回执的 `retry` 字段必须带齐新旧两个 sessionId；任一步失败回执 ok=false，PC 整体中止，不产生半套状态。
4. `capture list --serial <s>`
   - 两种方式：默认直接 adb 只读枚举 `capture/` 目录（不依赖引擎在线、不写令牌），输出每个场景下会话的 sessionId、state、frameCount、时间，`_discard` 单独分组，引擎离线时仍可用；需要引擎侧视角时可发 `capture:-:list:<rid>` 走回执。
5. `capture pull --serial <s> [--scene <id>] [--session <sessionId>] [--include-discard]`
   - 纯 adb 只读，不依赖心跳/令牌/回执。**只允许拉 state=closed 的会话**，否则退出 11；recording/failed/discarded 默认跳过并告警，显式 `--include-discard` 才连带拉 `_discard`（供排障，仍不可进工作台）。落到 `_bridge/<instanceId>/capture/<sceneId>/<sessionId>/`，拉完做帧数与 manifest 对账。

### 5.2 设备侧 retry 的安全算法（无递归、无删除）

- 只对 `capture/<sceneId>/` 一级做枚举与白名单判定；待移动目录先 realpath 确认在 capture 子树内、非符号链接。
- 移动是单次目录 `mv`（同 fs 原子改名），不使用 cp+rm、不通配、不递归删；`_discard` 不存在则 mkdir 后复核。
- 移动后只改 manifest 的 state/discardReason/endedAt（tmp+rename），不改任何帧文件。
- 未知命名条目跳过告警，绝不处理（契约第 5 节同款保守原则）。

### 5.3 单槽令牌：拒绝覆盖、同令幂等（v1 不做命令队列）

- 物理事实：capture-task.txt 是单文件单槽，引擎每 3 秒轮询，**一接受令牌就立即删除文件**；会话忙闲只写在 session-manifest，不长期占用令牌文件，因此 stop/retry 在正常节奏下始终有槽可用。
- bridge 写新令牌前先探测文件是否存在（比较含 rid 的整份令牌文本）：
  - 不存在 → 直接写入。
  - 已存在且与本次**逐字节完全相同（含相同 rid）** → **幂等返回成功**（不重复写、不报错），仅用于同一请求的进程级重试。
  - 已存在但内容不同（含"命令相同但 rid 不同"的新调用）→ **拒绝，退出码 2，不覆盖、不排队、不等待**；错误信息打印现存令牌原文，由操作者决定先 stop 还是 retry。
- v1.1 明确：rid 不同就是一次新请求，引擎不做跨 rid 去重；防重发是 bridge 上层职责。
- v1 明确不做多命令 FIFO 队列，避免乱序执行与"上一条没跑完下一条已入槽"的歧义；需要串行多个动作时由调用方等本次 rid 回执后再发下一条。
- 同一实例 CLI 侧复用现有 `deploy.lock` 思路加 `capture.lock`，防止两个 PC 进程同时探测/写入产生竞争。
- start 时设备侧已存在 recording 会话：引擎拒绝，manifest 不改，回状态 `already-recording`，PC 退出 8；须显式 stop 或 retry。
- 多开实例各自独立 `/sdcard`、独立控制文件与实例 id，串行发令、互不影响；同一 sceneId 可在不同实例各录各的。

### 5.4 常驻引擎、心跳与开机自启

- **形态**：采集 bundle 是常驻脚本（与生产引擎同形态），不是被令牌临时拉起的短命进程——PC 写文件本身无法启动 AutoJs6 脚本。
- **首次启动（仅一次，写操作手册）**：人工在 AutoJs6 里手动运行采集 bundle；随后在 AutoJs6 定时任务里配置「设备开机启动」执行该入口，模拟器重启后引擎自动回来。
- **心跳**：引擎每轮 3 秒轮询时刷新 `/sdcard/Download/autosgs-logs/capture-heartbeat.txt`，内容为当前 epoch 毫秒（tmp+rename 原子写）。
- **在线判定**：bridge 的 start/stop/retry 写令牌前读心跳，距今 >10 秒（允许约 3 个轮询周期抖动）判定引擎离线 → **退出码 9，不写任何令牌**，提示人工启动；list/pull 是纯只读 adb 操作，不查心跳、离线也可用。
- **v1 不做 intent/am 自动拉起 AutoJs6**：未验证的隐式启动不进 v1，代码里预留启动接口位；后续用独立探针确认 AutoJs6 intent 启动可行后再补。这不违反红线——禁令针对拉起游戏 `com.sanguosha.mjz.mi`，拉起 AutoJs6 自身不在禁止范围。
- **崩溃恢复**：引擎异常退出后心跳停摆，会话 manifest 停留 recording；引擎被手动/自启重新拉起时，看门狗把"无引擎归属的 recording"标记为 failed（不自动续录、不自动 retry），等待 PC 处置（见 6.2）。

---

## 6. 失败状态与重录语义（用户硬需求）

### 6.1 失败检测（设备侧自检，不假装成功）

| 原因码 | 触发 | 行为 |
|---|---|---|
| `capture` | root shell/screencap 调用失败（su 不可用、命令异常、黑帧） | 球变红、manifest failed、停止截图；按 4.3 上报，不擅自切投影 |
| `storage` | 目录不可写/磁盘满 | 同上，已存帧保留 |
| `geometry` | 连续几何校验失败（方向/尺寸异常，非 960×540 横屏） | 同上 |
| `io` | 帧写盘或 manifest 原子写失败 | 同上 |
| `heartbeat` | 心跳线程异常退出（看门狗检测） | 球变红，等待令牌，不自行重启 |

- failed 后球**不自动重试、不自行重启会话**，避免在用户不知情时产生混杂帧；只显示红色状态与原因，等 PC `retry` 或 `stop`。
- 所有失败都写 lastError 与时间，manifest 停在 failed；已落盘的帧不删。

### 6.2 retry 语义（PC 一键重录）

- 适用：failed 后重录，或用户主动作废当前段。
- 旧会话整体隔离到 `_discard/`（证据保留、物理不删、不与新会话混帧），新会话新时间戳、序号 001 起、sceneId 不变。
- 只有 closed 会话进入工作台候选；discarded/failed 默认不参与导入，`_discard` 保留到人工确认后再按 AGENTS.md 的逐文件核实流程清理（本方案不提供自动清理）。

---

## 7. 与生产引擎共存方案（具体隔离设计）

### 7.1 进程/引擎隔离（依据 src/lifecycle.js 实测逻辑）

- 生产引擎 `stopOtherEngines` 只 forceStop canonical source 等于 `/storage/emulated/0/脚本/auto-sgs/_main.js` 的引擎（lifecycle.js:4、8-21）。
- 采集 bundle 使用**独立入口路径**，建议 `/storage/emulated/0/脚本/auto-sgs-capture/_capture.js`，canonical 路径不同于 `_main.js`：
  - 生产引擎的 `_isProject` 判定为 false → 不会杀采集球；
  - 采集 bundle **不调用** stopOtherEngines，也不枚举/停止任何其他引擎 → 不会杀生产引擎。
- 两者可同时驻留：生产引擎跑日常时，采集球仍可待命（实际使用上建议采集与自动任务不同时进行，减少注意力干扰；截图链路已解耦，机制上允许共存）。

### 7.2 运行时与资源隔离

- AutoJs6 每个脚本引擎是独立 JS 运行时，全局对象（如 `sgs`）不共享；采集 bundle 用独立命名空间（如 `capture.`），不读写生产引擎变量。
- 截图链路：v1 采集走 root shell `screencap`，**不申请 MediaProjection**，因此与生产引擎 vision 的投影授权不存在争用，也无需"共享屏幕"弹窗；仅在未来无 root 备选方案里才涉及投影（4.3 已登记，v1 不实现）。
- 悬浮窗：各自 WindowManager 视图加不同 tag，孤儿回收只认自己的 tag，互不 removeView。
- 文件：采集只写 `capture/` 子树与自己的 capture-task.txt、capture-heartbeat.txt；生产引擎写 `recipes/`、`run.log`、`task-status*.json`、autotask.txt 等，**两边文件零重叠**，无需共享文件协调（原 R-C3 竞争随独立文件关闭）。
- build 隔离：新增 `capture/` 源码目录与独立构建（如 `tools/build-capture.js`），**不加入 `build.py` MODS**，产物单独部署，不影响 `build/bundle.js`。

---

## 8. 安全红线（采集专用）

1. 采集 bundle 与 bridge capture 子命令**只读游戏画面、只写 capture 子树**：禁止 `click`、`input tap/swipe`、`sendevent`、`am start`、OCR、模板匹配、任何资源消费；红线扫描把这些列为禁止词（与桥接 spec 第 5 节一致）。
2. 不主动拉起游戏、不切前台；用户手动进游戏并操作，球只被动截当前帧。
3. 即使画面出现玉璧/充值弹窗，也只截图记录，不产生任何点击或消费动作；付费拦截仍由未来配方引擎哨兵负责。
4. 路径全部白名单 + canonical 校验；设备侧只写 `capture/` 子树、capture-task.txt、capture-heartbeat.txt 与 capture-receipts/（回执文件名受 rid 正则约束），绝不读写 autotask.txt；retry 只 mv 不 rm，回执清理只删本目录已知命名的最旧文件。
5. 采集数据本地化：帧只落设备 capture/ 与 PC `_bridge/`（已 gitignore），不联网、不进 git、不进 recipes/。
6. 采集产物不是可执行配方：工作台导入后默认全部为待标注物料，必须人工标识别物、补 guard、置 bound 后才能进合法 recipe-package（契约 2.4 闸门不变）。

---

## 9. 工作台对接与最小闭环

### 9.1 导入形态

- `capture pull` 得到的目录（manifest + 有序 PNG）作为工作台"场景帧包"导入：一个会话对应工作台一个逻辑场景的帧序列，帧按 seq 排序、文件名保留序号。
- 工作台 P1 双端化后，导入器读 capture-session manifest，自动绑定 profile `emu-ld-960x540`、帧几何 960×540；仅 closed 会话可选，discarded 不展示在正常导入入口。
- 采集只给帧，**不预生成 point/步骤**（v1 getevent 已降级）；识别物由用户在帧上手工标注，天然满足 fail-closed 与"张数≈步数"的预期。

### 9.2 v1 验收闭环（全程不点游戏）

0. 手动启动一次采集 bundle，确认 capture-heartbeat.txt 每 3 秒刷新；停掉引擎后 `capture start` 应退出 9 且不留下令牌文件。
1. PC `capture start --serial emulator-5554 --scene mail` → 生成 rid、写四段令牌，球显示"邮件 · 000"进入 recording，bridge 只按该 rid 收到回执；引擎未消费前重发**同一 rid 令牌**幂等成功、发不同令牌（含同命令新 rid）退出 2 且原令牌不变。
2. 用户在游戏里逐步操作，每步点一次球，产生 001.png…NNN.png 与 toast 反馈；root screencap 回读校验全部 960×540。
3. 人为制造一次失败条件（如撤销 root 授权或令 screencap 失败）→ 球变红 failed；`capture retry` → 回执 `retry` 字段带齐新旧 sessionId，旧会话进 `_discard`、新会话 001 重计。
4. 正常操作后 `capture stop` → manifest=closed、球收，stop 回执 state=closed。
5. **rid 桩测四项**：① 预置一个延迟的旧 rid 回执文件，新发请求只认自己的 rid、绝不匹配旧文件；② 写入 rid 缺失/非法的损坏令牌，引擎不执行、告警并删文件（退出 2）；③ 删掉本次 rid 回执制造缺失，bridge 15s 后退出 12 且不重发；④ retry 回执含新旧两个 sessionId。
6. `capture list` 在引擎离线时仍能列出 closed 与 discarded 分组；`capture pull` 只拉 closed 会话（非 closed 退出 11）且帧数对账一致；discarded 需 `--include-discard`；回执目录超过 50 个时引擎 reconcile 只删最旧的已知命名文件。
7. 红线扫描确认无注入/点击/拉起游戏命令，生产引擎运行不受影响、不被采集 bundle 停止；全程游戏未被脚本操作。

---

## 10. 真机后续扩展（本轮不实现，仅登记差异）

1. **截图路径**：真机未必有 root，root screencap 主路径可能不可用，届时才启用 MediaProjection 备选（需处理竖屏 letterbox，经 vision.`_normalize` 裁黑边/归一到 2772×1280，见引擎 spec 第 8 节），manifest 的 frame 几何与 profile 改为真机参数；本扩展仅登记，不预先实现。
2. **悬浮窗权限**：TYPE_APPLICATION_OVERLAY 需用户授予"显示在其他应用上层"，真机厂商 ROM 可能额外限制，首次配置要人工确认。
3. **无线 adb**：令牌投递依赖 adb 连接，断连时心跳暂停、球保持当前状态；重连后续传，RSA 换机重配对（桥接 spec 第 8 节）。
4. **目录/命名**：sceneId 白名单与 capture 子树规则不变；实例隔离机制只为模拟器多开设计，真机单设备忽略 instanceId 分目录。
5. getevent 触摸采集在未 root 真机上可能无 `/dev/input` 读权限（见附录 C），真机不承诺该增强。

---

## 11. 待拍板项与风险

### 11.1 决策记录（C1~C8，均已拍板）

| 编号 | 决策点 | 结论 |
|---|---|---|
| C1 | 采集 bundle 入口路径 | 独立 `_capture.js`（与 `_main.js` 平级不同目录），保证 lifecycle 不互杀 |
| C2 | 球上是否保留"结束"小按钮 | 保留（等价 stop 令牌），但不放任何场景管理控件 |
| C3 | retry 后 `_discard` 保留策略 | 永久保留到人工清理，不自动删；list 默认折叠、pull 需显式开关 |
| C4 | pull 是否允许未 closed 会话 | 不允许（退出 11）；排障用 `--include-discard`，recording 一律不拉 |
| C5 | 采集与生产引擎同时运行 | 机制允许、操作上不建议；文档提示错峰使用 |
| C6 | 引擎启动与存活 | 常驻引擎 + 首次手动运行一次 + AutoJs6 开机自启；3 秒刷新 capture-heartbeat.txt；bridge 写令牌前查心跳，>10s 离线退出 9；v1 不做 intent 自动拉起，仅留接口位 |
| C7 | 令牌槽冲突 | 单槽；同内容幂等成功，不同内容拒绝（退出 2）不覆盖不排队；忙闲写 manifest 不占令牌文件，v1 不做命令队列 |
| C8（2026-11-28，协议 v1.1） | requestId 与回执 | 令牌扩为四段 `capture:<scene|->:<cmd>:<rid>`，rid 正则 `^r\d{13}[0-9a-f]{4}$`；回执写 `capture-receipts/<rid>.json`，bridge 只认自己的 rid，15s 超时退出 12；rid 只管回执认亲、不做排队去重，同内容不同 rid 算新请求；回执留最近 50 个，reconcile 按已知命名清最旧 |

### 11.2 风险与未验证

- **R-C1（root screencap 实测）——v1 硬前置**：雷电 Android 7.1.2 上经 AutoJs6 root shell 调 `screencap -p` 的几何（960×540 横屏）、写盘延迟、黑帧率尚未实测；若有坑按 4.3 停下来上报，不悄悄退回 MediaProjection。原"双引擎投影授权争用"风险因改用 root 路径而消除。
- **R-C2（overlay 与游戏焦点）**：悬浮球在 Cocos 全屏游戏上的触摸穿透/遮挡需模拟器点测；用 FLAG_NOT_FOCUSABLE + 贴边小窗缓解。
- **R-C3（autotask 共享竞争）——已关闭**：生产心跳/冒烟均"先读后删再判内容"（build.py:212-214、173-175），共文件方案不成立；拍板改用独立 capture-task.txt，文件级隔离，无读-删竞争，桥接 spec 2.4 的 autotask 语义不受影响。
- **R-C4（心跳延迟与误判离线）**：3 秒轮询决定 start/stop 最坏约 3 秒延迟（点球截图本身即时）；10 秒离线阈值容忍约 3 个周期抖动，但模拟器卡顿时可能误判，bridge 退出 9 后只提示手动启动、不写令牌，不会造成错误状态，重试即可。
- **R-C5（会话体量）**：张数≈步数已天然受控；仍设单会话帧数软上限（建议 200），超出提示封帧开新会话，防异常连点刷屏。
- **R-C6（崩溃对账）**：bundle 异常退出后心跳停摆、会话停留 recording；引擎重新拉起（手动/开机自启）时看门狗把"无主人的 recording"标记为 failed 待处置，不自动续录、不自动 retry。
- **R-C7（开机自启可靠性）**：AutoJs6 定时任务"设备开机启动"在雷电上的生效情况需实测；自启失败时 capture 命令会以退出 9 暴露，人工补一次手动启动即可，不静默失败。
- **R-C8（intent 自动拉起挂起）**：v1 预留接口但不实现 intent 拉起 AutoJs6；待独立探针验证后单独立项，避免未验证的隐式启动进 v1。

---

## 附录 A：与既有 spec 的关系

- 本文档取代 v1 录制 spec 的主线设计；`RECIPE-PACKAGE-CONTRACT` 的包格式/退出码/清理原则、`WORKBENCH-BRIDGE-SPEC` 的 adb 管道仍然有效。本方案新增独立控制文件 capture-task.txt、心跳文件 capture-heartbeat.txt 与 `capture/` 子树，**不改动 autotask.txt 与生产心跳**，不修改既有契约字段。
- 采集产物不是 recipe-package，不适用 manifest.files 哈希契约；其自身 session-manifest 是独立的小 schema（4.2）。

## 附录 B：已降级方案——定时连续截帧（burst）

- v1 的 PC 侧定时 burst（默认 1s、最小 500ms、600 帧上限）被用户明确否决（截图量过大）。**不再作为主线**；仅在"无人值守复现偶现界面问题"的特殊排障场景，作为 bridge 的隐藏可选参数保留设计，不进入采集 v1，默认不可用。

## 附录 C：已降级方案——getevent 触摸坐标采集

- 2026-11-27 模拟器只读探测（emulator-5554）：触摸屏 `/dev/input/event3`（name "input"），`ABS_MT_POSITION_X` 0–959、Y 0–539，与显示 960×540 **1:1**，理论校准残差接近 0；存在 `ABS_MT_TRACKING_ID(0039)`，提示多点协议 B；普通 adb shell（未 su）即可 `getevent -p`，事件流读取权限仍待人工五点探针确认。
- 因用户选择悬浮球手工点球模式，getevent 自动录坐标**降级为未来可选增强**：若日后需要"自动生成 point 草稿"，再基于上述探测数据单独立项，仍遵守草稿强制 draft、必须补 guard、禁止回放的红线；当前 v1 不实现任何 getevent 解析。

## 附录 D：已降级方案——PC 守望/开始停止信号

- "PC 侧守望进程 + 开始/停止信号"与用户"全程零对话零干扰、打开游戏就正常玩"的约束冲突，已弃用；场景绑定收敛为 PC 一次性 `capture start`，游戏内不再有任何对话式交互。
