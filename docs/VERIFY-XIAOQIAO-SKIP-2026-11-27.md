# bounded-skip 部署与真机验收（2026-11-27 15:16–15:21）

- 设备 M332BF；账号「血域魔神」（贵族7，120 级）；版本 `738dbbe8…`/185303（提交 `119efa8 fix: bound xiaoqiao idle wait`）
- 对照旧版：14:34 同账号 daily 小乔卡 420 秒超时 failed，整轮 447.6 秒 partial
- 全程游戏前台、autotask 投递、无人工点击游戏；零玉璧/充值事件、零资源扣减

## 一、部署（四件套之证据链）

| 项 | MD5 | 大小 |
|---|---|---|
| 备份旧版 `_shot/phone-main-predeploy3-20261127.js` | `fe261cbb7a95ec883bff317371c5eee7` | 184716 |
| 本地/手机/回拉三方一致 | `738dbbe8b0d63ac02d4651fdcf39db09` | 185303 |

- reload 热重载：logcat 15:16:26/33/39 三次 `申请截图 结果=false`（后台引擎预期行为，非故障）；未重复 reload、未 force-stop
- 用户前台手动授权后，15:17:51 `申请截图 第1次 结果=true`；shot 自检 2772×1280 正常，单球单状态条，小乔控件 fallback 0.9524 HIT，账号血域魔神确认

## 二、daily 真机时间线（投于 15:19:25）

| 时刻/耗时 | 事件 | 结果 |
|---|---|---|
| 15:19:32→15:19:37（5.2s） | 邮件：入口→全部领取 2 轮→关窗回城 | **skipped「已识别无可领取邮件，返回主城」**（homeRecovered=true） |
| 15:19:46 起 | 小乔：头像 0.9 命中 (19,490)→面板→日常 Tab（第 1 轮图识别未命中，第 2 轮过）→识别开启钮→点击 (1968,883) | — |
| 点开启后约 60s | 无任何正向信号，日志「**小乔 60 秒无执行信号，按无任务跳过**」 | 进入有界跳过 |
| 随后 | 「点击面板关闭（第 1 轮）」→「已确认回到主城」 | 复用 `_closeResult()`，无盲点 |
| 15:21:09（小乔 83.2s） | 小乔结果 | **skipped「开启后 60 秒无执行信号，按官方新规则判定今日已完成并跳过」** |
| 15:21:13（整轮 105.2s） | 汇总 | **「一键日常 成功 0 / 跳过 2」，status=success，aborted=false** |

- daily-last-result.json：counts `{success:0, skipped:2, unconfirmed:0, failed:0, not_run:0, cancelled:0}`，**failed=0、流程未中止**（注：本机 PowerShell 拉取显示中文乱码，文件本身 UTF-8，run.log 中文完好）
- 对比：旧版小乔单任务 421.5s failed；新版小乔 83.2s skipped（其中固定有界等待 60s），整轮从 447.6s 降到 **105.2s**

## 三、预期 vs 实际（验收判据逐项）

| 判据 | 预期 | 实际 |
|---|---|---|
| 小乔不再等满 420s | 60–70s 窗口内收尾 | 点开启后准点 60s 触发跳过，小乔总 83s（含面板/Tab/回城）✅ |
| 不再 failed | skipped | skipped，failed=0 ✅ |
| 含「60 秒无执行信号」日志 | 有 | run.log 原文一致 ✅ |
| 主动关面板+严格回城 | 是 | 面板关闭 1 轮 + 回城确认，锚点 0.9419 ✅ |
| 后续不中止、计数含 skipped | 是 | aborted=false，skipped:2 ✅ |
| 真异常仍 failed | 保留 | 代码路径保留，本次无异常触发 ✅ |
| 资源无异常扣减 | 是 | 体力 605、精力 95、元宝 660338 与任务前逐项相同 ✅ |
| 玉璧/充值事件 | 0 | 0（「充值」仅常驻图标）✅ |
| 悬浮窗/调视图/残留 | 单球单条、≤20、无残留 | ball+status 各一、20 张轮转、autotask clean、active=null ✅ |

## 四、附带覆盖

- **邮件空态分支首次真机覆盖**：本次邮件走 skipped「无可领取邮件」，是 EMPTY_PATTERNS 空态路径的首次真机命中（上午三轮均为 reward success）。具体命中哪条正则未在日志细分，不做过度断言
- 绿勾 claimed 分支仍无真机帧，继续挂账
- bounded-skip 仅改等待与收尾，奖励/绿条/再次执行兼容路径代码保留，真实执行路径待有任务的账号/时段再验

## 五、证据与复现

- 证据：`_shot/skip-selfcheck-20261127.png`、`skip-daily-final-20261127.png`、`skip-daily-result.json`、`skip-task-status.json`、`skip-final-res.png`；手机 run.log 本段
- 复现：备份比对 → push 三方哈希 → 前台授权 → `echo -n daily > autotask.txt` → 轮询 run.log 至「成功 0/跳过 2」→ 拉 JSON + exec-out 终态截图 + dumpsys 数窗口
- 结论：**bounded-skip 验收通过**，可关闭 `TASKSPEC-2026-11-27-xiaoqiao-bounded-skip.md`；小乔在官方新规则下不再拖垮 daily
