# 本地加固任务 spec（2026-11-27）

- 派发：**Chief**；承接：**码工（Codex，sol 6.1 low）**。
- 性质：纯本地任务，**禁止连接真机、禁止 adb、禁止任何游戏操作**。
- 基线：`main` HEAD `15899e7`，工作区干净。
- 交接：完成后按四件套（预期 / 实际 / 证据 / 复现）在群里回报。

## 背景

只读盘点（见 [READONLY-INVENTORY-2026-11-27](READONLY-INVENTORY-2026-11-27.md)）发现两个可纯本地修复的问题：

1. `run.log` 历史中截图权限 5 秒超时共 9 次，均为启动脚本时 AutoJs6 不在前台导致；其中 14:58 一次还伴随悬浮窗权限被拒。现有逻辑只做单次 `requestScreenCapture`，失败后要等后续 `frame()` 被动触发 `init()`，没有主动重试、退避和面向用户的明确提示。
2. 运行器内存日志数组 `LOGS` 只 push 不裁剪，长时间运行无界增长（文件日志已有 1MB 轮转，内存侧没有）。

## 任务一：启动期截图权限加固

位置：[`src/vision.js`](../src/vision.js) 的 `init()` / `_autoGrant()`（当前 L12–L65）。

### 现状（先读代码确认，行号可能偏移）

- `init()` 调一次 `_autoGrant(land)`；后者起 18 秒无障碍授权线程（只在 `com.android.systemui` 找「共享屏幕」），随后单次 `requestScreenCapture(land)`，失败即返回 false。
- 失败后没有 toast 提示，重试只发生在后续 `frame()` → `init()` 的被动路径上，无次数上限、无退避。

### 要求

1. 在 `init()` 内实现**有界主动重试**：最多 3 次申请，每次失败后短暂退避（如 800ms）再试；重试期间保留现有授权线程机制，不要拆掉。
2. 首次失败时用 `toast` 给出明确中文提示，例如「截图权限未授予，请把 AutoJs6 切到前台」，同时 `sgs.log.w` 留痕；最终全失败时 log.e 并保持 `_capOk=false`，不得静默假成功。
3. 成功后立即停止重试，行为与现在一致；不改变横屏强制（`_landForce`）逻辑、不改变 `frame()` 的缓存与克隆语义。
4. 授权按钮查找仍限定 `packageName("com.android.systemui")`，不许放宽到全局文字匹配。
5. 不触碰任何任务模块和消费流程。

### 验收

- 扩展 `tests/permission-dialog.js`：覆盖「首次失败、二次成功」「三次全失败」「requestScreenCapture 抛异常」三个路径，断言 toast/日志调用次数与最终 `_capOk` 状态。
- `node tools/build.js`、`node --check build/bundle.js`、`node tests/regression.js` 及全部既有测试通过。

## 任务二：内存日志 LOGS 有界化

位置：[`tools/build.py`](../tools/build.py) 的 `LOGBLOCK`（当前 L49–L96 附近），改的是构建器模板，**不许只改生成后的 bundle**。

### 现状

- `var LOGS = []`，`sgs.log.i/w/e` 无条件 `LOGS.push(s)`；推送时 `chunk = LOGS.slice(pushedIdx)`，靠 `pushedIdx` 记录已推位置。
- 文件日志 `appendFile` 已有 1MB + `.1` 轮转，不动它。

### 要求

1. `LOGS` 改为有界缓冲：上限 2000 条（提为常量 `LOG_MEM_MAX`），超出时丢弃最旧条目。
2. **正确处理 `pushedIdx`**：丢弃头部后，已推送索引必须同步收敛，保证电脑端在线时既不漏推也不重复推。建议把推送位置改为基于缓冲内有效偏移并随截断调整；自行评估更简洁的等价方案，但必须用测试证明。
3. `pushFail` 三次熔断、离线直接跳过推送等既有语义保持不变。
4. 注意截断发生在 `log.i/w/e` 调用链内，推送函数在同一运行器上下文，避免引入递归或重入问题。

### 验收

- 在 `tests/` 下新增专项测试（或在 regression 中新增成组用例，自行选择并说明），用注入的虚拟日志/推送捕获验证：
  - 未超限：行为与现在完全一致，推送内容顺序正确；
  - 超限截断：缓冲不超过 2000 条，最旧条目被丢；
  - 截断时电脑端在线：不丢未推日志、不重复推送；
  - 离线（`!sgs.PC`）路径不报错。
- `node tools/build.js` 重建、`node --check build/bundle.js`、全套测试通过、`git diff --check` 干净。

## 通用约束

- 只改 `src/` 和 `tools/build.py` 等源文件，构建产物随重建更新；提交信息沿用仓库风格。
- 两个任务可拆两个提交，每个提交自身保证构建和测试通过。
- 不做 spec 外的顺手重构；发现新问题先在群里提，不自行扩大范围。
- 完成后回报四件套，并列出修改文件、测试命令与结果、新增测试断言计数。
