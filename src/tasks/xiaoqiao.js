// tasks/xiaoqiao.js —— 主城小乔·一键日常（AutoX 版）
// 注意：点「开启」会花元宝买体力/精力丹，属预期行为（EC 版实测消耗约 80）
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.xiaoqiao = {
    id: "xiaoqiao",
    name: "主城小乔·一键日常",

    ENTRY: "xiaoqiao/entry-left.png",
    // 入口是悬浮头像，只会在屏幕左右两侧出现，纵向位置不固定 —— 所以两条搜索带拉满全高。
    // 不做全屏兜底：全屏会让模板误匹配到画面里其他圆头像，点过去就是乱点
    ENTRY_LEFT: [0, 0, 400, 1280],
    ENTRY_RIGHT: [2372, 0, 2772, 1280],
    ENTRY_RIGHT_TPL: "xiaoqiao/home-avatar.png",
    ENTRY_TH: 0.75,

    TAB_TEXT: "日常功能",
    TAB_CHECK: "日常", // OCR 常把「功」认成「劝」，判断时用短词
    TAB_REGION: [1820, 390, 2090, 535],

    KAIQI: "xiaoqiao/kaiqi.png",
    KAIQI_REGION: [1800, 700, 2150, 1050],
    KAIQI_POINT: [1900, 940], // 仅作文档参考；点击一律用图识别到的按钮中心，不做盲点兜底
    KAIQI_TH: 0.8,

    COMPLETION_REGION: [860, 1060, 1980, 1165],
    REWARD_REGION: [950, 70, 1850, 260],
    BLANK_TAP: [400, 640],
    RESULT_CLOSE: [1940, 88],
    PANEL_CLOSE: [2127, 235],
    AGAIN_REGION: [875, 530, 1870, 675],
    CONFIRM_REGION: [1430, 800, 1800, 925],

    POLL_MS: 8000,
    RUN_TIMEOUT: 420000,

    _findAvatar: function () {
        var v = sgs.vision;
        var img = v.frame(true);
        if (!img) return null;
        // 只认左右两条侧带，不做全屏兜底
        var cands = [
            { tpl: this.ENTRY, rect: this.ENTRY_LEFT },
            { tpl: this.ENTRY_RIGHT_TPL, rect: this.ENTRY_RIGHT }
        ];
        for (var i = 0; i < cands.length; i++) {
            var p = v.find(cands[i].tpl, this.ENTRY_TH, cands[i].rect, img);
            if (p) {
                sgs.log.i("头像命中 " + cands[i].tpl
                    + (cands[i].rect ? " 区域" + JSON.stringify(cands[i].rect) : " 全屏")
                    + " 中心 " + p.x + "," + p.y);
                return p;
            }
        }
        return null;
    },

    _done: function () {
        var v = sgs.vision;
        var im = v.frame(true);
        // 结果窗底部绿条（实测 RGB #80CF4C）：OCR 读不出描边字，改判颜色
        try {
            var b = this.COMPLETION_REGION;
            var c = images.clip(im, b[0], b[1], b[2] - b[0], b[3] - b[1]);
            try {
                if (images.findColor(c, "#80CF4C", { threshold: 60 })) return true;
            } finally { try { c.recycle(); } catch (r) { } }
        } catch (e) { }
        return false;
    },

    _findReward: function () {
        var v = sgs.vision;
        return v.hasText("恭喜获得", this.REWARD_REGION) || v.hasText("贡献获得", this.REWARD_REGION);
    },

    _panelOpen: function () {
        return sgs.vision.hasImage(this.KAIQI, this.KAIQI_REGION, this.KAIQI_TH);
    },

    // 面板判定：Tab 文字在 = 面板已开。不靠「找不到头像就当面板开着」这种反推，
    // 头像识别失败的原因可能是加载中、被弹窗盖住、模板失配，反推会直接跳到盲点。
    _panelOpenExplicit: function () {
        var v = sgs.vision;
        return v.hasText(this.TAB_TEXT, this.TAB_REGION) || v.hasText(this.TAB_CHECK, this.TAB_REGION);
    },

    _openPanel: function () {
        var v = sgs.vision;
        if (this._panelOpenExplicit()) {
            sgs.log.i("小乔助手面板已打开");
            return;
        }
        var t0 = new Date().getTime();
        var avatar = this._findAvatar();
        while (!avatar && new Date().getTime() - t0 < sgs.TIMEOUT.page) {
            sleep(800);
            avatar = this._findAvatar();
        }
        if (!avatar) throw new Error("未识别到小乔头像，无法打开助手面板");
        // 点识别到的中心点。find() 返回的已经是模板中心，不是左上角
        v.clickPointAt(avatar.x, avatar.y);
        sgs.log.i("已点击小乔头像 (" + avatar.x + "," + avatar.y + ")");
        if (!this._waitPanel(1)) throw new Error("点击头像后未确认助手面板");
        sgs.log.i("小乔助手面板已打开");
    },

    /** 等面板出现，最多 timeout 秒，命中即返回 true */
    _waitPanel: function (timeoutSec) {
        var t0 = new Date().getTime();
        while (new Date().getTime() - t0 < timeoutSec * 1000) {
            if (this._panelOpenExplicit()) return true;
            sleep(700);
        }
        return false;
    },

    _openDailyTab: function () {
        var v = sgs.vision;
        for (var t = 1; t <= 3; t++) {
            // 每轮先确认 Tab 还在。不在说明面板已经没了或点歪了，
            // 这时继续按固定坐标点下去，点在什么功能上完全不可控（可能是花元宝的入口）
            if (!this._panelOpenExplicit()) throw new Error("找不到「日常功能」Tab");
            v.tapRect(this.TAB_REGION);
            sgs.log.i("点击「日常功能」Tab（第 " + t + " 轮）");
            var btn = v.waitImage(this.KAIQI, sgs.TIMEOUT.page, this.KAIQI_REGION, this.KAIQI_TH);
            if (btn) { sgs.log.i("已识别到「开启」按钮"); return btn; }
            sgs.log.w("第 " + t + " 轮图识别未命中");
        }
        throw new Error("连续 3 次未出现「开启」按钮");
    },

    _closeResult: function () {
        var v = sgs.vision, completionSeen = false;
        sleep(800);

        // 1) 奖励弹窗：点空白优先，右上 X 兜底
        for (var r = 1; r <= 3 && this._findReward(); r++) {
            v.clickPointAt(this.BLANK_TAP[0], this.BLANK_TAP[1]);
            var d1 = new Date().getTime();
            while (new Date().getTime() - d1 < sgs.TIMEOUT.ui && this._findReward()) sleep(700);
            sgs.log.i("奖励弹窗空白关闭第 " + r + " 轮，仍在=" + this._findReward());
        }
        if (this._findReward()) {
            sgs.log.e("空白点击无效，兜底点右上 X");
            for (var x = 1; x <= 3 && this._findReward(); x++) {
                v.clickPointAt(this.RESULT_CLOSE[0], this.RESULT_CLOSE[1]);
                var d2 = new Date().getTime();
                while (new Date().getTime() - d2 < sgs.TIMEOUT.ui && this._findReward()) sleep(700);
            }
            if (this._findReward()) throw new Error("奖励弹窗未能关闭");
        }

        // 2) 旧版「执行完成」结果窗
        for (var c = 1; c <= 3 && this._done(); c++) {
            completionSeen = true;
            v.clickPointAt(this.RESULT_CLOSE[0], this.RESULT_CLOSE[1]);
            var d3 = new Date().getTime();
            while (new Date().getTime() - d3 < sgs.TIMEOUT.ui && this._done()) sleep(700);
        }

        // 3) 助手面板金色 X
        for (var p = 1; p <= 3; p++) {
            if (!this._panelOpen() && sgs.vision.isHome()) {
                sgs.log.i("已确认回到主城");
                return completionSeen;
            }
            if (this._panelOpen()) {
                v.clickPointAt(this.PANEL_CLOSE[0], this.PANEL_CLOSE[1]);
                sgs.log.i("点击面板关闭（第 " + p + " 轮）");
                var d4 = new Date().getTime();
                while (new Date().getTime() - d4 < sgs.TIMEOUT.ui && this._panelOpen()) sleep(700);
            } else {
                sleep(700);
            }
        }
        // 未知页面不再盲点左上角；由日常恢复器识别已知页面，无法确认就停止。
        if (!sgs.vision.isHome(v.frame(true))) throw new Error("面板未能关闭并回到主城");
        sgs.log.i("已确认回到主城");
        return completionSeen;
    },

    run: function (options) {
        var v = sgs.vision;
        var check = options && options.checkCancelled ? options.checkCancelled : function () { };
        var progress = options && options.onProgress ? options.onProgress : function () { };
        check();
        progress("打开助手", "识别小乔头像与日常功能");
        this._openPanel();
        var btn = this._openDailyTab();
        sgs.log.i("「日常功能」页就绪");

        // 使用实际识别坐标；点击前再次检查停止请求。
        check();
        v.clickRect(btn);
        sgs.log.i("已点击「开启」(" + btn.x + "," + btn.y + ")，每 " + (this.POLL_MS / 1000) + " 秒轮询，超时 " +
            Math.round(this.RUN_TIMEOUT / 1000) + " 秒");

        progress("等待完成", "已点击开启，等待整套日常结束");
        var deadline = new Date().getTime() + this.RUN_TIMEOUT;
        var againConfirmed = false;
        while (new Date().getTime() < deadline) {
            check();
            progress("等待完成", "等待完成标志，剩余等待上限 " + Math.max(0, Math.ceil((deadline - new Date().getTime()) / 1000)) + " 秒");
            if (this._findReward()) {
                sgs.log.i("识别到奖励弹窗，整套日常状态待确认");
                progress("核对结果", "已见奖励弹窗，继续核对整套完成并回城");
                var completionSeen = this._closeResult();
                return { status: completionSeen ? "success" : "unconfirmed",
                    message: completionSeen ? "已确认执行完成并返回主城" : "已关闭奖励弹窗，但整套日常完成状态未确认" };
            }
            if (this._done()) {
                sgs.log.i("识别到「执行完成」绿条");
                progress("返回主城", "已见执行完成标志，关闭助手并回城");
                this._closeResult();
                return { status: "success", message: "已识别执行完成标志并返回主城" };
            }
            if (!againConfirmed && v.hasText("再次执行", this.AGAIN_REGION)) {
                if (!v.waitText("确认", this.CONFIRM_REGION, sgs.TIMEOUT.page)) {
                    throw new Error("「再次执行」弹窗未识别到确认");
                }
                check();
                v.tapRect(this.CONFIRM_REGION);
                againConfirmed = true;
                deadline = new Date().getTime() + this.RUN_TIMEOUT;
                sgs.log.i("已确认「再次执行」，重新计时");
            }
            var remain = deadline - new Date().getTime();
            sleep(Math.min(this.POLL_MS, remain > 0 ? remain : 1));
        }
        throw new Error("未识别到完成信号");
    }
};

// 诊断任务：查看结果区 OCR 原文与颜色
sgs.tasks.diag = {
    id: "diag", name: "诊断",
    run: function () {
        var v = sgs.vision;
        var im = v.frame(true);
        sgs.log.i("[diag] 帧 " + im.getWidth() + "x" + im.getHeight() + " scale=" + JSON.stringify(v._scale));
        var zones = {
            big: [860, 1060, 1980, 1165],
            tight: [1280, 1075, 1460, 1145],
            small: [1190, 1070, 1580, 1155]
        };
        for (var k in zones) {
            try { sgs.log.i("[diag] " + k + " 原文=「" + v.ocrRect(zones[k], im) + "」"); }
            catch (e) { sgs.log.e("[diag] " + k + " 异常 " + e); }
        }
        try {
            var b = [860, 1060, 1980, 1165];
            var c = images.clip(im, b[0], b[1], b[2] - b[0], b[3] - b[1]);
            var p = images.findColor(c, "#3CC83C", { threshold: 80 });
            sgs.log.i("[diag] 绿色命中 " + (p ? p.x + "," + p.y : "null"));
        } catch (e2) { sgs.log.e("[diag] findColor 异常 " + e2); }
    }
};
