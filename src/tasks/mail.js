// tasks/mail.js —— 邮件全部领取（AutoX 版，流程与 EC 版一致）
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.mail = {
    id: "mail",
    name: "邮件全部领取",

    ENTRY: "daily_task/youjian.png",
    ENTRY_REGION: [60, 150, 520, 400],
    CLAIM: "daily_task/quanbulingqu.png",
    CLAIM_REGION: [400, 900, 1000, 1200],
    CLOSE: "daily_task/close.png",
    CLOSE_REGION: [2200, 80, 2500, 360],
    REWARD: "daily_task/reward_popup.png",
    REWARD_REGION: [900, 80, 1900, 330],
    DISMISS: [1386, 1180],

    run: function () {
        var v = sgs.vision;

        // 1) 打开邮件弹窗
        var opened = false;
        for (var i = 1; i <= 3; i++) {
            if (v.tapImage(this.ENTRY, 0.8, this.ENTRY_REGION)) {
                sgs.log.i("点击邮件入口（第 " + i + " 轮）");
                if (v.waitImage(this.CLOSE, sgs.TIMEOUT.page, this.CLOSE_REGION, 0.8)) {
                    opened = true;
                    break;
                }
            }
            sleep(600);
        }
        if (!opened) throw new Error("未找到邮件入口或弹窗未打开");
        sgs.log.i("邮件弹窗已打开");

        // 2) 全部领取。有附件会弹「恭喜获得」浮层，点屏幕下方空白即关；
        //    无可领邮件时按钮不消失、点了也没反应，所以不拿按钮当判据，点完就走。
        //    被 loading 吞掉也只影响这一次，日常天天跑，不必为此反复重试。
        for (var ci = 1; ci <= 2; ci++) {
            if (!v.tapImage(this.CLAIM, 0.8, this.CLAIM_REGION)) {
                sgs.log.i("未检测到全部领取按钮");
                break;
            }
            sgs.log.i("点击「全部领取」（第 " + ci + " 轮）");
            sleep(2000);
            v.clickPointAt(this.DISMISS[0], this.DISMISS[1]);
            sleep(600);
        }

        // 3) 关闭弹窗，确认回主城
        var cp = v.find(this.CLOSE, 0.8, this.CLOSE_REGION, v.frame(true));
        sgs.log.i("关闭按钮命中 " + (cp ? (cp.x + "," + cp.y) : "无"));
        var closed = false;
        for (var j = 1; j <= 3; j++) {
            if (v.tapImage(this.CLOSE, 0.8, this.CLOSE_REGION)) {
                sleep(900);
                // 判定弹窗是否真关掉，看「全部领取」按钮还在不在。
                // 不能用"close 图标找不到"当依据——模板匹不上时 hasImage 恒 false，
                // 会被当成已关闭，一步没点就误报成功（踩过一次）
                if (!v.hasImage(this.CLAIM, this.CLAIM_REGION, 0.8)) {
                    closed = true;
                    break;
                }
            }
            sleep(600);
        }
        if (!closed) throw new Error("邮件弹窗未能关闭");
        sgs.log.i("邮件弹窗已关闭");

        var home = v.waitImage(sgs.ANCHOR.image, sgs.TIMEOUT.ui, sgs.ANCHOR.region, 0.72);
        if (!home) throw new Error("关闭弹窗后未确认回到主城");
        sgs.log.i("邮件任务完成");
    }
};
