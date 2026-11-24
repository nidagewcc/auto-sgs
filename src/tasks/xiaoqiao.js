// tasks/xiaoqiao.js —— 主城小乔·一键日常（AutoX 版）
// 注意：点「开启」会花元宝买体力/精力丹，属预期行为（EC 版实测消耗约 80）
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.xiaoqiao = {
    id: "xiaoqiao",
    name: "主城小乔·一键日常",

    ENTRY: "xiaoqiao/xiaoqiao_entry.png",
    ENTRY_LEFT: [0, 0, 180, 1280],
    ENTRY_RIGHT: [2670, 0, 2772, 1280],
    ENTRY_RIGHT_TPL: "xiaoqiao/home-avatar.png",
    ENTRY_TH: 0.86,

    TAB_TEXT: "日常功能",
    TAB_REGION: [1820, 390, 2090, 535],

    KAIQI: "xiaoqiao/kaiqi.png",
    KAIQI_REGION: [1800, 700, 2150, 1050],
    KAIQI_TH: 0.8,

    COMPLETION_REGION: [1190, 1070, 1580, 1155],
    REWARD_REGION: [950, 70, 1850, 260],
    BLANK_TAP: [400, 640],
    RESULT_CLOSE: [1999, 89],
    PANEL_CLOSE: [2127, 235],
    AGAIN_REGION: [875, 530, 1870, 675],
    CONFIRM_REGION: [1430, 800, 1800, 925],

    POLL_MS: 8000,
    RUN_TIMEOUT: 420000,

    _findAvatar: function () {
        var v = sgs.vision;
        var p = v.find(this.ENTRY, this.ENTRY_TH, this.ENTRY_LEFT, v.frame(true));
        if (p) return p;
        return v.find(this.ENTRY_RIGHT_TPL, this.ENTRY_TH, this.ENTRY_RIGHT, v.frame(true));
    },

    _findReward: function () {
        var v = sgs.vision;
        return v.hasText("恭喜获得", this.REWARD_REGION) || v.hasText("贡献获得", this.REWARD_REGION);
    },

    _panelOpen: function () {
        return sgs.vision.hasImage(this.KAIQI, this.KAIQI_REGION, this.KAIQI_TH);
    },

    _openPanel: function () {
        var v = sgs.vision;
        if (v.hasText(this.TAB_TEXT, this.TAB_REGION)) {
            sgs.log.i("小乔助手面板已打开");
            return;
        }
        var t0 = new Date().getTime();
        var avatar = this._findAvatar();
        while (!avatar && new Date().getTime() - t0 < sgs.TIMEOUT.page) {
            sleep(800);
            avatar = this._findAvatar();
        }
        if (!avatar) throw new Error("未识别到小乔头像");
        v.clickRect(avatar);
        sgs.log.i("已点击小乔头像");
        if (!v.waitText(this.TAB_TEXT, this.TAB_REGION, sgs.TIMEOUT.page)) {
            throw new Error("点击头像后未确认助手面板");
        }
        sgs.log.i("小乔助手面板已打开");
    },

    _openDailyTab: function () {
        var v = sgs.vision;
        for (var t = 1; t <= 3; t++) {
            if (!v.hasText(this.TAB_TEXT, this.TAB_REGION)) {
                throw new Error("找不到「日常功能」Tab");
            }
            v.tapRect(this.TAB_REGION);
            sgs.log.i("点击「日常功能」Tab（第 " + t + " 轮）");
            var btn = v.waitImage(this.KAIQI, sgs.TIMEOUT.page, this.KAIQI_REGION, this.KAIQI_TH);
            if (btn) return btn;
        }
        throw new Error("连续 3 次未出现开启按钮");
    },

    _closeResult: function () {
        var v = sgs.vision;
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
        for (var c = 1; c <= 3 && v.hasText("执行完成", this.COMPLETION_REGION); c++) {
            v.clickPointAt(this.RESULT_CLOSE[0], this.RESULT_CLOSE[1]);
            var d3 = new Date().getTime();
            while (new Date().getTime() - d3 < sgs.TIMEOUT.ui && v.hasText("执行完成", this.COMPLETION_REGION)) sleep(700);
        }

        // 3) 助手面板金色 X
        for (var p = 1; p <= 3; p++) {
            if (!this._panelOpen() && sgs.vision.isHome()) {
                sgs.log.i("已确认回到主城");
                return;
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
        if (!sgs.vision.isHome()) throw new Error("面板未能关闭并回到主城");
        sgs.log.i("已确认回到主城");
    },

    run: function () {
        var v = sgs.vision;

        this._openPanel();
        var btn = this._openDailyTab();
        sgs.log.i("「日常功能」页就绪");

        v.clickRect(btn);
        sgs.log.i("已点击「开启」，每 " + (this.POLL_MS / 1000) + " 秒轮询，超时 " +
            Math.round(this.RUN_TIMEOUT / 1000) + " 秒");

        var deadline = new Date().getTime() + this.RUN_TIMEOUT;
        var againConfirmed = false;
        while (new Date().getTime() < deadline) {
            if (this._findReward()) {
                sgs.log.i("识别到完成弹窗");
                this._closeResult();
                return;
            }
            if (v.hasText("执行完成", this.COMPLETION_REGION)) {
                sgs.log.i("识别到「执行完成」绿条");
                this._closeResult();
                return;
            }
            if (!againConfirmed && v.hasText("再次执行", this.AGAIN_REGION)) {
                if (!v.waitText("确认", this.CONFIRM_REGION, sgs.TIMEOUT.page)) {
                    throw new Error("「再次执行」弹窗未识别到确认");
                }
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
