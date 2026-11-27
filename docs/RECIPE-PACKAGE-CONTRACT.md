# 配方包契约（RECIPE-PACKAGE-CONTRACT）

- 日期：2026-11-27
- 作者：游戏调研（只设计，不写生产代码）
- 地位：**冻结契约，单一事实源**。`docs/WORKBENCH-ENGINE-SPEC.md` 第 1 节与 `docs/WORKBENCH-BRIDGE-SPEC.md` 第 2、5、6 节中凡涉及包格式、哈希清单、设备侧清理、校验顺序处，均以本文档为准；两份 spec 只做引用，不另立格式。
- 本轮适用范围：雷电模拟器 profile `emu-ld-960x540`（帧 960×540）。真机 profile 未来沿用同一契约，仅 profile id 与帧几何不同。
- 背景：代码落地实现 Gate1 时发现两处契约缺口——manifest 字段未精确化、旧包清理无安全算法。本文档补齐到可直接编码的粒度。

---

## 1. 包内布局与命名

### 1.1 电脑侧源包（工作台导出 / 测试夹具生成）

```
<package-root>/
├── manifest.json
├── recipe.json
└── assets/
    └── <profile-id>/            # 如 emu-ld-960x540/
        └── <相对路径模板文件>     # 如 daily_task/youjian.png
```

- 包内只允许三类成员：根文件 `manifest.json`、根文件 `recipe.json`、`assets/` 前缀目录。任何其他顶层文件/目录校验失败。
- 包内**路径一律不出现中文**（中文只存在于 recipe.json 的文本字段里），规避设备文件编码差异。
- `.nomedia` 不属于包内容：由 CLI 在设备侧 recipes/ 根与截图目录维护，不进 manifest 清单。

### 1.2 设备侧部署布局（桥接 spec B3 已拍板）

```
/sdcard/Download/autosgs-logs/recipes/
├── .nomedia
├── current.txt                  # 指针，单行 = 当前生效包目录名
├── pkg-YYYYMMDD-HHMMSS/         # 版本目录，同 fs 内由 staging mv 而来
├── pkg-YYYYMMDD-HHMMSS/
└── .staging-YYYYMMDD-HHMMSS/    # 部署暂存（同机同串行，CLI 持有部署锁）
```

实例标识文件 `instance.txt` 位于 `autosgs-logs/` 根（recipes/ 之外），内容为单行 instance id。

---

## 2. manifest.json 精确 schema

### 2.1 完整字段

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `schema` | string | 是 | 固定常量 `"sgs-workbench/recipe-package"`，不符即拒 |
| `schemaVersion` | number | 是 | 当前 `1`；引擎/CLI 只接受 ≤ 自身支持版本的包，更高版本拒绝（不猜测） |
| `packageId` | string | 是 | 与部署目录名一致，正则 `^pkg-[0-9]{8}-[0-9]{6}$` |
| `exportedAt` | string | 是 | ISO 8601 带时区时间戳，仅作记录，不参与逻辑判断 |
| `profiles` | array | 是 | 非空；元素 `{id,label,frame:{width,height},ratio}`；`id` 正则 `^[a-z0-9-]+$`；本轮必须含 `emu-ld-960x540` 且 frame=960×540 |
| `scenes` | array | 是 | 元素 `{id,name,section,profileStatus,consumes}`；`id` 正则 `^[a-z0-9_-]+$`；`profileStatus` 以 profile id 为键，值枚举 `bound/draft/missing` |
| `files` | array | 是 | 哈希清单，见 2.3；至少含 `recipe.json` 一条 |

### 2.2 最小示例（Gate1 夹具：一个 scene、point+roi 各一、emu profile、无模板素材）

