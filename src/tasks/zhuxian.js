// tasks/zhuxian.js —— 主线副本·最新回一键扫荡
// 流程（2772x1280 真机实测 2026-11-25）：
//   主城征战 → 副本地图（默认定位最新回）→ 点最新回建筑 → 点 BOSS 角色本体
//   → 战斗面板读「挑战次数 N/5」→ 0 次时按 allowReset 决定是否花 20 元宝重置
//   → 点「扫荡N次」→ 等「扫荡战报」→ 关弹窗关面板 → 逐次返回，isHome 确认回主城
// 注意：
//   1. BOSS 名字标签不可点，必须点角色本体 (2290,800)，点标签无反应
//   2. 扫荡按钮文字随剩余次数变化（扫荡1次~扫荡5次），用 OCR 判「扫荡」关键词，不做固定文字模板
//   3. 「重置」与「扫荡N次」互斥同位：次数 0/5 时显示重置，>0 时显示扫荡
//   4. 未三星通关的关卡没有扫荡入口，识别不到一律 fail-closed，绝不自动点「挑战」进手动战斗
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.zhuxian = {
    id: "zhuxian",
    name: "主线副本扫荡",

    // 次数耗尽时是否允许花 20 元宝重置（一天最多 4 次）。
    // 用户已明确授权元宝消费，默认开；要保守挂机改成 false 即可，0/5 时直接报错退出。
    allowReset: true,

    // ---- 坐标（真机实测）----
    ENTER_ZHENGZHAN: [2625, 1150],   // 主城右下「征战」
    STAGE_BUILDING: [1450, 820],     // 地图页最新回建筑
    BOSS_BODY: [2290, 800],          // BOSS 角色本体（名字标签点了没反应）
    SWEEP_BTN: [1955, 885],          // 扫荡N次 / 重置（互斥同位）
    RESET_CONFIRM: [1586, 865],      // 重置确认弹窗「确认」
    BLUE_X: [2205, 215],             // 战报与 BOSS 面板共用的蓝色菱形 X
    BACK_ARROW: [110, 70],           // 左上红色返回

    // ---- OCR ROI [左,上,右,下] ----
    // 左上大标题是书法体金字，ML Kit 认不出；判据一律用印刷体 UI 文字
    MAP_TAB_REGION: [1820, 10, 2090, 95],       // 地图页右上选中 Tab「主线副本」
    MAP_SKIP_REGION: [2380, 1190, 2620, 1260],  // 地图页右下「跳过剧情」
    STAGE_RANK_REGION: [150, 1150, 430, 1275],  // 回详情页左下「排行榜」（地图页没有）
    STAGE_STAR_REGION: [1620, 1170, 1830, 1270],// 回详情页底部星数「30/30」
    ATTEMPT_REGION: [950, 415, 1260, 500],      // 「次数： N/5」（「挑战」二字被枪图形遮挡，勿用全词）
    CONDITION_REGION: [900, 520, 1450, 590],    // 「三星条件：主公未阵亡」，面板兜底判据
    SWEEP_REGION: [1780, 800, 2145, 960],       // 扫荡/重置按钮
    RESET_DIALOG_REGION: [1050, 520, 1750, 680],// 「是否花费20元宝重置副本」
    REPORT_TITLE_REGION: [1150, 85, 1650, 180], // 「扫荡战报」
    REPORT_SUM_REGION: [950, 760, 1850, 900],   // 「总计获得」金色条（实测在战报弹窗约 2/3 高度处）
    CENTER_DIALOG_REGION: [900, 500, 1900, 800],// 体力不足等居中弹窗

    /** 读战斗面板上的剩余挑战次数，返回 N（0~5），读不到返回 -1 */
    _readAttempts: function () {
        var v = sgs.vision;
        var t = v.ocrRect(this.ATTEMPT_REGION, v.frame(true)).replace(/\s+/g, "");
        var m = t.match(/(\d+)\s*\/\s*5/);
        if (!m) {
            sgs.log.w("[zhuxian] 挑战次数 OCR 原文=「" + t + "」");
            return -1;
        }
        return parseInt(m[1], 10);
    },

    /** 战斗面板是否在前台：「挑战」二字被枪图形遮挡，判「次数 N/5」分数或「三星条件」 */
    _panelOpen: function () {
        var v = sgs.vision;
        var im = v.frame(true);
        var t = v.ocrRect(this.ATTEMPT_REGION, im).replace(/\s+/g, "");
        if (t.indexOf("次数") >= 0 || /\d+\s*\/\s*5/.test(t)) return true;
        return v.hasText("三星条件", this.CONDITION_REGION, im);
    },

    /** 等战斗面板出现 */
    _waitPanel: function (timeoutSec) {
        var t0 = new Date().getTime();
        while (new Date().getTime() - t0 < timeoutSec * 1000) {
            if (this._panelOpen()) return true;
            sleep(700);
        }
        return false;
    },

    /** 等扫荡战报，期间识别体力不足等拒绝弹窗 */
    _waitReport: function (timeoutSec) {
        var v = sgs.vision;
        var t0 = new Date().getTime();
        while (new Date().getTime() - t0 < timeoutSec * 1000) {
            if (v.hasText("扫荡战报", this.REPORT_TITLE_REGION)) return "report";
            if (v.hasText("体力不足", this.CENTER_DIALOG_REGION)) return "no_stamina";
            sleep(700);
        }
        return "timeout";
    },

    run: function (options) {
        var v = sgs.vision;
        var check = options && options.checkCancelled ? options.checkCancelled : function () { };
        var allowReset = options && typeof options.allowReset === "boolean" ? options.allowReset : this.allowReset;
        var summary = { reset: false, attemptsBefore: -1, swept: 0 };
        check();

        // 1) 主城 → 征战 → 副本地图
        check();
        v.clickPointAt(this.ENTER_ZHENGZHAN[0], this.ENTER_ZHENGZHAN[1]);
        sgs.log.i("[zhuxian] 点击征战入口");
        var t0 = new Date().getTime();
        var onMap = false;
        while (new Date().getTime() - t0 < sgs.TIMEOUT.page) {
            var im = v.frame(true);
            // 两个印刷体判据任一命中即可：右上选中 Tab 或右下「跳过剧情」
            if (v.hasText("主线副本", this.MAP_TAB_REGION, im)
                || v.hasText("跳过剧情", this.MAP_SKIP_REGION, im)) { onMap = true; break; }
            sleep(700);
        }
        if (!onMap) throw new Error("点击征战后未进入主线副本地图");
        sgs.log.i("[zhuxian] 已进入主线副本地图");

        // 2) 点最新回建筑 → 回详情页（左下出现「排行榜」，地图页没有此入口）
        check();
        v.clickPointAt(this.STAGE_BUILDING[0], this.STAGE_BUILDING[1]);
        sgs.log.i("[zhuxian] 点击最新回建筑");
        t0 = new Date().getTime();
        var onStage = false;
        var diagLogged = false;
        while (new Date().getTime() - t0 < sgs.TIMEOUT.page) {
            var im2 = v.frame(true);
            if (v.hasText("排行榜", this.STAGE_RANK_REGION, im2)
                || v.ocrRect(this.STAGE_STAR_REGION, im2).indexOf("/30") >= 0) { onStage = true; break; }
            if (!diagLogged && new Date().getTime() - t0 > 3000) {
                diagLogged = true;
                sgs.log.w("[zhuxian] 详情页判据未命中，排行榜区=「"
                    + v.ocrRect(this.STAGE_RANK_REGION, im2) + "」星数区=「"
                    + v.ocrRect(this.STAGE_STAR_REGION, im2) + "」");
            }
            sleep(700);
        }
        if (!onStage) throw new Error("未进入回详情页");
        sgs.log.i("[zhuxian] 已进入回详情页");

        // 3) 点 BOSS 角色本体 → 战斗面板
        check();
        v.clickPointAt(this.BOSS_BODY[0], this.BOSS_BODY[1]);
        sgs.log.i("[zhuxian] 点击 BOSS 角色本体");
        if (!this._waitPanel(8)) throw new Error("点击 BOSS 后未出现战斗面板");

        // 4) 读次数
        var attempts = this._readAttempts();
        if (attempts < 0) throw new Error("挑战次数识别失败");
        summary.attemptsBefore = attempts;
        sgs.log.i("[zhuxian] 挑战次数 " + attempts + "/5");

        // 5) 次数为 0：按开关决定是否重置
        if (attempts === 0) {
            if (!allowReset) return { status: "skipped", message: "挑战次数为 0，日常未允许元宝重置", reset: false, attemptsBefore: 0, swept: 0 };
            sgs.log.i("[zhuxian] 次数为 0，点击重置（20 元宝）");
            check();
            v.clickPointAt(this.SWEEP_BTN[0], this.SWEEP_BTN[1]);
            t0 = new Date().getTime();
            var dialog = false;
            while (new Date().getTime() - t0 < sgs.TIMEOUT.ui * 2) {
                if (v.hasText("重置副本", this.RESET_DIALOG_REGION)) { dialog = true; break; }
                sleep(600);
            }
            if (!dialog) throw new Error("未出现重置确认弹窗，放弃消费");
            check();
            v.clickPointAt(this.RESET_CONFIRM[0], this.RESET_CONFIRM[1]);
            sgs.log.i("[zhuxian] 已确认重置");
            if (!this._waitPanel(8)) throw new Error("重置后面板未恢复");
            attempts = this._readAttempts();
            if (attempts <= 0) throw new Error("重置后次数仍为 0，结果异常");
            summary.reset = true;
            sgs.log.i("[zhuxian] 重置后次数 " + attempts + "/5");
        }

        // 6) 确认按钮当前是「扫荡N次」（不是重置/挑战），识别到才点
        if (!v.hasText("扫荡", this.SWEEP_REGION)) {
            throw new Error("未识别到扫荡按钮（可能关卡未三星或界面异常），不做盲点");
        }
        check();
        v.clickPointAt(this.SWEEP_BTN[0], this.SWEEP_BTN[1]);
        sgs.log.i("[zhuxian] 已点击扫荡（" + attempts + " 次，预计耗体力 " + (attempts * 5) + "）");

        // 7) 等战报
        var r = this._waitReport(15);
        if (r === "no_stamina") throw new Error("体力不足，扫荡被拒绝");
        if (r === "timeout") throw new Error("未出现扫荡战报，扫荡结果未知");
        summary.swept = attempts;
        var totalSeen = v.hasText("总计获得", this.REPORT_SUM_REGION);
        summary.status = totalSeen ? "success" : "unconfirmed";
        summary.message = totalSeen ? "已确认扫荡战报和总计获得" : "已见扫荡战报，但总计获得未确认";
        if (totalSeen) {
            sgs.log.i("[zhuxian] 战报确认：扫荡战报 + 总计获得，共扫荡 " + attempts + " 次");
        } else {
            sgs.log.w("[zhuxian] 已见扫荡战报，但未读到「总计获得」，请人工回看截图");
        }

        // 8) 关战报（蓝 X），确认战报消失
        check();
        v.clickPointAt(this.BLUE_X[0], this.BLUE_X[1]);
        t0 = new Date().getTime();
        while (new Date().getTime() - t0 < sgs.TIMEOUT.ui) {
            if (!v.hasText("扫荡战报", this.REPORT_TITLE_REGION)) break;
            sleep(600);
        }

        // 9) 关 BOSS 面板（同一个蓝 X 位），确认面板判据消失
        check();
        v.clickPointAt(this.BLUE_X[0], this.BLUE_X[1]);
        t0 = new Date().getTime();
        while (new Date().getTime() - t0 < sgs.TIMEOUT.ui) {
            if (!this._panelOpen()) break;
            sleep(600);
        }
        sgs.log.i("[zhuxian] 战斗面板已关闭");

        // 10) 返回主城：最多点 3 次返回，每次后用 isHome 正向确认，到了立刻停。
        // 不能盲点固定两次：返回箭头 (110,70) 与主城头像 (110,95) 很近，多一下会点开玩家信息面板
        var home = false;
        for (var bi = 0; bi < 3 && !home; bi++) {
            check();
            v.clickPointAt(this.BACK_ARROW[0], this.BACK_ARROW[1]);
            t0 = new Date().getTime();
            while (new Date().getTime() - t0 < 4000) {
                if (v.isHome(v.frame(true))) { home = true; break; }
                sleep(700);
            }
        }
        if (!home) throw new Error("扫荡完成但未能确认回到主城");
        sgs.log.i("[zhuxian] 已回到主城，任务结束 " + JSON.stringify(summary));
        return summary;
    }
};
