// tasks/junqing.js —— 紧急军情·一键挑战
// 实测流程：主城中下方第三个发光图标 -> 「敌军入侵，十万火急」面板 -> 右下「一键挑战」
//          -> 「恭喜获得」浮层（点任意位置关） -> 三关变「已击杀」 -> 蓝 X 关面板回主城
// 注意：一键挑战会消耗体力（实测一关 10 点，三关 30 点），属预期行为
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.junqing = {
    id: "junqing",
    name: "紧急军情·一键挑战",

    ENTRY: "special_event/jinjijunqing.png",
    ENTRY_REGION: [1000, 930, 1250, 1090],

    ONECLICK: "special_event/yijiantiaozhan.png",
    // 面板打开后这个按钮在 (2550,1234) 附近，和主城「冒险/征战」在同一块像素上，
    // 所以绝不能拿它当「面板是否已开」的判据（会把主城误判成面板，直接点进冒险）
    ONECLICK_REGION: [2360, 1100, 2740, 1280],

    TITLE_REGION: [700, 240, 2100, 350],
    REWARD_REGION: [700, 40, 2100, 230],
    BLANK: [1386, 700],

    // 面板关闭按钮是固定 UI（不在可拖动区域），实测 (2410,174) 稳定命中
    CLOSE_X: [2410, 174],

    // 三关「已击杀」标签的位置，用来判断本次是否真的打完了
    DONE_REGIONS: [
        [790, 910, 930, 1020],
        [1180, 910, 1320, 1020],
        [1570, 910, 1710, 1020]
    ],

    /** 面板判据：标题文字。一次 OCR 判完，别按关键词拆成多次 hasText */
    _panelOpen: function (img) {
        var v = sgs.vision;
        // 点击入口、领奖或关闭后必须读取新画面；ocrRect 默认会复用缓存。
        img = img || v.frame(true);
        if (!img) return false;
        var t = v.ocrRect(this.TITLE_REGION, img).replace(/\s+/g, "");
        return t.indexOf("敌军") >= 0 || t.indexOf("十万火急") >= 0 || t.indexOf("讨战") >= 0;
    },

    _doneCount: function () {
        var v = sgs.vision;
        var n = 0;
        for (var i = 0; i < this.DONE_REGIONS.length; i++) {
            if (v.hasText("击杀", this.DONE_REGIONS[i])) n++;
        }
        return n;
    },

    _openPanel: function () {
        var v = sgs.vision;
        if (this._panelOpen()) {
            sgs.log.i("紧急军情面板已打开");
            return true;
        }
        var seen = false;
        var opened = false;
        for (var i = 1; i <= 3; i++) {
            if (!v.tapImage(this.ENTRY, 0.8, this.ENTRY_REGION)) {
                sgs.log.w("第 " + i + " 轮未识别到紧急军情入口");
                sleep(700);
                continue;
            }
            seen = true;
            sgs.log.i("点击紧急军情入口（第 " + i + " 轮）");
            var t0 = new Date().getTime();
            while (new Date().getTime() - t0 < sgs.TIMEOUT.page) {
                sleep(700);
                if (this._panelOpen()) { opened = true; break; }
            }
            if (opened) break;
        }
        if (opened) {
            sgs.log.i("紧急军情面板已打开");
            return true;
        }
        // 这一排日常图标是按数量居中的：紧急军情打完后图标本身会消失，
        // 位置会整体右移。所以入口缺失不能一律当异常，也不能盲点固定坐标兜底
        if (!seen) {
            sgs.log.i("主城未出现紧急军情入口，按今日已完成处理");
            return false;
        }
        throw new Error("识别到紧急军情入口但面板未打开");
    },

    /**
     * 等「恭喜获得」浮层并点掉。返回是否真的出现并关掉了。
     * 只在识别到浮层时才点：没浮层时面板中部正好是关卡立绘，盲点会进「过关斩将」（踩过一次）
     */
    _dismissReward: function () {
        var v = sgs.vision;
        // 浮层基本点完就弹，等 8 轮（约 7s）足够，不拿 TIMEOUT.page 空等
        for (var i = 0; i < 8; i++) {
            sleep(900);
            if (v.hasText("恭喜获得", this.REWARD_REGION)) {
                sgs.log.i("出现「恭喜获得」浮层，点空白关闭");
                v.clickPointAt(this.BLANK[0], this.BLANK[1]);
                sleep(1000);
                return true;
            }
        }
        sgs.log.w("未出现「恭喜获得」浮层，本次可能没有可领取的奖励");
        return false;
    },

    run: function () {
        var v = sgs.vision;

        if (!this._openPanel()) {
            sgs.log.i("紧急军情今日无可挑战，任务结束");
            return;
        }

        if (!v.tapImage(this.ONECLICK, 0.8, this.ONECLICK_REGION)) {
            throw new Error("未识别到「一键挑战」按钮，未发起挑战");
        }
        sgs.log.i("点击「一键挑战」");

        var gotReward = this._dismissReward();
        if (gotReward) sgs.log.i("奖励浮层已关闭");

        // 结果校验：面板必须还在。点完就退出等于把「有没有打到」全交给运气
        if (!this._panelOpen()) throw new Error("点击一键挑战后界面异常，面板未保持");
        var done = this._doneCount();
        if (done === 0) throw new Error("未识别到「已击杀」标签，挑战结果未知");
        sgs.log.i("已击杀关卡 " + done + "/" + this.DONE_REGIONS.length);
        if (done < this.DONE_REGIONS.length) {
            sgs.log.w("只识别到 " + done + " 个「已击杀」，其余可能是识别误差或未解锁");
        }

        // 关面板回主城
        var closed = false;
        for (var c = 1; c <= 3; c++) {
            v.clickPointAt(this.CLOSE_X[0], this.CLOSE_X[1]);
            sleep(1200);
            if (!this._panelOpen()) { closed = true; break; }
            sgs.log.w("面板未关闭，重试（第 " + c + " 轮）");
        }
        if (!closed) throw new Error("紧急军情面板未能关闭");

        var home = v.waitImage(sgs.ANCHOR.image, sgs.TIMEOUT.ui, sgs.ANCHOR.region, 0.72);
        if (!home) throw new Error("关闭面板后未确认回到主城");
        sgs.log.i("紧急军情任务完成");
    }
};