```json
{
  "schema": "sgs-workbench/recipe-package",
  "schemaVersion": 1,
  "packageId": "pkg-20261127-220000",
  "exportedAt": "2026-11-27T22:00:00+08:00",
  "profiles": [
    { "id": "emu-ld-960x540", "label": "雷电模拟器 960×540",
      "frame": { "width": 960, "height": 540 }, "ratio": 1.7778 }
  ],
  "scenes": [
    {
      "id": "fixture_probe",
      "name": "打通夹具（不执行）",
      "section": "daily",
      "profileStatus": { "emu-ld-960x540": "bound" },
      "consumes": { "stamina": false, "energy": false, "sycee": false,
                    "fodder": false, "jadeOrPay": false }
    }
  ],
  "files": [
    { "path": "recipe.json",
      "sha256": "9f2c7a1e4b8d6f0a3c5e7b9d1f2a4c6e8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f80",
      "bytes": 2048 }
  ]
}
```

无模板素材时 `files` 只有 recipe.json 一条，是合法最小包；含素材时追加 `assets/...` 条目。

### 2.3 files[] 哈希清单规则

1. 元素形态固定为 `{ "path": <相对路径>, "sha256": <64位小写hex>, "bytes": <非负整数> }`，三字段必填。
2. `path` 规则（逐条校验，任一不过整包拒绝）：
   - 正斜杠 `/` 分隔的相对路径，禁止前导 `/`、反斜杠 `\`、空段、`.` 与 `..` 段；
   - 每个路径段匹配 `^[a-z0-9._-]+$`；路径总长 ≤200 字符；
   - 要么恰好等于 `"recipe.json"`，要么以 `"assets/<profiles[].id>/"` 为前缀，且该 profile id 必须在 `profiles` 中声明；
   - 清单按 `path` 字典序排列、不得重复。
3. **recipe.json 计入清单**（它是被校验对象，哈希自包含于 manifest）。
4. **manifest.json 不计入清单**：它是信任根，无法自哈希。其完整性由部署流程保证——CLI 在 PC 侧先算 manifest.json 的 sha256 记入部署日志，push 后在设备侧 `sha256sum` 回读比对（见 4.2 第 4 步）。
5. `bytes` 与 `sha256` 任一不符即拒；sha256 统一小写 hex，大小写不匹配按不符处理。

### 2.4 recipe.json 与 manifest 的交叉校验

CLI 本地预校验必须确认：

1. recipe.json 可解析，其 `scenes[].id` 集合与 manifest.scenes 的 id 集合完全一致（不多不少）。
2. 目标 profile（本轮 `emu-ld-960x540`）下，manifest 中每个 scene 的 `profileStatus` 都是 `bound`；出现 `draft/missing` 即拒（引擎 spec 0.3.5 的绑定闸门前置到部署期）。
3. recipe 内 element binding 引用的每个模板 asset 路径，都能在 `files[].path` 中找到；`files` 中每个 `assets/` 文件也必须至少被一个 binding 引用（孤儿素材告警，MVP 阶段可降级为警告不阻断，但要在输出中列出）。
4. 所有 binding 坐标落在声明 profile 的 frame 内（960×540），越界即拒。
5. 任何场景 `consumes.jadeOrPay === true` 即拒（引擎 spec 5.1 红线在数据层的体现）。

---

## 3. current.txt 与 instance.txt 契约

- `current.txt`：UTF-8/ASCII，单行内容为版本目录名（匹配 `^pkg-[0-9]{8}-[0-9]{6}$`），允许且仅允许一个结尾换行；指针值不合法时引擎与清理逻辑一律 fail-closed，不猜测"最新目录"。
- `instance.txt`：单行 instance id，匹配 `^[a-z0-9-]+$`（桥接 spec B2：`emulator-5554` → `ld-5554`），允许一个结尾换行。
- 两文件都采用 tmp+rename 原子写：先写 `<name>.tmp`（同目录），校验 tmp 内容后 `mv` 覆盖目标。
- 设备侧读取任一字段前先过上述正则；正则不过按文件损坏处理，拒绝继续并报具体文件名。

---

## 4. 校验流程与退出码

### 4.1 CLI 退出码约定（全工具统一）

| 码 | 含义 |
|---|---|
| 0 | 成功（含带告警的成功，告警走 stderr，不改变退出码） |
| 2 | 用法/配置错误：参数缺失、adb 路径无效、无匹配设备 |
| 3 | 包校验失败：schema/字段/路径白名单/哈希/引用/绑定状态任一不过（**任何设备写入之前**失败） |
| 4 | 设备通信或几何错误：adb 不可达、帧非 960×540 横屏、realpath 根校验不过 |
| 5 | 设备回读哈希不一致：传输损坏，指针不切换 |
| 6 | 原子切换失败：mv 或 current.txt rename 失败 |
| 7 | 清理失败：部署已生效但旧包/prune 未完成（结果仍可用，输出残留清单） |
| 8 | 回退失败：无合法上一版本或指针损坏 |
| 10 | 安全中止：canonical 越界、符号链接、未知条目阻挡等红线触发 |

### 4.2 deploy 步骤顺序（严格按序，前一步不过不进下一步）

**A. PC 本地预校验（全部离线，失败退出 3，零设备写入）**

1. 参数与包目录存在性；manifest.json、recipe.json 可读、可解析。
2. manifest 结构校验：schema 常量、schemaVersion 支持范围、packageId/profiles/scenes/files 字段与正则（第 2 节）。
3. files 清单校验：路径白名单、排序、去重、sha256 格式、bytes 非负。
4. 逐文件本地验 hash：实际 sha256 与 bytes 对清单；含 recipe.json 自身。
5. 第 2.4 节全部交叉校验（场景集合、bound 闸门、asset 引用闭环、坐标越界、付费红线）。
6. 计算并缓存 manifest.json 自身的 sha256，供设备回读比对。

**B. 设备探测（失败退出 4，仍零写入）**

7. `adb devices` 解析目标 serial 且状态 device；探一帧 screencap 校验 PNG 魔数与 960×540。
8. `realpath` recipes 根，必须等于 `/storage/emulated/0/Download/autosgs-logs/recipes`；根缺失则 `mkdir` 后复核（mkdir 目标同样过白名单与 realpath）。

**C. 暂存与回读（失败退出 5，不动 current.txt）**

9. 生成与 packageId 同名的暂存目录 `.staging-<ts>`（ts 取本机时间，格式 YYYYMMDD-HHMMSS），整包 push 入内；manifest 最后 push（无 manifest 的暂存目录天然视为不完整）。
10. 设备侧对暂存 manifest 跑 `sha256sum` 与 PC 缓存值比对。
11. 按 manifest.files 逐条设备侧 `sha256sum`，比对哈希与字节数；任一不符退出 5，保留暂存目录供取证，不切指针。

**D. 原子生效（失败退出 6）**

12. 同文件系统 `mv .staging-<ts> pkg-<ts>`（目录名 = packageId）。
13. tmp+rename 写 `current.txt` 指向新包目录名；写后回读并正则校验。
14. tmp+rename 写/更新 `instance.txt`（内容 = 派生 instance id），回读校验。

**E. 清理（best effort，失败退出 7，不回滚已生效部署）**

15. 执行第 5 节 prune 算法；残留与告警逐项打印。

### 4.3 rollback 步骤顺序

1. realpath 根校验（不过退出 4）。
2. 读 current.txt 并正则校验；损坏则退出 8，禁止"自动选最新"。
3. 枚举一级 `pkg-*` 白名单目录（第 5 节枚举规则），按时间戳名降序；排除当前指针后，取第一个 manifest 存在且设备侧哈希自检通过的包为回退目标；无则退出 8。
4. tmp+rename 把 current.txt 改写为目标目录名，回读校验（失败退出 6）。
5. 执行 prune（失败退出 7）。

### 4.4 设备侧只读校验脚本（Gate2，桥接 spec B6 已许可）的校验项

与 4.2-A/C 同源、在设备上独立复现：schema/版本、profile 几何（现场 screencap 一帧比对 960×540）、manifest 回读哈希、files 全量 sha256、2.4 交叉校验、current.txt 正则与指向存在性。输出 `{ok:false,reason:...}` 结构化结果；只读，不点击、不 OCR、不写 recipes/ 之外路径。

---

## 5. 旧包清理安全算法（无递归、无通配、不出 recipes/）

### 5.1 红线

- 永不使用 `rm -r`、`rm -rf`、通配符 `rm *`、`find -delete` 或任何等价递归删除。
- 永不触碰 `recipes/` 子树之外的任何路径；已知保留文件 `current.txt`、`instance.txt`、`.nomedia` 不参与删除。
- 未知命名、符号链接、realpath 越界：**跳过并告警，绝不删除**。

### 5.2 枚举（只看一级，不递归列目录）

1. 先 `realpath` recipes 根并核对预期 canonical 路径，不过则整体中止（退出 10）。
2. 对 recipes 根做**一级列举**（`ls -1`，不带 `-R`），每个 entry 独立分类：
   - 正则 `^pkg-[0-9]{8}-[0-9]{6}$` → 候选版本包；
   - 正则 `^\.staging-[0-9]{8}-[0-9]{6}$` → 候选暂存；
   - `current.txt` / `instance.txt` / `.nomedia` → 保留；
   - 其余一切 → 未知条目，跳过 + 告警（退出码 7 的告警来源之一）。
3. 对每个候选 entry 跑 `realpath` 与符号链接检查（`ls -ld` 输出含 `->` 或首字符 `l`）：解析结果必须仍在 recipes 根之内且不是符号链接，否则跳过 + 告警（退出 10 若判定为越界企图）。

### 5.3 保护集合

1. 读 current.txt（正则校验），其指向的 pkg 目录为**当前包，永远保护**；指针损坏则中止清理（退出 8/10），不删任何包。
2. 其余合法 pkg 目录按时间戳名降序排列，保留当前包之外最新的 N-1 个（**N=3，即总共保留 3 个 pkg 目录**）；更旧的进入待删集合。
3. staging 目录：默认不自动清理。仅两种情况删除——(a) 本次 deploy 自己创建的暂存在部署失败回滚时清理；(b) 暂存内存在**完整且哈希自检通过的 manifest** 时可按 5.4 流程 prune。无 manifest 的孤儿暂存一律只告警、列路径，交人工处理（fail-closed，不做递归枚举兜底）。

### 5.4 逐文件删除（清单驱动，不用递归）

对每个待删 pkg 目录：

1. 读其 `manifest.json`；不可读/不可解析/哈希自检不过 → 放弃该目录，告警保留，继续处理下一个。
2. 以 manifest.files 为**唯一删除清单**：对每个 `path`
   - 再过一次 2.3 路径白名单；
   - 拼出设备绝对路径后 `realpath`，确认仍位于该 pkg 目录之内；
   - 对单文件执行 `rm <绝对路径>`（无 `-r`、无通配）。
3. 显式删除该包的 `manifest.json`（固定已知文件名，同样先 realpath）。
4. 收集清单中所有文件的父目录，去重后按路径深度**从深到浅**排序，逐个 `rmdir`（rmdir 只能删空目录）：
   - 出现非空 rmdir 失败，说明目录里存在 manifest 清单之外的未知文件——立即停止该包的清理、保留目录、告警列差异，**未知文件永不删除**；
   - 最后 `rmdir` pkg 根目录。
5. 全过程每一步的路径与结果写部署日志，便于审计。

### 5.5 暂存目录删除的特例

满足 5.3-3(b) 的暂存目录，按 5.4 同一流程（以其 manifest 为清单）删除；本次部署自建暂存的失败回滚，PC 侧持有完整 push 文件清单，直接以该清单走 5.4 第 2~4 步，不依赖设备枚举。

---

## 6. 与两份 spec 的衔接

- 引擎 spec 1.2 的目录包布局、1.4 的加载校验、0.3.5 的引用完整性：本文档第 2、4 节是其精确化，字段命名保持一致（schema/schemaVersion/profiles/scenes/files、bound/draft/missing）。
- 桥接 spec 2.2 的部署分步、5.2 第 3/4 条哈希与清理红线、6.1 Gate1 验收：本文档第 4、5 节是其操作级定义；退出码与 staging 规则为新增冻结内容。
- 本契约后续任何字段新增只能走 schemaVersion 升级 + 文档变更评审，不允许实现侧私扩字段。
